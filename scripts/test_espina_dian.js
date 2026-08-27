#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE LA ESPINA DIAN (Regla 12 + Regla 13 + Regla 14).
//
// Qué protege, y por qué existe:
//
// Desde el 2026-08-27 el portal ya no muestra solo lo que llegó por correo:
// muestra también lo que la DIAN dice que nos facturaron y cuyo XML nunca
// llegó (origen='dian'). Es lo que impide que una factura no llegue, no se
// pague y se pierda. Pero abrió dos formas de hacer daño:
//
//   1. RETENCIÓN SOBRE LA NADA. De una factura sin XML no conocemos el
//      subtotal, y `num(null)` lo entrega como 0. El modal multiplicaba la
//      tarifa por ese 0 y mostraba $0 sin decir nada: el contador escribía
//      "2,5 %", veía cero, confirmaba, y la factura se pagaba completa.
//      Misma familia que "vacío no es cero" del Excel de retenciones.
//
//   2. LA FACTURA COJA PARA SIEMPRE. El sync NUNCA actualizaba una factura ya
//      cargada. Si entra por la DIAN sin subtotal y el XML llega tres días
//      después por correo, sin enriquecimiento tardío esa fila se queda sin
//      subtotal, sin IVA y sin ítems de por vida — y traer la espina habría
//      creado un problema nuevo en vez de resolver uno.
//
//   node scripts/test_espina_dian.js

const fs = require("fs"), os = require("os"), path = require("path");
const { execFileSync } = require("child_process");

