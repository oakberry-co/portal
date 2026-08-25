#!/usr/bin/env node
/* eslint-disable */
// EL VIAJE DE VUELTA DEL EXCEL DE RETENCIONES (Regla 14).
//
// El equipo baja las facturas, escribe las retenciones a mano y sube el archivo.
// Entre bajar y subir, ese archivo pasa por Excel y por manos: alguien ordena
// por proveedor, borra las filas que no le tocan, escribe "1.234.567" con puntos
// o pega un 2,5 pensando en la tarifa. Todo eso tiene que sobrevivir o fallar
// diciendo qué pasó — nunca escribir un número inventado sobre una factura.
//
// Se prueba con el Excel REAL que produce el portal, no con uno de mentiras.
//
//   node scripts/test_retenciones_excel.js [ruta.xlsx]

const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const ExcelJS = require("exceljs");

const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

// El compilado va DENTRO del proyecto: si se deja en /tmp, no encuentra
// `exceljs` (node resuelve node_modules subiendo desde el archivo, y /tmp no
// tiene ninguno arriba).
const tmp = fs.mkdtempSync(path.join(RAIZ, ".tmp-tests-"));
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
try {
  execFileSync("npx", ["tsc", "lib/retenciones-excel.ts", "--outDir", tmp, "--module", "commonjs",
                       "--target", "es2020", "--moduleResolution", "node", "--esModuleInterop",
                       "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" });
} catch {}
const { leerExcel, pareceTarifa } = require(path.join(tmp, "retenciones-excel.js"));

const ORIGEN = process.argv[2] || path.join(RAIZ, "scripts", "fixtures", "conciliacion.xlsx");

