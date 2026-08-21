#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DEL PESO DEL ENVÍO (Regla 14).
//
// El bug que fija: el 21-ago-2026 /cotizaciones se caía al adjuntar documentos.
// No era del formulario. El tope de un request en Vercel es 4,5 MB y lo corta EN
// EL BORDE con un 413 (`FUNCTION_PAYLOAD_TOO_LARGE`): la función no llega a
// existir, así que no hay excepción, no hay digest y el proveedor ve "Se nos
// cayó la página" sin código. Mientras tanto el navegador le decía que 25 MB por
// archivo estaba bien, y `next.config` decía "15mb" — dos permisos que nadie iba
// a honrar.
//
// Lo que se cuida acá:
//   1. El tope que le prometemos al proveedor cabe DEBAJO del de Vercel.
//   2. `next.config.mjs` dice lo mismo que `lib/documentos.ts` (una sola cifra).
//   3. El peso se juzga sobre el CONJUNTO: tres de 2 MB pasan uno a uno y el
//      envío se cae igual.
//   4. El mensaje NOMBRA el archivo pesado y dice qué hacer (Regla 18).
//
//   node scripts/test_peso_documentos.js

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, titulo, detalle = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${titulo}${detalle ? " — " + detalle : ""}`);
  if (!ok) fallos.push(titulo);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "peso-"));
try {
  execFileSync("npx", ["tsc", "lib/documentos.ts", "--outDir", tmp,
                       "--module", "commonjs", "--target", "es2020", "--lib", "es2020,dom",
                       "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" });
} catch (e) { /* emite igual */ }
const { TOPE_ENVIO_BYTES, pesoLegible, motivoPorPesoTotal, motivoRechazo } =
  require(path.join(tmp, "documentos.js"));

// El número de Vercel, escrito acá para que se vea de dónde sale el margen.
// https://vercel.com/docs/functions/limitations#request-body-size
const TOPE_VERCEL = 4.5 * 1000 * 1000;

console.log("\n1) Lo que prometemos cabe debajo de lo que manda Vercel");
check(TOPE_ENVIO_BYTES < TOPE_VERCEL,
      "el tope del formulario es MENOR que el de Vercel",
      `${pesoLegible(TOPE_ENVIO_BYTES)} < ${pesoLegible(TOPE_VERCEL)}`);
check(TOPE_VERCEL - TOPE_ENVIO_BYTES >= 300 * 1000,
      "queda margen para los campos de texto y el multipart",
      pesoLegible(TOPE_VERCEL - TOPE_ENVIO_BYTES));

console.log("\n2) next.config.mjs dice lo mismo (una sola cifra, no dos)");
const conf = fs.readFileSync(path.join(RAIZ, "next.config.mjs"), "utf8");
const m = /bodySizeLimit:\s*"(\d+(?:\.\d+)?)(mb|kb)"/i.exec(conf);
check(Boolean(m), "hay bodySizeLimit declarado en next.config.mjs");
if (m) {
  const bytes = parseFloat(m[1]) * (m[2].toLowerCase() === "mb" ? 1000 * 1000 : 1000);
  check(bytes <= TOPE_VERCEL,
        "bodySizeLimit no promete más de lo que Vercel deja pasar", m[0]);
  check(Math.abs(bytes - TOPE_ENVIO_BYTES) <= 500 * 1000,
        "bodySizeLimit y TOPE_ENVIO_BYTES están alineados",
        `${pesoLegible(bytes)} vs ${pesoLegible(TOPE_ENVIO_BYTES)}`);
}

console.log("\n3) El peso se juzga sobre el CONJUNTO");
const doc = (nombre, mb, etiqueta) => ({ nombre, peso: mb * 1000 * 1000, etiqueta });
check(motivoPorPesoTotal([doc("cert.pdf", 0.2, "Certificación"),
                          doc("rut.pdf", 0.3, "RUT"),
                          doc("cot.pdf", 0.4, "Documento soporte")]) === null,
      "tres documentos livianos pasan");
const tres = motivoPorPesoTotal([doc("cert.pdf", 2, "Certificación"),
                                 doc("rut.pdf", 2, "RUT"),
                                 doc("cot.pdf", 2, "Documento soporte")]);
check(tres !== null,
      "TRES de 2 MB se rechazan aunque cada uno quepa solo",
      tres ? "" : "¡PASARON! — es exactamente el 413 de producción");
check(motivoPorPesoTotal([]) === null, "sin documentos no hay nada que rechazar");
check(motivoPorPesoTotal([doc("uno.pdf", 3.9, "Soporte")]) === null,
      "justo debajo del tope pasa");

console.log("\n4) El mensaje nombra al culpable y dice qué hacer (Regla 18)");
const msg = motivoPorPesoTotal([doc("cedula-foto.jpg", 6, "Cédula"),
                                doc("cert.pdf", 0.2, "Certificación")]);
check(Boolean(msg && msg.includes("cedula-foto.jpg")), "dice CUÁL archivo pesa");
check(Boolean(msg && msg.includes("Cédula")), "dice de qué casilla es");
check(Boolean(msg && /enlace/i.test(msg)), "ofrece una salida, no solo el 'no'");
check(Boolean(msg && !/\d{7,}/.test(msg)), "habla en MB, no en bytes crudos",
      msg ? msg.slice(0, 60) + "…" : "");

console.log("\n5) Un archivo solo tampoco puede pasarse del tope del envío");
const gordo = new File([new Uint8Array(10)], "escaneo.pdf");
Object.defineProperty(gordo, "size", { value: TOPE_ENVIO_BYTES + 1 });
check(motivoRechazo(gordo, "documento", "Soporte") !== null,
      "se rechaza el archivo que ya no cabe ni solo");

console.log("\n6) Los pesos se leen en cristiano");
check(pesoLegible(4 * 1000 * 1000) === "4,0 MB", "4 MB", pesoLegible(4 * 1000 * 1000));
check(pesoLegible(250 * 1000) === "250 KB", "250 KB", pesoLegible(250 * 1000));

console.log(`\n${fallos.length ? "🔴 " + fallos.length + " fallo(s): " + fallos.join(", ") : "🟢 todo OK"}`);
process.exit(fallos.length ? 1 : 0);
