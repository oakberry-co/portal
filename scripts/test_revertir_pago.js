#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE «QUITAR UN PAGO QUE NUNCA SALIÓ» (Regla 14).
//
// El caso que lo pidió (10-sep-2026): VIB125646 ($13,9 M, penalidad de arriendo
// de Viva Barranquilla) figuraba pagada porque la migración del Sheet (11-ago)
// convirtió la marca «Pagado» tecleada a mano en un pago del portal, sin
// comprobante — y el equipo no encontraba el giro. El portal no tenía cómo
// devolverla: el estado solo avanza, a propósito, porque una pagada que
// retrocede reaparece en Pagos y se paga dos veces.
//
// Corre contra la base REAL y hace ROLLBACK, llamando al MISMO módulo que usa
// el server action (lib/revertir-pago.ts compilado con tsc), no a una copia.
// Lo que fija:
//   1. sin motivo, o sin la marca de «miramos el banco», NO toca nada;
//   2. un pago migrado sin comprobante SÍ se revierte: sale de `pagos`, queda
//      entero en `pagos_revertidos`, el Historial del tablero deja de listarlo,
//      la factura vuelve a «pendiente» y el evento entra a la bitácora sin
//      romper la cadena de hashes;
//   3. revertirlo dos veces falla (ya no hay pago);
//   4. un pago CON comprobante se rechaza: la plata salió;
//   5. un pago que cubre DOS facturas se rechaza: deshacer una lo descuadra;
//   6. la factura vuelve al paso que le toca por lo que ya tiene confirmado
//      (concepto+destino+plazo+retenciones → retenciones_ok, y así queda
//      elegible para Pendientes de Pagos por el camino normal);
//   7. la migración del Sheet, si se volviera a correr, respeta lo revertido.
//
//   node scripts/test_revertir_pago.js

const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const { Client } = require("pg");

