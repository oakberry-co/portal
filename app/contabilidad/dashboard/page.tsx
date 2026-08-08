import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

type Fila = {
  semana: string; desde: string; hasta: string;
  facturas: number; valor: number; con_pdf: number; con_concepto: number;
  con_destino: number; con_confianza: number; confirmadas: number;
  retenciones: number; a_pagar: number;
  dian: number | null; capturadas: number | null; causadas: number | null;
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
    WITH sem AS (
      SELECT
        to_char(f.fecha_emision, 'IYYY') || '-S' || to_char(f.fecha_emision, 'IW') AS semana,
        min(f.fecha_emision)::text AS desde, max(f.fecha_emision)::text AS hasta,
        count(*)::int AS facturas,
        coalesce(sum(f.total),0)::float AS valor,
        count(*) FILTER (WHERE f.link_drive IS NOT NULL)::int AS con_pdf,
        count(*) FILTER (WHERE COALESCE(p.concepto_sug, mp.concepto_default, e.concepto) IS NOT NULL)::int AS con_concepto,
        count(*) FILTER (WHERE COALESCE(p.destino_sug, mp.destino_default, e.destino) IS NOT NULL)::int AS con_destino,
        count(*) FILTER (WHERE mp.confianza >= 0.8)::int AS con_confianza,
        count(*) FILTER (WHERE e.estado <> 'capturada')::int AS confirmadas,
        coalesce(sum(e.reten_total),0)::float AS retenciones,
        coalesce(sum(coalesce(e.valor_a_pagar, f.total)),0)::float AS a_pagar
      FROM facturas f
      JOIN factura_estado e USING (cufe)
      LEFT JOIN factura_propuesta p USING (cufe)
      LEFT JOIN maestro_proveedores mp ON mp.nit = f.nit_proveedor
      GROUP BY semana
    )
    SELECT sem.*, ds.dian, ds.capturadas, ds.causadas
    FROM sem LEFT JOIN dashboard_semana ds ON ds.semana = sem.semana
    ORDER BY sem.semana DESC
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
    facturas: a.facturas + f.facturas, valor: a.valor + f.valor, con_concepto: a.con_concepto + f.con_concepto,
    con_destino: a.con_destino + f.con_destino, con_confianza: a.con_confianza + f.con_confianza,
    retenciones: a.retenciones + f.retenciones, aPagar: a.aPagar + f.a_pagar,
    dian: a.dian + (f.dian ?? 0), capturadas: a.capturadas + (f.capturadas ?? 0), causadas: a.causadas + (f.causadas ?? 0),
  }), { facturas: 0, valor: 0, con_concepto: 0, con_destino: 0, con_confianza: 0, retenciones: 0, aPagar: 0, dian: 0, capturadas: 0, causadas: 0 });
  const maxVal = Math.max(1, ...filas.map((f) => f.valor));

  return (
    <div className="container">
      <h1>📊 Dashboard</h1>
      <p className="sub">Evolución <b>semanal</b> del flujo. <b>Confiable %</b> = facturas de proveedores cuya historia es consistente (la sugerencia se puede creer). <b>Captura</b> = del universo DIAN, cuántas tenemos; la <b>fuga</b> es el resto.</p>

      <div className="dsh-cards">
        <div className="dsh-card"><i>Facturas</i><b>{T.facturas.toLocaleString("es-CO")}</b><span>{cop.format(T.valor)}</span></div>
        <div className="dsh-card hl"><i>Confiable (auto)</i><b>{pct(T.con_confianza, T.facturas)}%</b><span>proveedor consistente</span></div>
        <div className="dsh-card"><i>Con concepto</i><b>{pct(T.con_concepto, T.facturas)}%</b><span>clasificable</span></div>
        <div className="dsh-card"><i>Con destino</i><b>{pct(T.con_destino, T.facturas)}%</b><span>tienda / c. de costo</span></div>
        <div className="dsh-card"><i>Captura DIAN</i><b>{pct(T.capturadas, T.dian)}%</b><span>fuga {T.dian - T.capturadas}</span></div>
        <div className="dsh-card"><i>Causadas (Siigo)</i><b>{pct(T.causadas, T.dian)}%</b><span>en contabilidad</span></div>
      </div>

      <p className="mst-hint">Confirmado <b>en el portal</b>: {pct(filas.reduce((s, f) => s + f.confirmadas, 0), T.facturas)}% · Retenciones {M(T.retenciones)} · A pagar {M(T.aPagar)}. La confianza sube sola a medida que cada proveedor acumula historia consistente; cuando esté alta, esa sugerencia se puede aplicar casi a ciegas.</p>

      <div className="dsh-wrap">
        <table className="dsh-tabla">
          <thead><tr>
            <th>Semana</th><th>Rango</th><th className="num">Facturas</th><th>Valor</th>
            <th className="num">Confiable</th><th className="num">Concepto</th><th className="num">Destino</th>
            <th className="num">Captura</th><th className="num">Causadas</th><th className="num">A pagar</th>
          </tr></thead>
          <tbody>
            {filas.map((f) => {
              const pConf = pct(f.con_confianza, f.facturas), pCon = pct(f.con_concepto, f.facturas), pDes = pct(f.con_destino, f.facturas);
              const pCap = f.dian ? pct(f.capturadas ?? 0, f.dian) : null;
              const pCau = f.dian ? pct(f.causadas ?? 0, f.dian) : null;
              return (
                <tr key={f.semana}>
                  <td className="mono">{f.semana}</td>
                  <td className="muted">{ddmmm(f.desde)}–{ddmmm(f.hasta)}</td>
                  <td className="num">{f.facturas}</td>
                  <td><div className="dsh-val">{M(f.valor)}</div><div className="dsh-bar"><span style={{ width: `${(f.valor / maxVal) * 100}%` }} /></div></td>
                  <td className={"num heat " + heat(pConf)}>{pConf}%</td>
                  <td className={"num heat " + heat(pCon)}>{pCon}%</td>
                  <td className={"num heat " + heat(pDes)}>{pDes}%</td>
                  <td className={"num" + (pCap != null ? " heat " + heat(pCap) : "")} title={f.dian ? `fuga ${(f.dian ?? 0) - (f.capturadas ?? 0)} de ${f.dian}` : ""}>{pCap != null ? pCap + "%" : "—"}</td>
                  <td className={"num" + (pCau != null ? " heat " + heat(pCau) : "")}>{pCau != null ? pCau + "%" : "—"}</td>
                  <td className="num">{M(f.a_pagar)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="chain-note">Confiable/Concepto/Destino salen del cerebro de proveedores + la máquina (Postgres). Captura y Causadas salen del snapshot semanal (universo DIAN + Siigo) que la VM refresca a diario. Próximo nivel de confianza: medir cuántas veces el equipo <em>acepta</em> la sugerencia sin cambiarla (se acumula al confirmar en el portal).</p>
    </div>
  );
}
