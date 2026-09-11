#!/usr/bin/env node
/* eslint-disable */
// CENTINELA: EL ADELANTO NO SE DESCUENTA DOS VECES (Regla 14).
//
// El caso (11-sep-2026, FE150 de COMERCIALIZADORA ARTEFACTO): la cotización con
// adelanto ya estaba enlazada a la factura —el portal le resta el anticipo al
// saldo solo— y al confirmar las retenciones alguien escribió el mismo anticipo
// en «Otros». Resultado: saldo cero, y una factura con saldo cero NO entra a
// Pagos (esa regla existe para las anuladas por nota crédito). La factura
// desapareció del tablero sin ningún error, a un día de su vencimiento.
//
// Contra la base REAL, con ROLLBACK, llamando al módulo real (lib/retenciones.ts):
//   1. con un adelanto descontado, poner ese mismo valor en Otros se RECHAZA,
//      y el mensaje dice qué hacer;
//   2. con Otros en 0 se guarda y el saldo del tablero (SALDO_NETO) queda > 0;
//   3. control (bug a propósito): con el doble descuento escrito por SQL, el
//      saldo da 0 — que es exactamente por qué la factura se escondía.
//
//   node scripts/test_retenciones_adelanto.js

const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const { Client } = require("pg");

const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

const cache = path.join(RAIZ, "node_modules", ".cache");
fs.mkdirSync(cache, { recursive: true });
const tmp = fs.mkdtempSync(path.join(cache, "tra-"));
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
try {
  execFileSync("npx", ["tsc", "lib/retenciones.ts", "lib/eventos.ts", "lib/notas-credito.ts", "--outDir", tmp,
                       "--module", "commonjs", "--target", "es2020", "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" });
} catch (e) {
  if (!fs.existsSync(path.join(tmp, "retenciones.js"))) { console.error("No compiló:\n" + (e.stdout || e.message)); process.exit(1); }
}
// retenciones.ts importa "@/lib/eventos": el alias es de Next, no de Node.
for (const f of fs.readdirSync(tmp)) {
  const p = path.join(tmp, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/require\("@\/lib\//g, 'require("./'));
}
const { guardarRetenciones } = require(path.join(tmp, "retenciones.js"));
const { SALDO_NETO } = require(path.join(tmp, "notas-credito.js"));

function dsn() {
  const m = fs.readFileSync(path.join(RAIZ, ".env.local"), "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  return m ? m[1].trim() : process.env.DATABASE_URL;
}
const ACTOR = { email: "centinela@test", rol: "admin" };
const saldoDe = async (c, cufe) =>
  Number((await c.query(`SELECT ${SALDO_NETO("f", "e")} AS s FROM factura_estado e JOIN facturas f USING (cufe) WHERE e.cufe = $1`, [cufe])).rows[0].s);

(async () => {
  console.log("CENTINELA · el adelanto no se descuenta dos veces\n");
  const c = new Client({ connectionString: dsn(), ssl: /localhost|127\.0\.0\.1/.test(dsn()) ? false : { rejectUnauthorized: false } });
  await c.connect();
  await c.query("BEGIN");
  try {
    // Una factura con adelanto descontado y retenciones editables; si no hay, se fabrica el abono.
    let r = await c.query(`
      SELECT e.cufe, f.numero, f.total::float AS total, e.abono_aplicado::float AS abono
        FROM factura_estado e JOIN facturas f USING (cufe)
       WHERE e.abono_aplicado > 0 AND e.estado IN ('capturada','clasificada','retenciones_ok')
         AND coalesce(f.doc_tipo,'Invoice') <> 'CreditNote' ORDER BY f.fecha_emision DESC LIMIT 1`);
    if (!r.rowCount) {
      r = await c.query(`SELECT e.cufe, f.numero, f.total::float AS total, 0::float AS abono
                           FROM factura_estado e JOIN facturas f USING (cufe)
                          WHERE e.estado IN ('capturada','clasificada','retenciones_ok') AND f.total > 1000000 LIMIT 1`);
      await c.query("UPDATE factura_estado SET abono_aplicado = 500000 WHERE cufe = $1", [r.rows[0].cufe]);
      r.rows[0].abono = 500000;
    }
    const { cufe, numero, total, abono } = r.rows[0];
    console.log(`factura de prueba: ${numero} · total ${total.toLocaleString("es-CO")} · adelanto ya descontado ${abono.toLocaleString("es-CO")}\n`);
    const montos = { retefuente: 0, reteiva: 0, reteica: 0, otrosConcepto: null, observaciones: null };

    console.log("1) Otros = el adelanto → se rechaza y dice qué hacer");
    let e1 = null;
    try { await guardarRetenciones(c, cufe, { ...montos, otrosValor: abono }, ACTOR, "web"); } catch (e) { e1 = e; }
    check(!!e1, "rechazado", e1?.message?.slice(0, 90));
    check(!!e1 && /adelanto/i.test(e1.message) && /Otros/.test(e1.message), "el mensaje nombra el adelanto y dice «deja Otros en 0»");

    console.log("\n2) Otros = 0 → se guarda y el saldo del tablero queda > 0");
    const res = await guardarRetenciones(c, cufe, { ...montos, otrosValor: 0 }, ACTOR, "web");
    check(res.retencion_ok === true && Number(res.valor_a_pagar) === total, "valor a pagar = total (sin descontar el adelanto acá)", res.valor_a_pagar);
    const s2 = await saldoDe(c, cufe);
    check(s2 > 0 && Math.abs(s2 - (total - abono)) < 1, "saldo del tablero = total − adelanto, una sola vez", s2.toLocaleString("es-CO"));

    console.log("\n3) Control: metiendo el bug a propósito");
    await c.query("UPDATE factura_estado SET otros_valor = $2, valor_a_pagar = valor_a_pagar - $2 WHERE cufe = $1", [cufe, abono]);
    const s3 = await saldoDe(c, cufe);
    check(s3 === 0, "con el doble descuento el saldo da 0 — por eso la factura se escondía de Pagos", String(s3));
  } finally {
    await c.query("ROLLBACK");
  }
  await c.end();
  console.log("\n" + (fallos.length ? "❌ FALLÓ: " + fallos.join("; ") : "✅ OK — el adelanto se descuenta una sola vez."));
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error("💥", e); process.exit(1); });
