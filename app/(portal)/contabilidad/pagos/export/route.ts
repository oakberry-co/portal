import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getCurrentUserOrNull } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { codigoBanco, codigoBancoDavivienda, CODIGOS_DAVIVIENDA, TIPO_DOC_FULL, TIPO_CUENTA_FULL } from "@/lib/bancos";
import { codigoTipoId, codigoProducto, textoBanco, revisarFila, type Aviso } from "@/lib/davivienda";
import { LISTO_PARA_PAGOS } from "@/lib/documentos-no-dian";
import ExcelJS from "exceljs";

export const dynamic = "force-dynamic";

// Archivo del banco para una cuenta propia (Rappi/Davivienda/PSE): UNA línea por
// proveedor, con el total a pagar. El formato lo define cuentas_pago.formato. Los
// datos bancarios salen del maestro cuentas_bancarias_proveedor (banco → código
// ACH aquí).
//
// TODOS LOS FORMATOS SALEN EN .XLSX. Antes Rappi y PSE bajaban en CSV y era el
// mismo agujero que ya nos costó caro en Davivienda: un CSV no lleva formato de
// celda, así que Excel abre "03300013737" y lo guarda como 3300013737 — otra
// cuenta, sin un solo error en pantalla. HOY hay dos cuentas del maestro que
// empiezan por cero. En Excel la celda del número de cuenta va en formato Texto
// y el cero sobrevive.
//
// El total suma DOS orígenes, porque el banco hace una sola transferencia por
// proveedor: las facturas en Validación y lo aprobado en el intake (cuentas de
// cobro y adelantos de cotización, que no tienen factura electrónica). Si el
// intake quedara por fuera, alguien tendría que agregar esa línea a mano al
// archivo — exactamente el hueco por el que se cuelan las cuentas inventadas.

type Fila = {
  nit: string; nombre: string | null; monto: number; n_intake: number;
  titular_nombre: string | null; titular_apellido: string | null;
  tipo_doc: string | null; num_doc: string | null; banco: string | null;
  tipo_cuenta: string | null; num_cuenta: string | null; correo: string | null; referencia: string | null;
};

const limpiaDoc = (s: string) => s.replace(/[.\-\s]/g, "");

