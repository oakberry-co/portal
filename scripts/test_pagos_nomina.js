#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE PAGOS DE NÓMINA (Regla 14).
//
// Los dos Excel que entran al módulo —el maestro de empleados y el de pago de la
// quincena— pasan por manos y por Excel antes de llegar. Este centinela fija lo
// que no se puede romper, porque cada cosa acá es plata que llega a otra cuenta
// o una persona que no cobra:
//   · el maestro de RRHH se lee TAL COMO SALE (encabezados, «PPT 5017896», «109»);
//   · un punto que no está en la tabla NO cae a la tienda de al lado;
//   · banco/tipo/cuenta van juntos o la fila no entra;
//   · un banco mal escrito NO se resuelve por parecido;
//   · en el pago, vacío no es cero y una fila de totales no es una persona;
//   · la fila de Davivienda sale con los códigos del banco.
//
//   node scripts/test_pagos_nomina.js

const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const ExcelJS = require("exceljs");

const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

// Dentro del proyecto, para que el compilado encuentre `exceljs` en node_modules.
const tmp = fs.mkdtempSync(path.join(RAIZ, ".tmp-tests-"));
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
try {
  execFileSync("npx", ["tsc", "lib/nomina-pagos.ts", "lib/davivienda.ts", "lib/nomina-abono.ts", "--outDir", tmp, "--module", "commonjs",
                       "--target", "es2020", "--moduleResolution", "node", "--esModuleInterop",
                       "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" });
} catch {}
const N = require(path.join(tmp, "nomina-pagos.js"));
const { bancoCanonico } = require(path.join(tmp, "bancos.js"));
const { celdasDavivienda } = require(path.join(tmp, "davivienda.js"));
const A = require(path.join(tmp, "nomina-abono.js"));

const DESTINOS = ["Oakberry Zona T", "Oakberry Calle 109", "Oakberry Colina", "Oakberry Viva Barranquilla",
  "Oakberry Baq calle 76", "Oakberry Titan Plaza", "Administrativo"].map((nombre) => ({ nombre, short_code: null }));

async function libro(filas, { titulo = false, otraHoja = false } = {}) {
  const wb = new ExcelJS.Workbook();
  if (otraHoja) wb.addWorksheet("WA-LOCALES").addRow(["PUNTO", "CIUDAD", "NUMERO DE CELULAR"]);
  const h = wb.addWorksheet("Activos");
  if (titulo) h.addRow(["ACTIVOS MANEL FOODS — NÓMINA EN VIVO"]);
  for (const f of filas) h.addRow(f);
  return await wb.xlsx.writeBuffer();
}

