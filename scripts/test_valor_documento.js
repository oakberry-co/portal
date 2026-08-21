#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DEL MONTO CONTRA EL DOCUMENTO (Regla 14).
//
// El bug que fija: COT-0026 (21-ago-2026). La cotización de ENDIPACK decía
// `TOTAL A PAGAR $ 149.340,24` y el proveedor tecleó `$ 14.934.024` — el mismo
// número sin la coma, cien veces más grande, con 100% de adelanto. Nadie lo
// habría notado hasta el extracto bancario.
//
// Lo que se cuida:
//   1. Sobre DOCUMENTOS REALES (fixtures del repo), el ×100 se caza y los que
//      están bien NO se molestan — un aviso falso repetido es un aviso que el
//      equipo aprende a ignorar.
//   2. El NIT y los códigos de la DIAN no cuentan como plata. Es lo que evita el
//      falso "cuadra", que es el error caro.
//   3. La escalera de bloqueo tiene salida en cada peldaño (Regla 18).
//   4. EL ESPEJO: scripts/leer_valores.py tiene que sacar EXACTAMENTE los mismos
//      montos que lib/valor-documento.ts. El script escribe los candidatos y el
//      portal calcula el veredicto sobre ellos: si leen distinto, el semáforo
//      opina sobre números que nadie vio. Ya cazó una: `round()` de Python es
//      bancario (6,5 → 6) y `Math.round` de JS no (6,5 → 7).
//
//   node scripts/test_valor_documento.js

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const RAIZ = path.dirname(__dirname);
const FIX = path.join(RAIZ, "scripts", "fixtures");
const fallos = [];
const check = (ok, titulo, detalle = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${titulo}${detalle ? " — " + detalle : ""}`);
  if (!ok) fallos.push(titulo);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "valor-"));
try {
  execFileSync("npx", ["tsc", "lib/valor-documento.ts", "--outDir", tmp,
                       "--module", "commonjs", "--target", "es2020", "--lib", "es2020,dom",
                       "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" });
} catch (e) { /* emite igual */ }
const { montosDeTexto, veredicto, bloqueoValor, mismoMonto } =
  require(path.join(tmp, "valor-documento.js"));

const texto = (n) => fs.readFileSync(path.join(FIX, n), "utf8");

console.log("\n1) El caso real: la cotización cien veces inflada");
const endipack = montosDeTexto(texto("cotizacion_endipack.txt"));
check(endipack.includes(149340), "se lee el TOTAL A PAGAR ($ 149.340,24 → 149.340)",
      endipack.slice(0, 3).join(", "));
const v100 = veredicto(14934024, endipack);
check(v100.estado === "no_cuadra", "14.934.024 NO cuadra", v100.estado);
check(/centavos/.test(v100.motivo ?? ""), "y se dice la causa probable (la coma decimal)",
      (v100.motivo ?? "").slice(-60));
check(veredicto(149340, endipack).estado === "cuadra", "149.340 sí cuadra");
check(veredicto(125496, endipack).estado === "cuadra",
      "el TOTAL BRUTO también cuadra (el proveedor puede cotizar sin IVA)");

console.log("\n2) Lo que NO es plata aunque se escriba con puntos");
check(!endipack.includes(830514578), "el NIT 830.514.578-2 no entra como monto");
const faro = montosDeTexto(texto("factura_elfaro.txt"));
check(!faro.includes(1000000), "el rango DIAN 'HASTA MVF/1000000' no entra como monto");
check(!faro.includes(18764105081646), "el número de resolución tampoco");
check(faro.includes(10642), "y el total real sí se lee ($ 10.642)", faro.slice(0, 3).join(", "));
const parq = montosDeTexto(texto("parqueadero_ocr.txt"));
check(!parq.includes(1000000), "en OCR tampoco entra 'de 1 hasta 1.000.000'", parq.join(", "));

console.log("\n3) No molestar al que está bien");
const larga = montosDeTexto(texto("cotizacion_larga.txt"));
check(veredicto(2083666, larga).estado === "cuadra",
      "una cotización de 27 líneas con su total correcto pasa limpia");
check(veredicto(10650, faro).estado === "no_cuadra",
      "y 10.650 contra un documento que dice 10.642 SÍ se marca (son 8 pesos, pero son)");

console.log("\n4) Pesos enteros, no centavos (no es tolerancia: es la unidad)");
check(mismoMonto(149340.24, 149340), "149.340,24 del papel = 149.340 tecleado");
check(!mismoMonto(149341, 149340), "pero 149.341 NO es 149.340");

console.log("\n5) La escalera de bloqueo, con salida en cada peldaño (Regla 18)");
const conCandidatos = (c, extra = {}) => ({
  id: 1, estado: "leido", motivo: null, valor_leido: String(Math.max(...c)),
  candidatos: c, metodo: "texto_pdf", leido_en: "2026-08-21",
  valor_verificado: null, verificado_por: null, ...extra });

check(bloqueoValor(conCandidatos(endipack), 149340) === null, "cuadra → no bloquea");
const b1 = bloqueoValor(conCandidatos(endipack), 14934024);
check(b1 !== null, "no cuadra → bloquea");
check(/Ajustar monto/.test(b1 ?? ""), "y dice QUÉ hacer", (b1 ?? "").slice(-70));
check(bloqueoValor(null, 100) !== null,
      "SIN lectura también bloquea (un candado ciego que deja pasar es peor que ninguno)");
check(/escribe el total/i.test(bloqueoValor(null, 100) ?? ""), "…y ofrece la salida humana");
check(bloqueoValor(conCandidatos([1], { estado: "pendiente" }), 100) !== null,
      "pendiente bloquea, pero avisa que el lector corre cada 15 min");
check(bloqueoValor(conCandidatos([], { estado: "ilegible" }), 100) !== null, "ilegible bloquea");

console.log("\n6) El paso humano manda sobre la máquina");
const verif = conCandidatos(endipack, { valor_verificado: "149340", verificado_por: "a@b.co" });
check(bloqueoValor(verif, 149340) === null,
      "si un humano leyó 149.340 y eso es lo registrado, pasa");
const choque = bloqueoValor(verif, 14934024);
check(choque !== null && /149.340/.test(choque), "si leyó otra cosa, lo dice con las dos cifras");
// El caso que de verdad importa: el lector falló pero el humano leyó bien.
const soloHumano = conCandidatos([], { estado: "ilegible", valor_verificado: "500000" });
check(bloqueoValor(soloHumano, 500000) === null,
      "documento ilegible + humano que lo leyó → desbloquea igual");

console.log("\n7) EL ESPEJO: leer_valores.py saca lo mismo que valor-documento.ts");
const fixtures = fs.readdirSync(FIX).filter((f) => f.endsWith(".txt"));
const py = path.join(tmp, "montos_py.json");
try {
  execFileSync("python3", ["-c", `
import sys, os, json, re, math
src = open(os.path.join(${JSON.stringify(RAIZ)}, "scripts", "leer_valores.py")).read()
ns = {}
exec("import re, math\\n" + src[src.index("RE_ID_DRIVE"):src.index("def leer_documento")], ns)
FIX = ${JSON.stringify(FIX)}
out = {f: ns["montos_de_texto"](open(os.path.join(FIX, f), encoding="utf-8").read())
       for f in ${JSON.stringify(fixtures)}}
json.dump(out, open(${JSON.stringify(py)}, "w"))
`], { stdio: "pipe" });
  const dePython = JSON.parse(fs.readFileSync(py, "utf8"));
  let iguales = 0;
  for (const f of fixtures) {
    const ts = montosDeTexto(texto(f));
    const ok = JSON.stringify(ts) === JSON.stringify(dePython[f]);
    if (ok) iguales++;
    else check(false, `espejo ${f}`, `ts=${JSON.stringify(ts)} py=${JSON.stringify(dePython[f])}`);
  }
  check(iguales === fixtures.length, `los ${fixtures.length} documentos se leen IGUAL en TS y en Python`,
        `${iguales}/${fixtures.length}`);
} catch (e) {
  check(false, "se pudo correr el espejo de Python", String(e.message).slice(0, 120));
}

console.log(`\n${fallos.length ? "🔴 " + fallos.length + " fallo(s): " + fallos.join(", ") : "🟢 todo OK"}`);
process.exit(fallos.length ? 1 : 0);
