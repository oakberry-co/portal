#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE LOS GASTOS PERIÓDICOS (Regla 14).
//
// Corre contra la base REAL y hace ROLLBACK: no deja filas ni ensucia la
// bitácora. Lo que fija —y que es exactamente lo que se rompe al "simplificar":
//
//   1. el documento del mes nace SIN VALOR y por eso NO entra a Pagos;
//   2. …pero SÍ aparece en Conciliación aunque ya traiga concepto y destino.
//      Este es EL bug del módulo: con las dos condiciones escritas por separado
//      el documento se caía de las dos listas y la obligación del mes se volvía
//      invisible hasta que cortaran el servicio;
//   3. con valor + clasificación + retenciones, entra a Pagos;
//   4. correr el generador DOS VECES no duplica (el índice único de la base);
//   5. un gasto SUELTO no puede nacer sin valor (el CHECK);
//   6. el vencimiento se corre al día hábil ANTERIOR, nunca al siguiente;
//   7. clasificar un mes SUBE el concepto/destino a la plantilla;
//   8. dar de baja detiene la generación;
//   9. el SQL de "qué le falta" y su espejo en TypeScript dicen lo mismo;
//  10. lo que NO se transfiere no sale en el archivo del banco — si se colara,
//      el proveedor cobraría dos veces (una por su página y otra por el banco) y
//      no habría ningún error: sale la plata dos veces y ya;
//  11. escribir el monto por primera vez NO pide motivo; cambiarlo sí.
//
//     node scripts/test_gastos_periodicos.js

const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const { Client } = require("pg");