(async () => {
  if (!fs.existsSync(ORIGEN)) {
    console.log(`\n⏭  No está ${ORIGEN}. Baja el Excel de Conciliación y pásalo como argumento.`);
    process.exit(0);
  }

  // Se abre el archivo REAL y se le escriben retenciones como lo haría el equipo.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(ORIGEN);
  const ws = wb.worksheets[0];
  // `.values` de exceljs es un array DISPERSO (el índice 0 es un hueco):
  // .map lo salta pero .findIndex lo visita como undefined. Se densifica.
  const enc = Array.from(ws.getRow(1).values || [], (v) => String(v ?? "").toLowerCase());
  const col = (n) => enc.findIndex((x) => x.includes(n));
  const cRf = col("retefuente"), cRi = col("reteiva"), cRic = col("reteica"), cCufe = col("cufe");
  check(cCufe > 0 && cRf > 0, "el Excel trae CUFE y columnas de retención");

  // El fixture solo vale si tiene los MISMOS encabezados que el export de
  // verdad. Si mañana alguien renombra una columna allá y no acá, la prueba
  // seguiría en verde mientras el archivo real deja de leerse.
  const ruta = path.join(RAIZ, "app", "(portal)", "contabilidad", "conciliacion", "export", "route.ts");
  const src = fs.readFileSync(ruta, "utf8");
  const delExport = [...src.matchAll(/header:\s*"([^"]+)"/g)].map((m) => m[1]);
  const delArchivo = Array.from(ws.getRow(1).values || [], (v) => String(v ?? "")).filter(Boolean);
  const faltan = delExport.filter((h) => !delArchivo.includes(h));
  check(faltan.length === 0,
        "los encabezados del archivo son los mismos que produce el export",
        faltan.length ? "faltan: " + faltan.join(", ") : `${delExport.length} columnas`);

  // Fila 2: montos normales. Fila 3: con separadores de miles como los escribe
  // la gente. Fila 4: ceros explícitos ("acá no se retiene"). Fila 5: en blanco.
  // Fila 6: una TARIFA donde van pesos — el error clásico.
  const cufes = [];
  for (let i = 2; i <= 6; i++) cufes.push(String(ws.getRow(i).getCell(cCufe).value ?? ""));
  ws.getRow(2).getCell(cRf).value = 25000;
  ws.getRow(3).getCell(cRf).value = "1.234.567";
  ws.getRow(3).getCell(cRic).value = "9.870";
  ws.getRow(3).getCell(cRi).value = "$ 45.000";
  ws.getRow(4).getCell(cRf).value = 0;
  ws.getRow(4).getCell(cRi).value = 0;
  ws.getRow(4).getCell(cRic).value = 0;
  // fila 5 se deja intacta (en blanco)
  ws.getRow(6).getCell(cRf).value = 2.5;

  const buf = await wb.xlsx.writeBuffer();
  const { filas, problemas } = await leerExcel(buf);
  const por = new Map(filas.map((f) => [f.fila, f]));

  console.log("\n1) Se leen los montos como los escribe la gente");
  check(por.get(2)?.rf === 25000, "un número plano", String(por.get(2)?.rf));
  check(por.get(3)?.rf === 1234567, '"1.234.567" con puntos de miles', String(por.get(3)?.rf));
  check(por.get(3)?.ric === 9870, '"9.870" son 9.870 pesos, NO 9,87', String(por.get(3)?.ric));
  check(por.get(3)?.ri === 45000, '"$ 45.000" con signo de peso', String(por.get(3)?.ri));

  console.log("\n2) VACÍO NO ES CERO — la regla que evita pagar de más");
  check(por.get(4)?.rf === 0 && por.get(4)?.ri === 0,
        "un 0 escrito llega como 0 (es una decisión: acá no se retiene)");
  const f5 = por.get(5);
  check(f5 !== undefined && f5.rf === null && f5.ri === null && f5.ric === null,
        "una casilla en blanco llega como null, NO como 0",
        f5 ? `rf=${f5.rf}` : "no se leyó la fila");

  console.log("\n3) La columna 'Otros' no cuenta como 'esta fila la llenaron'");
  // `otros_valor` es NOT NULL DEFAULT 0 en la base: el export escribe un 0 en
  // TODAS las filas. Si eso contara como intención, subir el archivo tal cual
  // confirmaría en cero todas las facturas del periodo de una sentada.
  const cOtros = enc.findIndex((x) => x === "otros");
  check(cOtros > 0, "el export trae la columna Otros");
  const wbO = new ExcelJS.Workbook();
  await wbO.xlsx.readFile(ORIGEN);
  const wsO = wbO.worksheets[0];
  for (let i = 2; i <= 6; i++) wsO.getRow(i).getCell(cOtros).value = 0;   // como sale del export
  const rO = await leerExcel(await wbO.xlsx.writeBuffer());
  const conIntencion = rO.filas.filter((f) => [f.rf, f.ri, f.ric].some((v) => v !== null));
  check(conIntencion.length === 0,
        "filas con Otros=0 y retenciones en blanco NO cuentan como llenadas",
        `${conIntencion.length} contarían`);

  console.log("\n4) La llave es el CUFE, no la posición");
  check(por.get(2)?.cufe === cufes[0], "cada fila conserva su CUFE");
  check(new Set(filas.map((f) => f.cufe)).size === filas.length, "no hay CUFE repetidos");

  console.log("\n5) Una tarifa escrita donde van pesos se RECHAZA, no se interpreta");
  check(pareceTarifa(2.5, 3_000_000), "2,5 sobre una factura de 3 millones: parece tarifa");
  check(pareceTarifa(10, 500_000), "10 sobre 500 mil: parece tarifa");
  check(!pareceTarifa(25_000, 3_000_000), "25.000 sobre 3 millones: son pesos de verdad");
  check(!pareceTarifa(410, 100_000_000), "410 pesos de ReteICA sobre 100 millones NO se toca");
  check(!pareceTarifa(0, 3_000_000), "un cero nunca es tarifa");

  console.log("\n6) Basura adentro, aviso afuera (nunca un número inventado)");
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(ORIGEN);
  const ws2 = wb2.worksheets[0];
  ws2.getRow(2).getCell(cRf).value = "no aplica";
  ws2.getRow(3).getCell(cRf).value = -5000;
  const r2 = await leerExcel(await wb2.xlsx.writeBuffer());
  check(r2.problemas.some((p) => p.fila === 2), "texto donde va un número → se reporta");
  check(r2.problemas.some((p) => p.fila === 3), "un negativo → se reporta");
  check(!r2.filas.some((f) => f.fila === 2 || f.fila === 3), "...y esas filas NO entran al plan");

  console.log("\n7) Un archivo que no es el del portal se rechaza con un porqué");
  const wb3 = new ExcelJS.Workbook();
  wb3.addWorksheet("otra").addRow(["Nombre", "Valor"]);
  let msg = "";
  try { await leerExcel(await wb3.xlsx.writeBuffer()); } catch (e) { msg = e.message; }
  check(/CUFE/.test(msg), "sin columna CUFE: se explica por qué no sirve", msg.slice(0, 60) + "…");

    console.log("\n8) EL ARCHIVO SOBREVIVE AL SEGUNDO PASO");
  // React 19 RESETEA el formulario cuando una acción termina. Después de
  // "Revisar", el <input type=file> queda VACÍO: "Aplicar" viajaba sin archivo,
  // la acción respondía "elige el Excel", el plan se borraba y NO SE ESCRIBÍA
  // NADA — se veía como que el botón no hacía nada. Comprobado en navegador el
  // 23-ago-2026 (`files.length: 0` justo antes de aplicar).
  const sub = fs.readFileSync(path.join(RAIZ, "app", "(portal)", "contabilidad",
                                        "conciliacion", "SubirRetenciones.tsx"), "utf8");
  check(/useState<File \| null>/.test(sub),
        "el File se guarda en memoria, no se relee del <input>");
  check(/fd\.set\("archivo", archivo, archivo\.name\)/.test(sub),
        "y los dos pasos lo mandan explícitamente en el FormData");
  check(!/<button type="submit"[^>]*value="aplicar"/.test(sub),
        "aplicar NO depende del submit nativo del formulario (que es lo que se resetea)");
  check(/fd\.set\("accion", que\)/.test(sub),
        "la acción (revisar/aplicar) viaja por el mismo camino, no por el submitter");

  console.log(`\n${fallos.length ? "🔴 " + fallos.length + " fallo(s): " + fallos.join(", ") : "🟢 todo OK"}`);
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