const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, titulo, detalle = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${titulo}${detalle ? " — " + detalle : ""}`);
  if (!ok) fallos.push(titulo);
};

// Compila DENTRO del repo: los módulos requieren `pg` en tiempo de ejecución y
// desde /tmp Node no encuentra el node_modules del proyecto.
const cache = path.join(RAIZ, "node_modules", ".cache");
fs.mkdirSync(cache, { recursive: true });
const tmp = fs.mkdtempSync(path.join(cache, "trp-"));
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
try {
  execFileSync("npx", ["tsc", "lib/revertir-pago.ts", "lib/eventos.ts", "--outDir", tmp,
                       "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
               { cwd: RAIZ, stdio: "pipe" });
} catch (e) {
  if (!fs.existsSync(path.join(tmp, "revertir-pago.js"))) {
    console.error("No compiló:\n" + (e.stdout || e.message)); process.exit(1);
  }
}
const { revertirPago, pagoActivoDe, estadoPrevioAlPago } = require(path.join(tmp, "revertir-pago.js"));
const { verificarCadena } = require(path.join(tmp, "eventos.js"));

function dsn() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(RAIZ, f);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
    if (m) return m[1].trim();
  }
  return process.env.DATABASE_URL;
}

// La consulta del Historial NO se copia: se LEE del archivo que se despliega.
const PAGE = path.join(RAIZ, "app/(portal)/contabilidad/pagos/page.tsx");
function sqlHistorial() {
  const s = fs.readFileSync(PAGE, "utf8");
  const q = s.split("const historial = await pool.query<PagoHecho>(`")[1]?.split("`);")[0];
  if (!q) throw new Error("No encontré la consulta del historial en pagos/page.tsx");
  return q.replace(/LIMIT\s+\d+\s*$/i, "");
}
const enHistorial = async (c, pagoId) =>
  (await c.query(`SELECT 1 FROM (${sqlHistorial()}) h WHERE h.id = $1`, [pagoId])).rowCount > 0;

// La condición con la que el tablero arma la columna Pendientes (pagos/page.tsx).
const enPendientesDePagos = async (c, cufe) =>
  (await c.query(`SELECT 1 FROM factura_estado e WHERE e.cufe = $1 AND e.estado = 'retenciones_ok'
                    AND coalesce(e.pago_estado,'pendiente') <> 'pagado' AND e.cuenta_pago IS NULL`, [cufe])).rowCount > 0;

const ACTOR = { email: "centinela@test", rol: "admin" };
const MOTIVO = "Centinela: extracto revisado, la transferencia no existe.";

(async () => {
  console.log("CENTINELA · quitar un pago que nunca salió\n");
  const c = new Client({ connectionString: dsn(), ssl: /localhost|127\.0\.0\.1/.test(dsn()) ? false : { rejectUnauthorized: false } });
  await c.connect();
  const antes = (await c.query("SELECT count(*)::int AS n FROM pagos")).rows[0].n;
  await c.query("BEGIN");
  try {
    // ── un pago migrado del Sheet, sin comprobante, de una sola factura ──
    const mig = await c.query(`
      SELECT pf.cufe, p.id AS pago_id, p.monto::float AS monto, e.estado, e.pago_estado
        FROM pago_facturas pf JOIN pagos p ON p.id = pf.pago_id JOIN factura_estado e ON e.cufe = pf.cufe
       WHERE p.pagado_por LIKE 'migracion:%' AND p.comprobante_url IS NULL AND p.tipo = 'completo'
         AND (SELECT count(*) FROM pago_facturas x WHERE x.pago_id = p.id) = 1
         AND (SELECT count(*) FROM pago_facturas y WHERE y.cufe = pf.cufe) = 1
       ORDER BY p.id LIMIT 1`);
    if (!mig.rowCount) { console.log("SIN DATOS: no hay pagos migrados sin comprobante para probar."); await c.query("ROLLBACK"); await c.end(); return; }
    const { cufe, pago_id: pagoId, monto } = mig.rows[0];
    console.log(`factura de prueba: pago #${pagoId} · $${Math.round(monto).toLocaleString("es-CO")} · estado ${mig.rows[0].estado}\n`);

    console.log("1) Sin motivo o sin la marca del banco, no toca nada");
    let e1 = null; try { await revertirPago(c, cufe, { motivo: "", verificadoBanco: true }, ACTOR); } catch (e) { e1 = e; }
    check(!!e1 && /motivo/i.test(e1.message), "sin motivo → rechaza", e1?.message);
    let e2 = null; try { await revertirPago(c, cufe, { motivo: MOTIVO, verificadoBanco: false }, ACTOR); } catch (e) { e2 = e; }
    check(!!e2 && /banco/i.test(e2.message), "sin la marca del banco → rechaza", e2?.message);
    const sigue = (await c.query("SELECT 1 FROM pagos WHERE id = $1", [pagoId])).rowCount === 1;
    check(sigue, "y el pago sigue donde estaba");

    console.log("\n2) Un pago migrado sin comprobante SÍ se revierte, y deja rastro");
    const info = await pagoActivoDe(c, cufe);
    check(info.puede && info.migrado, "pagoActivoDe lo reconoce como migrado y revertible", info.motivoNo ?? "");
    check(await enHistorial(c, pagoId), "antes: el Historial del tablero lo lista");
    const r = await revertirPago(c, cufe, { motivo: MOTIVO, verificadoBanco: true }, ACTOR);
    check(r.pago_estado === "pendiente", "la factura vuelve a pendiente", `estado → ${r.estado}`);
    check((await c.query("SELECT 1 FROM pagos WHERE id = $1", [pagoId])).rowCount === 0, "el pago salió de `pagos`");
    check((await c.query("SELECT 1 FROM pago_facturas WHERE pago_id = $1", [pagoId])).rowCount === 0, "…y de `pago_facturas`");
    const rev = await c.query("SELECT * FROM pagos_revertidos WHERE pago_id = $1 AND cufe = $2", [pagoId, cufe]);
    check(rev.rowCount === 1, "queda entero en `pagos_revertidos`");
    check(rev.rows[0] && Number(rev.rows[0].monto) === Math.round(monto * 100) / 100
          && rev.rows[0].verificado_banco === true && rev.rows[0].motivo === MOTIVO
          && rev.rows[0].revertido_por === ACTOR.email, "…con monto, motivo, marca del banco y quién");
    check(rev.rows[0] && Array.isArray(rev.rows[0].facturas) && rev.rows[0].facturas.length === 1
          && rev.rows[0].facturas[0].cufe === cufe, "…y las facturas que cubría");
    check(!(await enHistorial(c, pagoId)), "después: el Historial del tablero YA NO lo lista");
    const fe = (await c.query("SELECT estado, pago_estado, pago_monto, fecha_pago, cuenta_pago FROM factura_estado WHERE cufe = $1", [cufe])).rows[0];
    check(fe.pago_estado === "pendiente" && fe.pago_monto == null && fe.fecha_pago == null && fe.cuenta_pago == null,
          "factura_estado quedó sin rastro del pago", JSON.stringify(fe));
    check(["capturada", "clasificada", "retenciones_ok"].includes(fe.estado), "…y en un estado previo al pago", fe.estado);
    const ev = await c.query("SELECT valor_nuevo, valor_anterior FROM eventos WHERE cufe = $1 AND tipo = 'revierte_pago' ORDER BY id DESC LIMIT 1", [cufe]);
    check(ev.rowCount === 1 && ev.rows[0].valor_nuevo.motivo === MOTIVO && ev.rows[0].valor_anterior.pago?.id === pagoId,
          "el evento `revierte_pago` está en la bitácora con el pago entero adentro");
    // Se verifica la cola de la cadena (desde unos eventos antes del nuestro):
    // la cadena completa de producción ya venía rota en el #1188, un evento de
    // la migración del 11-ago escrito por Python, y eso no es culpa de esto.
    const idEv = (await c.query("SELECT id FROM eventos WHERE cufe = $1 AND tipo = 'revierte_pago' ORDER BY id DESC LIMIT 1", [cufe])).rows[0].id;
    const cadena = await verificarCadena(c, Math.max(1, Number(idEv) - 20));
    check(cadena.ok, "el evento quedó bien encadenado (hash propio y del anterior)", cadena.ok ? "" : `rota en #${cadena.rotoEnId}`);

    console.log("\n3) Revertir dos veces falla");
    let e3 = null; try { await revertirPago(c, cufe, { motivo: MOTIVO, verificadoBanco: true }, ACTOR); } catch (e) { e3 = e; }
    check(!!e3 && /ningún pago/i.test(e3.message), "segunda vez → «no tiene ningún pago»", e3?.message);

    console.log("\n4) Un pago CON comprobante se rechaza");
    const conComp = await c.query(`
      SELECT pf.cufe FROM pago_facturas pf JOIN pagos p ON p.id = pf.pago_id
       WHERE p.comprobante_url IS NOT NULL LIMIT 1`);
    if (conComp.rowCount) {
      const i4 = await pagoActivoDe(c, conComp.rows[0].cufe);
      check(!i4.puede && /comprobante/i.test(i4.motivoNo ?? ""), "pagoActivoDe dice que no, y por qué", i4.motivoNo ?? "");
      let e4 = null; try { await revertirPago(c, conComp.rows[0].cufe, { motivo: MOTIVO, verificadoBanco: true }, ACTOR); } catch (e) { e4 = e; }
      check(!!e4, "revertirPago lanza", e4?.message);
    } else console.log("  (sin pagos con comprobante en la base; se salta)");

    console.log("\n5) Un pago que cubre DOS facturas se rechaza");
    await c.query("SAVEPOINT dos");
    const dos = await c.query(`
      SELECT f.cufe FROM facturas f JOIN factura_estado e USING (cufe)
       WHERE NOT EXISTS (SELECT 1 FROM pago_facturas x WHERE x.cufe = f.cufe)
         AND f.nit_proveedor = (SELECT nit_proveedor FROM facturas WHERE cufe = $1) AND f.cufe <> $1
       LIMIT 2`, [cufe]);
    if (dos.rowCount === 2) {
      const pg = await c.query(`INSERT INTO pagos (nit_proveedor, fecha_pago, monto, tipo, pagado_por, cuenta_pago, origen)
                                VALUES ((SELECT nit_proveedor FROM facturas WHERE cufe = $1), CURRENT_DATE, 1000, 'completo', 'centinela@test', 'Davivienda', 'factura')
                                RETURNING id`, [dos.rows[0].cufe]);
      for (const row of dos.rows) await c.query("INSERT INTO pago_facturas (pago_id, cufe, monto_aplicado) VALUES ($1,$2,500)", [pg.rows[0].id, row.cufe]);
      const i5 = await pagoActivoDe(c, dos.rows[0].cufe);
      check(!i5.puede && /2 facturas/.test(i5.motivoNo ?? ""), "pagoActivoDe dice que no: cubrió 2 facturas", i5.motivoNo ?? "");
    } else console.log("  (no encontré dos facturas libres del mismo proveedor; se salta)");
    await c.query("ROLLBACK TO SAVEPOINT dos");

    console.log("\n6) Vuelve al paso que le toca por lo que ya tiene confirmado");
    check(estadoPrevioAlPago({ concepto: null, destino: "X", plazo_dias: 30, retencion_ok: true }) === "capturada", "sin concepto → capturada");
    check(estadoPrevioAlPago({ concepto: "Fruta", destino: "X", plazo_dias: null, retencion_ok: true }) === "capturada", "sin plazo → capturada (falta el día de pago)");
    check(estadoPrevioAlPago({ concepto: "Fruta", destino: "X", plazo_dias: 30, retencion_ok: false }) === "clasificada", "completa sin retenciones → clasificada");
    check(estadoPrevioAlPago({ concepto: "Fruta", destino: "X", plazo_dias: 30, retencion_ok: true }) === "retenciones_ok", "completa con retenciones → retenciones_ok");
    // Y contra la base: otro pago migrado, forzado a tener todo confirmado.
    await c.query("SAVEPOINT seis");
    const mig2 = await c.query(`
      SELECT pf.cufe FROM pago_facturas pf JOIN pagos p ON p.id = pf.pago_id
       WHERE p.pagado_por LIKE 'migracion:%' AND p.comprobante_url IS NULL AND p.tipo = 'completo'
         AND (SELECT count(*) FROM pago_facturas x WHERE x.pago_id = p.id) = 1
         AND (SELECT count(*) FROM pago_facturas y WHERE y.cufe = pf.cufe) = 1 AND pf.cufe <> $1
       ORDER BY p.id LIMIT 1`, [cufe]);
    if (mig2.rowCount) {
      const c2 = mig2.rows[0].cufe;
      await c.query(`UPDATE factura_estado SET concepto = coalesce(concepto,'Fruta'), destino = coalesce(destino,'TRANSVERSAL'),
                        plazo_dias = coalesce(plazo_dias, 30), retencion_ok = TRUE WHERE cufe = $1`, [c2]);
      const r6 = await revertirPago(c, c2, { motivo: MOTIVO, verificadoBanco: true }, ACTOR);
      check(r6.estado === "retenciones_ok", "con todo confirmado vuelve a retenciones_ok", r6.estado);
      check(await enPendientesDePagos(c, c2), "…y el tablero de Pagos la ve otra vez en Pendientes");
    } else console.log("  (solo hay un pago migrado; se salta la prueba contra la base)");
    await c.query("ROLLBACK TO SAVEPOINT seis");

    console.log("\n7) La migración del Sheet respeta lo revertido");
    const src = fs.readFileSync(path.join(RAIZ, "scripts/migrar_historico_humano.py"), "utf8");
    check(/FROM pagos_revertidos/.test(src) && /cufe in revertidas/.test(src),
          "migrar_historico_humano.py lee pagos_revertidos y salta esas facturas");

    console.log("\n8) Control: metiendo el bug a propósito");
    // Si la reversión olvidara sacar el pago de `pagos`, el Historial lo seguiría mostrando.
    await c.query("SAVEPOINT bug");
    await c.query(`INSERT INTO pagos (id, nit_proveedor, fecha_pago, monto, tipo, pagado_por, cuenta_pago, origen)
                   SELECT pago_id, nit_proveedor, fecha_pago, monto, tipo, pagado_por, cuenta_pago, origen FROM pagos_revertidos WHERE pago_id = $1`, [pagoId]);
    await c.query("INSERT INTO pago_facturas (pago_id, cufe, monto_aplicado) VALUES ($1,$2,$3)", [pagoId, cufe, monto]);
    check(await enHistorial(c, pagoId), "sin el DELETE, el Historial volvería a listarlo — el centinela lo distingue");
    await c.query("ROLLBACK TO SAVEPOINT bug");
  } finally {
    await c.query("ROLLBACK");
  }
  const despues = (await c.query("SELECT count(*)::int AS n FROM pagos")).rows[0].n;
  check(antes === despues, "ROLLBACK: la base quedó como estaba", `${antes} pagos antes y después`);
  await c.end();
  console.log("\n" + (fallos.length ? "❌ FALLÓ: " + fallos.join("; ") : "✅ OK — quitar un pago deja rastro, no deja doble pago y la factura vuelve al flujo."));
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error("💥", e); process.exit(1); });
