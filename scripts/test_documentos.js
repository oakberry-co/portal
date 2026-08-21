#!/usr/bin/env node
/* eslint-disable */
// CENTINELA del filtro de archivos (Regla 14).
//
// La regla que se cuida: la certificación bancaria y el documento soporte entran
// SOLO en PDF o Word; la cédula y el RUT aceptan además foto; y NINGUNO puede
// venir con contraseña. Si esto se afloja, vuelve el trabajo manual que costó:
// un PDF cifrado que nadie abre, o una foto de WhatsApp como certificación de la
// que hay que sacar un número de cuenta a ojo.
//
// Se prueba con PDFs REALES (los mismos que se usaron para el lector), no con
// bytes inventados.
//
//   node scripts/test_documentos.js

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "doc-"));
try {
  execFileSync("npx", ["tsc", "lib/documentos.ts", "--outDir", tmp,
                       "--module", "commonjs", "--target", "es2020", "--lib", "es2020,dom",
                       "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" });
} catch (e) { /* emite igual */ }
const { motivoRechazo, tieneClave } = require(path.join(tmp, "documentos.js"));

const falso = (nombre, bytes = 1000) =>
  new File([new Uint8Array(bytes)], nombre, { type: "" });

console.log("\n1) Certificación bancaria y soporte: PDF o Word, nada más");
for (const n of ["cert.pdf", "cert.PDF", "cert.doc", "cert.docx"]) {
  check(motivoRechazo(falso(n), "documento", "Certificación") === null, `entra ${n}`);
}
for (const n of ["cert.jpg", "foto.png", "cert.heic", "cert.zip", "cert.rar", "captura.webp", "sinextension"]) {
  const m = motivoRechazo(falso(n), "documento", "Certificación");
  check(m !== null, `RECHAZA ${n}`, m ? m.slice(0, 58) + "…" : "¡PASÓ!");
}

console.log("\n2) Cédula y RUT: además foto (llegan del celular)");
for (const n of ["cedula.jpg", "cedula.jpeg", "cedula.png", "cedula.heic", "rut.pdf"]) {
  check(motivoRechazo(falso(n), "libre", "Cédula") === null, `entra ${n}`);
}
for (const n of ["cedula.zip", "cedula.mp4", "cedula.exe"]) {
  check(motivoRechazo(falso(n), "libre", "Cédula") !== null, `RECHAZA ${n}`);
}

console.log("\n3) Tamaño");
// El tope real es el del ENVÍO (4 MB, ver TOPE_ENVIO_BYTES): lo pone Vercel, no
// nosotros. El peso del conjunto lo cuida scripts/test_peso_documentos.js.
check(motivoRechazo(falso("a.pdf", 26 * 1024 * 1024), "documento", "Soporte") !== null,
      "rechaza el archivo que no cabe en un envío");
check(motivoRechazo(new File([], "vacio.pdf"), "documento", "Soporte") !== null,
      "rechaza el archivo vacío (0 bytes)");

console.log("\n4) PDFs de verdad (fixtures del repo, cifrado AES-256 real)");
const PRUEBAS = path.join(RAIZ, "scripts", "fixtures");
const casos = [
  ["cert_con_clave.pdf", true],
  ["cert_sin_clave.pdf", false],
];
let vistos = 0;
(async () => {
  for (const [nombre, esperado] of casos) {
    const ruta = path.join(PRUEBAS, nombre);
    if (!fs.existsSync(ruta)) { check(false, `falta el fixture ${nombre}`); continue; }
    vistos++;
    const f = new File([fs.readFileSync(ruta)], nombre, { type: "application/pdf" });
    const conClave = await tieneClave(f);
    check(conClave === esperado,
          `${nombre}: ${esperado ? "se detecta la clave" : "pasa limpio"}`,
          conClave ? "tiene clave" : "sin clave");
  }
  check(vistos > 0, "hubo PDFs reales que probar", `${vistos} archivo(s)`);
  console.log(`\n${fallos.length ? "🔴 " + fallos.length + " fallo(s): " + fallos.join(", ") : "🟢 todo OK"}`);
  process.exit(fallos.length ? 1 : 0);
})();
