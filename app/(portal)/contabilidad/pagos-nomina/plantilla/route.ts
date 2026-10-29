import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getPool } from "@/lib/db";
import { getCurrentUserOrNull } from "@/lib/auth";
import { puede } from "@/lib/permisos";

export const dynamic = "force-dynamic";

// LAS DOS PLANTILLAS, prellenadas con lo que ya sabe el portal. Bajar, llenar y
// volver a subir es el camino: así las columnas llegan con los nombres que el
// lector reconoce y la cédula y la cuenta en formato TEXTO (los ceros a la
// izquierda sobreviven a que alguien abra y guarde el archivo).
//   ?tipo=empleados → el maestro de nómina (o vacío, la primera vez)
//   ?tipo=pago      → los activos con su punto y el valor EN BLANCO

export async function GET(req: NextRequest) {
  const user = await getCurrentUserOrNull();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!puede(user.rol, "pagos_nomina")) return NextResponse.json({ error: "No autorizado (pagos_nomina)." }, { status: 403 });
  const tipo = req.nextUrl.searchParams.get("tipo");
  const pool = getPool();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal Oakberry";
  const texto = (fila: ExcelJS.Row, cols: number[]) => cols.forEach((c) => {
    const cel = fila.getCell(c); cel.numFmt = "@"; cel.value = String(cel.value ?? "");
  });

  if (tipo === "empleados") {
    const h = wb.addWorksheet("Empleados");
    h.addRow(["Tipo de documento", "Cedula", "Nombres y Apellidos", "Nombres", "Apellidos", "Punto",
              "Cargo", "Email", "Banco", "Tipo de cuenta", "Numero de cuenta", "Activo"]).font = { bold: true };
    const r = await pool.query(`SELECT tipo_doc, num_doc, nombre_completo, nombres, apellidos, destino, cargo, correo,
                                       banco, tipo_cuenta, num_cuenta, activo
                                  FROM nomina_beneficiarios ORDER BY destino, nombre_completo`);
    for (const b of r.rows) {
      const f = h.addRow([b.tipo_doc, b.num_doc, b.nombre_completo, b.nombres ?? "", b.apellidos ?? "", b.destino,
                          b.cargo ?? "", b.correo ?? "", b.banco ?? "", b.tipo_cuenta ?? "", b.num_cuenta ?? "", b.activo ? "SI" : "NO"]);
      texto(f, [2, 11]);
    }
    if (!r.rowCount) for (let i = 2; i <= 60; i++) { h.getCell(i, 2).numFmt = "@"; h.getCell(i, 11).numFmt = "@"; }
    h.columns.forEach((c, i) => { c.width = [16, 14, 36, 22, 22, 26, 26, 30, 22, 14, 18, 8][i]; });
    const g = wb.addWorksheet("Cómo llenarla");
    [["Tipo de documento", "CC, CE, PPT, PASAPORTE o TI. Si la cédula viene como «PPT 5017896» no hace falta."],
     ["Nombres / Apellidos", "SEPARADOS. Davivienda los pide aparte; si solo está «Nombres y Apellidos», el archivo del banco marca la fila para revisar."],
     ["Punto", "La tienda como la escribe RRHH (ZONA T, 109, COLINA…) o «Administrativo» para la gente de oficina. Decide a qué P&L cae el sueldo."],
     ["Banco", "Como en la lista del portal: BANCOLOMBIA, BANCO DAVIVIENDA, NEQUI, DAVIPLATA, NU, BANCO DE BOGOTÁ…"],
     ["Tipo de cuenta", "ahorros, corriente o daviplata."],
     ["Numero de cuenta", "Solo dígitos, en celda de TEXTO. Si empieza por 0, revisa que el cero siga ahí."],
     ["Activo", "SI / NO. Quien no venga en el archivo NO se desactiva: hay que escribir NO."],
     ["Celdas en blanco", "No borran lo que ya está guardado. Para cambiar una cuenta, escribe la nueva."]]
      .forEach((x) => g.addRow(x));
    g.getColumn(1).width = 22; g.getColumn(2).width = 110;
  } else if (tipo === "pago") {
    const h = wb.addWorksheet("Pago");
    h.addRow(["Cedula", "Nombres y Apellidos", "Punto", "Neto a pagar", "Total devengado", "Nota"]).font = { bold: true };
    const r = await pool.query(`SELECT num_doc, nombre_completo, destino FROM nomina_beneficiarios
                                 WHERE activo ORDER BY destino, nombre_completo`);
    for (const b of r.rows) texto(h.addRow([b.num_doc, b.nombre_completo, b.destino, null, null, ""]), [1]);
    h.getColumn(4).numFmt = "#,##0"; h.getColumn(5).numFmt = "#,##0";
    h.columns.forEach((c, i) => { c.width = [14, 36, 26, 16, 16, 30][i]; });
    const g = wb.addWorksheet("Cómo llenarla");
    [["Neto a pagar", "Lo que llega a la cuenta de la persona (después de salud, pensión, retención, libranzas). En pesos."],
     ["Total devengado", "Opcional: lo ganado antes de deducciones. Sirve para el P&L del mes en curso."],
     ["En blanco", "Esa persona NO va en este pago (no se transfieren ceros)."],
     ["Punto", "Solo cámbialo si esta vez el sueldo cae en otra tienda. Una persona en dos tiendas = dos filas con su punto."]]
      .forEach((x) => g.addRow(x));
    g.getColumn(1).width = 18; g.getColumn(2).width = 110;
  } else {
    return NextResponse.json({ error: "?tipo=empleados o ?tipo=pago" }, { status: 400 });
  }
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="plantilla_nomina_${tipo}.xlsx"`,
  }});
}