const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`);
  if (!ok) fallos.push(t);
};
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), "utf8");

// ---------------------------------------------------------------------------
console.log("\n1) La base gravable: cuánto se retiene");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "espina-"));
try {
  execFileSync("npx", ["tsc", "lib/base-retencion.ts", "--outDir", tmp, "--module", "commonjs",
                       "--target", "es2020", "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" });
} catch (e) { console.log("  (no compiló lib/base-retencion.ts)"); }
const { soloDigitos, montoRetencion, faltaBase } = require(path.join(tmp, "base-retencion.js"));

check(montoRetencion(1_000_000, 2.5) === 25_000, "1.000.000 al 2,5% = 25.000", montoRetencion(1_000_000, 2.5));
check(montoRetencion(0, 2.5) === 0, "base 0 da 0 (por eso hace falta el candado de abajo)");
// En Colombia el punto separa miles: "1.520.000" es un millón y medio, no 1,52.
check(soloDigitos("1.520.000") === 1_520_000, '"1.520.000" se lee como 1.520.000', soloDigitos("1.520.000"));
check(soloDigitos("$ 149.340,24") === 14934024, "solo dígitos, sin inventar decimales", soloDigitos("$ 149.340,24"));
check(soloDigitos("") === 0 && soloDigitos(null) === 0, "vacío y null dan 0");

// ---------------------------------------------------------------------------
console.log("\n2) El candado: tarifa escrita sin base sobre la cual aplicarla");
check(faltaBase({ baseRf: 0, baseIva: 0, rf: "2.5", ri: "", ric: "" }) === true,
  "ReteFuente 2,5% con base 0 → TRABA");
check(faltaBase({ baseRf: 0, baseIva: 0, rf: "", ri: "", ric: "1" }) === true,
  "ReteICA 1% con base 0 → TRABA");
check(faltaBase({ baseRf: 0, baseIva: 0, rf: "", ri: "15", ric: "" }) === true,
  "ReteIVA 15% sin IVA conocido → TRABA");
// "Este proveedor no retiene" es una decisión legítima y NO necesita base:
// trabarla ahí sería estorbar sin proteger nada.
check(faltaBase({ baseRf: 0, baseIva: 0, rf: "0", ri: "0", ric: "0" }) === false,
  'declarar "no retiene" (0%) sin base → DEJA confirmar');
check(faltaBase({ baseRf: 0, baseIva: 0, rf: "", ri: "", ric: "" }) === false,
  "sin tarifas escritas → DEJA confirmar");
check(faltaBase({ baseRf: 1_520_000, baseIva: 0, rf: "2.5", ri: "", ric: "" }) === false,
  "con base escrita → DEJA confirmar");
// El caso mixto: ya escribió la base pero no el IVA, y pide ReteIVA.
check(faltaBase({ baseRf: 1_520_000, baseIva: 0, rf: "2.5", ri: "15", ric: "" }) === true,
  "base sí, IVA no, y pide ReteIVA → TRABA");

// ---------------------------------------------------------------------------
console.log("\n3) El modal usa la base, no el subtotal crudo");
const modal = leer("app/(portal)/contabilidad/conciliacion/RetencionesModal.tsx");
// Si alguien "simplifica" volviendo a multiplicar por `subtotal`, el bug vuelve
// entero y en silencio. Esta es la línea exacta que no puede reaparecer.
check(!/Math\.round\(\(subtotal \*/.test(modal),
  "no vuelve a multiplicar por `subtotal` directo");
check(/montoRetencion\(baseRf, rf\)/.test(modal), "ReteFuente se calcula sobre baseRf");
check(/montoRetencion\(baseIva, ri\)/.test(modal), "ReteIVA se calcula sobre baseIva");
check(/disabled=\{faltaBase\}/.test(modal), "el botón de confirmar se traba con faltaBase");
// Regla 18: un botón trabado sin motivo escrito es un lazo que no cierra.
check(/ret-motivo/.test(modal), "dice POR QUÉ está trabado, al lado del botón");
check(/\.ret-motivo\s*\{/.test(leer("app/globals.css")), "la clase del motivo existe en el CSS");
// La trampa que el CLAUDE.md ya documenta: variables de color inexistentes
// hacen que el elemento salga invisible, sin ningún error.
const css = leer("app/globals.css");
// TODAS las reglas de la marca, no solo la primera: los niveles `pide` y `urge`
// tienen sus propios colores y un var() inexistente los deja invisibles.
for (const bloque of css.match(/\.c-sinxml[^{]*\{[^}]*\}/g) || []) {
  for (const v of bloque.match(/var\(--[a-z-]+\)/g) || []) {
    const nombre = v.slice(4, -1);
    check(new RegExp("\\" + nombre + "\\s*:").test(css),
      `la marca "sin XML" usa ${nombre}, que existe`);
  }
}

console.log("\n3b) La alarma envejece en vez de bloquear");
// El umbral no es un gusto: el 93% de los XML llega en 7 días (1.160 facturas
// de jul-ago). Bajarlo convierte la marca en ruido; subirlo pierde el soporte.
check(/diasSinXml >= 7/.test(modal || "") || /diasSinXml >= 7/.test(leer("app/(portal)/contabilidad/conciliacion/FacturaCard.tsx")),
  "el aviso de 'pídelo' entra a los 7 días");
const tarjeta = leer("app/(portal)/contabilidad/conciliacion/FacturaCard.tsx");
check(/pagada && diasSinXml >= 15/.test(tarjeta),
  "el nivel rojo exige PAGADA + 15 días (pagar sin soporte es la pérdida real)");
check(/\.c-sinxml\.pide/.test(css) && /\.c-sinxml\.urge/.test(css),
  "los dos niveles tienen estilo propio");
// Lo que NO puede pasar: que la alarma se vuelva candado. El pago avanza.
check(!/sinXml.*disabled|disabled.*sinXml/.test(tarjeta),
  "la marca NO bloquea ningún botón: el pago avanza sin el documento");

// ---------------------------------------------------------------------------
console.log("\n4) El sync: la factura coja se completa, y lo lleno no se pisa");
const sync = leer("scripts/sync_bq_to_pg.py");
// Orden del COALESCE: en plata es (lo_que_hay, lo_que_llega) — al revés de los
// enlaces. Solo se LLENA lo vacío. Invertirlo dejaría que una corrida pisara un
// monto ya guardado, en silencio.
check(/subtotal = COALESCE\(facturas\.subtotal, EXCLUDED\.subtotal\)/.test(sync),
  "subtotal solo se rellena si está vacío");
check(/iva\s*= COALESCE\(facturas\.iva,\s*EXCLUDED\.iva\)/.test(sync),
  "IVA solo se rellena si está vacío");
check(/\(facturas\.subtotal IS NULL AND EXCLUDED\.subtotal IS NOT NULL\)/.test(sync),
  "el WHERE deja que el UPDATE dispare cuando llega el subtotal");
// `total` NO puede estar en el SET: identidad y montos se capturan UNA vez, y
// una diferencia entre lo que dice la DIAN y lo que dice el XML es algo que hay
// que VER, no pisar.
check(!/^\s*total = COALESCE/m.test(sync), "`total` nunca se re-escribe");
check(/origen = CASE WHEN EXCLUDED\.origen = 'xml' THEN 'xml'/.test(sync),
  "el origen solo avanza de 'dian' a 'xml', nunca al revés");
check(/DIAN_ESPINA_DESDE = "2026-08-01"/.test(sync),
  "la espina tiene un piso de fecha explícito");
// La espina y lo capturado no pueden mandar el mismo CUFE en el mismo lote:
// Postgres rechaza el INSERT entero ("no puede afectar la fila dos veces").
check(/por_cufe/.test(sync), "se deduplica por CUFE antes de escribir");

// ---------------------------------------------------------------------------
console.log("\n5) La nota crédito sin XML se declara suelta, no se adivina");
const vista = path.join(RAIZ, "..", "datawarehouse", "contabilidad", "facturacion",
                       "sql", "v_dian_sin_captura.sql");
if (fs.existsSync(vista)) {
  const sql = fs.readFileSync(vista, "utf8");
  check(/QUALIFY ROW_NUMBER\(\) OVER \(PARTITION BY d\.cufe/.test(sql),
    "la vista deduplica el barrido DIAN (es append-only)");
  check(/Application response|d\.tipo IN \('Factura electrónica', 'Nota de crédito electrónica'\)/.test(sql),
    "solo documentos de negocio (los acuses DIAN traen CUFE y se colarían)");
} else {
  console.log("  (la vista vive en el repo datawarehouse; no está acá)");
}
check(/CAST\(NULL AS STRING\)\s+AS ref_cufe/.test(sync),
  "sin XML, a qué factura corrige una NC va NULL — nunca se cruza por valor");

// ---------------------------------------------------------------------------
console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s): ${fallos.join(", ")}\n`
                          : "\n✅ Todo en orden\n");
process.exit(fallos.length ? 1 : 0);
