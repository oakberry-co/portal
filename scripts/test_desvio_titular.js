#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE LA IDENTIDAD DEL TITULAR DE UN DESVÍO (Regla 14).
//
// Desviar el pago de una factura manda la plata a la cuenta de OTRO. Lo que el
// banco recibe como dueño de esa cuenta es el documento que se escribe en el
// formulario del desvío — no el NIT del proveedor de la factura.
//
// Lo que fija este test, y que ya se rompió (MTS CONSULTORÍA, ago-2026):
//   1. una empresa no puede quedar declarada con cédula;
//   2. el NIT se guarda SIN dígito de verificación (la clave de la casa), y si
//      lo escriben pegado se le PREGUNTA, no se trunca a ciegas;
//   3. el documento no es opcional: vacío, el archivo del banco cae al NIT del
//      proveedor y declara dueño a quien no lo es.
//
//   node scripts/test_desvio_titular.js

const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dt-"));
try { execFileSync("npx", ["tsc", "lib/cuenta-destino.ts", "--outDir", tmp, "--module", "commonjs",
                           "--target", "es2020", "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" }); } catch {}
const { revisarTitularDestino } = require(path.join(tmp, "cuenta-destino.js"));

console.log("\n1) Una empresa no se declara con cédula");
const empresa = revisarTitularDestino("COMETA CAPITAL SAS", "CC", "901634840");
check(!!empresa.error, "«COMETA CAPITAL SAS» + Cédula se RECHAZA", empresa.error ?? "pasó derecho");
check(/NIT/.test(empresa.error ?? ""), "y el mensaje dice qué hacer");
check(!revisarTitularDestino("COMETA CAPITAL SAS", "NIT", "901634840").error,
      "la misma con NIT pasa");
check(!revisarTitularDestino("MARIA JOSE PEREZ", "CC", "1020304050").error,
      "una persona con cédula pasa (aunque sean 10 dígitos)");

console.log("\n2) El NIT va SIN dígito de verificación");
const pegado = revisarTitularDestino("COMETA CAPITAL SAS", "NIT", "9016348401");
check(!!pegado.error, "9016348401 escrito de corrido se RECHAZA", pegado.error ?? "pasó derecho");
check(/901634840/.test(pegado.error ?? ""), "y el mensaje propone el número bueno");
check(revisarTitularDestino("COMETA CAPITAL SAS", "NIT", "901.634.840-1").doc === "901634840",
      "con guion sí se acepta y se guarda sin el DV",
      revisarTitularDestino("COMETA CAPITAL SAS", "NIT", "901.634.840-1").doc);
// El caso que prohíbe truncar a ciegas: una cédula de 10 dígitos cuyo último
// dígito es, por casualidad, el DV de los 9 anteriores.
const cedula = revisarTitularDestino("JORGE MIGUEL RUIZ", "CC", "1020304050");
check(cedula.doc === "1020304050" && !cedula.error, "una cédula de 10 dígitos NO se trunca", cedula.doc);

console.log("\n3) El documento es obligatorio y el tipo también");
check(!!revisarTitularDestino("COMETA CAPITAL SAS", "NIT", "").error, "sin documento se RECHAZA");
check(!!revisarTitularDestino("COMETA CAPITAL SAS", "", "901634840").error, "sin tipo de documento se RECHAZA");
check(!!revisarTitularDestino("COMETA CAPITAL SAS", "PASAPORTE", "901634840").error,
      "un tipo que el formulario no ofrece se RECHAZA");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s): ${fallos.join(", ")}\n` : "\n🟢 todo OK\n");
process.exit(fallos.length ? 1 : 0);
