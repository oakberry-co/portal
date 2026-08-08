import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

type Fila = {
  semana: string; desde: string; hasta: string;
  facturas: number; valor: number; con_pdf: number; con_concepto: number;
  con_destino: number; confirmadas: number; retenciones: number; a_pagar: number;
};

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const M = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : cop.format(n));
const pct = (x: number, n: number) => (n ? Math.round((100 * x) / n) : 0);
const heat = (p: number) => (p >= 75 ? "hi" : p >= 40 ? "mid" : "lo");

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const ddmmm = (d: string) => { const x = new Date(d); return `${String(x.getUTCDate()).padStart(2, "0")}/${MESES[x.getUTCMonth()]}`; };

async function cargar(): Promise<Fila[]> {
  const pool = getPool();
  const { rows } = await pool.query<Fila>(`
    SELECT
      to_char(f.fecha_emision, 'IYYY') || '-S' || to_char(f.fecha_emision, 'IW') AS semana,
      min(f.fecha_emision)::text AS desde,
      max(f.fecha_emision)::text AS hasta,
      count(*)::int AS facturas,
      coalesce(sum(f.total),0)::float AS valor,
      count(*) FILTER (WHERE f.link_drive IS NOT NULL)::int AS con_pdf,
      count(*) FILTER (WHERE COALESCE(p.concepto_sug, mp.concepto_default, e.concepto) IS NOT NULL)::int AS con_concepto,
      count(*) FILTER (WHERE COALESCE(p.destino_sug, mp.destino_default, e.destino) IS NOT NULL)::int AS con_destino,
      count(*) FILTER (WHERE e.estado <> 'capturada')::int AS confirmadas,
      coalesce(sum(e.reten_total),0)::float AS retenciones,
      coalesce(sum(coalesce(e.valor_a_pagar, f.total)),0)::float AS a_pagar
    FROM facturas f
    JOIN factura_estado e USING (cufe)
    LEFT JOIN factura_propuesta p USING (cufe)
    LEFT JOIN maestro_proveedores mp ON mp.nit = f.nit_proveedor
    GROUP BY semana
    ORDER BY semana DESC
  `);
  return rows;
}

export default async function DashboardPage() {
  let filas: Fila[];
  try {
    filas = await cargar();
  } catch (e) {
    return <div className="container"><h1>📊 Dashboard</h1><p className="hint">No se pudo leer la base: {(e as Error).message}</p></div>;
  }

  const T = filas.reduce((a, f) => ({
    facturas: a.facturas + f.facturas, valor: a.valor + f.valor, con_pdf: a.con_pdf + f.con_pdf,
    con_concepto: a.con_concepto + f.con_concepto, con_destino: a.con_destino + f.con_destino,
    confirmadas: a.confirmadas + f.confirmadas, retenciones: a.retenciones + f.retenciones, aPagar: a.aPagar + f.a_pagar,
  }), { facturas: 0, valor: 0, con_pdf: 0, con_concepto: 0, con_destino: 0, confirmadas: 0, retenciones: 0, aPagar: 0 });
  const maxVal = Math.max(1, ...filas.map((f) => f.valor));

  return (
    <div className="container">
      <h1>📊 Dashboard</h1>
      <p className="sub">Evolución <b>semanal</b> del flujo de conciliación: cuánto entra, qué tan cubierto está (concepto · destino · factura) y las retenciones. La meta es que la cobertura suba semana a semana al alimentar los maestros.</p>

      <div className="dsh-cards">
        <div className="dsh-card"><i>Facturas</i><b>{T.facturas.toLocaleString("es-CO")}</b><span>{cop.format(T.valor)}</span></div>
        <div className="dsh-card"><i>Con concepto</i><b>{pct(T.con_concepto, T.facturas)}%</b><span>clasificable por concepto</span></div>
        <div className="dsh-card"><i>Con destino</i><b>{pct(T.con_destino, T.facturas)}%</b><span>tienda / centro de costo</span></div>
        <div className="dsh-card"><i>Con factura</i><b>{pct(T.con_pdf, T.facturas)}%</b><span>PDF en Drive</span></div>
        <div className="dsh-card"><i>Retenciones</i><b>{M(T.retenciones)}</b><span>calculadas</span></div>
        <div className="dsh-card"><i>A pagar</i><b>{M(T.aPagar)}</b><span>valor − retenciones</span></div>
      </div>

      <p className="mst-hint">Confirmado <b>en el portal</b>: {pct(T.confirmadas, T.facturas)}% ({T.confirmadas.toLocaleString("es-CO")} de {T.facturas.toLocaleString("es-CO")}). Sube a medida que el equipo valida aquí (hoy el trabajo aún vive en el Sheet — es el parallel-run).</p>

      <div className="dsh-wrap">
        <table className="dsh-tabla">
          <thead><tr>
            <th>Semana</th><th>Rango</th><th className="num">Facturas</th><th>Valor</th>
            <th className="num">Factura</th><th className="num">Concepto</th><th className="num">Destino</th>
            <th className="num">Retenciones</th><th className="num">A pagar</th>
          </tr></thead>
          <tbody>
            {filas.map((f) => {
              const pPdf = pct(f.con_pdf, f.facturas), pCon = pct(f.con_concepto, f.facturas), pDes = pct(f.con_destino, f.facturas);
              return (
                <tr key={f.semana}>
                  <td className="mono">{f.semana}</td>
                  <td className="muted">{ddmmm(f.desde)}–{ddmmm(f.hasta)}</td>
                  <td className="num">{f.facturas}</td>
                  <td><div className="dsh-val">{M(f.valor)}</div><div className="dsh-bar"><span style={{ width: `${(f.valor / maxVal) * 100}%` }} /></div></td>
                  <td className={"num heat " + heat(pPdf)}>{pPdf}%</td>
                  <td className={"num heat " + heat(pCon)}>{pCon}%</td>
                  <td className={"num heat " + heat(pDes)}>{pDes}%</td>
                  <td className="num">{f.retenciones ? M(f.retenciones) : "—"}</td>
                  <td className="num">{M(f.a_pagar)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="chain-note">Fuente: base operacional del portal (Neon). La cobertura de concepto/destino usa el maestro de proveedores + la sugerencia de la máquina. Próximo: sumar Fuga (universo DIAN) y Causadas (Siigo) desde la bodega, como en el Sheet.</p>
    </div>
  );
}
