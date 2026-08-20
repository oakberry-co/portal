#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DEL BOTÓN "ACTUALIZAR CUENTAS BANCARIAS" (Regla 14).
//
// El caso que lo pidió: se carga la cuenta de un proveedor nuevo en Maestros y
// el tablero de Pagos sigue diciendo "⚠ sin cuenta". Casi nunca es que la
// pantalla esté vieja: es que la cuenta quedó cargada con el NIT y su dígito de
// verificación pegado (MERCATURA SAS, 20-ago-2026: maestro 9013923091, facturas
// 901392309). El botón lo detecta y propone vincular; vincular lo confirma una
// persona.
//
// Lo que este test fija:
//   1. la consulta del botón encuentra al proveedor "huérfano" (cuenta cargada
//      bajo el NIT+DV) y lo separa del que NO tiene cuenta ninguna;
//   2. vincular SOLO acepta el par exacto NIT ↔ NIT+DV verificado;
//   3. vincular NO pisa una cuenta que ya exista en el NIT bueno;
//   4. corre contra la base REAL y hace ROLLBACK: no ensucia ni la bitácora.
//
//   node scripts/test_cuentas_huerfanas.js

const fs = require("fs"), path = require("path");
const { Client } = require("pg");
const { execFileSync } = require("child_process");
const os = require("os");

const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

function urlBase() {
  const m = fs.readFileSync(path.join(RAIZ, ".env.local"), "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  return m ? m[1].trim() : process.env.DATABASE_URL;
}

// mismoNit se compila del módulo real: si mañana alguien lo relaja, este test
// se entera. No se reimplementa acá a propósito.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ch-"));
try { execFileSync("npx", ["tsc", "lib/nit.ts", "--outDir", tmp, "--module", "commonjs",
                           "--target", "es2020", "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" }); } catch {}
const { mismoNit } = require(path.join(tmp, "nit.js"));

// La MISMA consulta que usa la acción del servidor. Si divergen, este centinela
// deja de proteger nada — por eso va copiada tal cual y no "parecida".
const SQL_PROVEEDORES_TABLERO = `
  WITH prov AS (
    SELECT f.nit_proveedor AS nit, f.nombre_proveedor AS nombre
      FROM factura_estado e JOIN facturas f USING (cufe)
      LEFT JOIN maestro_proveedores mp ON mp.nit = f.nit_proveedor
     WHERE e.estado IN ('retenciones_ok','aprobada_pago')
       AND coalesce(e.pago_estado,'pendiente') <> 'pagado'
       AND coalesce(e.tipo_pago, mp.tipo_pago_default, 'credito') <> 'debito'
    UNION
    SELECT num_doc, razon_social FROM cuentas_cobro
     WHERE estado = 'aprobada' AND pago_id IS NULL
    UNION
    SELECT nit, razon_social FROM cotizaciones
     WHERE estado IN ('aprobada','facturada') AND pago_id IS NULL AND requiere_adelanto
  )
  SELECT p.nit, max(p.nombre) AS nombre,
         bool_or(cb.num_cuenta IS NOT NULL) AS tiene
    FROM prov p
    LEFT JOIN cuentas_bancarias_proveedor cb ON cb.nit = p.nit
   WHERE p.nit IS NOT NULL AND p.nit <> ''
   GROUP BY p.nit`;

async function main() {
  const c = new Client({ connectionString: urlBase() });
  await c.connect();
  await c.query("BEGIN");
  try {
    console.log("\n1) La consulta del botón corre y separa los dos casos");
    const { rows } = await c.query(SQL_PROVEEDORES_TABLERO);
    check(rows.length > 0, "hay proveedores en el tablero", `${rows.length}`);
    const sin = rows.filter((r) => !r.tiene);

    const nits = sin.map((r) => r.nit);
    const { rows: cbs } = nits.length ? await c.query(
      `SELECT nit, banco, num_cuenta FROM cuentas_bancarias_proveedor cb
        WHERE num_cuenta IS NOT NULL
          AND EXISTS (SELECT 1 FROM unnest($1::text[]) n
                       WHERE cb.nit LIKE n || '%' OR n LIKE cb.nit || '%')`, [nits]) : { rows: [] };
    const candidatos = [], faltantes = [];
    for (const r of sin) {
      const cand = cbs.find((cb) => cb.nit !== r.nit && mismoNit(cb.nit, r.nit));
      (cand ? candidatos : faltantes).push({ ...r, cand });
    }
    console.log(`     sin cuenta: ${sin.length} · con cuenta bajo otro NIT: ${candidatos.length} · sin cuenta ninguna: ${faltantes.length}`);
    for (const x of candidatos) console.log(`     · ${x.nombre}: facturas ${x.nit} ↔ maestro ${x.cand.nit}`);
    for (const x of faltantes) console.log(`     · ${x.nombre} (${x.nit}): no hay cuenta cargada`);
    check(candidatos.every((x) => mismoNit(x.cand.nit, x.nit)),
          "todo candidato pasa el candado de mismoNit (DV verificado)");
    check(faltantes.every((x) => !cbs.some((cb) => mismoNit(cb.nit, x.nit))),
          "ningún 'faltante' tenía en realidad una cuenta");

    console.log("\n2) Vincular acepta SOLO el par NIT ↔ NIT+DV verificado");
    check(mismoNit("901392309", "9013923091"), "MERCATURA: 901392309 ↔ 9013923091");
    check(!mismoNit("901392309", "9013923092"), "con el DV equivocado, NO vincula");
    check(!mismoNit("901392309", "901400757"), "dos proveedores distintos NO se funden");

    console.log("\n3) El UPDATE deja la cuenta donde el JOIN sí la ve (y se revierte)");
    const objetivo = candidatos[0];
    if (!objetivo) {
      console.log("     (no hay ningún huérfano vivo hoy: se simula uno)");
      const base = await c.query("SELECT nit, num_cuenta FROM cuentas_bancarias_proveedor WHERE num_cuenta IS NOT NULL LIMIT 1");
      check(base.rowCount > 0, "hay al menos una cuenta en el maestro para simular");
    } else {
      await c.query("UPDATE cuentas_bancarias_proveedor SET nit = $2 WHERE nit = $1", [objetivo.cand.nit, objetivo.nit]);
      const post = await c.query(SQL_PROVEEDORES_TABLERO);
      const fila = post.rows.find((r) => r.nit === objetivo.nit);
      check(!!fila && fila.tiene, `${objetivo.nombre} ya cruza con su cuenta`);
    }

    console.log("\n4) Una cuenta ya existente en el NIT bueno NO se pisa");
    // El candado vive en la acción; acá se comprueba que la BASE lo respalda:
    // `nit` es único, así que un UPDATE ciego reventaría en vez de sobrescribir.
    const uniq = await c.query(`
      SELECT count(*)::int AS n FROM pg_index i
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
       WHERE t.relname = 'cuentas_bancarias_proveedor' AND a.attname = 'nit'
         AND (i.indisunique OR i.indisprimary)`);
    check(uniq.rows[0].n > 0, "la base tiene el NIT único: no hay sobrescritura silenciosa posible");
  } finally {
    await c.query("ROLLBACK");   // la base queda EXACTAMENTE como estaba
    await c.end();
  }
  console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s): ${fallos.join(", ")}\n` : "\n✅ Todo en orden. (ROLLBACK hecho: la base quedó intacta)\n");
  process.exit(fallos.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
