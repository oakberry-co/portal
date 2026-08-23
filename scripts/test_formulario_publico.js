#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE LO QUE EL FORMULARIO PÚBLICO NO PUEDE DEJAR PASAR (Regla 14).
//
// Dos datos entran por un formulario que llena un desconocido desde el celular y
// los dos deciden plata: CUÁNTO se paga y A QUIÉN. Los dos han fallado ya.
//
//  · EL MONTO — COT-0026: el proveedor COPIÓ `TOTAL A PAGAR $ 149.340,24` de su
//    documento y el servidor le borró los puntos y la coma, dejando 14.934.024.
//    Cien veces más, con 100% de adelanto. Se arregla interpretando la plata a
//    la colombiana en vez de limpiarla.
//  · EL NIT — COT-0034: entró '800165' cuando el NIT de ese GRUPO DECOR es
//    '800165377'. Un NIT torcido no cruza con la cuenta ni con las facturas del
//    proveedor: la fila desaparece del archivo del banco sin dar un solo error
//    ($37M de MODAL TRACK).
//
//   node scripts/test_formulario_publico.js

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "form-"));
try {
  execFileSync("npx", ["tsc", "lib/pesos.ts", "lib/nit.ts", "--outDir", tmp, "--module", "commonjs",
                       "--target", "es2020", "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" });
} catch { /* emite igual */ }
const { pesos } = require(path.join(tmp, "pesos.js"));
const { digitoVerificacion, soloDigitos } = require(path.join(tmp, "nit.js"));

const comoLoGuarda = (t) => Math.round(pesos(t));

console.log("\n1) EL CASO QUE ROMPIÓ: el total copiado del documento");
check(comoLoGuarda("$ 149.340,24") === 149340,
      "'$ 149.340,24' entra como 149.340", String(comoLoGuarda("$ 149.340,24")));
check(comoLoGuarda("$ 149.340,24") !== 14934024,
      "y NO como 14.934.024, que es lo que quedó registrado en COT-0026");

console.log("\n2) Las otras formas en que llega la plata");
for (const [texto, esperado, nota] of [
  ["149340", 149340, "pelado"],
  ["149.340", 149340, "con separador de miles"],
  ["2.083.666", 2083666, "millones a la colombiana"],
  ["1,234,567.50", 1234568, "a la gringa (también llega)"],
  ["$ 10.650,17", 10650, "los centavos se redondean al peso"],
  ["9.870", 9870, "nueve mil ochocientos setenta, NO 9,87"],
]) check(comoLoGuarda(texto) === esperado, `'${texto}' → ${esperado.toLocaleString("es-CO")} (${nota})`,
         String(comoLoGuarda(texto)));

console.log("\n3) EL NIT: nueve dígitos, siempre");
const DIGITOS_NIT = 9;
for (const n of ["830514578", "901330350", "860063875", "800165377", "901412787"])
  check(soloDigitos(n).length === DIGITOS_NIT, `${n} — un NIT real de la base`);
check(soloDigitos("800165").length !== DIGITOS_NIT,
      "'800165' (lo que llegó en COT-0034) NO pasa la regla de largo");

console.log("\n4) El dígito de verificación, contra NIT que conocemos");
check(digitoVerificacion("901412787") === "4", "ManelFoods: 901.412.787-4");
check(digitoVerificacion("830514578") === "2", "ENDIPACK: 830.514.578-2 (está en su cotización)");
check(digitoVerificacion("800165377") === "1", "GRUPO DECOR: 800.165.377-1");

console.log("\n5) Por qué hacen falta LAS DOS reglas y no una");
// El dígito NO caza todo: hay 1 en 11 de que un número torcido dé el correcto.
// Justamente pasa con el caso real, y es la razón de la regla del largo.
check(digitoVerificacion("800165") === digitoVerificacion("800165377"),
      "'800165' da el MISMO dígito que '800165377' — el DV solo no lo caza",
      digitoVerificacion("800165"));
check(soloDigitos("800165").length !== DIGITOS_NIT,
      "…y por eso la regla de los 9 dígitos es la que lo caza");

console.log(`\n${fallos.length ? "🔴 " + fallos.length + " fallo(s): " + fallos.join(", ") : "🟢 todo OK"}`);
process.exit(fallos.length ? 1 : 0);
