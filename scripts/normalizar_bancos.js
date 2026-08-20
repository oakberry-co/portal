#!/usr/bin/env node
/* eslint-disable */
// NOMBRES DE BANCO MAL ESCRITOS EN EL MAESTRO.
//
// "BACOLOMBIA", "BANDO DE BOGOTA". Para un humano se leen bien; para el archivo
// del banco no resuelven a NINGÚN código y la fila sale con el campo vacío —
// que el banco rechaza. Es el mismo patrón del NIT con dígito de verificación:
// un dato que "se ve bien" y no cruza.
//
// PERO ACÁ NO SE CORRIGE SOLO (Regla 3: el parecido sugiere, nunca afirma). De
// este nombre sale el código al que viaja la plata: confundir "Banco Unión" con
// "Banco Union" da igual, confundir "Banco W" con "Banco AV Villas" no. Así que:
//
//   · se propone SOLO cuando hay UN candidato claro y la diferencia es de un par
//     de letras sobre un nombre largo;
//   · lo demás se lista para que lo arregle una persona;
//   · nada se escribe sin --aplicar, y cada cambio queda en la bitácora.
//
//   node scripts/normalizar_bancos.js            (ensayo)
//   node scripts/normalizar_bancos.js --aplicar

const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const { Client } = require("pg");

const RAIZ = path.dirname(__dirname);
const APLICAR = process.argv.includes("--aplicar");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bancos-"));
try {
  execFileSync("npx", ["tsc", "lib/bancos.ts", "lib/eventos.ts", "--outDir", tmp,
                       "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
               { cwd: RAIZ, stdio: "pipe" });
} catch {}
const { BANCOS, codigoBancoDavivienda } = require(path.join(tmp, "bancos.js"));
const { registrarEvento } = require(path.join(tmp, "eventos.js"));

const norm = (s) => (s || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^A-Z0-9]/g, " ").replace(/\s+/g, " ").trim();

/** Distancia de edición. Barata y suficiente: los errores reales son una letra
 *  cambiada ("BANDO"→"BANCO") o una comida ("BACOLOMBIA"→"BANCOLOMBIA"). */
function distancia(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function proponer(nombre) {
  const n = norm(nombre);
  if (!n) return null;
  // Tolerancia proporcional al largo: en un nombre de 10 letras, 2 cambios son
  // un error de dedo; en uno de 4 ("ITAU"), 2 cambios ya es otro banco.
  const tope = Math.max(1, Math.min(3, Math.floor(n.length / 5)));
  const cands = BANCOS
    .map((b) => ({ ...b, d: distancia(n, norm(b.nombre)) }))
    .filter((b) => b.d <= tope)
    .sort((a, b) => a.d - b.d);
  if (!cands.length) return null;
  // Si dos bancos empatan de cerca, no se elige: lo mira una persona.
  if (cands.length > 1 && cands[1].d === cands[0].d) return null;
  return cands[0];
}

function dsn() {
  const m = fs.readFileSync(path.join(RAIZ, ".env.local"), "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  return m ? m[1].trim() : process.env.DATABASE_URL;
}

(async () => {
  const c = new Client({ connectionString: dsn() });
  await c.connect();
  const { rows } = await c.query(
    `SELECT nit, coalesce(titular_nombre, nit) AS quien, banco
       FROM cuentas_bancarias_proveedor
      WHERE coalesce(num_cuenta,'') <> '' ORDER BY titular_nombre`);

  const claros = [], aMano = [];
  for (const r of rows) {
    if (codigoBancoDavivienda(r.banco)) continue;   // ya resuelve: no se toca
    const p = proponer(r.banco);
    if (p) claros.push({ ...r, sugerido: p.nombre, d: p.d });
    else aMano.push(r);
  }

  console.log(`\n${rows.length} cuentas · ${claros.length + aMano.length} con banco que NO resuelve a código\n`);
  if (claros.length) {
    console.log("SE PUEDE PROPONER (un solo candidato, diferencia de pocas letras):");
    for (const x of claros) {
      console.log(`   ${x.quien.slice(0, 32).padEnd(32)} "${x.banco}"  →  "${x.sugerido}"  (${x.d} letra${x.d === 1 ? "" : "s"})`);
    }
  }
  if (aMano.length) {
    console.log("\nLO TIENE QUE MIRAR UNA PERSONA (sin candidato claro):");
    for (const x of aMano) console.log(`   ${x.quien.slice(0, 32).padEnd(32)} "${x.banco || "(vacío)"}"`);
  }
  if (!APLICAR) {
    console.log(claros.length ? "\n(ensayo — corre con --aplicar para escribir las propuestas)" : "");
    await c.end(); return;
  }
  await c.query("BEGIN");
  for (const x of claros) {
    await c.query("UPDATE cuentas_bancarias_proveedor SET banco = $1 WHERE nit = $2", [x.sugerido, x.nit]);
    await registrarEvento(c, {
      cufe: null, tipo: "corrige_nombre_banco", campo: "banco",
      valorAnterior: { nit: x.nit, banco: x.banco },
      valorNuevo: { nit: x.nit, banco: x.sugerido,
                    motivo: "el nombre no resolvía a ningún código del banco y había un único candidato" },
      actor: "scripts/normalizar_bancos.js", actorRol: "sistema", origen: "pipeline",
    });
  }
  await c.query("COMMIT");
  console.log(`\n✅ ${claros.length} corregido(s), cada uno en la bitácora.` +
              (aMano.length ? `  Quedan ${aMano.length} para revisar a mano.` : ""));
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
