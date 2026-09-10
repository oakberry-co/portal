#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE LA BITÁCORA (Regla 14): lo que se hashea es lo que se guarda.
//
// El 10-sep-2026, al verificar la cadena por primera vez, aparecieron 7
// eventos escritos por el portal cuyo hash no reproduce ningún verificador.
// No los tocó nadie: `canonical()` escribía una llave con `undefined` como
// `null`, y `JSON.stringify` —lo que de verdad va a la base— la descarta. El
// hash quedó calculado sobre un objeto que nunca existió en la base. Un evento
// así es indistinguible de uno adulterado, que es justo lo que la cadena
// existe para detectar.
//
// Corre contra la base REAL con ROLLBACK, con el módulo compilado (no copia):
//   1. un evento con una llave `undefined` se guarda sin ella y su hash SÍ se
//      reproduce al releerlo (la cola de la cadena verifica);
//   2. el hash del evento nuevo engancha con el anterior;
//   3. control: un evento hasheado a la manera vieja (con la llave como null)
//      lo detecta `verificarCadena` — el bug no puede volver callado.
//
//   node scripts/test_bitacora.js

const { execFileSync } = require("child_process");
const { createHash } = require("crypto");
const fs = require("fs"), path = require("path");
const { Client } = require("pg");

const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

const cache = path.join(RAIZ, "node_modules", ".cache");
fs.mkdirSync(cache, { recursive: true });
const tmp = fs.mkdtempSync(path.join(cache, "tbit-"));
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
try {
  execFileSync("npx", ["tsc", "lib/eventos.ts", "--outDir", tmp, "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
               { cwd: RAIZ, stdio: "pipe" });
} catch (e) {
  if (!fs.existsSync(path.join(tmp, "eventos.js"))) { console.error("No compiló:\n" + (e.stdout || e.message)); process.exit(1); }
}
const { registrarEvento, verificarCadena } = require(path.join(tmp, "eventos.js"));

function dsn() {
  const m = fs.readFileSync(path.join(RAIZ, ".env.local"), "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  return m ? m[1].trim() : process.env.DATABASE_URL;
}
// La manera VIEJA de canonicalizar (undefined → null), para el control.
function canonicalViejo(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonicalViejo).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalViejo(v[k])).join(",") + "}";
}

(async () => {
  console.log("CENTINELA · la bitácora hashea lo que guarda\n");
  const c = new Client({ connectionString: dsn(), ssl: /localhost|127\.0\.0\.1/.test(dsn()) ? false : { rejectUnauthorized: false } });
  await c.connect();
  await c.query("BEGIN");
  try {
    const ultimo = (await c.query("SELECT id, hash_evento FROM eventos ORDER BY id DESC LIMIT 1")).rows[0];

    console.log("1) Un evento con una llave `undefined`");
    const hash = await registrarEvento(c, {
      cufe: null, tipo: "centinela_bitacora", campo: "prueba",
      valorNuevo: { id: 1, documentos: undefined, monto: 487900, texto: "ñandú" },
      actor: "centinela@test", actorRol: "admin", origen: "web",
    });
    const ev = (await c.query("SELECT id, valor_nuevo, hash_anterior FROM eventos WHERE tipo = 'centinela_bitacora' ORDER BY id DESC LIMIT 1")).rows[0];
    check(!("documentos" in ev.valor_nuevo), "la llave `undefined` NO se guarda", JSON.stringify(ev.valor_nuevo));
    const v1 = await verificarCadena(c, Number(ev.id));
    check(v1.ok, "…y aun así su hash se reproduce al releerlo", v1.ok ? "" : `rota en #${v1.rotoEnId}`);

    console.log("\n2) Engancha con el anterior");
    check(ev.hash_anterior === ultimo.hash_evento, "hash_anterior = hash del último evento", `#${ultimo.id}`);
    // Desde el último evento previo (no diez atrás): entre los últimos puede
    // haber uno de los 7 irreproducibles de antes del arreglo (#8934 lo es), y
    // eso es historia conocida, no una regresión. La historia completa la
    // vigila `bitacora_cadena` en health_check.py con esa lista de excepciones.
    const v2 = await verificarCadena(c, Number(ultimo.id));
    check(v2.ok, "el último evento previo y el nuestro verifican encadenados", v2.ok ? "" : `rota en #${v2.rotoEnId}`);

    console.log("\n3) Control: metiendo el bug a propósito");
    // Un evento escrito a la manera vieja: hash sobre {"documentos":null,...},
    // pero guardado sin la llave.
    const creadoEn = new Date().toISOString();
    const payloadViejo = canonicalViejo({ cufe: null, tipo: "centinela_bitacora_bug", campo: null,
      valorAnterior: null, valorNuevo: { id: 2, documentos: undefined }, actor: "centinela@test", creadoEn });
    const hashViejo = createHash("sha256").update(payloadViejo + hash).digest("hex");
    await c.query(`INSERT INTO eventos (cufe, tipo, campo, valor_anterior, valor_nuevo, actor, actor_rol, origen, creado_en, hash_anterior, hash_evento)
                   VALUES (NULL, 'centinela_bitacora_bug', NULL, NULL, $1, 'centinela@test', 'admin', 'web', $2, $3, $4)`,
                  [JSON.stringify({ id: 2, documentos: undefined }), creadoEn, hash, hashViejo]);
    const v3 = await verificarCadena(c, Number(ev.id));
    check(!v3.ok, "verificarCadena lo caza", v3.ok ? "NO lo cazó" : `rota en #${v3.rotoEnId}`);
  } finally {
    await c.query("ROLLBACK");
  }
  await c.end();
  console.log("\n" + (fallos.length ? "❌ FALLÓ: " + fallos.join("; ") : "✅ OK — la bitácora hashea exactamente lo que guarda."));
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error("💥", e); process.exit(1); });
