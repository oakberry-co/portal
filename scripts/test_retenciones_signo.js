#!/usr/bin/env node
/* eslint-disable */
// CENTINELA: EL DOCUMENTO MANDA EL SIGNO, Y «OTROS» TIENE DOS SENTIDOS (Regla 14).
//
// Pedido del equipo contable (17-sep-2026), dos cosas:
//   · En una NOTA CRÉDITO la retención "no puede quedar negativa": es un DÉBITO
//     que reversa la practicada en la factura. El humano la escribe y la ve en
//     positivo; el portal la guarda con el signo del documento (negativo) para
//     que `total − retenciones − otros = valor a pagar` cuadre al peso, que es
//     lo que la causación comprueba antes de escribir en Siigo.
//   · Un ADICIONAL a favor del proveedor (se le deben $20.000 más): casilla
//     propia, positiva, que se guarda como «Otros» negativo y exige concepto.
//
// Contra la base REAL con ROLLBACK, llamando a los módulos reales:
//   1. nota crédito: montos positivos → guardados en negativo, valor a favor =
//      total + retención (menos negativo), y la identidad de la causación cuadra;
//   2. …y si llegan negativos, el resultado es el MISMO (el signo no lo pone el humano);
//   3. factura: adicional con concepto → valor a pagar sube; sin concepto → se rechaza;
//   4. el Excel junta «Otros» y «Adicional (+)» en un neto con signo, y vacío ≠ cero.
//
//   node scripts/test_retenciones_signo.js

const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const { Client } = require("pg");
const ExcelJS = require("exceljs");

const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

