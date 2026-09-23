#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DEL CRUCE MANUAL DE NOTAS CRÉDITO (Regla 14).
//
// El caso que lo pidió (23-sep-2026): Siigo facturó 952034897 ($8.106.226) y
// emitió la nota 105248481 (−$1.247.266); las dos entraron por el barrido de la
// DIAN sin XML, que es el único sitio donde una nota dice a qué factura
// corrige. La nota quedó con «a pagar $0» y la factura completa en Pagos.
//
// Corre contra la base REAL y hace ROLLBACK, llamando al MISMO módulo que usa el
// server action (lib/cruzar-nota.ts compilado con tsc), no a una copia. Fija:
//   1. cruzar una nota suelta con una factura del mismo NIT le baja el saldo a
//      esa factura exactamente en el valor de la nota, la nota deja de estar
//      «sin cruzar», y queda el evento encadenado en la bitácora;
//   2. cruzarla dos veces se rechaza (primero «quitar cruce»);
//   3. NO se cruza con otro NIT ni con otra nota;
//   4. una nota cuyo XML ya dijo la factura (y está en el portal) no se toca;
//   5. una nota cuyo XML dice una factura que NO está en el portal solo admite
//      «fuera del portal», con motivo; después deja de estar sin cruzar;
//   6. quitar un cruce manual restaura el saldo; quitar uno del XML se rechaza;
//   7. el sync (scripts/sync_bq_to_pg.py, el SQL real leído del archivo) NO
//      pisa un cruce manual con un XML que llegue después, y SÍ llena uno
//      que no tenía nada;
//   8. control: la condición `NC_SIN_CRUZAR` de la fila es la misma que usa el
//      centinela Python (health_check.py), palabra por palabra en lo que importa.
//
//   node scripts/test_cruzar_nota.js

const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const { Client } = require("pg");