const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, titulo, detalle = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${titulo}${detalle ? " — " + detalle : ""}`);
  if (!ok) fallos.push(titulo);
};

// El directorio de compilación va DENTRO del repo, no en /tmp: los módulos que
// se compilan requieren `pg` en tiempo de ejecución, y desde /tmp Node no
// encuentra el `node_modules` del proyecto.
const cache = path.join(RAIZ, "node_modules", ".cache");
fs.mkdirSync(cache, { recursive: true });
const tmp = fs.mkdtempSync(path.join(cache, "tgp-"));
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
try {
  execFileSync("npx", ["tsc", "lib/plantillas.ts", "lib/documentos-no-dian.ts", "lib/falta-pagos.ts", "--outDir", tmp,
                       "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
               { cwd: RAIZ, stdio: "pipe" });
} catch (e) {
  if (!fs.existsSync(path.join(tmp, "plantillas.js"))) {
    console.error("No compiló:\n" + (e.stdout || e.message)); process.exit(1);
  }
}
const { crearPlantilla, generarPendientes, crearDocumentoDelMes, darDeBaja } = require(path.join(tmp, "plantillas.js"));
const { LISTO_PARA_PAGOS, POR_CLASIFICAR, faltaParaPagos } = require(path.join(tmp, "falta-pagos.js"));
const { periodosDebidos, vencimientoDe } = require(path.join(tmp, "gastos-periodicos.js"));
const { esHabil, festivos } = require(path.join(tmp, "habiles.js"));
const { SQL_VA_AL_BANCO, SQL_PAGO_MANUAL } = require(path.join(tmp, "gastos-periodicos.js"));

function dsn() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(RAIZ, f);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
    if (m) return m[1].trim();
  }
  return process.env.DATABASE_URL;
}

const ACTOR = { email: "centinela@test", rol: "admin" };
const enPagos = async (c, id) =>
  (await c.query(`SELECT 1 FROM cuentas_cobro cc WHERE cc.id = $1 AND ${LISTO_PARA_PAGOS("cc")}`, [id])).rowCount > 0;
const enConciliacion = async (c, id) =>
  (await c.query(`SELECT 1 FROM cuentas_cobro cc WHERE cc.id = $1 AND ${POR_CLASIFICAR("cc")}`, [id])).rowCount > 0;

(async () => {
  const c = new Client({ connectionString: dsn() });
  await c.connect();
  await c.query("BEGIN");
  try {
    // ── 6) LAS FECHAS, antes de tocar la base ────────────────────────────────
    console.log("\n6) El vencimiento se corre HACIA ATRÁS");
    // 2026-11-01 es domingo Y festivo trasladado (Todos los Santos cae en
    // domingo, se corre al lunes 2). Un gasto que vence el 1 se paga el
    // viernes 30 de octubre, no el martes 3.
    const v = vencimientoDe({ dia_pago: 1 }, "2026-11-01");
    check(v === "2026-10-30", "el que vence el 1-nov (domingo) se paga el viernes 30-oct", v);
    check(esHabil("2026-10-30") && !esHabil("2026-11-01"), "y el hábil se calcula bien");
    // Festivos verificados contra co_holidays.py del repo datawarehouse (124
    // fechas, 2024-2030, idénticas). Estas tres cubren los tres tipos: fijo,
    // trasladable por Ley Emiliani y atado a la Pascua.
    const f26 = festivos(2026);
    check(f26.has("2026-01-01"), "festivo fijo (Año Nuevo)");
    check(f26.has("2026-01-12"), "trasladable: Reyes (6-ene, martes) se corre al lunes 12");
    check(f26.has("2026-04-03"), "atado a la Pascua: Viernes Santo 2026");
    const feb = vencimientoDe({ dia_pago: 31 }, "2027-02-01");
    check(feb <= "2027-02-28", "el que vence el 31 no se sale de febrero", feb);

    // ── La plantilla ────────────────────────────────────────────────────────
    console.log("\n1-2) El documento del mes nace sin valor");
    const pid = await crearPlantilla(c, {
      razon_social: "CENTINELA ENERGIA SA", num_doc: "999999901", tipo_doc: "NIT", correo: null,
      tipo: "servicio_publico", tipo_detalle: "Energía prueba", descripcion: "Luz",
      concepto: null, destino: null, area: "OPERACIONES",
      forma_pago: "pse", referencia_pago: "REF-0001", sitio_pago: "enel.com.co",
      dia_pago: 10, dias_anticipacion: 10,
      desde_periodo: "2026-01-01", vigente_hasta: null,
      valor_referencia: 800000, documentos: [], origen_doc_id: null,
    }, ACTOR);
    check(!!pid, "la plantilla se crea");

    const g1 = await crearDocumentoDelMes(c, pid, "2026-03-01", ACTOR);
    check(!!g1, "genera el documento del mes", g1 && g1.ref);
    const doc = (await c.query("SELECT * FROM cuentas_cobro WHERE id = $1", [g1.id])).rows[0];
    check(doc.valor === null, "nace SIN valor (vacío no es cero)");
    check(doc.referencia_pago === "REF-0001" && doc.forma_pago === "pse",
          "hereda la referencia y la forma de pago COPIADAS, no referenciadas");
    check(!(await enPagos(c, g1.id)), "sin valor NO entra a Pagos");
    check(await enConciliacion(c, g1.id), "pero SÍ aparece en Conciliación");

    // EL LIMBO: con concepto y destino puestos pero todavía sin monto, un
    // documento tiene que seguir viéndose. Si se cae de las dos listas, nadie
    // se entera hasta que cortan el servicio.
    await c.query(`UPDATE cuentas_cobro SET concepto='Servicios públicos', destino='BOG001',
                     retencion_ok = TRUE WHERE id = $1`, [g1.id]);
    check(await enConciliacion(c, g1.id), "clasificado pero SIN VALOR sigue en Conciliación (el limbo)");
    check(!(await enPagos(c, g1.id)), "y sigue sin poder pagarse");

    console.log("\n3) Con el valor puesto, pasa a Pagos");
    await c.query("UPDATE cuentas_cobro SET valor = 812340 WHERE id = $1", [g1.id]);
    check(await enPagos(c, g1.id), "con valor + clasificación + retenciones, entra a Pagos");
    check(!(await enConciliacion(c, g1.id)), "y sale de la lista de pendientes");
    await c.query("UPDATE cuentas_cobro SET valor = 0 WHERE id = $1", [g1.id]);
    check(!(await enPagos(c, g1.id)), "un valor de CERO tampoco se puede pagar");
    await c.query("UPDATE cuentas_cobro SET valor = 812340 WHERE id = $1", [g1.id]);

    console.log("\n4) Correrlo dos veces no duplica");
    const repe = await crearDocumentoDelMes(c, pid, "2026-03-01", ACTOR);
    check(repe === null, "el mismo mes otra vez devuelve null (índice único), no una fila nueva");
    const n = (await c.query("SELECT count(*)::int n FROM cuentas_cobro WHERE plantilla_id = $1 AND periodo = '2026-03-01'", [pid])).rows[0].n;
    check(n === 1, "y en la base sigue habiendo UNA sola", String(n));

    const a = await generarPendientes(c, ACTOR, "2026-06-15");
    const b = await generarPendientes(c, ACTOR, "2026-06-15");
    check(a.length > 0, `la primera corrida crea lo que falta (${a.length})`);
    check(b.length === 0, "la segunda, con el mismo día, no crea nada");

    console.log("\n   La ventana hacia atrás está topada");
    const debidos = periodosDebidos(
      { id: pid, dia_pago: 10, dias_anticipacion: 10, desde_periodo: "2020-01-01",
        vigente_hasta: null, activo: true }, "2026-06-15");
    check(debidos.length <= 8, `una plantilla con fecha de 2020 no crea 6 años de una (${debidos.length} meses)`);

    console.log("\n5) Un gasto SUELTO no puede nacer sin valor");
    let choco = false;
    try {
      await c.query("SAVEPOINT sp1");
      await c.query(`INSERT INTO cuentas_cobro (razon_social, num_doc, estado, valor)
                     VALUES ('CENTINELA SUELTO','999999902','aprobada',NULL)`);
    } catch (e) { choco = /ck_cc_valor_o_plantilla/.test(e.message); }
    await c.query("ROLLBACK TO SAVEPOINT sp1");
    check(choco, "la base lo rechaza (el candado no vive en el formulario)");

    console.log("\n7) Clasificar un mes SUBE a la plantilla");
    const { clasificar } = require(path.join(tmp, "documentos-no-dian.js"));
    const g2 = await crearDocumentoDelMes(c, pid, "2026-07-01", ACTOR);
    await clasificar(c, g2.id, { concepto: "Servicios públicos", destino: "BOG001" }, ACTOR);
    const pl = (await c.query("SELECT concepto, destino FROM gasto_periodico WHERE id = $1", [pid])).rows[0];
    check(pl.concepto === "Servicios públicos" && pl.destino === "BOG001",
          "el concepto y el destino suben: el mes entrante nace clasificado");
    const g3 = await crearDocumentoDelMes(c, pid, "2026-08-01", ACTOR);
    const d3 = (await c.query("SELECT concepto, destino, valor FROM cuentas_cobro WHERE id = $1", [g3.id])).rows[0];
    check(d3.concepto === "Servicios públicos" && d3.destino === "BOG001" && d3.valor === null,
          "y el mes siguiente solo espera el monto");
    // Lo que un humano decidió para UN mes no reescribe la plantilla.
    await clasificar(c, g3.id, { destino: "BOG004" }, ACTOR);
    const pl2 = (await c.query("SELECT destino FROM gasto_periodico WHERE id = $1", [pid])).rows[0];
    check(pl2.destino === "BOG001", "cambiar el destino de UN mes no cambia la regla de siempre");

    // Una segunda plantilla, por PSE, para el archivo del banco. Va aparte
    // porque la primera se da de baja en el paso siguiente.
    const pid2 = await crearPlantilla(c, {
      razon_social: "CENTINELA ACUEDUCTO", num_doc: "999999903", tipo_doc: "NIT", correo: null,
      tipo: "servicio_publico", tipo_detalle: "Agua", descripcion: null,
      concepto: "Servicios públicos", destino: "BOG001", area: null,
      forma_pago: "pse", referencia_pago: "AC-77", sitio_pago: null,
      dia_pago: 15, dias_anticipacion: 10, desde_periodo: "2026-05-01",
      vigente_hasta: null, valor_referencia: null, documentos: [], origen_doc_id: null,
    }, ACTOR);

    console.log("\n8) Dar de baja detiene la generación");
    await darDeBaja(c, pid, "cerró la tienda", ACTOR);
    const post = await generarPendientes(c, ACTOR, "2026-12-15");
    check(post.filter((x) => x.plantilla_id === pid).length === 0,
          "una plantilla dada de baja no vuelve a generar");
    const viven = (await c.query("SELECT count(*)::int n FROM cuentas_cobro WHERE plantilla_id = $1", [pid])).rows[0].n;
    check(viven > 0, "pero los meses que ya creó siguen ahí (son gastos reales)", String(viven));

    console.log("\n9) El SQL y su espejo en TypeScript dicen lo mismo");
    const casos = [
      { concepto: null, destino: "X", retencion_ok: true, valor: 100, falta: true },
      { concepto: "A", destino: null, retencion_ok: true, valor: 100, falta: true },
      { concepto: "A", destino: "X", retencion_ok: false, valor: 100, falta: true },
      { concepto: "A", destino: "X", retencion_ok: true, valor: null, falta: true },
      { concepto: "A", destino: "X", retencion_ok: true, valor: 0, falta: true },
      { concepto: "A", destino: "X", retencion_ok: true, valor: 100, falta: false },
    ];
    let espejo = true;
    for (const k of casos) {
      const sql = (await c.query(
        `SELECT (${POR_CLASIFICAR("cc")}) AS falta FROM (
           SELECT 'aprobada'::text estado, $1::text concepto, $2::text destino,
                  $3::boolean retencion_ok, $4::numeric valor) cc`,
        [k.concepto, k.destino, k.retencion_ok, k.valor])).rows[0].falta;
      const ts = faltaParaPagos(k).length > 0;
      if (sql !== k.falta || ts !== k.falta) { espejo = false; console.log("     ↳ discrepa:", JSON.stringify(k), { sql, ts }); }
    }
    check(espejo, `las dos coinciden en los ${casos.length} casos`);
    check(faltaParaPagos({ concepto: "A", destino: "X", retencion_ok: true, valor: null })[0] === "el valor del mes",
          "y el mensaje dice qué falta, con nombre propio (Regla 18)");

    // ── 10) EL ARCHIVO DEL BANCO ────────────────────────────────────────────
    console.log("\n10) Lo que se paga a mano NO sale en el archivo del banco");
    const pse = await crearDocumentoDelMes(c, pid2, "2026-05-01", ACTOR);
    await c.query(`UPDATE cuentas_cobro SET valor = 500000, retencion_ok = TRUE,
                     valor_a_pagar = 500000, cuenta_pago = 'Davivienda' WHERE id = $1`, [pse.id]);
    const enBanco = async (id) => (await c.query(
      `SELECT 1 FROM cuentas_cobro cc WHERE cc.id = $1 AND ${LISTO_PARA_PAGOS("cc")}
         AND cc.cuenta_pago = 'Davivienda' AND ${SQL_VA_AL_BANCO("cc")}`, [id])).rowCount > 0;
    check(await enPagos(c, pse.id), "el gasto por PSE sí entra al tablero (hay que pagarlo)");
    check(!(await enBanco(pse.id)), "pero NO sale en el archivo del banco");
    const manual = (await c.query(
      `SELECT 1 FROM cuentas_cobro cc WHERE cc.id = $1 AND ${SQL_PAGO_MANUAL("cc")}`, [pse.id])).rowCount > 0;
    check(manual, "y sí aparece en la lista de lo que se paga a mano");
    await c.query("UPDATE cuentas_cobro SET forma_pago = 'transferencia' WHERE id = $1", [pse.id]);
    check(await enBanco(pse.id), "el mismo documento, marcado como transferencia, sí sale");
    // Lo que existía ANTES de este módulo no tiene forma de pago y se transfiere:
    // si el coalesce se cayera, las cuentas de cobro desaparecerían del archivo.
    await c.query("UPDATE cuentas_cobro SET forma_pago = NULL WHERE id = $1", [pse.id]);
    check(await enBanco(pse.id), "y lo que no tiene forma de pago (lo de siempre) también");
    const rutaExport = fs.readFileSync(path.join(RAIZ,
      "app/(portal)/contabilidad/pagos/export/route.ts"), "utf8");
    check(/SQL_VA_AL_BANCO/.test(rutaExport),
          "el exportador usa la regla del módulo, no una copia del WHERE");

    // ── 11) LLENAR NO ES CAMBIAR ────────────────────────────────────────────
    console.log("\n11) Escribir el monto por primera vez no pide motivo");
    const va = fs.readFileSync(path.join(RAIZ, "lib", "valor-actions.ts"), "utf8");
    check(/const llena = /.test(va) && /!llena && motivo\.length < 5/.test(va),
          "el motivo solo se exige cuando se CAMBIA una cifra ya registrada");
    check(/exigirCap\(llena \? "clasificar" : "intake"\)/.test(va),
          "y quien concilia puede llenarlo sin tener que operar la bandeja");
    check(/"pone_valor_mes" : "ajusta_monto"/.test(va),
          "los dos hechos quedan en la bitácora con nombres distintos");
  } finally {
    await c.query("ROLLBACK");
    await c.end();
  }

  console.log(fallos.length ? `\n🔴 ${fallos.length} fallo(s): ${fallos.join(" · ")}` : "\n🟢 todo OK");
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
