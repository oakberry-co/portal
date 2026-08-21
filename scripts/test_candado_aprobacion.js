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
  execFileSync("npx", ["tsc", "lib/certificaciones.ts", "lib/areas.ts", "lib/valor-documento.ts", "--outDir", tmp,
                       "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
               { cwd: RAIZ, stdio: "pipe" });
} catch { /* solo se queja del alias de un `import type`; emite igual */ }
const { bloqueoAprobacion } = require(path.join(tmp, "certificaciones.js"));
const { docsFaltantes, CLASES_DOC, DOCS_CUENTA_COBRO, DOCS_COTIZACION,
        DOCS_RECURRENTE } = require(path.join(tmp, "areas.js"));

const doc = (clase) => ({ clase, estado: "subido", path: "https://drive/x" });
const LOS_4 = CLASES_DOC.map((c) => doc(c.clase));
const SOLO_SOPORTE = [doc("soporte")];
const CERT_OK = {
  id: 1, estado: "valida", motivo: null, banco: "BANCOLOMBIA", num_cuenta: "12345678901",
  aplicada: false, cuenta_anterior: null, leido_en: "2026-08-19",
  cuenta_verificada: "12345678901", verificada_por: "compras@manelfoods.com",
};
const EN_MAESTRO = { banco: "BANCOLOMBIA", tipo_cuenta: "ahorros", num_cuenta: "12345678901", certificada: true };

// EL MONTO NO ESTÁ ACÁ a propósito: es una ALARMA, no un candado. Se coteja
// contra el documento y la bandeja lo grita, pero no impide aprobar — quien
// decide es el humano. Lo cuida scripts/test_valor_documento.js.
/** Azúcar: los llamados eran posicionales y la firma pasó a ser un objeto. */
const bloqueo = (docsFaltan, cert, cuenta, recurrente = false) =>
  bloqueoAprobacion({ docsFaltan, cert, cuenta, recurrente });

console.log("\n1) Camino normal (proveedor nuevo)");
check(bloqueo(docsFaltantes(LOS_4), CERT_OK, null) === null,
      "con los 4 documentos, certificación válida y cuenta verificada -> APRUEBA");
check(bloqueo(docsFaltantes(SOLO_SOPORTE), CERT_OK, null) !== null,
      "faltando documentos -> bloquea");
check(bloqueo(docsFaltantes(LOS_4), null, EN_MAESTRO) !== null,
      "sin certificación -> bloquea (aunque el NIT ya tenga cuenta)");
check(bloqueo(docsFaltantes(LOS_4), { ...CERT_OK, cuenta_verificada: null }, null) !== null,
      "sin la verificación humana -> bloquea");
// LO QUE EL LECTOR HAYA PODIDO LEER YA NO TRANCA (21-ago-2026). Una foto
// borrosa o un PDF con clave dejaban la solicitud esperando a una máquina que no
// iba a poder, con una persona mirando el documento al lado. Ahora el único
// requisito es que ESA persona escriba banco, tipo y número.
check(bloqueo(docsFaltantes(LOS_4), { ...CERT_OK, estado: "protegido", motivo: "con clave",
                                      cuenta_verificada: null }, null) !== null,
      "certificación con clave y SIN que nadie la lea -> bloquea");
check(bloqueo(docsFaltantes(LOS_4), { ...CERT_OK, estado: "protegido", motivo: "con clave" }, null) === null,
      "pero con clave y CON un humano que la abrió y escribió la cuenta -> APRUEBA");
check(bloqueo(docsFaltantes(LOS_4), { ...CERT_OK, estado: "ilegible", num_cuenta: null }, null) === null,
      "e ilegible para el lector, legible para una persona -> APRUEBA");

console.log("\n2) Cambio de cuenta");
const CAMBIO = { ...CERT_OK, cuenta_anterior: "99999999999" };
check(bloqueo(docsFaltantes(LOS_4), CAMBIO, EN_MAESTRO) !== null,
      "cuenta distinta a la que el NIT ya tenía -> bloquea hasta confirmar");
check(bloqueo(docsFaltantes(LOS_4), { ...CAMBIO, aplicada: true }, EN_MAESTRO) === null,
      "una vez confirmado el cambio -> aprueba");
const PREFIJO = { ...CERT_OK, cuenta_anterior: "6270388827", num_cuenta: "0570006270388827",
                  cuenta_verificada: "0570006270388827" };
const msg = bloqueo(docsFaltantes(LOS_4), PREFIJO, EN_MAESTRO);
check(msg !== null && /terminan igual/.test(msg),
      "misma cuenta con prefijo del banco -> lo dice con esas palabras, no 'cambió •••8827 por •••8827'");
check(bloqueo(docsFaltantes(LOS_4), { ...CERT_OK, cuenta_anterior: "012345678901" }, EN_MAESTRO) === null,
      "cero a la izquierda NO es un cambio de cuenta");

console.log("\n3) Proveedor RECURRENTE (ya tenía cuenta certificada)");
check(docsFaltantes(SOLO_SOPORTE, DOCS_RECURRENTE).length === 0,
      "solo se le exige el soporte");
