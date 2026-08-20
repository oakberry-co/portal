#!/usr/bin/env node
/* eslint-disable */
// EL NIT CON DÍGITO DE VERIFICACIÓN QUE DEJA PAGOS POR FUERA (Regla 15).
//
// Cómo se destapó: MODAL TRACK SERVICES tenía su cuenta cargada en Maestros y el
// tablero de Pagos igual decía "⚠ sin cuenta · no entra al CSV" — $37.144.800
// que no salían en el archivo del banco y nadie sabía por qué.
//
// La causa: la DIAN emite las facturas con el NIT de 9 dígitos (901675059) y en
// el maestro de cuentas alguien lo cargó con el dígito de verificación pegado
// (9016750599). Son el mismo proveedor y para un humano se ven iguales; para un
// `JOIN ... ON cb.nit = f.nit_proveedor` no lo son, y la cuenta simplemente no
// aparece. El fallo es SILENCIOSO: no hay error, solo un proveedor que no cobra.
//
// Este script corrige la clave, pero NO adivina: solo toca una fila cuando el
// último dígito es EXACTAMENTE el dígito de verificación DIAN del resto y el NIT
// corto sí aparece en documentos reales. Con eso no hay forma de fundir dos
// proveedores distintos. Cada corrección queda en la bitácora.
//
//   node scripts/normalizar_nit_cuentas.js            (ensayo)
//   node scripts/normalizar_nit_cuentas.js --aplicar
//
// Nota: la defensa de verdad es no dejar que vuelva a entrar mal — ver
// `nitCanonico` en lib/nit.ts (se aplica al escribir) y el centinela
// `cuenta_banco_nit_con_dv` del health_check.

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Client } = require("pg");

const RAIZ = path.dirname(__dirname);
const APLICAR = process.argv.includes("--aplicar");

// Compilar la bitácora REAL: la cadena de hashes se rompe si se escribe a mano.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nit-"));
try {
  execFileSync("npx", ["tsc", "lib/eventos.ts", "lib/nit.ts", "--outDir", tmp,
                       "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
               { cwd: RAIZ, stdio: "pipe" });
} catch {}
const { registrarEvento } = require(path.join(tmp, "eventos.js"));
const { soloDigitos, digitoVerificacion } = require(path.join(tmp, "nit.js"));

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
  const c = new Client({ connectionString: dsn() });
  await c.connect();

  // Universo de NITs que SÍ aparecen en documentos reales.
  const univ = new Set();
  for (const q of ["SELECT DISTINCT nit_proveedor n FROM facturas WHERE nit_proveedor IS NOT NULL",
                   "SELECT DISTINCT num_doc n FROM cuentas_cobro WHERE num_doc IS NOT NULL",
                   "SELECT DISTINCT nit n FROM cotizaciones WHERE nit IS NOT NULL"]) {
    for (const r of (await c.query(q)).rows) univ.add(soloDigitos(r.n));
  }

  const { rows } = await c.query(
    "SELECT nit, titular_nombre, num_cuenta FROM cuentas_bancarias_proveedor ORDER BY nit");
  const arreglar = [];
  for (const r of rows) {
    const d = soloDigitos(r.nit);
    if (univ.has(d)) continue;                       // ya cruza: no se toca
    const corto = d.slice(0, -1);
    if (d.length < 10 || !univ.has(corto)) continue; // el corto tiene que existir de verdad
    if (digitoVerificacion(corto) !== d.slice(-1)) continue;  // y el último dígito ser SU DV
    if (rows.some((x) => soloDigitos(x.nit) === corto)) {
      console.log(`  ⏭  ${r.nit} → ${corto}: ya existe esa fila, lo revisa un humano`);
      continue;
    }
    arreglar.push({ ...r, corto });
  }

  console.log(`\n${arreglar.length} cuenta(s) con el dígito de verificación de más:`);
  for (const a of arreglar) {
    console.log(`   ${a.nit} → ${a.corto}   ${(a.titular_nombre || "").slice(0, 40)}  cta …${(a.num_cuenta || "").slice(-4)}`);
  }
  if (!arreglar.length) { await c.end(); return; }

  if (!APLICAR) { console.log("\n(ensayo — corre con --aplicar para corregirlas)"); await c.end(); return; }

  await c.query("BEGIN");
  for (const a of arreglar) {
    await c.query("UPDATE cuentas_bancarias_proveedor SET nit = $1 WHERE nit = $2", [a.corto, a.nit]);
    await registrarEvento(c, {
      cufe: null, tipo: "corrige_nit_cuenta_banco", campo: "nit",
      valorAnterior: { nit: a.nit },
      valorNuevo: { nit: a.corto, titular: a.titular_nombre,
                    motivo: "el NIT traía el dígito de verificación pegado y la cuenta no cruzaba con las facturas" },
      actor: "scripts/normalizar_nit_cuentas.js", actorRol: "sistema", origen: "pipeline",
    });
  }
  await c.query("COMMIT");
  console.log(`\n✅ ${arreglar.length} corregida(s), cada una en la bitácora.`);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
