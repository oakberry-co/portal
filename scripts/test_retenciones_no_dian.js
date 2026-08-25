#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE LAS DOS LLAVES DEL EXCEL DE RETENCIONES (Regla 14).
//
// Desde el 23-ago-2026 el Excel lleva las DOS clases de documento: las facturas
// DIAN con su CUFE, y lo que no tiene factura (cuentas de cobro, servicios
// públicos) con su referencia `CC-46` / `SP-51`. Los contadores les ponen su
// retención —aunque sea cero— y todo se paga en UNA sola tanda.
//
// Lo que se cuida, y por qué duele si se rompe:
//
//   1. LAS DOS LLAVES SE DISTINGUEN POR LA FORMA, nunca adivinando. Un CUFE son
//      96 hexadecimales; una referencia es CC/SP/OT + número. Si una se colara
//      como la otra, la retención de una cuenta de cobro se escribiría sobre una
//      factura ajena — y el 45,7% de las facturas comparte NIT y total con una
//      gemela, así que ni siquiera se notaría.
//   2. LA REFERENCIA VUELVE AL MISMO DOCUMENTO del que salió (Regla 15: lo que
//      sale tiene que poder volver). `refDe` la arma y `idDeRef` la deshace.
//   3. EL ENCABEZADO NUEVO Y EL VIEJO se aceptan los dos: el equipo tiene
//      archivos ya bajados que dicen "CUFE" a secas.
//
//   node scripts/test_retenciones_no_dian.js

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nodian-"));
try {
  execFileSync("npx", ["tsc", "lib/ref-documento.ts", "--outDir", tmp, "--module", "commonjs",
                       "--target", "es2020", "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" });
} catch { /* emite igual */ }
const { refDe, esRefNoDian, idDeRef } = require(path.join(tmp, "ref-documento.js"));

// Un CUFE de verdad, sacado de la base (96 hexadecimales).
const CUFE = "9570699b43e44a69a70e79a664fc885606de3734700299a10e7dd2472ab1ef9e89dcd72d4f7a25e65ebede0a3a123a66";

console.log("\n1) Un CUFE NUNCA se confunde con una referencia");
check(!esRefNoDian(CUFE), "el CUFE real no pasa por referencia");
check(idDeRef(CUFE) === null, "y no devuelve ningún id");
for (const s of ["", "  ", "46", "CC", "CC-", "CC-46-1", "FACTURA-46", "cc46", "9570699b"])
  check(!esRefNoDian(s), `'${s}' no es una referencia`);

console.log("\n2) La referencia se reconoce y devuelve SU id");
for (const [ref, id] of [["CC-46", 46], ["SP-51", 51], ["cc-7", 7], ["  CC-94  ", 94], ["OT-3", 3]]) {
  check(esRefNoDian(ref), `'${ref}' es una referencia`);
  check(idDeRef(ref) === id, `'${ref}' → id ${id}`, String(idDeRef(ref)));
}

console.log("\n3) IDA Y VUELTA: la referencia vuelve al mismo documento (Regla 15)");
// Se usa la MISMA `refDe` que la bandeja y el export — no una copia: si fueran
// dos, el Excel diría CC-46 donde la pantalla dice SP-46 y la retención se
// escribiría sobre otro documento.
const dnd = fs.readFileSync(path.join(RAIZ, "lib", "documentos-no-dian.ts"), "utf8");
check(/from "@\/lib\/ref-documento"/.test(dnd),
      "la bandeja toma refDe del módulo puro (no tiene su propia copia)");
for (const [tipo, id] of [["cuenta_cobro", 46], ["servicio_publico", 94], ["otro", 3], ["cuenta_cobro", 100000]]) {
  const ref = refDe(tipo, id);
  check(esRefNoDian(ref) && idDeRef(ref) === id, `${tipo}#${id} → ${ref} → ${id}`);
}

console.log("\n4) El export escribe la llave que el importador sabe leer");
const exp = fs.readFileSync(path.join(RAIZ, "app", "(portal)", "contabilidad", "conciliacion",
                                      "export", "route.ts"), "utf8");
check(/cufe:\s*refDe\(/.test(exp), "el export usa refDe para la columna de la llave");
check(/header:\s*"CUFE \/ Ref"/.test(exp), "y el encabezado dice que lleva las dos cosas");
check(/FROM cuentas_cobro cc/.test(exp), "el export SÍ trae los documentos sin factura DIAN");

console.log("\n5) Los encabezados viejos siguen sirviendo");
// El equipo tiene archivos ya bajados que dicen "CUFE" a secas: si dejaran de
// leerse, subirlos fallaría con "no encontré la columna" teniéndola.
const xls = fs.readFileSync(path.join(RAIZ, "lib", "retenciones-excel.ts"), "utf8");
const alias = /cufe:\s*\[([^\]]+)\]/.exec(xls)?.[1] ?? "";
check(/"cufe"/.test(alias), 'se acepta el encabezado viejo "CUFE"');
check(/"cufe ref"/.test(alias), 'y el nuevo "CUFE / Ref"');
check(/COLUMNAS\.cufe\.includes\(norm\(v\)\)/.test(xls),
      "la FILA del encabezado se busca con esos mismos alias (si no, el archivo nuevo no se reconoce)");

console.log("\n6) Cada clase escribe por SU camino, y hay uno solo por clase");
const apl = fs.readFileSync(path.join(RAIZ, "app", "(portal)", "contabilidad", "conciliacion",
                                      "retenciones-excel.ts"), "utf8");
check(/x\.clase === "no_dian"/.test(apl), "el aplicador despacha por la clase que decidió la llave");
check(/guardarRetencionesNoDian\(c, x\.id!/.test(apl), "los sin factura van al escritor no-DIAN");
check(/guardarRetenciones\(c, x\.cufe/.test(apl), "las facturas van al de siempre");
const modal = fs.readFileSync(path.join(RAIZ, "app", "(portal)", "contabilidad", "cuentas-de-cobro",
                                        "actions.ts"), "utf8");
check(/guardarRetencionesNoDian\(/.test(modal),
      "y el MODAL usa el mismo escritor que el Excel (un solo camino por clase)");
check(!/UPDATE cuentas_cobro\s+SET iva_incluido/.test(modal),
      "el modal ya no tiene su propia copia del UPDATE");

console.log(`\n${fallos.length ? "🔴 " + fallos.length + " fallo(s): " + fallos.join(", ") : "🟢 todo OK"}`);
process.exit(fallos.length ? 1 : 0);
