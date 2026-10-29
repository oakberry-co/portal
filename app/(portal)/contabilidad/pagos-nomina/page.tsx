import { getPool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { filasBancoLote } from "@/lib/nomina-banco";
import { NominaPagosView, type Lote, type Beneficiario, type CuentaPago } from "./NominaPagosView";

export const dynamic = "force-dynamic";

// PAGOS DE NÓMINA — el mismo tablero que Pagos de proveedores (por pagar →
// validación → confirmados), con el lote de una quincena como unidad. La spec
// del negocio vive en gs://oakberry-col-core/03_contabilidad/conciliacion_pagos.

async function cargar() {
  const pool = getPool();
  // Lo vivo completo + lo pagado/anulado de los últimos 13 meses (historial).
  const lotes = await pool.query<Omit<Lote, "personas" | "avisos" | "sinCuenta">>(`
    SELECT l.id, l.periodo, l.concepto, l.mes_gasto::text AS mes_gasto, l.descripcion, l.estado,
           l.cuenta_pago, l.fecha_pago_prog::text AS fecha_pago_prog, l.archivo_nombre, l.creado_por,
           l.creado_en::text AS creado_en, l.pagado_en::text AS pagado_en, l.pagado_por,
           l.comprobante_url, l.nota,
           coalesce(sum(p.neto),0)::float AS total, count(p.id)::int AS n,
           coalesce(json_agg(json_build_object('destino', p.destino, 'neto', p.neto::float))
                    FILTER (WHERE p.id IS NOT NULL), '[]') AS por_destino_raw
      FROM nomina_lotes l LEFT JOIN nomina_pagos p ON p.lote_id = l.id
     WHERE l.estado IN ('por_pagar','validacion') OR l.creado_en > now() - interval '13 months'
     GROUP BY l.id
     ORDER BY l.periodo DESC, l.id DESC`);
  const vivos = lotes.rows.filter((l) => l.estado === "por_pagar" || l.estado === "validacion").map((l) => l.id);
  const personas = vivos.length ? await pool.query<{ lote_id: number; num_doc: string; nombre: string; destino: string; neto: number; devengado: number | null; sin_cuenta: boolean }>(`
    SELECT p.lote_id, p.num_doc, b.nombre_completo AS nombre, p.destino, p.neto::float, p.devengado::float,
           (nullif(btrim(b.num_cuenta),'') IS NULL OR b.banco IS NULL OR b.tipo_cuenta IS NULL) AS sin_cuenta
      FROM nomina_pagos p JOIN nomina_beneficiarios b USING (num_doc)
     WHERE p.lote_id = ANY($1)
     ORDER BY p.destino, b.nombre_completo`, [vivos]) : { rows: [] };
  const beneficiarios = await pool.query<Beneficiario>(`
    SELECT num_doc, tipo_doc, nombre_completo, (nombres IS NOT NULL AND apellidos IS NOT NULL) AS separados,
           banco, tipo_cuenta, CASE WHEN num_cuenta IS NULL THEN NULL ELSE right(num_cuenta, 4) END AS ult4,
           destino, cargo, activo,
           coalesce(cuenta_cambio_en > now() - interval '30 days', false) AS cuenta_nueva
      FROM nomina_beneficiarios ORDER BY activo DESC, destino, nombre_completo`);
  const cuentas = await pool.query<CuentaPago>("SELECT nombre, formato FROM cuentas_pago WHERE activo ORDER BY id");

  const out: Lote[] = [];
  for (const l of lotes.rows) {
    const raw = (l as unknown as { por_destino_raw: { destino: string; neto: number }[] }).por_destino_raw;
    const porDestino = new Map<string, number>();
    for (const x of raw) porDestino.set(x.destino, (porDestino.get(x.destino) ?? 0) + x.neto);
    // Las revisiones del archivo del banco se calculan con LA MISMA función que
    // arma el archivo (lib/nomina-banco.ts): la pantalla no puede decir otra cosa.
    const banco = l.estado === "validacion" ? await filasBancoLote(l.id) : null;
    const ps = personas.rows.filter((p) => p.lote_id === l.id);
    out.push({
      ...l, por_destino: [...porDestino].map(([destino, neto]) => ({ destino, neto })).sort((a, b) => b.neto - a.neto),
      personas: ps, avisos: banco?.avisos ?? [], sinCuenta: ps.filter((p) => p.sin_cuenta).length,
    } as Lote);
  }
  return { lotes: out, beneficiarios: beneficiarios.rows, cuentas: cuentas.rows };
}

export default async function PagosNominaPage() {
  const { rol } = await getCurrentUser();
  if (!puede(rol, "pagos_nomina")) {
    return <div className="container"><h1>👥 Pagos de nómina</h1><p className="hint">Este módulo lo opera solo el decisor: tiene el sueldo y la cuenta de cada persona.</p></div>;
  }
  let data: Awaited<ReturnType<typeof cargar>>;
  try {
    data = await cargar();
  } catch (e) {
    return <div className="container"><h1>👥 Pagos de nómina</h1><p className="hint">No se pudo leer la base: {(e as Error).message}</p></div>;
  }
  return (
    <div className="container container-wide">
      <h1>👥 Pagos de nómina</h1>
      <p className="sub">
        Igual que Pagos: <b>Por pagar</b> (sube el Excel de la quincena y revísalo) →
        <b> Validación</b> (elige la cuenta y baja el archivo de Davivienda) →
        <b> Confirmados</b> (el banco ya pagó). El maestro de personas y sus cuentas vive en <b>Empleados</b>.
      </p>
      <NominaPagosView lotes={data.lotes} beneficiarios={data.beneficiarios} cuentas={data.cuentas} />
    </div>
  );
}
