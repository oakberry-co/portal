#!/usr/bin/env node
/* eslint-disable */
// EL GENERADOR DE LOS GASTOS QUE SE REPITEN.
//
// Crea, para cada plantilla viva, el documento del mes que ya debería existir —
// SIN VALOR, porque la obligación existe antes que el recibo. A partir de ahí el
// gasto vive en Conciliación como cualquier otro: se le pone el monto, se
// confirman las retenciones y pasa a Pagos.
//
// Es lo que hace que el módulo sirva: sin esto, el gasto solo entra si alguien
// se acuerda, y de la luz de una tienda nadie se acuerda hasta que la cortan.
//
//   node scripts/generar_gastos_periodicos.js              (ensayo — ROLLBACK)
//   node scripts/generar_gastos_periodicos.js --aplicar
//   node scripts/generar_gastos_periodicos.js --hoy 2026-09-01   (para probar)
//
// NO tiene su propia copia del INSERT: usa `lib/plantillas.ts`, el mismo módulo
// que el botón "generar los que falten" de la pantalla. Con dos copias, el día
// que una deja de poner una columna el gasto entra a medias por el lado que
// nadie está mirando.
//
// Es IDEMPOTENTE, y no porque mire antes de escribir: el índice único
// (plantilla_id, periodo) de la base es quien impide el duplicado. Entre mirar y
// escribir cabe otra corrida, y un doble pago no da error — sale la plata y ya.

const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const { Client } = require("pg");

const RAIZ = path.dirname(__dirname);
const APLICAR = process.argv.includes("--aplicar");
const iHoy = process.argv.indexOf("--hoy");
const HOY = iHoy > -1 ? process.argv[iHoy + 1] : null;

// Se compilan los módulos REALES. Si mañana cambia cómo se calcula el
// vencimiento o qué columnas hereda el documento, este script cambia con ellos.
// El directorio de compilación va DENTRO del repo, no en /tmp: los módulos que
// se compilan requieren `pg` en tiempo de ejecución, y desde /tmp Node no
// encuentra el `node_modules` del proyecto.
const cache = path.join(RAIZ, "node_modules", ".cache");
fs.mkdirSync(cache, { recursive: true });
const tmp = fs.mkdtempSync(path.join(cache, "gp-"));
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
try {
  execFileSync("npx", ["tsc", "lib/plantillas.ts", "--outDir", tmp,
                       "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
               { cwd: RAIZ, stdio: "pipe" });
} catch (e) {
  // Un error de compilación acá NO se traga: significa que el módulo que crea
  // los documentos no compila, y seguir con una copia vieja del /tmp sería
  // generar plata con reglas que ya no existen.
  if (!fs.existsSync(path.join(tmp, "plantillas.js"))) {
    console.error("No compiló lib/plantillas.ts:\n" + (e.stdout || e.message || e));
    process.exit(1);
  }
}
const { generarPendientes } = require(path.join(tmp, "plantillas.js"));
const { hoyBogota } = require(path.join(tmp, "habiles.js"));
const { etiquetaPeriodo } = require(path.join(tmp, "gastos-periodicos.js"));

function dsn() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(RAIZ, f);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
    if (m) return m[1].trim();
  }
  return process.env.DATABASE_URL;
}

(async () => {
  // HOY en Bogotá, no en UTC: la VM vive en UTC y después de las 7 p.m. de
  // Bogotá `new Date()` ya dice mañana — el 30 de septiembre a las 8 p.m. se
  // generaría el mes equivocado (Regla 1).
  const hoy = HOY || hoyBogota();
  const c = new Client({ connectionString: dsn() });
  await c.connect();
  const actor = { email: "cron@generador", rol: "admin" };

  await c.query("BEGIN");
  let creados = [];
  try {
    creados = await generarPendientes(c, actor, hoy);
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("✖ falló la generación:", e.message);
    await c.end();
    process.exit(1);
  }

  console.log(`${APLICAR ? "APLICANDO" : "ENSAYO"} · hoy = ${hoy}`);
  if (!creados.length) {
    console.log("  nada por crear (todo lo que vence dentro de la ventana ya existe)");
  }
  for (const g of creados) {
    console.log(`  + ${g.ref}  ${etiquetaPeriodo(g.periodo)}  vence ${g.venc}  (plantilla ${g.plantilla_id})`);
  }

  await c.query(APLICAR ? "COMMIT" : "ROLLBACK");
  if (!APLICAR && creados.length) console.log("\n  (ensayo: nada se escribió — corre con --aplicar)");
  await c.end();
})().catch((e) => { console.error("ERR", e); process.exit(1); });
