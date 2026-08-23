#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE LA PUERTA DE APROBACIÓN (Regla 14).
//
// Aprobar una cuenta de cobro o una cotización es lo que mete plata en el
// archivo del banco. Lo que se cuida acá es que la bandeja MUESTRE lo mismo que
// el servidor EXIGE: los dos llaman a `bloqueoAprobacion`, y si divergieran el
// equipo aprendería a pelearse con un botón que no explica por qué no funciona.
//
// QUÉ QUEDA DEL CANDADO (21-ago-2026): dos cosas, y ninguna es "validar".
//
//   1. los documentos que ese carril pide, subidos de verdad a Drive;
//   2. una cuenta en el maestro — sin ella el archivo del banco no tiene a dónde
//      mandar la plata y la fila desaparece sin un solo error.
//
// QUÉ SE QUITÓ, y por qué importa que este centinela lo diga: el estado del
// lector de certificaciones, el choque contra lo que leyó el OCR y la
// confirmación de "cambió la cuenta". Entre los tres hacían que aprobar fuera un
// trámite de cinco pasos, y trancaban a un revisor que tenía el documento
// abierto al lado. La cuenta se ESCRIBE (lib/certificacion-actions § guardarCuenta),
// no se valida; cada guardado queda en la bitácora con la cuenta anterior, así
// que un cambio raro se ve — después, no antes.
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
const { docsFaltantes, etiquetaClase, CLASES_DOC, DOCS_CUENTA_COBRO, DOCS_COTIZACION,
        DOCS_RECURRENTE } = require(path.join(tmp, "areas.js"));

const doc = (clase) => ({ clase, estado: "subido", path: "https://drive/x" });
const LOS_4 = CLASES_DOC.map((c) => doc(c.clase));
const SOLO_SOPORTE = [doc("soporte")];
const CON_CUENTA = { banco: "BANCOLOMBIA", tipo_cuenta: "ahorros", num_cuenta: "12345678901", certificada: true };
const CERT = {
  id: 1, estado: "valida", motivo: null, banco: "BANCOLOMBIA", tipo_cuenta: "ahorros",
  num_cuenta: "12345678901", aplicada: true, cuenta_anterior: null, leido_en: "2026-08-21",
  cuenta_verificada: "12345678901", banco_verificado: "BANCOLOMBIA",
  tipo_verificado: "ahorros", verificada_por: "compras@manelfoods.com",
};
const bloqueo = (docsFaltan, cert, cuenta, recurrente = false) =>
  bloqueoAprobacion({ docsFaltan, cert, cuenta, recurrente });

console.log("\n1) Los dos requisitos, y nada más");
check(bloqueo(docsFaltantes(LOS_4), CERT, CON_CUENTA) === null,
      "documentos completos + cuenta en el maestro -> APRUEBA");
check(bloqueo(docsFaltantes(SOLO_SOPORTE), CERT, CON_CUENTA) !== null,
      "faltando documentos -> bloquea");
check(bloqueo(docsFaltantes(LOS_4), CERT, null) !== null,
      "sin cuenta en el maestro -> bloquea (el pago no tendría a dónde ir)");
check(bloqueo(docsFaltantes(LOS_4), CERT, { ...CON_CUENTA, num_cuenta: "" }) !== null,
      "con la cuenta VACÍA en el maestro -> bloquea igual");
const falta = bloqueo(docsFaltantes(LOS_4), CERT, null);
check(/banco/i.test(falta ?? "") && /tipo/i.test(falta ?? "") && /número/i.test(falta ?? ""),
      "y el mensaje dice qué escribir: banco, tipo y número (Regla 18)",
      (falta ?? "").slice(0, 60) + "…");

console.log("\n2) LO QUE EL LECTOR HAGA YA NO TRANCA");
// Esto es el cambio del 21-ago. Una foto borrosa o un PDF con clave dejaban la
// solicitud esperando a una máquina que no iba a poder, con una persona
// mirando el documento al lado.
for (const [estado, nota] of [["pendiente", "sin leer todavía"], ["ilegible", "foto borrosa"],
                              ["protegido", "PDF con clave"], ["no_es_certificacion", "otro papel"]]) {
  check(bloqueo(docsFaltantes(LOS_4), { ...CERT, estado, num_cuenta: null }, CON_CUENTA) === null,
        `certificación '${estado}' (${nota}) -> APRUEBA igual`);
}
check(bloqueo(docsFaltantes(LOS_4), null, CON_CUENTA) === null,
      "SIN lectura de certificación -> APRUEBA (la cuenta la escribió una persona)");

console.log("\n3) Que la cuenta cambie ya NO es un candado (queda en la bitácora)");
check(bloqueo(docsFaltantes(LOS_4), { ...CERT, cuenta_anterior: "99999999", aplicada: false }, CON_CUENTA) === null,
      "una cuenta distinta a la anterior -> APRUEBA; el cambio se lee en la bitácora");

console.log("\n4) Qué documentos se piden — y cuáles YA NO");
// LA CÉDULA SE DEJÓ DE PEDIR el 23-ago-2026: no sustentaba nada que el RUT y la
// certificación no sustentaran ya, y era un cuarto adjunto que el proveedor
// tenía que conseguir desde el celular. Se prueba explícitamente porque el día
// que vuelva a la lista, todos los envíos abiertos se bloquean de golpe.
check(!CLASES_DOC.some((c) => c.clase === "cedula"), "la cédula NO está entre las casillas");
check(!DOCS_CUENTA_COBRO.some((c) => c.clase === "cedula"), "ni entre las que exige una cuenta de cobro");
check(!DOCS_COTIZACION.some((c) => c.clase === "cedula"), "ni entre las de una cotización");
check(DOCS_CUENTA_COBRO.length === 3 && DOCS_COTIZACION.length === 3,
      "los dos carriles piden TRES: certificación, RUT y soporte");
// Un envío VIEJO que la trae no se rompe: se sigue mostrando con su nombre.
check(etiquetaClase("cedula") === "Cédula",
      "una cédula guardada antes se sigue viendo como 'Cédula', no como 'Documento'");
check(docsFaltantes(LOS_4, DOCS_COTIZACION).length === 0, "con los tres, no falta nada");
check(docsFaltantes(SOLO_SOPORTE, DOCS_RECURRENTE).length === 0, "al recurrente le basta el soporte");
check(docsFaltantes(SOLO_SOPORTE, DOCS_COTIZACION).join(",") === "Certificación bancaria,RUT",
      "y a un proveedor nuevo le faltan los otros dos");
check(docsFaltantes([], DOCS_RECURRENTE).length > 0,
      "recurrente SIN soporte -> falta (es lo único suyo de este cobro)");

console.log("\n5) Un documento que no llegó a Drive es un documento que FALTA");
// 'pendiente' = el proveedor lo adjuntó pero la subida falló. En la bandeja no
// hay nada que abrir, así que para aprobar es como si no existiera.
const sinSubir = CLASES_DOC.map((c) =>
  c.clase === "rut" ? { clase: "rut", estado: "pendiente", path: "" } : doc(c.clase));
check(docsFaltantes(sinSubir, DOCS_CUENTA_COBRO).join(",") === "RUT",
      "el que quedó 'pendiente' cuenta como faltante");

console.log(`\n${fallos.length ? "❌ " + fallos.length + " fallo(s): " + fallos.join(", ") : "🟢 todo OK"}`);
process.exit(fallos.length ? 1 : 0);
