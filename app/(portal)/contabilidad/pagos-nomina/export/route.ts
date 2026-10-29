import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getPool } from "@/lib/db";
import { getCurrentUserOrNull } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { ENCABEZADO_DAVIVIENDA, celdasDavivienda, formatoFilaDavivienda } from "@/lib/davivienda";
import { filasBancoLote } from "@/lib/nomina-banco";

export const dynamic = "force-dynamic";

// EL ARCHIVO DEL BANCO DE UN LOTE DE NÓMINA — mismo «Formato Excel Estándar» de
// Davivienda que el de proveedores (la fila sale de lib/davivienda.ts: una sola
// definición). Una línea por PERSONA: si alguien trabajó en dos tiendas, el P&L
// lo parte en dos pero el banco le hace una sola transferencia.
//
// Solo se baja un lote EN VALIDACIÓN. Bajar el de un lote ya pagado es tener en
// la carpeta de descargas un archivo listo para pagar la quincena otra vez.

export async function GET(req: NextRequest) {
  const user = await getCurrentUserOrNull();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!puede(user.rol, "pagos_nomina")) return NextResponse.json({ error: "No autorizado (pagos_nomina)." }, { status: 403 });
  const id = Number(req.nextUrl.searchParams.get("lote"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Falta ?lote=" }, { status: 400 });

  const pool = getPool();
  const lote = await pool.query<{ periodo: string; concepto: string; estado: string; cuenta_pago: string | null }>(
    "SELECT periodo, concepto, estado, cuenta_pago FROM nomina_lotes WHERE id = $1", [id]);
  const l = lote.rows[0];
  if (!l) return NextResponse.json({ error: "Ese lote no existe." }, { status: 404 });
  if (l.estado !== "validacion") {
    return NextResponse.json({ error: `El lote está «${l.estado}». El archivo del banco solo se baja en validación.` }, { status: 409 });
  }
  const cfg = await pool.query<{ formato: string }>("SELECT formato FROM cuentas_pago WHERE nombre = $1", [l.cuenta_pago]);
  if (cfg.rows[0]?.formato !== "davivienda") {
    // Hoy la nómina sale por Davivienda (decisión de Daniel, 29-oct-2026). Otro
    // formato no se improvisa: un archivo con columnas que el banco no espera es
    // una nómina rechazada el día de pago.
    return NextResponse.json({ error: `La cuenta «${l.cuenta_pago}» no es de formato Davivienda. Devuelve el lote y asígnale Davivienda.` }, { status: 409 });
  }

  const { filas, avisos, sinCuenta } = await filasBancoLote(id);
  // El candado de «pasar a validación» ya exige cuenta completa; si alguien la
  // borró del maestro después, la persona NO sale callada: el archivo no se arma.
  if (sinCuenta.length) {
    return NextResponse.json({ error: `${sinCuenta.length} persona(s) quedaron sin cuenta bancaria después de validar: ${sinCuenta.join(", ")}. Corrige el maestro en «Empleados».` }, { status: 409 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal Oakberry";
  const hoja = wb.addWorksheet("Pagos");     // Davivienda regla 8: una sola hoja
  hoja.addRow(ENCABEZADO_DAVIVIENDA);
  for (const r of filas) {
    const fila = hoja.addRow(celdasDavivienda({
      tipoDoc: r.tipo_doc, numDoc: r.num_doc, nombre: r.nombre, apellido: r.apellido, codigoBanco: r.codigo,
      tipoCuenta: r.tipo_cuenta, numCuenta: r.num_cuenta, monto: r.neto,
      referencia: l.periodo, correo: r.correo, detalle: `NOMINA ${l.periodo}`,
    }));
    formatoFilaDavivienda(fila, r.num_cuenta, r.num_doc);
  }
  hoja.getRow(1).font = { bold: true };
  hoja.columns.forEach((c) => { c.width = Math.max(12, Math.min(38, (String(c.values?.[1] ?? "").length + 4))); });
  // Lo que hay que revisar lo pinta el tablero al lado de este botón (mismo
  // cálculo, lib/nomina-banco.ts); el archivo solo lo avisa en el nombre.
  const nuevas = avisos.filter((a) => a.regla === "cuenta nueva").length;
  const rows = filas;

  const buf = await wb.xlsx.writeBuffer();
  const pruebas = process.env.AMBIENTE === "pruebas" ? "PRUEBAS-NO-SUBIR-AL-BANCO_" : "";
  const total = rows.reduce((s, r) => s + r.neto, 0);
  return new NextResponse(buf as ArrayBuffer, { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${pruebas}NOMINA_${l.periodo}_${l.concepto}_${rows.length}personas`
      + (avisos.length ? `_REVISAR-${avisos.length}` : "") + (nuevas ? `_CUENTA-NUEVA-${nuevas}` : "") + `.xlsx"`,
    "X-Personas": String(rows.length),
    "X-Total": String(Math.round(total)),
    "X-Filas-Por-Revisar": String(avisos.length),
  }});
}
