#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE LA PLANTILLA DUPLICADA (Regla 14).
//
// Oct-2026: al cargar a mano el recibo del mes, el equipo volvió a marcar
// «este gasto se repite». Quedaron DOS plantillas activas de AAA Barranquilla
// y dos de AIR-E para la misma tienda, y cada una generó su obligación del mes:
// SP-730, SP-738 y SP-774 sin valor, esperando que alguien pagara por segunda
// vez lo que ya se había pagado (SP-727 y SP-773). Un doble pago no da error.
//
// Este centinela fija la regla de `plantillaChoca` (lib/gastos-periodicos.ts):
//   · misma referencia de pago = mismo contrato → choca (AIR-E);
//   · sin referencia en alguno de los dos lados, y sin un destino distinto y
//     conocido que los separe → choca (AAA: la vieja sin ref, la nueva con);
//   · dos referencias distintas = dos contratos → NO choca (Enel: Plaza Claro
//     y Zona G);
//   · otro NIT nunca choca;
// y que `crearPlantilla` la consulta antes de insertar (no hay segundo camino).
//
//   node scripts/test_plantilla_duplicada.js

const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gp-"));
try { execFileSync("npx", ["tsc", "lib/gastos-periodicos.ts", "--outDir", tmp, "--module", "commonjs",
                           "--target", "es2020", "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" }); } catch {}
const M = require(path.join(tmp, "gastos-periodicos.js"));

const P = (id, num_doc, destino, referencia_pago) => ({ id, num_doc, destino, referencia_pago });

console.log("plantillaChoca — los casos reales de octubre");
// AIR-E: la 44 nació con la MISMA referencia que la 32.
const aire = [P(32, "9013809302", "Oakberry Baq calle 76", "6598617")];
check(M.plantillaChoca(aire, P(undefined, "9013809302", null, "6598617"))?.id === 32,
      "misma referencia de pago = mismo contrato: choca (AIR-E 44 vs 32)");
// AAA: la 41 (transferencia, sin ref) ya existía cuando nació la 42 (pse, con ref).
const aaa = [P(41, "800135913", null, null)];
check(M.plantillaChoca(aaa, P(undefined, "800135913", null, "276042"))?.id === 41,
      "una activa SIN referencia y la nueva sin destino: choca (AAA 42 vs 41)");
check(M.plantillaChoca([P(41, "800135913", "Oakberry Baq calle 76", null)],
                       P(undefined, "800135913", "Oakberry Baq calle 76", null))?.id === 41,
      "dos sin referencia, mismo destino: choca");
// Enel: Plaza Claro y Zona G son contratos distintos.
const enel = [P(39, "860063875", "Oakberry Plaza Claro", "67598298")];
check(M.plantillaChoca(enel, P(undefined, "860063875", null, "0507616-5")) === null,
      "dos referencias distintas = dos contratos: NO choca (Enel Zona G vs Plaza Claro)");
check(M.plantillaChoca([P(41, "800135913", "Oakberry Baq calle 76", null)],
                       P(undefined, "800135913", "Oakberry Chapinero", null)) === null,
      "sin referencia pero destinos distintos y conocidos: NO choca");
check(M.plantillaChoca(aire, P(undefined, "800135913", null, "6598617")) === null,
      "otro NIT nunca choca, aunque la referencia coincida");
check(M.plantillaChoca([], P(undefined, "800135913", null, null)) === null, "sin activas no hay choque");
check(M.plantillaChoca([P(7, "1", null, "  A1 ")], P(undefined, "1", null, "A1"))?.id === 7,
      "la referencia se compara sin espacios");

console.log("el único camino de creación consulta el candado");
const src = fs.readFileSync(path.join(RAIZ, "lib/plantillas.ts"), "utf8");
const cuerpo = src.slice(src.indexOf("export async function crearPlantilla"), src.indexOf("export type PlantillaViva"));
check(/plantillaChoca\(/.test(cuerpo) && cuerpo.indexOf("plantillaChoca(") < cuerpo.indexOf("INSERT INTO gasto_periodico"),
      "crearPlantilla llama a plantillaChoca ANTES del INSERT");
check(/WHERE activo AND num_doc = \$1/.test(cuerpo), "solo mira las plantillas ACTIVAS del mismo NIT");
const schema = fs.readFileSync(path.join(RAIZ, "db/schema.sql"), "utf8");
check(/ux_gp_nit_ref[\s\S]*ON gasto_periodico \(num_doc, referencia_pago\)[\s\S]*WHERE activo AND referencia_pago IS NOT NULL/.test(schema),
      "la base tiene su propia llave: una plantilla activa por NIT + referencia");
const plant = src.slice(src.indexOf("export async function crearDocumentoDelMes"));
check(/clase: "plantilla"/.test(plant), "el documento del mes hereda el recibo como 'plantilla', no como 'soporte'");

console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s)` : "\n✅ plantilla duplicada: todo en orden");
process.exit(fallos.length ? 1 : 0);