export async function GET(req: NextRequest) {
  const user = await getCurrentUserOrNull();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!puede(user.rol, "pagos")) return NextResponse.json({ error: "No autorizado (pagos)." }, { status: 403 });

  const cuenta = (req.nextUrl.searchParams.get("cuenta") ?? "").trim();
  if (!cuenta) return NextResponse.json({ error: "Falta ?cuenta=" }, { status: 400 });

  const pool = getPool();
  const cc = await pool.query<{ formato: string }>("SELECT formato FROM cuentas_pago WHERE nombre = $1", [cuenta]);
  const formato = cc.rows[0]?.formato ?? "generico";

  const { rows } = await pool.query<Fila>(
    `WITH facturas_val AS (
       SELECT f.nit_proveedor AS nit, f.nombre_proveedor AS nombre, 0 AS es_intake,
              coalesce(e.valor_a_pagar, f.total) - coalesce(e.pago_monto,0) - coalesce(e.abono_aplicado,0) AS monto
         FROM factura_estado e JOIN facturas f USING (cufe)
        WHERE e.estado = 'aprobada_pago' AND e.cuenta_pago = $1
          AND coalesce(e.pago_estado,'pendiente') <> 'pagado'
     ), intake_val AS (
       -- El NETO de retenciones: lo que de verdad se transfiere. Mandar el
       -- valor bruto al banco es pagarle de más al proveedor, y eso después hay
       -- que pedírselo de vuelta.
       SELECT num_doc AS nit, razon_social AS nombre, 1 AS es_intake,
              coalesce(valor_a_pagar, valor, 0) AS monto
         FROM cuentas_cobro cc
        WHERE ${LISTO_PARA_PAGOS("cc")} AND cc.cuenta_pago = $1
       UNION ALL
       SELECT nit, razon_social, 1, round(coalesce(valor,0) * coalesce(adelanto_pct,0) / 100)
         FROM cotizaciones
        WHERE estado IN ('aprobada','facturada') AND pago_id IS NULL AND requiere_adelanto
          AND cuenta_pago = $1
     ), todo AS (SELECT * FROM facturas_val UNION ALL SELECT * FROM intake_val)
     SELECT t.nit, max(t.nombre) AS nombre, round(sum(t.monto))::float AS monto,
            sum(t.es_intake)::int AS n_intake,
            max(cb.titular_nombre) titular_nombre, max(cb.titular_apellido) titular_apellido,
            max(cb.tipo_doc) tipo_doc, max(cb.num_doc) num_doc, max(cb.banco) banco,
            max(cb.tipo_cuenta) tipo_cuenta, max(cb.num_cuenta) num_cuenta,
            max(cb.correo) correo, max(cb.referencia) referencia
       FROM todo t
       LEFT JOIN cuentas_bancarias_proveedor cb ON cb.nit = t.nit
      GROUP BY t.nit
     HAVING sum(t.monto) > 0
      ORDER BY nombre`,
    [cuenta]);

  // CANDADO DEL ARCHIVO DEL BANCO: un proveedor SIN número de cuenta no puede
  // salir en el archivo. Antes salía igual con el campo vacío (`num_cuenta ?? ""`):
  // una línea rota que el banco rechaza o —peor— que alguien "arregla" a mano
  // escribiendo una cuenta al vuelo, que es justo el agujero que estamos
  // cerrando. Para un proveedor del intake la ÚNICA forma de tener cuenta es
  // que su certificación bancaria se haya leído bien.
  const sinCuenta = rows.filter((r) => !(r.num_cuenta ?? "").trim());
  const pagables = rows.filter((r) => (r.num_cuenta ?? "").trim());

  const nombre = (r: Fila) => (r.titular_nombre ?? r.nombre ?? "").trim();
  const apellido = (r: Fila) => (r.titular_apellido ?? "").trim();
  const doc = (r: Fila) => (r.tipo_doc ?? "NIT");
  const numDoc = (r: Fila) => limpiaDoc(r.num_doc ?? r.nit ?? "");
  const tipoCta = (r: Fila) => TIPO_CUENTA_FULL[r.tipo_cuenta ?? ""] ?? (r.tipo_cuenta ?? "");

  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal Oakberry";
  const hoja = wb.addWorksheet("Pagos");   // Davivienda regla 8: una sola hoja
  let revisar = 0;

  /** El número de cuenta SIEMPRE en celda de formato Texto, en cualquier
   *  formato: es la única forma de que un cero a la izquierda sobreviva a que
   *  alguien abra y vuelva a guardar el archivo. */
  const cuentaComoTexto = (fila: ExcelJS.Row, col: number, valor: string | null) => {
    const celda = fila.getCell(col);
    celda.numFmt = "@";
    celda.value = String(valor ?? "");
  };

  if (formato === "rappi") {
    hoja.addRow(["NOMBRE", "APELLIDOS", "TIPO DE DOCUMENTO", "NÚMERO DE DOCUMENTO", "BANCO",
                 "CÓDIGO DE BANCO", "TIPO DE CUENTA", "NÚMERO DE CUENTA", "MONTO"]);
    for (const r of pagables) {
      const fila = hoja.addRow([
        nombre(r), apellido(r), TIPO_DOC_FULL[doc(r)] ?? doc(r), numDoc(r),
        r.banco ?? "", codigoBanco(r.banco), tipoCta(r), r.num_cuenta ?? "", Math.round(r.monto),
      ]);
      cuentaComoTexto(fila, 8, r.num_cuenta);
      fila.getCell(4).numFmt = "@";   // el documento también: hay NIT que empiezan por 0
      fila.getCell(4).value = numDoc(r);
      fila.getCell(9).numFmt = "#,##0";
    }
  } else if (formato === "davivienda") {
    // DAVIVIENDA tiene formato PROPIO exigido por el banco ("Formato Excel
    // Estándar"): códigos numéricos de identificación, tipo de producto en
    // CC/CA/DP/TP/DE, textos sin tildes ni signos y el valor sin separador de
    // miles. No se toca por gusto: una fila fuera de formato la rechaza el banco.
    const validos = new Set(CODIGOS_DAVIVIENDA);
    const avisos: Aviso[] = [];
    hoja.addRow(["Tipo de Identificación", "Número de Identificación", "Nombre", "Apellido",
                 "Código del Banco", "Tipo de Producto o Servicio", "Número del Producto o Servicio",
                 "Valor del pago o de la recarga", "Referencia (Opcional)",
                 "Correo Electronico (Opcional)", "Descripción o Detalle (Opcional)"]);
    pagables.forEach((r, i) => {
      const cod = codigoBancoDavivienda(r.banco);
      avisos.push(...revisarFila(i + 2, r, cod, validos));   // +2: fila real del Excel
      const fila = hoja.addRow([
        codigoTipoId(doc(r)),                 // 1 · código numérico, no "NIT"
        numDoc(r),                            // 10 · no se toca
        textoBanco(nombre(r)),                // 6 y 7 · sin tildes, ñ ni signos
        textoBanco(apellido(r)),
        cod,                                  // 4 · no se modifica, se valida
        codigoProducto(r.tipo_cuenta),        // 3 · CC/CA/DP/TP/DE
        r.num_cuenta ?? "",                   // 5 · TEXTO (abajo)
        Math.round(r.monto),                  // 9 · número, sin separador de miles
        textoBanco(r.referencia),             // 7
        r.correo ?? "",                       // 10 · no se toca
        "",
      ]);
      // Regla 5: la celda del número de producto queda en formato Texto y con
      // el valor exacto. Sin esto los ceros a la izquierda se pierden solos.
      cuentaComoTexto(fila, 7, r.num_cuenta);
      fila.getCell(8).numFmt = "0.00";        // 9 · 16 enteros + 2 decimales, sin miles
    });
    revisar = avisos.length;
    if (revisar) {
      console.warn("[pagos/export] Davivienda — filas por revisar a mano:\n"
        + avisos.map((a) => `  fila ${a.fila} · ${a.quien} · regla ${a.regla}: ${a.detalle}`).join("\n"));
    }
  } else {
    // PSE / genérico: hoja legible para que quien pague vea línea por línea.
    hoja.addRow(["Proveedor", "NIT", "Banco", "Tipo de cuenta", "Número de cuenta",
                 "Titular", "Documento", "Valor a pagar"]);
    for (const r of pagables) {
      const fila = hoja.addRow([
        r.nombre ?? "", r.nit, r.banco ?? "", tipoCta(r), r.num_cuenta ?? "",
        (nombre(r) + " " + apellido(r)).trim(), `${doc(r)} ${numDoc(r)}`.trim(), Math.round(r.monto),
      ]);
      cuentaComoTexto(fila, 5, r.num_cuenta);
      fila.getCell(2).numFmt = "@";
      fila.getCell(2).value = String(r.nit ?? "");
      fila.getCell(8).numFmt = "#,##0";
    }
  }

  hoja.getRow(1).font = { bold: true };
  hoja.columns.forEach((c) => { c.width = Math.max(12, Math.min(38, (String(c.values?.[1] ?? "").length + 4))); });

  const buf = await wb.xlsx.writeBuffer();

  // Lo excluido NUNCA se calla: un archivo con menos líneas de las esperadas se
  // lee como "ya está todo pagado". Va en el nombre del archivo (que el humano
  // SÍ ve) y en un header para quien lo consuma por programa.
  if (sinCuenta.length) {
    console.warn("[pagos/export] fuera del archivo por no tener cuenta bancaria: "
      + sinCuenta.map((r) => `${r.nombre ?? r.nit} (${r.nit})`).join(", "));
  }
  return new NextResponse(buf as ArrayBuffer, { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="pagos_${slugDe(cuenta)}_${hoyISO()}`
      + (sinCuenta.length ? `_FALTAN-${sinCuenta.length}` : "")
      + (revisar ? `_REVISAR-${revisar}` : "") + `.xlsx"`,
    "X-Proveedores-Incluidos": String(pagables.length),
    "X-Proveedores-Sin-Cuenta": String(sinCuenta.length),
    "X-Filas-Por-Revisar": String(revisar),
    "X-Solicitudes-Sin-Factura-Dian": String(rows.reduce((n, r) => n + (r.n_intake || 0), 0)),
  }});
}

const hoyISO = () => new Date().toISOString().slice(0, 10);
const slugDe = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
