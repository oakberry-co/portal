#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE LA CAMPANA (Regla 14).
//
// Daniel buscó la campana el 21-sep-2026 y no existía: las alertas vivían en el
// correo de la mañana y pegadas a cada fila. Esto fija que la campana:
//   1. filtra por rol como dice `visible`: el admin ve todo, el equipo ve los
//      casos de «compras» y lo operativo de sus pantallas, el contador solo lo
//      que puede causar;
//   2. contra la base real, todo aviso con enlace lleva a una pantalla que
//      EXISTE en el portal (un aviso al que no se puede ir es ruido), y todo lo
//      operativo tiene su capacidad;
//   3. «ya lo resolví» deja el caso en en_verificacion con quién y nota, no en
//      resuelto (eso lo confirma el centinela), y no se marca dos veces;
//   4. cada pantalla del mapa PANTALLA corresponde a un check real del
//      health_check (si el repo datawarehouse está en la VM);
//   5. el correo de la mañana dice «campanita» y la ruta /contabilidad/avisos existe.
//
//   node scripts/test_avisos.js

const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const { Client } = require("pg");

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
  execFileSync("npx", ["tsc", "lib/avisos.ts", "lib/eventos.ts", "lib/permisos.ts", "lib/db.ts", "--outDir", tmp,
                       "--module", "commonjs", "--target", "es2020", "--skipLibCheck", "--esModuleInterop"], { cwd: RAIZ, stdio: "pipe" });
} catch (e) { if (!fs.existsSync(path.join(tmp, "avisos.js"))) { console.error("No compiló:\n" + (e.stdout || e.message)); process.exit(1); } }
for (const f of fs.readdirSync(tmp)) { const p = path.join(tmp, f); fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/require\("@\/lib\//g, 'require("./')); }
const { todosLosAvisos, visible, marcarCasoResuelto } = require(path.join(tmp, "avisos.js"));
const { getPool } = require(path.join(tmp, "db.js"));

(async () => {
  console.log("CENTINELA · la campana\n");
  console.log("1) Quién ve qué (regla pura)");
  const casoCompras = { origen: "centinela", dueno: "compras", cap: null };
  const casoDaniel = { origen: "centinela", dueno: "daniel", cap: null };
  const opPagos = { origen: "operacion", cap: "pagos", dueno: null };
  const opCausar = { origen: "operacion", cap: "causar", dueno: null };
  check(visible(casoCompras, "admin") && visible(casoDaniel, "admin") && visible(opPagos, "admin") && visible(opCausar, "admin"), "admin ve todo");
  check(visible(casoCompras, "operador") && !visible(casoDaniel, "operador"), "operador ve los casos de compras, no los de Daniel");
  check(visible(opPagos, "operador") && visible(opCausar, "operador"), "operador ve lo operativo de sus pantallas");
  check(!visible(casoCompras, "causador") && !visible(opPagos, "causador") && visible(opCausar, "causador"), "el contador solo ve lo que puede causar");
  check(visible(opPagos, "pagador") && !visible(opCausar, "pagador"), "pagador ve pagos, no causaciones");

  console.log("\n2) Contra la base real: enlaces y capacidades");
  const { avisos, ultimaCorrida } = await todosLosAvisos();
  check(Array.isArray(avisos), `${avisos.length} aviso(s) hoy`, `última corrida del centinela: ${ultimaCorrida ?? "—"}`);
  const rutas = new Set(fs.readdirSync(path.join(RAIZ, "app", "(portal)", "contabilidad")).map((d) => "/contabilidad/" + d));
  const rotos = avisos.filter((a) => a.href && !rutas.has(a.href.split("?")[0]));
  check(rotos.length === 0, "todo aviso con enlace lleva a una pantalla que existe", rotos.map((a) => a.href).join(", "));
  check(avisos.filter((a) => a.origen === "operacion").every((a) => a.cap), "todo aviso operativo tiene capacidad");
  check(avisos.every((a) => a.titulo && (a.n == null || a.n > 0)), "ningún aviso vacío ni en cero");

  console.log("\n3) «Ya lo resolví» (ROLLBACK)");
  const c = await getPool().connect();
  await c.query("BEGIN");
  try {
    const ab = (await c.query("SELECT id FROM centinela_caso WHERE estado = 'abierto' ORDER BY id LIMIT 1")).rows[0];
    if (!ab) console.log("  (sin casos abiertos para probar; se salta)");
    else {
      await marcarCasoResuelto(c, ab.id, { email: "centinela@test", rol: "admin" }, "probando");
      const r = (await c.query("SELECT estado, marcado_por, nota_humano FROM centinela_caso WHERE id = $1", [ab.id])).rows[0];
      check(r.estado === "en_verificacion" && r.marcado_por === "centinela@test" && r.nota_humano === "probando", "queda en en_verificacion con quién y nota", r.estado);
      const ev = (await c.query("SELECT tipo, quien FROM centinela_caso_evento WHERE caso_id = $1 ORDER BY id DESC LIMIT 1", [ab.id])).rows[0];
      check(ev?.tipo === "marcado_resuelto" && ev?.quien === "centinela@test", "y el evento del caso lo dice");
      const bit = (await c.query("SELECT 1 FROM eventos WHERE tipo = 'marca_caso_resuelto' AND actor = 'centinela@test' ORDER BY id DESC LIMIT 1")).rowCount;
      check(bit === 1, "y la bitácora del portal también");
      let e2 = null; try { await marcarCasoResuelto(c, ab.id, { email: "x@test", rol: "admin" }, null); } catch (e) { e2 = e; }
      check(!!e2 && /marcado/.test(e2.message), "marcarlo dos veces se rechaza y dice por qué", e2?.message);
    }
    const res = (await c.query("SELECT id FROM centinela_caso WHERE estado = 'resuelto' LIMIT 1")).rows[0];
    if (res) { let e3 = null; try { await marcarCasoResuelto(c, res.id, { email: "x@test", rol: "admin" }, null); } catch (e) { e3 = e; }
      check(!!e3 && /resuelto/.test(e3.message), "un caso resuelto no se marca"); }
  } finally { await c.query("ROLLBACK"); c.release(); }

  console.log("\n4) El mapa de pantallas apunta a checks reales");
  const hc = "/home/daniel/proyectos/datawarehouse/contabilidad/facturacion/health_check.py";
  if (fs.existsSync(hc)) {
    const src = fs.readFileSync(hc, "utf8");
    const mapa = fs.readFileSync(path.join(RAIZ, "lib", "avisos.ts"), "utf8").split("const PANTALLA")[1].split("};")[0];
    const claves = [...mapa.matchAll(/([a-z_0-9]+):\s*"/g)].map((m) => m[1]);
    const huerfanas = claves.filter((k) => !src.includes(`"${k}"`));
    check(huerfanas.length === 0, `${claves.length} pantallas mapeadas, todas a checks del health_check`, huerfanas.join(", "));
  } else console.log("  (health_check.py no está en esta máquina; se salta)");

  console.log("\n5) El correo de la mañana y la ruta");
  const correo = "/home/daniel/proyectos/datawarehouse/centinelas/correo_diario.py";
  check(fs.existsSync(path.join(RAIZ, "app", "(portal)", "contabilidad", "avisos", "page.tsx")), "/contabilidad/avisos existe");
  if (fs.existsSync(correo)) check(/campanita/.test(fs.readFileSync(correo, "utf8")), "el correo de la mañana manda a la campanita");

  await getPool().end();
  console.log("\n" + (fallos.length ? "❌ FALLÓ: " + fallos.join("; ") : "✅ OK — la campana muestra lo que toca a quien le toca, y no cierra nada sola."));
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error("💥", e); process.exit(1); });
