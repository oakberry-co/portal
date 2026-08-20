#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE LOS NOMBRES DE BANCO (Regla 14).
//
// De este nombre sale el CÓDIGO al que se transfiere. Escritos a mano entraron
// "BACOLOMBIA" y "BANDO DE BOGOTA": la fila salía al archivo del banco con el
// código VACÍO y el banco la rechaza.
//
// La regla que se fija acá: TODO nombre de la lista que ofrece Maestros tiene
// que resolver a código en los DOS formatos (Davivienda y ACH/Rappi). Si mañana
// alguien agrega un banco a la lista y no lo agrega a las dos tablas de códigos,
// la pantalla lo ofrecería y el archivo saldría roto. Eso es lo que este test
// impide.
//
//   node scripts/test_bancos.js

const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bt-"));
try { execFileSync("npx", ["tsc", "lib/bancos.ts", "--outDir", tmp, "--module", "commonjs",
                           "--target", "es2020", "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" }); } catch {}
const { BANCOS, codigoBanco, codigoBancoDavivienda, esBancoConocido } = require(path.join(tmp, "bancos.js"));

console.log(`\n1) Los ${BANCOS.length} bancos que ofrece Maestros resuelven a código`);
const sinDav = BANCOS.filter((b) => !codigoBancoDavivienda(b.nombre)).map((b) => b.nombre);
const sinAch = BANCOS.filter((b) => !codigoBanco(b.nombre)).map((b) => b.nombre);
check(sinDav.length === 0, "todos resuelven a código DAVIVIENDA", sinDav.join(", ") || `${BANCOS.length}/${BANCOS.length}`);
check(sinAch.length === 0, "todos resuelven a código ACH (Rappi)", sinAch.join(", ") || `${BANCOS.length}/${BANCOS.length}`);

console.log("\n2) La validación del servidor");
check(esBancoConocido("BANCOLOMBIA"), "acepta un nombre de la lista");
check(esBancoConocido(""), "acepta vacío (el banco es opcional en el maestro)");
check(!esBancoConocido("BACOLOMBIA"), "RECHAZA el typo que nos rompió el archivo");
check(!esBancoConocido("BANDO DE BOGOTA"), "RECHAZA el otro typo");
check(!esBancoConocido("Banco Inventado S.A."), "RECHAZA un banco que no existe");

console.log("\n3) No hay nombres duplicados en la lista");
const vistos = new Set(), dup = [];
for (const b of BANCOS) { if (vistos.has(b.nombre)) dup.push(b.nombre); vistos.add(b.nombre); }
check(dup.length === 0, "cada banco aparece una sola vez", dup.join(", ") || `${vistos.size} nombres`);

console.log(`\n${fallos.length ? "🔴 " + fallos.length + " fallo(s): " + fallos.join(", ") : "🟢 todo OK"}`);
process.exit(fallos.length ? 1 : 0);
