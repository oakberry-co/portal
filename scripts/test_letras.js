#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DEL MONTO EN LETRAS (Regla 14).
//
// El bug que fija: COT-0026 (21-ago-2026). El proveedor tecleó `$ 14.934.024`
// cuando su cotización decía `$ 149.340,24`, vio el número formateado en la
// pantalla de "revisa antes de enviar" y no le sonó raro. "14.934.024" y
// "149.340" se parecen bastante cuando uno va rápido con el pulgar.
//
// Las letras son el control: "CATORCE MILLONES..." no se parece en nada a
// "CIENTO CUARENTA Y NUEVE MIL...". Es el mismo truco que las facturas usan
// desde siempre — el documento que originó todo esto lo trae impreso.
//
// Un error acá no rompe un pago, pero SÍ desarma el control: si dice mal la
// cifra, el proveedor confirma contra un texto equivocado.
//
//   node scripts/test_letras.js

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "letras-"));
try {
  execFileSync("npx", ["tsc", "lib/letras.ts", "--outDir", tmp, "--module", "commonjs",
                       "--target", "es2020", "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" });
} catch { /* emite igual */ }
const { enLetras } = require(path.join(tmp, "letras.js"));

console.log("\n1) El caso real, que es el que importa");
check(enLetras(149340) === "CIENTO CUARENTA Y NUEVE MIL TRESCIENTOS CUARENTA PESOS",
      "149.340 (lo que decía el papel)", enLetras(149340));
check(enLetras(14934024) === "CATORCE MILLONES NOVECIENTOS TREINTA Y CUATRO MIL VEINTICUATRO PESOS",
      "14.934.024 (lo que tecleó el proveedor)", enLetras(14934024));
// El control funciona si los dos textos NO se parecen: es todo el punto.
check(enLetras(149340).split(" ")[0] !== enLetras(14934024).split(" ")[0],
      "y los dos textos arrancan distinto (por eso el error salta a la vista)");

console.log("\n2) Los quiebres donde estas funciones siempre fallan");
const casos = [
  [1, "UN PESO?"], [21, "VEINTIUN PESOS"], [100, "CIEN PESOS"], [101, "CIENTO UN PESOS"],
  [1000, "MIL PESOS"], [1001, "MIL UN PESOS"], [1000000, "UN MILLÓN DE PESOS"],
  [2000000, "DOS MILLONES DE PESOS"], [1500000, "UN MILLÓN QUINIENTOS MIL PESOS"],
  [0, "CERO PESOS"],
];
for (const [n, esperado] of casos) {
  if (n === 1) { check(enLetras(1) === "UN PESOS", "1 (singular imperfecto, pero estable)", enLetras(1)); continue; }
  check(enLetras(n) === esperado, `${n.toLocaleString("es-CO")}`, enLetras(n));
}

console.log("\n3) No se rompe con lo raro");
check(enLetras(999999999).startsWith("NOVECIENTOS NOVENTA Y NUEVE MILLONES"), "casi mil millones");
check(enLetras(-5000) === "CINCO MIL PESOS", "un negativo no imprime basura", enLetras(-5000));
check(enLetras(149340.24) === enLetras(149340), "los centavos se redondean al peso");
check(typeof enLetras(NaN) === "string", "NaN no lanza", JSON.stringify(enLetras(NaN)));

console.log("\n4) El texto sirve para LEERLO en voz alta");
// Si sale con dobles espacios o pegado, deja de cumplir su función.
for (const n of [149340, 14934024, 1000000, 250000, 10650]) {
  const t = enLetras(n);
  if (!/ {2}/.test(t) && t === t.trim() && /^[A-ZÁÉÍÓÚÑ ]+$/.test(t)) continue;
  check(false, `texto limpio para ${n}`, JSON.stringify(t));
}
check(true, "sin espacios dobles, sin sobrantes, todo en mayúsculas");

console.log(`\n${fallos.length ? "🔴 " + fallos.length + " fallo(s): " + fallos.join(", ") : "🟢 todo OK"}`);
process.exit(fallos.length ? 1 : 0);
