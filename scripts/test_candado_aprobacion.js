#!/usr/bin/env node
/* eslint-disable */
// EL CANDADO DE APROBACIÓN, probado contra el módulo REAL (Regla 14).
//
// Aprobar es lo que mete plata en el archivo del banco. Este test compila
// lib/certificaciones.ts y lib/areas.ts y les pregunta directamente — nada de
// re-escribir la lógica acá, que es como se destapó el bug del 19-ago: había dos
// copias de la misma consulta y una envejeció.
//
// Lo que se fija:
//   · el camino normal exige los 4 documentos, certificación válida, cuenta
//     verificada por un humano y el cambio de cuenta resuelto;
//   · el camino RECURRENTE (proveedor que ya tiene cuenta certificada) se salta
//     los documentos de identidad PERO exige que la cuenta siga en el maestro;
//   · y sobre todo: que "recurrente" no sea una puerta trasera para aprobar sin
//     cuenta a dónde pagar.
//
//   node scripts/test_candado_aprobacion.js

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "candado-"));
try {
  execFileSync("npx", ["tsc", "lib/certificaciones.ts", "lib/areas.ts", "--outDir", tmp,
                       "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
               { cwd: RAIZ, stdio: "pipe" });
} catch { /* solo se queja del alias de un `import type`; emite igual */ }
const { bloqueoAprobacion } = require(path.join(tmp, "certificaciones.js"));
const { docsFaltantes, CLASES_DOC } = require(path.join(tmp, "areas.js"));

const doc = (clase) => ({ clase, estado: "subido", path: "https://drive/x" });
const LOS_4 = CLASES_DOC.map((c) => doc(c.clase));
const SOLO_SOPORTE = [doc("soporte")];
const CERT_OK = {
  id: 1, estado: "valida", motivo: null, banco: "BANCOLOMBIA", num_cuenta: "12345678901",
  aplicada: false, cuenta_anterior: null, leido_en: "2026-08-19",
  cuenta_verificada: "12345678901", verificada_por: "compras@manelfoods.com",
};
const EN_MAESTRO = { banco: "BANCOLOMBIA", tipo_cuenta: "ahorros", num_cuenta: "12345678901", certificada: true };

console.log("\n1) Camino normal (proveedor nuevo)");
check(bloqueoAprobacion(docsFaltantes(LOS_4), CERT_OK, null) === null,
      "con los 4 documentos, certificación válida y cuenta verificada -> APRUEBA");
check(bloqueoAprobacion(docsFaltantes(SOLO_SOPORTE), CERT_OK, null) !== null,
      "faltando documentos -> bloquea");
check(bloqueoAprobacion(docsFaltantes(LOS_4), null, EN_MAESTRO) !== null,
      "sin certificación -> bloquea (aunque el NIT ya tenga cuenta)");
check(bloqueoAprobacion(docsFaltantes(LOS_4), { ...CERT_OK, cuenta_verificada: null }, null) !== null,
      "sin la verificación humana -> bloquea");
check(bloqueoAprobacion(docsFaltantes(LOS_4), { ...CERT_OK, estado: "protegido", motivo: "con clave" }, null) !== null,
      "certificación con clave -> bloquea");

console.log("\n2) Cambio de cuenta");
const CAMBIO = { ...CERT_OK, cuenta_anterior: "99999999999" };
check(bloqueoAprobacion(docsFaltantes(LOS_4), CAMBIO, EN_MAESTRO) !== null,
      "cuenta distinta a la que el NIT ya tenía -> bloquea hasta confirmar");
check(bloqueoAprobacion(docsFaltantes(LOS_4), { ...CAMBIO, aplicada: true }, EN_MAESTRO) === null,
      "una vez confirmado el cambio -> aprueba");
const PREFIJO = { ...CERT_OK, cuenta_anterior: "6270388827", num_cuenta: "0570006270388827",
                  cuenta_verificada: "0570006270388827" };
const msg = bloqueoAprobacion(docsFaltantes(LOS_4), PREFIJO, EN_MAESTRO);
check(msg !== null && /terminan igual/.test(msg),
      "misma cuenta con prefijo del banco -> lo dice con esas palabras, no 'cambió •••8827 por •••8827'");
check(bloqueoAprobacion(docsFaltantes(LOS_4), { ...CERT_OK, cuenta_anterior: "012345678901" }, EN_MAESTRO) === null,
      "cero a la izquierda NO es un cambio de cuenta");

console.log("\n3) Proveedor RECURRENTE (ya tenía cuenta certificada)");
check(docsFaltantes(SOLO_SOPORTE, true).length === 0,
      "solo se le exige el soporte");
check(docsFaltantes(SOLO_SOPORTE, false).length === 3,
      "...pero a un proveedor nuevo se le siguen exigiendo los 4",
      docsFaltantes(SOLO_SOPORTE, false).join(", "));
check(bloqueoAprobacion(docsFaltantes(SOLO_SOPORTE, true), null, EN_MAESTRO, true) === null,
      "con su cuenta en el maestro -> APRUEBA sin certificación nueva");

console.log("\n4) Que 'recurrente' no sea una puerta trasera");
check(bloqueoAprobacion(docsFaltantes(SOLO_SOPORTE, true), null, null, true) !== null,
      "recurrente SIN cuenta en el maestro -> BLOQUEA (no hay a dónde pagarle)");
check(bloqueoAprobacion(docsFaltantes(SOLO_SOPORTE, true), null, { ...EN_MAESTRO, num_cuenta: "" }, true) !== null,
      "recurrente con la cuenta vacía en el maestro -> BLOQUEA");
check(bloqueoAprobacion(docsFaltantes([], true), null, EN_MAESTRO, true) !== null,
      "recurrente SIN soporte -> BLOQUEA (el soporte es lo único suyo de este cobro)");
// Si además manda certificación, NO se salta el candado del cambio de cuenta.
check(bloqueoAprobacion(docsFaltantes(LOS_4, true), CAMBIO, EN_MAESTRO, true) !== null,
      "recurrente que SÍ manda certificación con otra cuenta -> sigue pasando por el candado del cambio");

console.log(`\n${fallos.length ? "🔴 " + fallos.length + " fallo(s): " + fallos.join(", ") : "🟢 todo OK"}`);
process.exit(fallos.length ? 1 : 0);
