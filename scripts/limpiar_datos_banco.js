#!/usr/bin/env node
/* eslint-disable */
// LIMPIEZA DEL MAESTRO DE CUENTAS BANCARIAS (Regla 12 + Regla 13).
//
// Tres cosas que salieron al abrir el archivo REAL de Davivienda del 20-ago-2026
// y que no producían ningún error: la fila salía, solo que con el dato torcido.
//
//   A) `num_doc` con el DÍGITO DE VERIFICACIÓN pegado — 43 de 44 filas. El
//      arreglo del 20-ago corrigió la columna `nit` (la del JOIN) pero no ésta,
//      y el archivo escribe `num_doc ?? nit` en *Número de Identificación*. La
//      columna salía MEZCLADA: unas con DV y otras sin, porque las de `num_doc`
//      vacío caían al `nit` ya corregido. Las dos no pueden estar bien.
//   B) MOJIBAKE: `PEÃA` en vez de `PEÑA` — los dos bytes UTF-8 de la Ñ leídos
//      como Latin-1. Al banco llegaba `PEAA` más un carácter de control
//      invisible.
//   C) Un correo guardado como `mailto:oficial@…` (se pegó el enlace, no el
//      texto). Un correo así no rebota: el proveedor simplemente nunca se entera.
//
// Este script NO adivina:
//   · `num_doc` solo se corrige cuando es EXACTAMENTE el NIT de esa misma fila
//     con su DV verificado (`mismoNit`). Una cédula de titular nunca se toca.
//   · el mojibake solo se repara cuando el texto es reinterpretable byte a byte
//     y el resultado es UTF-8 válido; si no descifra, se deja como está.
//
//   node scripts/limpiar_datos_banco.js             (ensayo — no escribe nada)
//   node scripts/limpiar_datos_banco.js --aplicar
//
// La defensa de verdad es que no vuelva a entrar: `limpiarTextoHumano` /
// `limpiarCorreo` (lib/texto.ts) corren al guardar en Maestros, `textoBanco` los
// vuelve a aplicar antes del archivo, y el centinela `texto_sucio_cuentas_banco`
// del health_check avisa si aparece uno nuevo.

const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const { Client } = require("pg");

const RAIZ = path.dirname(__dirname);
const APLICAR = process.argv.includes("--aplicar");

// Se compilan los módulos REALES: si mañana alguien cambia la regla de
// `mismoNit`, este script cambia con ella y no se queda con una copia vieja.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "limp-"));
try {
  execFileSync("npx", ["tsc", "lib/eventos.ts", "lib/nit.ts", "lib/texto.ts", "--outDir", tmp,
                       "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
               { cwd: RAIZ, stdio: "pipe" });
} catch {}
const { registrarEvento } = require(path.join(tmp, "eventos.js"));
const { mismoNit } = require(path.join(tmp, "nit.js"));
const { limpiarTextoHumano, limpiarCorreo } = require(path.join(tmp, "texto.js"));

function dsn() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(RAIZ, f);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
    if (m) return m[1].trim();
  }
  return process.env.DATABASE_URL;
}

const TEXTOS = ["titular_nombre", "titular_apellido", "banco", "referencia"];

(async () => {
  const c = new Client({ connectionString: dsn() });
  await c.connect();

  const { rows } = await c.query(
    `SELECT nit, tipo_doc, num_doc, correo, ${TEXTOS.join(", ")}
       FROM cuentas_bancarias_proveedor ORDER BY nit`);

  const cambios = [];
  for (const r of rows) {
    const antes = {}, despues = {};

    // A) el documento del titular que en realidad es el NIT con su DV
    if (r.num_doc && r.num_doc !== r.nit && mismoNit(r.num_doc, r.nit)) {
      antes.num_doc = r.num_doc; despues.num_doc = r.nit;
    }
    // B) mojibake y caracteres invisibles
    for (const k of TEXTOS) {
      const limpio = limpiarTextoHumano(r[k]);
      if (r[k] != null && limpio !== r[k]) { antes[k] = r[k]; despues[k] = limpio; }
    }
    // C) el correo pegado como enlace
    const correo = limpiarCorreo(r.correo);
    if (r.correo != null && correo !== r.correo) { antes.correo = r.correo; despues.correo = correo; }

    if (Object.keys(despues).length) cambios.push({ nit: r.nit, quien: r.titular_nombre, antes, despues });
  }

  console.log(`\n${cambios.length} fila(s) por limpiar de ${rows.length}:\n`);
  for (const x of cambios) {
    console.log(`  ${x.nit}  ${(x.quien || "").slice(0, 34)}`);
    for (const k of Object.keys(x.despues)) {
      console.log(`     ${k}: ${JSON.stringify(x.antes[k])} → ${JSON.stringify(x.despues[k])}`);
    }
  }
  if (!cambios.length) { await c.end(); return; }
  if (!APLICAR) { console.log("\n(ensayo — corre con --aplicar para escribirlas)"); await c.end(); return; }

  await c.query("BEGIN");
  for (const x of cambios) {
    const campos = Object.keys(x.despues);
    const sets = campos.map((k, i) => `${k} = $${i + 2}`).join(", ");
    await c.query(`UPDATE cuentas_bancarias_proveedor SET ${sets}, actualizado_en = now() WHERE nit = $1`,
                  [x.nit, ...campos.map((k) => x.despues[k])]);
    await registrarEvento(c, {
      cufe: null, tipo: "limpia_cuenta_banco", campo: campos.join(","),
      valorAnterior: x.antes,
      valorNuevo: { ...x.despues, motivo: "dato que llegaba torcido al archivo del banco sin dar ningún error" },
      actor: "scripts/limpiar_datos_banco.js", actorRol: "sistema", origen: "pipeline",
    });
  }
  await c.query("COMMIT");
  console.log(`\n✅ ${cambios.length} fila(s) limpias, cada una en la bitácora.`);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
