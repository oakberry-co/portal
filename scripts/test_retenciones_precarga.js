#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE LA PRECARGA DE RETENCIONES (Regla 14).
//
// El bug (20-sep-2026): el modal abría con la propuesta del pipeline ANTES que
// la tarifa aprendida del contador, y un "$0" del pipeline —su error más común—
// contaba como propuesta: el modal decía 0% y nunca miraba la tarifa aprendida.
// En 115 facturas el contador tecleó a mano lo que el portal ya sabía.
//
// Fija la precedencia de `tarifaInicial` (lib/base-retencion.ts), módulo puro:
//   1. lo confirmado en la factura gana, aunque sea 0;
//   2. la tarifa del proveedor (maestro) gana al pipeline;
//   3. un 0 del pipeline NO tapa la tarifa aprendida ni la regla del concepto;
//   4. sin nada aprendido, el pipeline > 0 sí precarga y el 0 deja vacío;
//   5. una nota crédito (base negativa) precarga en positivo.
//
//   node scripts/test_retenciones_precarga.js

const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

const cache = path.join(RAIZ, "node_modules", ".cache"); fs.mkdirSync(cache, { recursive: true });
const tmp = fs.mkdtempSync(path.join(cache, "tpre-"));
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
try { execFileSync("npx", ["tsc", "lib/base-retencion.ts", "--outDir", tmp, "--module", "commonjs", "--target", "es2020", "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" }); } catch {}
const { tarifaInicial } = require(path.join(tmp, "base-retencion.js"));

console.log("CENTINELA · con qué tarifa abre el modal de retenciones\n");
const base = 1000000;
console.log("1) Lo confirmado gana, aunque sea 0");
check(tarifaInicial({ confirmado: 25000, base, tarifaProveedor: "1.5", sugerido: 0 }) === "2.5", "confirmado 25.000 sobre 1M → 2.5%");
check(tarifaInicial({ confirmado: 0, base, tarifaProveedor: "2.5", sugerido: 25000 }) === "0", "confirmado 0 → 0% (no retiene es una decisión)");
console.log("\n2) La tarifa del proveedor gana al pipeline");
check(tarifaInicial({ confirmado: null, base, tarifaProveedor: "1.5", sugerido: 25000 }) === "1.5", "maestro 1.5% vs pipeline 2.5% → 1.5%");
check(tarifaInicial({ confirmado: null, base, tarifaProveedor: "0", sugerido: 25000 }) === "0", "maestro dice «no retiene» → 0%, aunque el pipeline proponga");
console.log("\n3) EL BUG: un 0 del pipeline no tapa lo aprendido");
check(tarifaInicial({ confirmado: null, base, tarifaProveedor: "2.5", sugerido: 0 }) === "2.5", "pipeline 0 + maestro 2.5% → 2.5%");
check(tarifaInicial({ confirmado: null, base, tarifaProveedor: null, reglaConcepto: { aplica: true, tarifa: "2.5" }, sugerido: 0 }) === "2.5", "pipeline 0 + regla del concepto 2.5% → 2.5%");
check(tarifaInicial({ confirmado: null, base, tarifaProveedor: null, reglaConcepto: { aplica: false, tarifa: null }, sugerido: 25000 }) === "0", "concepto que no retiene → 0% aunque el pipeline proponga");
console.log("\n4) Sin nada aprendido, el pipeline");
check(tarifaInicial({ confirmado: null, base, sugerido: 25000 }) === "2.5", "pipeline 25.000 → 2.5%");
check(tarifaInicial({ confirmado: null, base, sugerido: 0 }) === "", "pipeline 0 → vacío (no es una decisión)");
check(tarifaInicial({ confirmado: null, base }) === "", "nada → vacío");
console.log("\n5) Nota crédito: base negativa, precarga en positivo");
check(tarifaInicial({ confirmado: -921, base: -36824 }) === "2.501", "−921 sobre −36.824 → 2.501%");
console.log("\n6) Control: la precedencia VIEJA (pipeline antes que maestro) sí cometía el bug");
const vieja = (sug, tar) => (sug != null && sug !== "" ? String(+((sug / base) * 100).toFixed(3)) : "") || (tar ?? "");
check(vieja(0, "2.5") === "0", "con el orden viejo, pipeline 0 tapaba el 2.5% aprendido — el centinela distingue");
console.log("\n" + (fallos.length ? "❌ FALLÓ: " + fallos.join("; ") : "✅ OK — lo aprendido del contador manda sobre el pipeline, y un 0 no es propuesta."));
process.exit(fallos.length ? 1 : 0);