(async () => {
  console.log("\n1) El maestro de RRHH se lee tal como sale (encabezados reales, otra hoja delante, título arriba)");
  const ENC = ["Activos ID", "Cedula", "Ciudad de Exp", "Nombres y Apellidos", "Fecha de ingreso", "Salario",
               "Auxilio transporte ", "Punto ", "Cargo Actual", "Email", "Activo", "Banco", "Tipo de cuenta", "Numero de cuenta"];
  const buf = await libro([
    ENC,
    [1, 1000000001, "BOGOTÁ", "PRUEBA UNO ANA", "", "$ 2,056,398", "SI", "ZONA T", "ADMINISTRADOR PUNTO", "a@x.co", "SI", "Bancolombia", "Ahorros", "03300013737"],
    [2, "PPT 5017896", "BOGOTÁ", "PRUEBA DOS LUIS", "", "", "SI", "109", "AUXILIAR", "", "SI", "", "", ""],
    [3, 1000000003, "BAQ", "PRUEBA TRES EVA", "", "", "SI", "CALLE 76", "AUXILIAR", "", "SI", "NEQUI", "", 3001234567],
    [4, 1000000004, "BOG", "PRUEBA CUATRO", "", "", "SI", "CALLE 85", "AUXILIAR", "", "SI", "", "", ""],          // punto desconocido
    [5, 1000000001, "BOG", "PRUEBA REPETIDA", "", "", "SI", "COLINA", "AUXILIAR", "", "SI", "", "", ""],        // cédula repetida
    [6, 1000000006, "BOG", "PRUEBA SEIS", "", "", "SI", "COLINA", "AUXILIAR", "", "SI", "BACOLOMBIA", "ahorros", "123456"], // typo de banco
    [7, 1000000007, "BOG", "PRUEBA SIETE", "", "", "SI", "TITAN PLAZA", "AUXILIAR", "", "SI", "Davivienda", "", "123456"],   // falta tipo
    [8, 1000000008, "BOG", "PRUEBA OCHO", "", "", "NO", "Administrativo", "CONTADORA", "", "NO", "", "", ""],
  ], { titulo: true, otraHoja: true });
  const L = await N.leerEmpleados(buf, DESTINOS);
  const por = Object.fromEntries(L.filas.map((f) => [f.num_doc, f]));
  check(L.hoja === "Activos", "salta la hoja que no tiene encabezado (WA-LOCALES)", L.hoja);
  check(L.filas.length === 4, "entran 4 filas buenas", String(L.filas.length));
  check(por["1000000001"]?.num_cuenta === "03300013737", "la cuenta escrita como texto conserva el CERO de la izquierda", por["1000000001"]?.num_cuenta);
  check(por["1000000001"]?.banco === "BANCOLOMBIA" && por["1000000001"]?.tipo_cuenta === "ahorros", "banco y tipo se llevan al nombre exacto de la lista");
  check(por["1000000001"]?.destino === "Oakberry Zona T", "«ZONA T » (con espacio) → Oakberry Zona T");
  check(por["5017896"]?.tipo_doc === "PPT" && !por["5017896"]?.tipoAsumido, "«PPT 5017896» → tipo PPT, número 5017896, no asumido");
  check(por["5017896"]?.destino === "Oakberry Calle 109", "«109» → Oakberry Calle 109");
  check(por["5017896"]?.num_cuenta === null, "sin datos bancarios: entra sin cuenta (no inventa una)");
  check(por["1000000003"]?.destino === "Oakberry Baq calle 76", "«CALLE 76» → Oakberry Baq calle 76 (Barranquilla, no Bogotá)");
  check(por["1000000003"]?.tipo_cuenta === "deposito" && por["1000000003"]?.cuentaComoNumero, "Nequi sin tipo → depósito, y avisa que la cuenta venía como NÚMERO");
  check(por["1000000001"]?.tipoAsumido === true && por["1000000001"]?.tipo_doc === "CC", "cédula pelada sin columna de tipo → CC, marcada como asumida");
  check(por["1000000008"]?.activo === false && por["1000000008"]?.destino === "Administrativo", "Activo=NO se respeta; «Administrativo» es destino válido");
  const prob = (txt) => L.problemas.some((p) => p.detalle.includes(txt));
  check(prob("CALLE 85"), "un punto que NO está en la tabla se reporta (no cae a la tienda de al lado)");
  check(prob("repetida"), "la cédula repetida se reporta");
  check(prob("BACOLOMBIA"), "el typo «BACOLOMBIA» NO se resuelve por parecido");
  check(prob("falta el tipo de cuenta"), "banco + cuenta sin tipo: la fila no entra");

  console.log("\n2) Sin columna Punto o sin nombre, el archivo se rechaza entero");
  let err = "";
  try { await N.leerEmpleados(await libro([["Cedula", "Nombres y Apellidos"], [123456, "X"]]), DESTINOS); } catch (e) { err = e.message; }
  check(/Punto/.test(err), "sin «Punto» no se carga (no se sabe a qué P&L cae el sueldo)", err.slice(0, 60));

  console.log("\n3) El Excel de pago");
  const P = await N.leerPago(await libro([
    ["Cedula", "Nombres y Apellidos", "Punto", "Neto a pagar", "Total devengado"],
    [1000000001, "PRUEBA UNO", "", "1.234.567", 1500000],
    ["PPT 5017896", "PRUEBA DOS", "COLINA", 900000.5, ""],
    [1000000003, "PRUEBA TRES", "", "", ""],                 // en blanco: no va
    [1000000004, "PRUEBA CUATRO", "", 0, ""],                // cero: no va
    [1000000005, "PRUEBA CINCO", "", -5000, ""],             // negativo: problema
    [1000000006, "PRUEBA SEIS", "", 800000, 700000],         // devengado < neto
    ["TOTAL", "", "", 99999999, ""],                         // fila de totales
  ]));
  const pp = Object.fromEntries(P.filas.map((f) => [f.num_doc, f]));
  check(pp["1000000001"]?.neto === 1234567, "«1.234.567» son un millón doscientos (el punto separa miles)", String(pp["1000000001"]?.neto));
  check(pp["5017896"]?.puntoCrudo === "COLINA", "el punto del pago viaja para partir el P&L");
  check(P.vacias === 2 && !pp["1000000003"] && !pp["1000000004"], "vacío y cero NO entran al lote (no se transfieren ceros)", String(P.vacias));
  check(P.problemas.some((p) => /negativo/.test(p.detalle)), "un neto negativo se reporta");
  check(P.problemas.some((p) => /devengado/.test(p.detalle)), "devengado menor que el neto se reporta (columnas cruzadas)");
  check(!P.filas.some((f) => f.neto === 99999999) && !P.problemas.some((p) => /TOTAL/i.test(p.quien)), "la fila de TOTAL no es una persona");
  err = "";
  try { await N.leerPago(await libro([["Cedula", "Nombre"], [123456, "X"]])); } catch (e) { err = e.message; }
  check(/valor a depositar/.test(err), "sin columna de valor el archivo se rechaza", err.slice(0, 60));

  // El «Reporte Neto a pagar» del software de nómina, como sale: 4 filas de
  // título, una fila de grupos (Datos empleados / Ingresos / Deducciones) y el
  // encabezado en la 6; la cédula se llama «Identificación».
  const R = await N.leerPago(await libro([
    ["Nómina detallada por concepto"], ["MANEL FOODS SAS"], ["Nómina: NOMINA 1Q OCTUBRE 2026"], ["Periodo: 01/10/2026 - 15/10/2026"],
    ["Datos empleados", "", "", "Ingresos", "", "Deducciones", "", ""],
    ["Nombre", "Identificación", "No contrato", "Sueldo", "Total Ingresos", "Fondo de salud", "Total deducciones", "Neto a Pagar"],
    ["PRUEBA UNO", "1000000001", "1000000001", 1500000, 1624548, 60000, 120000, 1504548],
    ["PRUEBA DOS", "1000000002", "1000000002-1", 975452, 1313751, 47568, 95136, 1218615],
    ["", null, null, null, null, null, null, null],
  ]));
  check(R.filas.length === 2 && R.problemas.length === 0, "el Reporte Neto a pagar se lee con su título y la fila de grupos", `${R.filas.length} filas`);
  check(R.filas[0]?.neto === 1504548 && R.filas[0]?.devengado === 1624548, "«Neto a Pagar» es el neto y «Total Ingresos» el devengado (para el P&L)");

  console.log("\n4) Bancos: igualdad o alias, nunca contención");
  check(bancoCanonico("Davivienda") === "BANCO DAVIVIENDA", "«Davivienda» → BANCO DAVIVIENDA");
  check(bancoCanonico("banco de bogota") === "BANCO DE BOGOTÁ", "«banco de bogota» → BANCO DE BOGOTÁ");
  check(bancoCanonico("Nu bank") === "NU", "«Nu bank» → NU");
  check(bancoCanonico("BANCO") === null, "«BANCO» a secas NO es ningún banco");
  check(bancoCanonico("Bancolombia sucursal") === null, "«Bancolombia sucursal» no se adivina");

  console.log("\n5) Periodo y fila de Davivienda");
  check(N.periodoValido("2026-11-Q1") && N.periodoValido("2026-11") && !N.periodoValido("2026-13-Q1") && !N.periodoValido("nov-2026"),
        "periodo: 2026-11-Q1 / 2026-11 sí; 2026-13 y «nov-2026» no");
  check(N.mesDePeriodo("2026-11-Q2") === "2026-11-01", "la 2ª quincena cae en el P&L de su mes");
  const fila = celdasDavivienda({ tipoDoc: "PPT", numDoc: "5017896", nombre: "Luis Peña", apellido: "", codigoBanco: "7",
                                  tipoCuenta: "ahorros", numCuenta: "03300013737", monto: 900000.5 });
  check(fila[0] === "5" && fila[5] === "CA" && fila[6] === "03300013737" && fila[7] === 900001 && fila[2] === "Luis Pena",
        "PPT→5, ahorros→CA, cuenta como texto, monto redondeado, sin ñ", JSON.stringify(fila.slice(0, 8)));

  console.log("\n6) Reasignación decidida: «VIVA» → Calle 76 (Daniel, 29-oct-2026)");
  const V = await N.leerEmpleados(await libro([["Cedula", "Nombres y Apellidos", "Punto", "Celular"],
    [1000000011, "PRUEBA VIVA", "VIVA", "318 5867123"], [1000000012, "PRUEBA CEL MALO", "ZONA T", "12345"]]), DESTINOS);
  const vv = Object.fromEntries(V.filas.map((f) => [f.num_doc, f]));
  check(vv["1000000011"]?.destino === "Oakberry Baq calle 76", "«VIVA» → Oakberry Baq calle 76", vv["1000000011"]?.destino);
  check(vv["1000000011"]?.celular === "573185867123", "«318 5867123» → 573185867123 para WhatsApp", vv["1000000011"]?.celular);
  check(vv["1000000012"] && vv["1000000012"].celular === null && V.avisos.some((a) => /12345/.test(a.detalle)) && !V.problemas.length,
        "celular ilegible: la fila ENTRA sin celular y se avisa (no bloquea)");

  console.log("\n7) Cuándo le entra la plata (aviso de WhatsApp)");
  check(A.fechaAbono("2026-10-29", "BANCO DAVIVIENDA") === "2026-10-29", "Davivienda → Davivienda: el mismo día hábil");
  check(A.fechaAbono("2026-10-29", "BANCOLOMBIA") === "2026-10-30", "otro banco (ACH): el día hábil siguiente");
  check(A.fechaAbono("2026-10-30", "NEQUI") === "2026-11-03", "viernes 30-oct a otro banco → martes 3-nov (salta sábado, domingo y el festivo del lunes 2)",
        A.fechaAbono("2026-10-30", "NEQUI"));
  check(A.fechaAbono("2026-10-31", "DAVIPLATA") === "2026-11-03", "pagado un sábado a DaviPlata → primer hábil (el lunes 2-nov es festivo)", A.fechaAbono("2026-10-31", "DAVIPLATA"));
  check(A.fechaLarga("2026-10-30") === "viernes 30 de octubre", "fecha escrita, nunca «hoy/mañana»", A.fechaLarga("2026-10-30"));
  check(A.celularWa("+57 320 805 8309") === "573208058309" && A.celularWa("3208058309") === "573208058309"
        && A.celularWa("6012345678") === null && A.celularWa("") === null, "celular: 57 + 10 dígitos que empiezan por 3; un fijo no es celular");

  console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s)` : "\n✅ todo bien");
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
