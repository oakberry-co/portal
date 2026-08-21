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
//   3. El tope es POR DOCUMENTO, porque cada uno sube en su propia petición
//      (lib/intake-subida.ts). Un envío con cuatro documentos de 3 MB pasa; uno
//      solo de 5 MB, no.
//   4. El mensaje dice cuánto pesa y qué hacer (Regla 18).
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
const { TOPE_ARCHIVO_BYTES, pesoLegible, motivoRechazo } =
  require(path.join(tmp, "documentos.js"));

// El número de Vercel, escrito acá para que se vea de dónde sale el margen.
// https://vercel.com/docs/functions/limitations#request-body-size
const TOPE_VERCEL = 4.5 * 1000 * 1000;

console.log("\n1) Lo que prometemos cabe debajo de lo que manda Vercel");
check(TOPE_ARCHIVO_BYTES < TOPE_VERCEL,
      "el tope del formulario es MENOR que el de Vercel",
      `${pesoLegible(TOPE_ARCHIVO_BYTES)} < ${pesoLegible(TOPE_VERCEL)}`);
check(TOPE_VERCEL - TOPE_ARCHIVO_BYTES >= 300 * 1000,
      "queda margen para los campos de texto y el multipart",
      pesoLegible(TOPE_VERCEL - TOPE_ARCHIVO_BYTES));

console.log("\n2) next.config.mjs dice lo mismo (una sola cifra, no dos)");
const conf = fs.readFileSync(path.join(RAIZ, "next.config.mjs"), "utf8");
const m = /bodySizeLimit:\s*"(\d+(?:\.\d+)?)(mb|kb)"/i.exec(conf);
check(Boolean(m), "hay bodySizeLimit declarado en next.config.mjs");
if (m) {
  const bytes = parseFloat(m[1]) * (m[2].toLowerCase() === "mb" ? 1000 * 1000 : 1000);
  check(bytes <= TOPE_VERCEL,
        "bodySizeLimit no promete más de lo que Vercel deja pasar", m[0]);
  check(Math.abs(bytes - TOPE_ARCHIVO_BYTES) <= 500 * 1000,
        "bodySizeLimit y TOPE_ARCHIVO_BYTES están alineados",
        `${pesoLegible(bytes)} vs ${pesoLegible(TOPE_ARCHIVO_BYTES)}`);
}

console.log("\n3) El tope es POR DOCUMENTO (cada uno viaja en su propia petición)");
const archivo = (nombre, mb) => {
  const f = new File([new Uint8Array(10)], nombre);
  Object.defineProperty(f, "size", { value: Math.round(mb * 1000 * 1000) });
  return f;
};
check(motivoRechazo(archivo("cert.pdf", 3), "documento", "Certificación") === null,
      "un documento de 3 MB entra");
check(motivoRechazo(archivo("escaneo.pdf", 5), "documento", "Soporte") !== null,
      "uno de 5 MB no (Vercel lo cortaría en el borde, sin dejar error)");
// Lo que ANTES fallaba: cuatro documentos de 3 MB sumaban 12 MB y el envío moría
// entero. Hoy cada uno va solo, así que los cuatro pasan. Esto es el arreglo.
check([1, 2, 3, 4].every((i) => motivoRechazo(archivo(`d${i}.pdf`, 3), "documento", "Doc") === null),
      "CUATRO documentos de 3 MB pasan: 12 MB en total, ninguna petición sobre el tope");

console.log("\n4) El mensaje dice cuánto pesa y qué hacer (Regla 18)");
const msg = motivoRechazo(archivo("escaneo.pdf", 6), "documento", "Soporte");
check(/6,0 MB/.test(msg ?? ""), "dice cuánto pesa", (msg ?? "").slice(0, 55) + "…");
check(/Guardar como PDF/.test(msg ?? ""), "y cómo achicarlo");
check(!/\d{7,}/.test(msg ?? ""), "en MB, no en bytes crudos");

console.log("\n5) Los pesos se leen en cristiano");
check(pesoLegible(4 * 1000 * 1000) === "4,0 MB", "4 MB", pesoLegible(4 * 1000 * 1000));
check(pesoLegible(250 * 1000) === "250 KB", "250 KB", pesoLegible(250 * 1000));

console.log(`\n${fallos.length ? "🔴 " + fallos.length + " fallo(s): " + fallos.join(", ") : "🟢 todo OK"}`);
process.exit(fallos.length ? 1 : 0);
