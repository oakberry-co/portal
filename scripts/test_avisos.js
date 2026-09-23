#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE LA CAMPANA (Regla 14).
//
// Daniel buscó la campana el 21-sep-2026 y no existía. El 23-sep decidió qué va
// en ella: SOLO tareas que se ejecutan y corrigen en el portal; los centinelas
// se quedan en el correo de la mañana. Esto fija que la campana:
//   1. filtra por la capacidad de HACER lo que pide (regla pura `visible`);
//   2. contra la base real, todo aviso lleva a una pantalla que EXISTE en el
//      portal, tiene capacidad y no está en cero;
//   3. NO lee los casos de los centinelas (`centinela_caso`) ni tiene botón de
//      «ya lo resolví»: eso vive en el correo;
//   4. el aviso de notas crédito sin cruzar usa la MISMA condición que la fila
//      de Conciliación (`NC_SIN_CRUZAR`) y su enlace cae en un filtro que la
//      pantalla entiende (`?q=nc-sin-cruzar`);
//   5. el correo de la mañana ya no manda a la «campanita».
//
//   node scripts/test_avisos.js

const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");

const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

function dsn() {
  const m = fs.readFileSync(path.join(RAIZ, ".env.local"), "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  return m ? m[1].trim() : process.env.DATABASE_URL;
}
process.env.DATABASE_URL = dsn();   // lib/db.ts lo exige al primer uso

const cache = path.join(RAIZ, "node_modules", ".cache"); fs.mkdirSync(cache, { recursive: true });
const tmp = fs.mkdtempSync(path.join(cache, "tav-"));
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
try {
  execFileSync("npx", ["tsc", "lib/avisos.ts", "lib/notas-credito.ts", "lib/permisos.ts", "lib/db.ts", "--outDir", tmp,
                       "--module", "commonjs", "--target", "es2020", "--skipLibCheck", "--esModuleInterop"], { cwd: RAIZ, stdio: "pipe" });
} catch (e) { if (!fs.existsSync(path.join(tmp, "avisos.js"))) { console.error("No compiló:\n" + (e.stdout || e.message)); process.exit(1); } }
for (const f of fs.readdirSync(tmp)) { const p = path.join(tmp, f); fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/require\("@\/lib\//g, 'require("./')); }
const { todosLosAvisos, visible } = require(path.join(tmp, "avisos.js"));
const { getPool } = require(path.join(tmp, "db.js"));

(async () => {
  console.log("CENTINELA · la campana\n");
  console.log("1) Quién ve qué (regla pura: la capacidad de HACER)");
  const opPagos = { cap: "pagos" }, opCausar = { cap: "causar" }, opCruzar = { cap: "cruzar_nota" }, opRet = { cap: "retenciones" };
  check(visible(opPagos, "admin") && visible(opCausar, "admin") && visible(opCruzar, "admin"), "admin ve todo");
  check(visible(opPagos, "operador") && visible(opCruzar, "operador") && visible(opCausar, "operador"), "operador ve lo operativo, incluido cruzar notas");
  check(!visible(opPagos, "causador") && !visible(opCruzar, "causador") && visible(opCausar, "causador") && visible(opRet, "causador"),
        "el contador solo ve lo que puede causar o retener, no pagos ni cruces");
  check(visible(opPagos, "pagador") && !visible(opCausar, "pagador"), "pagador ve pagos, no causaciones");
  check(!visible({ cap: null }, "admin"), "un aviso sin capacidad no lo ve nadie (control)");

  console.log("\n2) Contra la base real: enlaces, capacidades, nada en cero");
  const { avisos } = await todosLosAvisos();
  check(Array.isArray(avisos), `${avisos.length} aviso(s) hoy`, avisos.map((a) => `${a.clave}=${a.n}`).join(", "));
  const rutas = new Set(fs.readdirSync(path.join(RAIZ, "app", "(portal)", "contabilidad")).map((d) => "/contabilidad/" + d));
  const rotos = avisos.filter((a) => !a.href || !rutas.has(a.href.split("?")[0]));
  check(rotos.length === 0, "todo aviso lleva a una pantalla que existe", rotos.map((a) => a.href).join(", "));
  check(avisos.every((a) => a.cap), "todo aviso tiene capacidad");
  check(avisos.every((a) => a.titulo && a.queHacer && a.n > 0), "ningún aviso vacío, sin qué hacer, ni en cero");

  console.log("\n3) La campana no lee a los centinelas");
  const src = fs.readFileSync(path.join(RAIZ, "lib", "avisos.ts"), "utf8");
  check(!/centinela_caso/.test(src), "lib/avisos.ts no consulta centinela_caso");
  check(!/marcarCasoResuelto|en_verificacion/.test(src), "no existe «ya lo resolví» en la campana");
  check(!fs.existsSync(path.join(RAIZ, "app", "(portal)", "contabilidad", "avisos", "MarcarResuelto.tsx")), "ni el botón en la pantalla de avisos");
  check(fs.existsSync(path.join(RAIZ, "app", "(portal)", "contabilidad", "avisos", "page.tsx")), "/contabilidad/avisos existe");

  console.log("\n4) Notas crédito sin cruzar: una sola condición, y el enlace cae en un filtro real");
  check(/NC_SIN_CRUZAR\("f"\)/.test(src), "el aviso usa NC_SIN_CRUZAR de lib/notas-credito.ts (no una copia)");
  const vista = fs.readFileSync(path.join(RAIZ, "app", "(portal)", "contabilidad", "conciliacion", "ConciliacionView.tsx"), "utf8");
  check(/nc-sin-cruzar/.test(vista) && /q=nc-sin-cruzar/.test(src), "Conciliación entiende el token `nc-sin-cruzar` y la campana lo usa");
  const pagina = fs.readFileSync(path.join(RAIZ, "app", "(portal)", "contabilidad", "conciliacion", "page.tsx"), "utf8");
  check(/NC_SIN_CRUZAR\("f"\)\}\s+AS nc_sin_cruzar/.test(pagina), "la fila de Conciliación calcula nc_sin_cruzar con la misma condición");
  const pool = getPool();
  const n = (await pool.query(`SELECT count(*)::int AS n FROM facturas f WHERE f.doc_tipo = 'CreditNote'
      AND coalesce(f.ref_fuente,'') <> 'fuera_portal' AND NOT EXISTS (SELECT 1 FROM facturas x WHERE x.cufe = f.ref_cufe)`)).rows[0].n;
  const av = avisos.find((a) => a.clave === "notas_sin_cruzar");
  check((av?.n ?? 0) === n, "el número de la campana es el de la base", `${av?.n ?? 0} vs ${n}`);

  console.log("\n5) El correo de la mañana");
  const correo = "/home/daniel/proyectos/datawarehouse/centinelas/correo_diario.py";
  if (fs.existsSync(correo)) check(!/campanita/.test(fs.readFileSync(correo, "utf8")), "ya no manda a la «campanita»: los centinelas viven en el correo");
  else console.log("  (correo_diario.py no está en esta máquina; se salta)");

  await pool.end();
  console.log("\n" + (fallos.length ? "❌ FALLÓ: " + fallos.join("; ") : "✅ OK — la campana muestra solo lo que se puede hacer en el portal, a quien puede hacerlo."));
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error("💥", e); process.exit(1); });