check(docsFaltantes(SOLO_SOPORTE, DOCS_CUENTA_COBRO).length === 3,
      "...pero a un proveedor nuevo se le siguen exigiendo los 4",
      docsFaltantes(SOLO_SOPORTE, DOCS_CUENTA_COBRO).join(", "));
check(bloqueo(docsFaltantes(SOLO_SOPORTE, DOCS_RECURRENTE), null, EN_MAESTRO, true) === null,
      "con su cuenta en el maestro -> APRUEBA sin certificación nueva");

console.log("\n4) Que 'recurrente' no sea una puerta trasera");
check(bloqueo(docsFaltantes(SOLO_SOPORTE, DOCS_RECURRENTE), null, null, true) !== null,
      "recurrente SIN cuenta en el maestro -> BLOQUEA (no hay a dónde pagarle)");
check(bloqueo(docsFaltantes(SOLO_SOPORTE, DOCS_RECURRENTE), null, { ...EN_MAESTRO, num_cuenta: "" }, true) !== null,
      "recurrente con la cuenta vacía en el maestro -> BLOQUEA");
check(bloqueo(docsFaltantes([], DOCS_RECURRENTE), null, EN_MAESTRO, true) !== null,
      "recurrente SIN soporte -> BLOQUEA (el soporte es lo único suyo de este cobro)");
// Si además manda certificación, NO se salta el candado del cambio de cuenta.
check(bloqueo(docsFaltantes(LOS_4, DOCS_RECURRENTE), CAMBIO, EN_MAESTRO, true) !== null,
      "recurrente que SÍ manda certificación con otra cuenta -> sigue pasando por el candado del cambio");

// ── CADA CARRIL PIDE LO SUYO (21-ago-2026) ─────────────────────────────────
//
// La cotización dejó de pedir la cédula. El riesgo de un cambio así no está en
// la pantalla: está en que la lista de la PANTALLA y la de la BANDEJA se
// separen. Si solo se quitara del formulario, la bandeja seguiría diciendo
// "falta la cédula" y esa cotización no se podría aprobar nunca — el proveedor
// mandó lo que le pidieron y aun así queda trabado (Regla 18).
console.log("\n5) Cada carril exige su propio set de documentos");
const SIN_CEDULA = CLASES_DOC.filter((c) => c.clase !== "cedula").map((c) => doc(c.clase));
const SOLO_EL_SOPORTE = [doc("soporte")];

check(docsFaltantes(SIN_CEDULA, DOCS_COTIZACION).length === 0,
      "una cotización SIN cédula está completa");
check(docsFaltantes(SIN_CEDULA, DOCS_CUENTA_COBRO).length === 1,
      "pero a una cuenta de cobro sí le falta (la cobra una persona natural)",
      docsFaltantes(SIN_CEDULA, DOCS_CUENTA_COBRO).join(", "));
check(!DOCS_COTIZACION.some((c) => c.clase === "cedula"),
      "la cédula NO está en la lista de la cotización");
check(DOCS_COTIZACION.some((c) => c.clase === "certificacion_bancaria"),
      "pero la certificación bancaria sigue: de ahí sale a qué cuenta se paga");
check(docsFaltantes(SOLO_EL_SOPORTE, DOCS_RECURRENTE).length === 0,
      "al recurrente le basta el soporte");
check(docsFaltantes(SOLO_EL_SOPORTE, DOCS_COTIZACION).length === 2,
      "y a un proveedor nuevo no", docsFaltantes(SOLO_EL_SOPORTE, DOCS_COTIZACION).join(", "));

// Una cotización de recurrente se aprueba sin certificación, PERO solo si su
// cuenta sigue en el maestro: si alguien la borró, aprobar dejaría un anticipo
// listo para pagar y sin a dónde.
check(bloqueo(docsFaltantes(SOLO_EL_SOPORTE, DOCS_RECURRENTE), null, EN_MAESTRO, true) === null,
      "cotización recurrente + cuenta en el maestro: se puede aprobar");
check(bloqueo(docsFaltantes(SOLO_EL_SOPORTE, DOCS_RECURRENTE), null, null, true) !== null,
      "recurrente SIN cuenta en el maestro: NO se aprueba");

console.log("\n9) LA CUENTA LA ESCRIBE EL HUMANO: banco, tipo y número");
// Antes solo se le pedía el NÚMERO y el banco salía del OCR. Un banco mal leído
// no resuelve a ningún código y la fila sale al archivo bancario con el campo
// vacío: el banco la rechaza y el proveedor no cobra. Pasó con "BACOLOMBIA".
check(bloqueo(docsFaltantes(LOS_4), { ...CERT_OK, cuenta_verificada: null }, null) !== null,
      "sin que un humano escriba la cuenta -> bloquea");
const pide = bloqueo(docsFaltantes(LOS_4), { ...CERT_OK, cuenta_verificada: null }, null);
check(/banco/i.test(pide ?? "") && /tipo/i.test(pide ?? ""),
      "y el mensaje pide los TRES datos, no solo el número", (pide ?? "").slice(0, 70) + "…");

console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s): ${fallos.join(", ")}\n` : "\n🟢 todo OK\n");
process.exit(fallos.length ? 1 : 0);