const cache = path.join(RAIZ, "node_modules", ".cache");
fs.mkdirSync(cache, { recursive: true });
const tmp = fs.mkdtempSync(path.join(cache, "trs-"));
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
try {
  execFileSync("npx", ["tsc", "lib/retenciones.ts", "lib/eventos.ts", "lib/retenciones-excel.ts", "lib/pesos.ts", "--outDir", tmp,
                       "--module", "commonjs", "--target", "es2020", "--skipLibCheck", "--esModuleInterop"], { cwd: RAIZ, stdio: "pipe" });
} catch (e) {
  if (!fs.existsSync(path.join(tmp, "retenciones.js"))) { console.error("No compiló:\n" + (e.stdout || e.message)); process.exit(1); }
}
for (const f of fs.readdirSync(tmp)) { const p = path.join(tmp, f); fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/require\("@\/lib\//g, 'require("./')); }
const { guardarRetenciones } = require(path.join(tmp, "retenciones.js"));
const { leerExcel } = require(path.join(tmp, "retenciones-excel.js"));

function dsn() {
  const m = fs.readFileSync(path.join(RAIZ, ".env.local"), "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  return m ? m[1].trim() : process.env.DATABASE_URL;
}
const ACTOR = { email: "centinela@test", rol: "admin" };
const fila = async (c, cufe) => (await c.query(`SELECT e.retefuente::float rf, e.reteiva::float ri, e.reteica::float ric, e.reten_total::float ret,
   e.otros_valor::float otros, e.valor_a_pagar::float pagar, f.total::float total FROM factura_estado e JOIN facturas f USING (cufe) WHERE e.cufe = $1`, [cufe])).rows[0];
const identidad = (r) => Math.abs(r.total - r.ret - r.otros - r.pagar) < 1;

async function excel(cols, vals) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("x");
  ws.addRow(cols); ws.addRow(vals);
  return leerExcel(await wb.xlsx.writeBuffer());
}

(async () => {
  console.log("CENTINELA · el documento manda el signo; Otros en dos sentidos\n");
  const c = new Client({ connectionString: dsn(), ssl: /localhost|127\.0\.0\.1/.test(dsn()) ? false : { rejectUnauthorized: false } });
  await c.connect();
  await c.query("BEGIN");
  try {
    const nc = (await c.query(`SELECT e.cufe, f.numero, f.total::float total FROM factura_estado e JOIN facturas f USING (cufe)
      WHERE f.doc_tipo = 'CreditNote' AND f.total < 0 AND e.estado IN ('capturada','clasificada','retenciones_ok') ORDER BY f.fecha_emision DESC LIMIT 1`)).rows[0];
    if (!nc) { console.log("SIN DATOS: no hay nota crédito editable."); await c.query("ROLLBACK"); await c.end(); return; }
    console.log(`nota crédito de prueba: ${nc.numero} · total ${nc.total.toLocaleString("es-CO")}`);

    console.log("\n1) Nota crédito: el humano escribe en positivo, el portal guarda con el signo del documento");
    await guardarRetenciones(c, nc.cufe, { retefuente: 921, reteiva: 0, reteica: 100, otrosValor: 0, otrosConcepto: null, observaciones: null }, ACTOR, "web");
    const r1 = await fila(c, nc.cufe);
    check(r1.rf === -921 && r1.ric === -100 && r1.ret === -1021, "retenciones guardadas en negativo (débito)", `${r1.rf} / ${r1.ric} / total ${r1.ret}`);
    check(Math.abs(r1.pagar - (nc.total + 1021)) < 1, "lo que queda a favor = total de la nota + retención reversada", r1.pagar.toLocaleString("es-CO"));
    check(identidad(r1), "total − retenciones − otros = valor a pagar (lo que comprueba la causación)");

    console.log("\n2) …y si llegan negativos, el resultado es el mismo");
    await guardarRetenciones(c, nc.cufe, { retefuente: -921, reteiva: 0, reteica: -100, otrosValor: 0, otrosConcepto: null, observaciones: null }, ACTOR, "excel");
    const r2 = await fila(c, nc.cufe);
    check(r2.rf === r1.rf && r2.ret === r1.ret && r2.pagar === r1.pagar, "mismo resultado: el signo lo pone el documento, no la persona");

    console.log("\n3) Factura: adicional a favor del proveedor");
    const fac = (await c.query(`SELECT e.cufe, f.numero, f.total::float total FROM factura_estado e JOIN facturas f USING (cufe)
      WHERE coalesce(f.doc_tipo,'Invoice') = 'Invoice' AND f.total > 100000 AND e.estado IN ('capturada','clasificada','retenciones_ok')
        AND coalesce(e.abono_aplicado,0) = 0 ORDER BY f.fecha_emision DESC LIMIT 1`)).rows[0];
    let e3 = null;
    try { await guardarRetenciones(c, fac.cufe, { retefuente: 0, reteiva: 0, reteica: 0, otrosValor: -20000, otrosConcepto: null, observaciones: null }, ACTOR, "web"); } catch (e) { e3 = e; }
    check(!!e3 && /concepto/i.test(e3.message), "sin concepto se rechaza", e3?.message?.slice(0, 70));
    await guardarRetenciones(c, fac.cufe, { retefuente: 0, reteiva: 0, reteica: 0, otrosValor: -20000, otrosConcepto: "flete que no venía en la factura", observaciones: null }, ACTOR, "web");
    const r3 = await fila(c, fac.cufe);
    check(r3.otros === -20000 && Math.abs(r3.pagar - (fac.total + 20000)) < 1, "con concepto: valor a pagar = total + 20.000", r3.pagar.toLocaleString("es-CO"));
    check(identidad(r3), "la identidad de la causación sigue cuadrando");
    check(r3.rf === 0, "y en una factura la retención no cambia de signo");

    console.log("\n4) El Excel junta Otros y Adicional en un neto con signo");
    const a = await excel(["CUFE / Ref", "ReteFuente", "Otros", "Adicional (+)"], ["abc", 100, 1000, 20000]);
    check(a.filas[0]?.otros === -19000 && a.tiene.otros, "Otros 1.000 y Adicional 20.000 → neto −19.000", String(a.filas[0]?.otros));
    const b = await excel(["CUFE / Ref", "ReteFuente", "Adicional (+)"], ["abc", 100, 20000]);
    check(b.filas[0]?.otros === -20000 && b.tiene.otros, "solo Adicional → −20.000 y la columna cuenta como presente");
    const d = await excel(["CUFE / Ref", "ReteFuente", "Otros", "Adicional (+)"], ["abc", 100, null, null]);
    check(d.filas[0]?.otros === null, "las dos vacías → null (vacío no es cero)");
    const neg = await excel(["CUFE / Ref", "ReteFuente", "Adicional (+)"], ["abc", 100, -5]);
    check(neg.problemas.length === 1 && /negativo/.test(neg.problemas[0].detalle), "un Adicional negativo se rechaza: se escribe en positivo");
  } finally {
    await c.query("ROLLBACK");
  }
  await c.end();
  console.log("\n" + (fallos.length ? "❌ FALLÓ: " + fallos.join("; ") : "✅ OK — el documento manda el signo y el adicional se paga con concepto."));
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error("💥", e); process.exit(1); });
