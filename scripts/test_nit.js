#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DEL NIT (Regla 14 + Regla 15).
//
// De acá salió el bug más caro del portal: MODAL TRACK con la cuenta cargada en
// Maestros y $37.144.800 que no salían en el archivo del banco, sin un solo
// error en pantalla. El maestro tenía el NIT con el dígito de verificación
// pegado y las facturas no.
//
// Lo que este test protege, y que es fácil "simplificar" por accidente:
// NO se quita el último dígito por longitud. Una CÉDULA de 10 dígitos tiene
// ~9% de probabilidad de que su último dígito sea, por casualidad, el DV de los
// 9 anteriores; truncarla la rompe. Solo se quita cuando viene marcado con
// guion/punto Y el dígito verifica.
//
//   node scripts/test_nit.js

const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const { execSync } = require("child_process");

const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nitt-"));
try { execFileSync("npx", ["tsc", "lib/nit.ts", "--outDir", tmp, "--module", "commonjs",
                           "--target", "es2020", "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" }); } catch {}
const { nitCanonico, mismoNit, digitoVerificacion } = require(path.join(tmp, "nit.js"));

console.log("\n1) El dígito de verificación DIAN");
for (const [nit, esperado] of [["901675059", "9"], ["860007386", "1"], ["900536232", "8"], ["901800432", "1"]]) {
  check(digitoVerificacion(nit) === esperado, `DV de ${nit} = ${esperado}`, digitoVerificacion(nit));
}

console.log("\n2) Canónico: el NIT sin DV");
for (const [entra, sale] of [
  ["901675059-9", "901675059"], ["901.675.059-9", "901675059"], ["901675059", "901675059"],
  ["  901675059 - 9 ", "901675059"],
]) check(nitCanonico(entra) === sale, `"${entra}" → ${sale}`, nitCanonico(entra));

console.log("\n3) LO QUE NO SE PUEDE ROMPER: la cédula no se trunca");
// 1004718143 es una cédula real del maestro cuyo último dígito NO es el DV,
// pero el punto es el criterio, no la suerte: sin guion, no se toca. Nunca.
for (const cedula of ["1004718143", "1005976628", "1011202139", "1015444735"]) {
  check(nitCanonico(cedula) === cedula, `${cedula} entra y sale igual`, nitCanonico(cedula));
}
// El caso peligroso construido a mano: una cédula de 10 dígitos cuyo último
// dígito SÍ es el DV de los 9 primeros. Sin guion, tampoco se toca.
const base9 = "100471814";
const trampa = base9 + digitoVerificacion(base9);
check(nitCanonico(trampa) === trampa,
      "una cédula cuyo último dígito coincide con el DV por casualidad NO se trunca", trampa);

console.log("\n4) Comparar: tolera el DV, pero solo si es el correcto");
check(mismoNit("901675059", "9016750599"), "el mismo NIT con y sin DV son el mismo");
check(mismoNit("9016750599", "901675059"), "...en cualquier orden");
check(!mismoNit("901675059", "9016750598"), "con el DV EQUIVOCADO no son el mismo");
check(!mismoNit("901675059", "901675058"), "dos NIT distintos no se funden");
check(!mismoNit("", "901675059"), "vacío no matchea nada");

console.log("\n5) El espejo en Python dice lo mismo (scripts/nit.py)");
// Si los dos lados se separan, uno seguirá metiendo la clave torcida — que es
// exactamente lo que pasó: las 4 cuentas malas entraron por el cargue, no por la web.
const casos = ["901675059-9", "9016750599", "1004718143", "901.675.059-9", trampa];
const guion = path.join(tmp, "casos.py");
fs.writeFileSync(guion,
  "import sys, json\n" +
  "sys.path.insert(0, 'scripts')\n" +
  "from nit import nit_canonico\n" +
  "print('|'.join(nit_canonico(x) for x in json.loads(sys.argv[1])))\n");
const py = execSync(`python3 ${guion} ${JSON.stringify(JSON.stringify(casos))}`,
  { cwd: RAIZ }).toString().trim().split("|");
casos.forEach((c, i) => check(py[i] === nitCanonico(c),
  `"${c}": TypeScript y Python coinciden`, `ts=${nitCanonico(c)} py=${py[i]}`));

console.log(`\n${fallos.length ? "🔴 " + fallos.length + " fallo(s): " + fallos.join(", ") : "🟢 todo OK"}`);
process.exit(fallos.length ? 1 : 0);
