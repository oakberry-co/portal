#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DEL MES DEL GASTO (§27 del esquema, Regla 14).
//
// La regla que fija (7-oct-2026): cada factura sabe a qué MES pertenece su
// gasto, que no siempre es el mes de la factura. Siigo registra con la fecha
// del documento: la luz de Andino de septiembre entra facturada el 4 de
// octubre y, sin esto, octubre carga el consumo de septiembre. Nadie lo veía
// porque el cierre contable tarda semanas; el P&L al día de finanzas sí.
//
// Corre contra la base REAL y hace ROLLBACK, llamando al MISMO módulo que usa
// el server action (lib/periodo-gasto-db.ts compilado con tsc), no a una copia.
// Fija:
//   1. sin que nadie lo fije, el mes del gasto es el mes de la factura ('emision');
//   2. fijarlo a mano lo guarda con fuente 'humano' y la vista lo devuelve;
//   3. UNA factura fijada NO enseña al proveedor (Regla 13: una corrección
//      puntual no re-mapea un maestro) — la siguiente factura sigue en 'emision';
//   4. DOS facturas con el mismo corrimiento SÍ: la tercera, sin tocarla,
//      resuelve al mes aprendido con fuente 'proveedor';
//   5. fuera del rango (más de 6 meses atrás, más de 1 adelante) o algo que no
//      es un mes se rechaza con motivo;
//   6. cada cambio deja su evento `set_periodo_gasto` en la cadena y la cadena
//      sigue entera;
//   7. el sync (scripts/sync_bq_to_pg.py) NO escribe periodo_gasto: no puede
//      pisar lo humano porque ni conoce la columna;
//   8. grilla y export leen la VISTA (una sola definición) y el export trae la
//      columna «Mes gasto».
//
//   node scripts/test_periodo_gasto.js

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
const tmp = fs.mkdtempSync(path.join(cache, "tpg-"));
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
try {
  execFileSync("npx", ["tsc", "lib/periodo-gasto-db.ts", "lib/periodo-gasto.ts", "lib/eventos.ts", "--outDir", tmp,
                       "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
               { cwd: RAIZ, stdio: "pipe" });
} catch (e) {
  if (!fs.existsSync(path.join(tmp, "periodo-gasto-db.js"))) {
    console.error("No compiló:\n" + (e.stdout || e.message)); process.exit(1);
  }
}
const { fijarPeriodoGasto } = require(path.join(tmp, "periodo-gasto-db.js"));
const { mesDe, sumarMeses, offsetEntre, opcionesPeriodo, etiquetaMes } = require(path.join(tmp, "periodo-gasto.js"));
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

const ACTOR = { email: "centinela@test", rol: "operador" };
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), "utf8");