const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, titulo, detalle = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${titulo}${detalle ? " — " + detalle : ""}`);
  if (!ok) fallos.push(titulo);
};

const cache = path.join(RAIZ, "node_modules", ".cache");
fs.mkdirSync(cache, { recursive: true });
const tmp = fs.mkdtempSync(path.join(cache, "tcn-"));
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
try {
  execFileSync("npx", ["tsc", "lib/cruzar-nota.ts", "lib/notas-credito.ts", "lib/eventos.ts", "--outDir", tmp,
                       "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
               { cwd: RAIZ, stdio: "pipe" });
} catch (e) {
  if (!fs.existsSync(path.join(tmp, "cruzar-nota.js"))) {
    console.error("No compiló:\n" + (e.stdout || e.message)); process.exit(1);
  }
}
const { cruzarNota, quitarCruce, candidatasPara } = require(path.join(tmp, "cruzar-nota.js"));
const { NC_SIN_CRUZAR, SALDO_NETO } = require(path.join(tmp, "notas-credito.js"));
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

// El UPSERT del sync NO se copia: se LEE del script que corre en el cron.
function sqlSync() {
  const s = fs.readFileSync(path.join(RAIZ, "scripts", "sync_bq_to_pg.py"), "utf8");
  // Hay varios execute_values en el sync (proveedores, semanas…): el que importa
  // es el de `facturas`, que es el que decide si un XML pisa un cruce manual.
  const q = s.split('execute_values(cur, """').map((t) => t.split('"""')[0]).find((t) => /^\s*INSERT INTO facturas/.test(t));
  if (!q) throw new Error("No encontré el INSERT de facturas en sync_bq_to_pg.py");
  const cols = 21;
  const vals = "(" + Array.from({ length: cols }, (_, i) => "$" + (i + 1)).join(",") + ")";
  return q.replace("VALUES %s", "VALUES " + vals).replace(/RETURNING[\s\S]*$/, "RETURNING ref_cufe, ref_fuente");
}
async function simularSync(c, cufe, refCufe, refNumero) {
  const r = (await c.query(`SELECT cufe, nit_proveedor, nombre_proveedor, numero, consecutivo_num, fecha_emision, subtotal, iva, total,
                                    moneda, es_exterior, responsabilidad_dian, link_drive, gcs_xml_path, doc_tipo, origen
                               FROM facturas WHERE cufe = $1`, [cufe])).rows[0];
  const params = [r.cufe, r.nit_proveedor, r.nombre_proveedor, r.numero, r.consecutivo_num, r.fecha_emision, r.subtotal, r.iva, r.total,
                  r.moneda, r.es_exterior, r.responsabilidad_dian, r.link_drive, r.gcs_xml_path, new Date(), r.doc_tipo,
                  refNumero, refCufe, "Anulación (XML)", "xml", refCufe ? "xml" : null];
  await c.query(sqlSync(), params);
  return (await c.query("SELECT ref_cufe, ref_numero, ref_fuente FROM facturas WHERE cufe = $1", [cufe])).rows[0];
}

const saldoDe = async (c, cufe) =>
  Number((await c.query(`SELECT ${SALDO_NETO("f", "e")}::float AS s FROM facturas f JOIN factura_estado e USING (cufe) WHERE f.cufe = $1`, [cufe])).rows[0].s);
const sinCruzar = async (c, cufe) =>
  !!(await c.query(`SELECT ${NC_SIN_CRUZAR("f")} AS s FROM facturas f WHERE f.cufe = $1`, [cufe])).rows[0].s;

const ACTOR = { email: "centinela@test", rol: "operador" };
const MOTIVO = "Centinela: el proveedor confirmó por correo de qué factura descuenta.";

(async () => {
  console.log("CENTINELA · cruce manual de notas crédito\n");
  const c = new Client({ connectionString: dsn(), ssl: /localhost|127\.0\.0\.1/.test(dsn()) ? false : { rejectUnauthorized: false } });
  await c.connect();
  await c.query("BEGIN");
  try {
    // ── una nota suelta (sin referencia) cuyo NIT tiene una factura SIN pagar ──
    const suelta = await c.query(`
      SELECT nc.cufe, nc.numero, abs(nc.total)::float AS valor, nc.nit_proveedor,
             (SELECT x.cufe FROM facturas x JOIN factura_estado xe USING (cufe)
               WHERE x.nit_proveedor = nc.nit_proveedor AND coalesce(x.doc_tipo,'Invoice') <> 'CreditNote'
                 AND coalesce(xe.pago_estado,'pendiente') <> 'pagado'
                 AND ${SALDO_NETO("x", "xe")} >= abs(nc.total)
               ORDER BY x.fecha_emision DESC LIMIT 1) AS factura
        FROM facturas nc
       WHERE nc.doc_tipo = 'CreditNote' AND nc.ref_cufe IS NULL AND nc.ref_fuente IS NULL
       ORDER BY nc.fecha_emision DESC`);
    const caso = suelta.rows.find((r) => r.factura);
    if (!caso) { console.log("SIN DATOS: no hay nota suelta con una factura pendiente del mismo NIT para probar."); await c.query("ROLLBACK"); await c.end(); return; }
    const { cufe: nota, numero: numNota, valor, factura } = caso;
    const numFactura = (await c.query("SELECT numero FROM facturas WHERE cufe = $1", [factura])).rows[0].numero;
    console.log(`caso de prueba: nota ${numNota} ($${Math.round(valor).toLocaleString("es-CO")}) → factura ${numFactura}\n`);

    console.log("1) Cruzar una nota suelta con una factura del mismo NIT");
    const info = await candidatasPara(c, nota);
    check(info.puede && !info.soloFuera && info.candidatas.some((x) => x.cufe === factura), "candidatasPara la ofrece y lista la factura", info.motivoNo ?? "");
    check(await sinCruzar(c, nota), "antes: la nota está «sin cruzar»");
    const antes = await saldoDe(c, factura);
    const r = await cruzarNota(c, nota, { cufeFactura: factura, fueraPortal: false, nota: MOTIVO }, ACTOR);
    const despues = await saldoDe(c, factura);
    check(Math.abs((antes - despues) - valor) < 1, "el saldo de la factura baja exactamente el valor de la nota", `${antes} → ${despues}`);
    check(r.factura && Math.abs(r.factura.saldo - despues) < 1 && r.nota.ref_fuente === "manual" && r.nota.nc_sin_cruzar === false, "el parche que vuelve a la pantalla dice lo mismo");
    check(!(await sinCruzar(c, nota)), "después: la nota ya no está «sin cruzar»");
    const fila = (await c.query("SELECT ref_cufe, ref_numero, ref_fuente, ref_manual_por, ref_manual_nota FROM facturas WHERE cufe = $1", [nota])).rows[0];
    check(fila.ref_cufe === factura && fila.ref_numero === numFactura && fila.ref_fuente === "manual" && fila.ref_manual_por === ACTOR.email && fila.ref_manual_nota === MOTIVO,
          "quedó quién, con qué factura y la nota", JSON.stringify(fila));
    const ev = await c.query("SELECT id, valor_nuevo FROM eventos WHERE cufe = $1 AND tipo = 'cruza_nota_credito' ORDER BY id DESC LIMIT 1", [nota]);
    check(ev.rowCount === 1 && ev.rows[0].valor_nuevo.factura?.cufe === factura && Math.abs(ev.rows[0].valor_nuevo.factura.saldo_antes - antes) < 1,
          "el evento `cruza_nota_credito` está en la bitácora con el saldo antes/después");
    const cadena = await verificarCadena(c, Math.max(1, Number(ev.rows[0].id) - 20));
    check(cadena.ok, "y quedó bien encadenado", cadena.ok ? "" : `rota en #${cadena.rotoEnId}`);

    console.log("\n2) Cruzarla dos veces se rechaza");
    let e2 = null; try { await cruzarNota(c, nota, { cufeFactura: factura, fueraPortal: false, nota: null }, ACTOR); } catch (e) { e2 = e; }
    check(!!e2 && /quitar cruce/i.test(e2.message), "segunda vez → «primero quitar cruce»", e2?.message);

    console.log("\n3) Ni con otro NIT, ni con otra nota");
    const otroNit = (await c.query(`SELECT cufe, numero FROM facturas WHERE nit_proveedor <> $1 AND coalesce(doc_tipo,'Invoice') <> 'CreditNote' LIMIT 1`, [caso.nit_proveedor])).rows[0];
    const otraNota = (await c.query(`SELECT cufe FROM facturas WHERE doc_tipo = 'CreditNote' AND cufe <> $1 AND ref_fuente IS NULL AND ref_cufe IS NULL LIMIT 1`, [nota])).rows[0];
    if (otraNota) {
      let e3 = null; try { await cruzarNota(c, otraNota.cufe, { cufeFactura: otroNit.cufe, fueraPortal: false, nota: null }, ACTOR); } catch (e) { e3 = e; }
      check(!!e3 && /otro proveedor/i.test(e3.message), "otro NIT → rechaza y dice de quién es", e3?.message);
      let e4 = null; try { await cruzarNota(c, otraNota.cufe, { cufeFactura: nota, fueraPortal: false, nota: null }, ACTOR); } catch (e) { e4 = e; }
      check(!!e4 && /otra nota/i.test(e4.message), "otra nota → rechaza", e4?.message);
      let e5 = null; try { await cruzarNota(c, otraNota.cufe, { cufeFactura: null, fueraPortal: false, nota: null }, ACTOR); } catch (e) { e5 = e; }
      check(!!e5 && /escoge/i.test(e5.message), "sin factura y sin «fuera del portal» → rechaza", e5?.message);
    } else console.log("  (no hay otra nota suelta; se salta)");

    console.log("\n4) Una nota cuyo XML ya dijo la factura no se toca");
    const xmlOk = (await c.query(`SELECT nc.cufe, nc.numero FROM facturas nc WHERE nc.doc_tipo = 'CreditNote' AND nc.ref_fuente = 'xml'
                                    AND EXISTS (SELECT 1 FROM facturas x WHERE x.cufe = nc.ref_cufe) LIMIT 1`)).rows[0];
    if (xmlOk) {
      const i4 = await candidatasPara(c, xmlOk.cufe);
      check(!i4.puede && /XML/i.test(i4.motivoNo ?? ""), "candidatasPara dice que el documento manda", i4.motivoNo ?? "");
      let e6 = null; try { await cruzarNota(c, xmlOk.cufe, { cufeFactura: otroNit.cufe, fueraPortal: false, nota: null }, ACTOR); } catch (e) { e6 = e; }
      check(!!e6, "y cruzarla se rechaza", e6?.message);
      let e7 = null; try { await quitarCruce(c, xmlOk.cufe, MOTIVO, ACTOR); } catch (e) { e7 = e; }
      check(!!e7 && /DIAN/i.test(e7.message), "quitar una referencia del XML se rechaza", e7?.message);
    } else console.log("  (no hay nota con referencia XML en el portal; se salta)");

    console.log("\n5) Nota cuyo XML dice una factura que NO está en el portal: solo «fuera del portal»");
    const xmlFuera = (await c.query(`SELECT nc.cufe, nc.numero, nc.ref_numero FROM facturas nc WHERE nc.doc_tipo = 'CreditNote' AND nc.ref_cufe IS NOT NULL
                                       AND nc.ref_fuente = 'xml' AND NOT EXISTS (SELECT 1 FROM facturas x WHERE x.cufe = nc.ref_cufe) LIMIT 1`)).rows[0];
    if (xmlFuera) {
      const i5 = await candidatasPara(c, xmlFuera.cufe);
      check(i5.puede && i5.soloFuera, "candidatasPara: se puede, pero solo fuera del portal");
      check(await sinCruzar(c, xmlFuera.cufe), "antes: cuenta como «sin cruzar» (apunta a una factura que no tenemos)");
      const hermana = (await c.query(`SELECT cufe FROM facturas x WHERE x.nit_proveedor = (SELECT nit_proveedor FROM facturas WHERE cufe = $1)
                                        AND coalesce(x.doc_tipo,'Invoice') <> 'CreditNote' LIMIT 1`, [xmlFuera.cufe])).rows[0];
      if (hermana) { let e8 = null; try { await cruzarNota(c, xmlFuera.cufe, { cufeFactura: hermana.cufe, fueraPortal: false, nota: null }, ACTOR); } catch (e) { e8 = e; }
        check(!!e8 && /fuera del portal/i.test(e8.message), "cruzarla con otra factura → rechaza y manda a «fuera del portal»", e8?.message); }
      let e9 = null; try { await cruzarNota(c, xmlFuera.cufe, { cufeFactura: null, fueraPortal: true, nota: "corto" }, ACTOR); } catch (e) { e9 = e; }
      check(!!e9 && /por qué/i.test(e9.message), "fuera del portal sin motivo → rechaza", e9?.message);
      const r5 = await cruzarNota(c, xmlFuera.cufe, { cufeFactura: null, fueraPortal: true, nota: "Anula una factura que nunca entró; el proveedor re-facturó." }, ACTOR);
      check(r5.nota.ref_fuente === "fuera_portal" && r5.factura === null, "queda fuera del portal, sin descontar de nada");
      check(!(await sinCruzar(c, xmlFuera.cufe)), "después: ya no cuenta como «sin cruzar»");
      const f5 = (await c.query("SELECT ref_cufe, ref_numero FROM facturas WHERE cufe = $1", [xmlFuera.cufe])).rows[0];
      check(f5.ref_numero === xmlFuera.ref_numero && !!f5.ref_cufe, "y lo que dijo el XML se conserva (no se contradice al documento)");
      const r5b = await quitarCruce(c, xmlFuera.cufe, "Centinela: deshaciendo la marca de prueba.", ACTOR);
      check(r5b.nota.ref_fuente === "xml" && (await sinCruzar(c, xmlFuera.cufe)), "quitar la marca vuelve a «xml» y a «sin cruzar»");
    } else console.log("  (no hay nota con referencia a factura ausente; se salta)");

    console.log("\n6) Quitar un cruce manual restaura el saldo");
    const r6 = await quitarCruce(c, nota, "Centinela: era la factura equivocada.", ACTOR);
    check(Math.abs((await saldoDe(c, factura)) - antes) < 1, "el saldo de la factura vuelve al de antes");
    check(r6.nota.ref_fuente === null && r6.nota.nc_sin_cruzar === true && r6.factura?.cufe === factura, "la nota vuelve a «sin cruzar» y el parche lo dice");
    const ev6 = await c.query("SELECT 1 FROM eventos WHERE cufe = $1 AND tipo = 'quita_cruce_nota' ORDER BY id DESC LIMIT 1", [nota]);
    check(ev6.rowCount === 1, "el evento `quita_cruce_nota` quedó en la bitácora");
    let e10 = null; try { await quitarCruce(c, nota, "Centinela: otra vez.", ACTOR); } catch (e) { e10 = e; }
    check(!!e10 && /ningún cruce/i.test(e10.message), "quitarlo dos veces → «no tiene ningún cruce»", e10?.message);

    console.log("\n7) El sync no pisa un cruce manual (SQL real de scripts/sync_bq_to_pg.py)");
    await cruzarNota(c, nota, { cufeFactura: factura, fueraPortal: false, nota: MOTIVO }, ACTOR);
    const s7 = await simularSync(c, nota, otroNit.cufe, otroNit.numero);
    check(s7.ref_cufe === factura && s7.ref_fuente === "manual", "llega un XML con OTRA factura → el cruce manual se queda", JSON.stringify(s7));
    check(Math.abs((await saldoDe(c, factura)) - despues) < 1, "y el saldo de la factura no se movió");
    await quitarCruce(c, nota, "Centinela: limpiando para probar el sync.", ACTOR);
    const s7b = await simularSync(c, nota, factura, numFactura);
    check(s7b.ref_cufe === factura && s7b.ref_fuente === "xml", "una nota sin nada SÍ recibe la referencia del XML, marcada 'xml'", JSON.stringify(s7b));

    console.log("\n8) Control: la fila y el centinela Python usan la misma condición");
    const hc = "/home/daniel/proyectos/datawarehouse/contabilidad/facturacion/health_check.py";
    if (fs.existsSync(hc)) {
      const py = fs.readFileSync(hc, "utf8").split("def _check_nota_credito_sin_referencia")[1]?.split("\ndef ")[0] ?? "";
      const ts = NC_SIN_CRUZAR("f");
      const piezas = ["doc_tipo = 'CreditNote'", "coalesce(f.ref_fuente, '') <> 'fuera_portal'", "NOT EXISTS (SELECT 1 FROM facturas x WHERE x.cufe = f.ref_cufe)"];
      check(piezas.every((p) => ts.includes(p) && py.includes(p)), "las tres condiciones están en los dos", piezas.filter((p) => !py.includes(p)).join(" | "));
    } else console.log("  (health_check.py no está en esta máquina; se salta)");
  } finally {
    await c.query("ROLLBACK");
  }
  await c.end();
  console.log("\n" + (fallos.length ? "❌ FALLÓ: " + fallos.join("; ") : "✅ OK — una nota descuenta de la factura que una persona escogió, con rastro, y nadie la pisa."));
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error("💥", e); process.exit(1); });
