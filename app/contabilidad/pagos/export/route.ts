import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getCurrentUserOrNull } from "@/lib/auth";
import { codigoBanco, TIPO_DOC_FULL, TIPO_CUENTA_FULL, csvRow } from "@/lib/bancos";

export const dynamic = "force-dynamic";

// Archivo del banco (CSV) para una cuenta propia (Rappi/Davivienda/PSE): UNA
// línea por proveedor, con el total a pagar (suma de saldos de sus facturas en
// Validación). El formato lo define cuentas_pago.formato. Los datos bancarios
// salen del maestro cuentas_bancarias_proveedor (banco → código ACH aquí).

type Fila = {
  nit: string; nombre: string | null; monto: number;
  titular_nombre: string | null; titular_apellido: string | null;
  tipo_doc: string | null; num_doc: string | null; banco: string | null;
  tipo_cuenta: string | null; num_cuenta: string | null; correo: string | null; referencia: string | null;
};

const limpiaDoc = (s: string) => s.replace(/[.\-\s]/g, "");

export async function GET(req: NextRequest) {
  const user = await getCurrentUserOrNull();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const cuenta = (req.nextUrl.searchParams.get("cuenta") ?? "").trim();
  if (!cuenta) return NextResponse.json({ error: "Falta ?cuenta=" }, { status: 400 });

  const pool = getPool();
  const cc = await pool.query<{ formato: string }>("SELECT formato FROM cuentas_pago WHERE nombre = $1", [cuenta]);
  const formato = cc.rows[0]?.formato ?? "generico";

  const { rows } = await pool.query<Fila>(
    `SELECT f.nit_proveedor AS nit, max(f.nombre_proveedor) AS nombre,
            round(sum(coalesce(e.valor_a_pagar, f.total) - coalesce(e.pago_monto,0)))::float AS monto,
            max(cb.titular_nombre) titular_nombre, max(cb.titular_apellido) titular_apellido,
            max(cb.tipo_doc) tipo_doc, max(cb.num_doc) num_doc, max(cb.banco) banco,
            max(cb.tipo_cuenta) tipo_cuenta, max(cb.num_cuenta) num_cuenta,
            max(cb.correo) correo, max(cb.referencia) referencia
       FROM factura_estado e JOIN facturas f USING (cufe)
       LEFT JOIN cuentas_bancarias_proveedor cb ON cb.nit = f.nit_proveedor
      WHERE e.estado = 'aprobada_pago' AND e.cuenta_pago = $1 AND coalesce(e.pago_estado,'pendiente') <> 'pagado'
      GROUP BY f.nit_proveedor
     HAVING sum(coalesce(e.valor_a_pagar, f.total) - coalesce(e.pago_monto,0)) > 0
      ORDER BY nombre`,
    [cuenta]);

  const nombre = (r: Fila) => (r.titular_nombre ?? r.nombre ?? "").trim();
  const apellido = (r: Fila) => (r.titular_apellido ?? "").trim();
  const doc = (r: Fila) => (r.tipo_doc ?? "NIT");
  const numDoc = (r: Fila) => limpiaDoc(r.num_doc ?? r.nit ?? "");
  const tipoCta = (r: Fila) => TIPO_CUENTA_FULL[r.tipo_cuenta ?? ""] ?? (r.tipo_cuenta ?? "");

  const lines: string[] = [];
  if (formato === "rappi") {
    lines.push(csvRow(["NOMBRE", "APELLIDOS", "TIPO DE DOCUMENTO", "NÚMERO DE DOCUMENTO", "BANCO", "CÓDIGO DE BANCO", "TIPO DE CUENTA", "NÚMERO DE CUENTA", "MONTO"]));
    for (const r of rows) lines.push(csvRow([
      nombre(r), apellido(r), TIPO_DOC_FULL[doc(r)] ?? doc(r), numDoc(r),
      r.banco ?? "", codigoBanco(r.banco), tipoCta(r), r.num_cuenta ?? "", Math.round(r.monto),
    ]));
  } else if (formato === "davivienda") {
    lines.push(csvRow(["Tipo de Identificación", "Número de Identificación", "Nombre", "Apellido", "Código del Banco", "Tipo de Producto o Servicio", "Número del Producto o Servicio", "Valor del pago o de la recarga", "Referencia (Opcional)", "Correo Electronico (Opcional)", "Descripción o Detalle (Opcional)"]));
    for (const r of rows) lines.push(csvRow([
      doc(r), numDoc(r), nombre(r), apellido(r), codigoBanco(r.banco),
      tipoCta(r), r.num_cuenta ?? "", Math.round(r.monto), r.referencia ?? "", r.correo ?? "", "",
    ]));
  } else {
    // PSE / genérico: CSV legible para que quien pague vea línea por línea.
    lines.push(csvRow(["Proveedor", "NIT", "Banco", "Tipo de cuenta", "Número de cuenta", "Titular", "Documento", "Valor a pagar"]));
    for (const r of rows) lines.push(csvRow([
      r.nombre ?? "", r.nit, r.banco ?? "", tipoCta(r), r.num_cuenta ?? "",
      (nombre(r) + " " + apellido(r)).trim(), `${doc(r)} ${numDoc(r)}`.trim(), Math.round(r.monto),
    ]));
  }

  const csv = "﻿" + lines.join("\r\n") + "\r\n"; // BOM (Excel) + CRLF
  const fecha = new Date().toISOString().slice(0, 10);
  const slug = cuenta.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pagos_${slug}_${fecha}.csv"`,
    },
  });
}
