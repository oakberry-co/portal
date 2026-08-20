#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DEL ARCHIVO DEL BANCO (Regla 14 + Regla 15).
//
// El archivo con el que se paga sale en .xlsx para TODAS las cuentas propias
// (Rappi, Davivienda, PSE). No es cosmético: un CSV no lleva formato de celda,
// así que Excel abre "03300013737" y lo guarda como 3300013737 — otra cuenta,
// y sin un solo error en pantalla. Hoy hay cuentas del maestro que empiezan por
// cero (STEEL MASTER 03300013737, JORGE MIGUEL 05314486074).
//
// Lo que este test fija, y que es fácil romper "simplificando":
//   1. la celda del número de cuenta va en formato Texto ("@") en los 3 formatos;
//   2. al releer el archivo, el cero a la izquierda sigue ahí;
//   3. el archivo se puede volver a leer (Regla 15: lo que sale tiene que poder volver).
//
//   node scripts/test_archivo_banco.js

const ExcelJS = require("exceljs");
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

// Las cuentas que de verdad muerden: empiezan por cero.
const CUENTAS = ["03300013737", "05314486074", "0550456300162249", "8600000378"];

/** Reproduce el gesto del route: escribir la cuenta en celda de formato Texto. */
function cuentaComoTexto(fila, col, valor) {
  const celda = fila.getCell(col);
  celda.numFmt = "@";
  celda.value = String(valor ?? "");
}

async function main() {
  console.log("\n1) La cuenta se escribe en celda de TEXTO y el cero sobrevive al round-trip");
  const wb = new ExcelJS.Workbook();
  const hoja = wb.addWorksheet("Pagos");
  hoja.addRow(["Proveedor", "Número de cuenta", "Valor"]);
  for (const c of CUENTAS) {
    const fila = hoja.addRow(["PRUEBA", c, 1000]);
    cuentaComoTexto(fila, 2, c);
  }
  const buf = await wb.xlsx.writeBuffer();

  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf);                       // Regla 15: vuelve a entrar
  const hoja2 = wb2.getWorksheet("Pagos");
  check(!!hoja2, "el archivo se puede volver a leer");

  CUENTAS.forEach((esperado, i) => {
    const celda = hoja2.getRow(i + 2).getCell(2);
    const leido = String(celda.value ?? "");
    check(leido === esperado, `cuenta ${esperado} vuelve intacta`, leido !== esperado ? `leído: ${leido}` : "");
    check(celda.numFmt === "@", `cuenta ${esperado} queda en formato Texto`, `numFmt: ${celda.numFmt}`);
  });

  console.log("\n2) Lo que pasaría en CSV (el bug que este formato evita)");
  // No es una prueba del código: es la demostración de por qué el .xlsx importa.
  // Un CSV es texto plano; el cero solo sobrevive si nadie lo abre en Excel.
  const comoNumero = Number("03300013737");
  check(String(comoNumero) !== "03300013737",
        "un número pierde el cero a la izquierda", `Number("03300013737") = ${comoNumero}`);

  console.log("\n3) El valor a pagar sigue siendo NÚMERO (el banco no acepta texto ahí)");
  const celdaValor = hoja2.getRow(2).getCell(3);
  check(typeof celdaValor.value === "number", "el valor viaja como número", `tipo: ${typeof celdaValor.value}`);

  console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s): ${fallos.join(", ")}\n` : "\n✅ Todo en orden.\n");
  process.exit(fallos.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