(async () => {
  console.log("CENTINELA · el mes del gasto\n");

  console.log("0) Lo puro: fechas y etiquetas");
  check(mesDe("2026-10-04") === "2026-10-01" && mesDe(new Date(2026, 9, 4)) === "2026-10-01", "mesDe: string y Date dan el mismo mes");
  check(sumarMeses("2026-01-01", -1) === "2025-12-01" && sumarMeses("2026-12-01", 1) === "2027-01-01", "sumarMeses cruza el año en los dos sentidos");
  check(offsetEntre("2026-10-01", "2026-09-01") === -1 && offsetEntre("2026-01-01", "2025-11-01") === -2, "offsetEntre cuenta meses, no días");
  check(opcionesPeriodo("2026-10-04").join() === "2026-07-01,2026-08-01,2026-09-01,2026-10-01,2026-11-01", "opciones: 3 atrás, la emisión y 1 adelante");
  check(opcionesPeriodo("2026-10-04", "2026-04-01")[0] === "2026-04-01", "un mes fijado fuera del rango se sigue mostrando");
  check(etiquetaMes("2026-09-01") === "sep-26", "etiqueta corta");

  console.log("\n7) El sync no conoce la columna (no puede pisar lo humano)");
  const sync = leer("scripts/sync_bq_to_pg.py");
  check(!/periodo_gasto/.test(sync), "sync_bq_to_pg.py no menciona periodo_gasto");
  console.log("\n8) Una sola definición: grilla y export leen la vista");
  check(/CREATE OR REPLACE VIEW v_factura_periodo/.test(leer("db/schema.sql")), "schema.sql define v_factura_periodo");
  check(/v_factura_periodo/.test(leer("app/(portal)/contabilidad/conciliacion/page.tsx")), "la grilla lee v_factura_periodo");
  const exp = leer("app/(portal)/contabilidad/conciliacion/export/route.ts");
  check(/v_factura_periodo/.test(exp) && /Mes gasto/.test(exp), "el export lee la vista y trae la columna «Mes gasto»");
  check(!/date_trunc\('month', f\.fecha_emision\)/.test(leer("app/(portal)/contabilidad/conciliacion/page.tsx")), "la grilla NO recalcula el mes por su cuenta");

  const c = new Client({ connectionString: dsn(), ssl: /localhost|127\.0\.0\.1/.test(dsn()) ? false : { rejectUnauthorized: false } });
  await c.connect();
  await c.query("BEGIN");
  try {
    // Un proveedor real con tres facturas sin mes fijado. Se le borra la regla
    // DENTRO de la transacción (se deshace al final) para que la prueba no
    // dependa de lo que el equipo ya le enseñó.
    const prov = await c.query(`
      SELECT f.nit_proveedor AS nit, array_agg(f.cufe ORDER BY f.fecha_emision DESC) AS cufes
        FROM facturas f JOIN factura_estado e USING (cufe)
       WHERE e.periodo_gasto IS NULL AND coalesce(f.doc_tipo, 'Invoice') <> 'CreditNote'
         AND f.nit_proveedor <> 'ND'
       GROUP BY 1 HAVING count(*) >= 3 ORDER BY count(*) DESC LIMIT 1`);
    if (prov.rowCount === 0) { console.log("SIN DATOS: no hay proveedor con 3 facturas sin mes fijado."); await c.query("ROLLBACK"); await c.end(); return; }
    const { nit, cufes } = prov.rows[0];
    const [c1, c2, c3] = cufes;
    await c.query("UPDATE maestro_proveedores SET periodo_offset_meses = NULL WHERE nit = $1", [nit]);
    const vista = async (cufe) => {
      const r = (await c.query("SELECT fecha_emision, periodo_gasto, periodo_fuente FROM v_factura_periodo WHERE cufe = $1", [cufe])).rows[0];
      return { emision: mesDe(r.fecha_emision), periodo: mesDe(r.periodo_gasto), fuente: r.periodo_fuente };
    };
    const ultimoEvento = async () => Number((await c.query("SELECT max(id) AS id FROM eventos")).rows[0].id);
    const desde = (await ultimoEvento()) + 1;
    console.log(`\ncaso de prueba: NIT ${nit} (${cufes.length} facturas)`);

    console.log("\n1) Sin fijar nada, el mes del gasto es el de la factura");
    let v = await vista(c1);
    check(v.periodo === v.emision && v.fuente === "emision", "vista: periodo = emisión, fuente 'emision'", `${v.periodo} / ${v.fuente}`);

    console.log("\n2) Fijarlo a mano");
    const mesAnterior1 = sumarMeses(v.emision, -1);
    const p1 = await fijarPeriodoGasto(c, c1, mesAnterior1, ACTOR);
    v = await vista(c1);
    check(v.periodo === mesAnterior1 && v.fuente === "humano", "vista: devuelve el mes fijado con fuente 'humano'", `${v.periodo} / ${v.fuente}`);
    check(p1.periodo_gasto === mesAnterior1 && p1.periodo_fuente === "humano", "el parche que vuelve a la pantalla dice lo mismo");
    const fila = (await c.query("SELECT periodo_gasto, periodo_gasto_fuente FROM factura_estado WHERE cufe = $1", [c1])).rows[0];
    check(mesDe(fila.periodo_gasto) === mesAnterior1 && fila.periodo_gasto_fuente === "humano", "la base guarda el mes y la fuente");

    console.log("\n3) Una sola factura NO enseña al proveedor (Regla 13)");
    check(p1.regla_proveedor === null, "sin regla aprendida tras una factura");
    const v3a = await vista(c3);
    check(v3a.periodo === v3a.emision && v3a.fuente === "emision", "la tercera factura sigue en el mes de su emisión");

    console.log("\n4) Dos facturas con el mismo corrimiento SÍ enseñan");
    const e2 = (await vista(c2)).emision;
    const p2 = await fijarPeriodoGasto(c, c2, sumarMeses(e2, -1), ACTOR);
    check(p2.regla_proveedor === -1, "el proveedor aprende -1 (mes anterior)");
    const regla = (await c.query("SELECT periodo_offset_meses, fuente FROM maestro_proveedores WHERE nit = $1", [nit])).rows[0];
    check(regla && regla.periodo_offset_meses === -1 && regla.fuente === "humano", "maestro_proveedores guarda la regla como humana");
    const v3b = await vista(c3);
    check(v3b.periodo === sumarMeses(v3b.emision, -1) && v3b.fuente === "proveedor", "la tercera, sin tocarla, resuelve al mes anterior con fuente 'proveedor'", `${v3b.periodo} / ${v3b.fuente}`);
    // Fijar la primera de vuelta a su propio mes no desaprende: solo hay UNA en 0.
    await fijarPeriodoGasto(c, c1, v.emision, ACTOR);
    const regla2 = (await c.query("SELECT periodo_offset_meses FROM maestro_proveedores WHERE nit = $1", [nit])).rows[0];
    check(regla2.periodo_offset_meses === -1, "una corrección contraria aislada no cambia la regla aprendida");

    console.log("\n5) Lo que se rechaza");
    let msg = "";
    try { await fijarPeriodoGasto(c, c1, sumarMeses(v.emision, 2), ACTOR); } catch (e) { msg = e.message; }
    check(/entre 6 meses antes y 1 después/.test(msg), "dos meses adelante se rechaza con motivo", msg.slice(0, 60));
    msg = "";
    try { await fijarPeriodoGasto(c, c1, sumarMeses(v.emision, -7), ACTOR); } catch (e) { msg = e.message; }
    check(/entre 6 meses antes/.test(msg), "siete meses atrás se rechaza");
    msg = "";
    try { await fijarPeriodoGasto(c, c1, "2026-10-15", ACTOR); } catch (e) { msg = e.message; }
    check(/tiene que ser un mes/.test(msg), "un día que no es primero de mes se rechaza");
    msg = "";
    try { await c.query("UPDATE factura_estado SET periodo_gasto = '2026-10-15' WHERE cufe = $1", [c1]); } catch (e) { msg = e.message; await c.query("ROLLBACK TO SAVEPOINT s0").catch(() => {}); }
    check(/ck_periodo_gasto_mes/.test(msg), "y la base también lo rechaza (CHECK), no solo el código");
  } catch (e) {
    console.error("\nERROR:", e);
    fallos.push("excepción: " + e.message);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
  }

  // La prueba del CHECK rompe la transacción, así que la cadena se verifica en
  // una transacción aparte, repitiendo el camino feliz.
  await c.query("BEGIN");
  try {
    const prov = await c.query(`
      SELECT f.cufe FROM facturas f JOIN factura_estado e USING (cufe)
       WHERE e.periodo_gasto IS NULL AND coalesce(f.doc_tipo, 'Invoice') <> 'CreditNote' AND f.nit_proveedor <> 'ND'
       ORDER BY f.fecha_emision DESC LIMIT 1`);
    const cufe = prov.rows[0].cufe;
    const desde = Number((await c.query("SELECT max(id) AS id FROM eventos")).rows[0].id) + 1;
    const em = mesDe((await c.query("SELECT fecha_emision FROM facturas WHERE cufe = $1", [cufe])).rows[0].fecha_emision);
    console.log("\n6) La bitácora");
    await fijarPeriodoGasto(c, cufe, sumarMeses(em, -1), ACTOR);
    const ev = await c.query("SELECT tipo, campo, valor_nuevo, actor FROM eventos WHERE id >= $1 ORDER BY id", [desde]);
    check(ev.rowCount === 1 && ev.rows[0].tipo === "set_periodo_gasto" && ev.rows[0].valor_nuevo.periodo_gasto === sumarMeses(em, -1),
          "queda un evento set_periodo_gasto con el mes nuevo");
    const cad = await verificarCadena(c, desde);
    check(cad.ok, "la cadena sigue entera desde el evento nuevo", cad.ok ? "" : `rota en #${cad.rotoEnId}`);
  } catch (e) {
    console.error("\nERROR:", e);
    fallos.push("excepción: " + e.message);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }

  console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s): ${fallos.join(" · ")}` : "\n✅ el mes del gasto se comporta");
  process.exit(fallos.length ? 1 : 0);
})();
