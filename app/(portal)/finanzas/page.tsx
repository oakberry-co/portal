import Link from "next/link";
import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { ruta } from "@/lib/ruta";
import { etiquetaMes, mesIso, mm, pct } from "@/lib/finanzas";

// EL SEMÁFORO DE LA RED: cada tienda propia con su mes en curso al día.
//
// Lee la foto fin_* (scripts/sync_finanzas.py). Las cifras son las del P&L al
// día de BigQuery: venta y COGS teórico del POS (D-0), Rappi (D-2), lo demás
// devengado o estimado hasta que llegue la factura. «Estimadas» dice cuántas
// líneas del mes todavía no son reales — ese número baja solo con los días.
export const dynamic = "force-dynamic";

type Fila = {
  short_code: string; ciudad: string | null; mes: Date;
  venta: string; cogs: string; ebitda: string; margen: string | null;
  estimadas: number; dias: number; hasta: Date | null;
  cierre_mes: Date | null; cierre_est: string | null; cierre_real: string | null;
};
type Sync = { clave: string; valor: string | null };

async function cargar() {
  const pool = getPool();
  const { rows } = await pool.query<Fila>(`
    WITH mes_actual AS (SELECT date_trunc('month', (now() AT TIME ZONE 'America/Bogota'))::date AS mes),
    m AS (
      SELECT p.short_code, max(p.ciudad) AS ciudad, p.mes,
             sum(p.valor) FILTER (WHERE p.seccion = '1. Ingresos') AS venta,
             sum(p.valor) FILTER (WHERE p.seccion = '2. COGS')     AS cogs,
             max(p.valor) FILTER (WHERE p.linea = 'EBITDA directo') AS ebitda,
             max(p.valor) FILTER (WHERE p.linea = 'Margen EBITDA directo %') AS margen,
             count(*) FILTER (WHERE p.seccion IN ('2. COGS', '3. Gastos operativos') AND p.metodo NOT LIKE 'real%')::int AS estimadas,
             max(p.hasta) AS hasta,
             (max(p.hasta) - p.mes + 1)::int AS dias
        FROM fin_pnl_mes p, mes_actual a
       WHERE p.mes = a.mes
       GROUP BY p.short_code, p.mes
    ),
    -- El último mes que Julio cerró: qué dijo el método y qué dijo la contabilidad.
    c AS (
      SELECT DISTINCT ON (short_code) short_code, mes AS cierre_mes, estimado AS cierre_est, cierre AS cierre_real
        FROM fin_reconciliacion WHERE linea = 'EBITDA directo'
       ORDER BY short_code, mes DESC
    )
    SELECT m.*, c.cierre_mes, c.cierre_est, c.cierre_real
      FROM m LEFT JOIN c USING (short_code)
     ORDER BY m.ebitda DESC NULLS LAST`);
  const sync = (await pool.query<Sync>("SELECT clave, valor FROM fin_sync")).rows;
  return { filas: rows, sync: Object.fromEntries(sync.map((s) => [s.clave, s.valor])) as Record<string, string> };
}

export default async function FinanzasPage() {
  const { rol } = await getCurrentUser();
  if (!puede(rol, "finanzas")) redirect("/contabilidad/conciliacion");

  let data: Awaited<ReturnType<typeof cargar>>;
  try {
    data = await cargar();
  } catch (e) {
    return <div className="container"><h1>💹 Finanzas</h1><p className="hint">No se pudo leer la foto del P&L: {(e as Error).message}. Corre scripts/sync_finanzas.py.</p></div>;
  }
  const { filas, sync } = data;
  if (!filas.length) {
    return <div className="container"><h1>💹 Finanzas</h1><p className="hint">Todavía no hay foto del mes en curso. Corre scripts/sync_finanzas.py.</p></div>;
  }
  const mes = mesIso(filas[0].mes);
  const diasMes = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
  const T = filas.reduce((t, f) => ({ venta: t.venta + Number(f.venta), cogs: t.cogs + Number(f.cogs), ebitda: t.ebitda + Number(f.ebitda ?? 0) }),
                         { venta: 0, cogs: 0, ebitda: 0 });
  const margenT = T.venta ? (100 * T.ebitda) / T.venta : 0;
  // Proyección simple a mes completo con el ritmo que lleva (para la regla de los 35 MM).
  const proy = (venta: number, dias: number) => (dias > 0 ? (venta * diasMes) / dias : 0);

  return (
    <div className="container">
      <h1>💹 Finanzas — P&L al día por tienda</h1>
      <p className="sub">
        <b>{etiquetaMes(mes)}</b>, con datos hasta el <b>{sync.ventas_hasta ?? "—"}</b>. Lo que es diario de verdad viene diario (venta y COGS teórico del POS, comisión y Ads de Rappi);
        lo mensual se devenga por día y se vuelve real cuando llega la factura con su <i>mes del gasto</i>. <b>EBITDA directo</b> = ingresos − COGS − gastos de la tienda; sin administración ni mercadeo transversal (eso se decide después).
      </p>
      <p className="fin-fuentes">
        Fuentes: POS hasta {sync.ventas_hasta ?? "—"} · Rappi hasta {sync.rappi_hasta ?? "—"} · portal reflejado {sync.portal_reflejo ?? "—"} UTC · último cierre contable {sync.ultimo_cierre ? etiquetaMes(sync.ultimo_cierre.slice(0, 10)) : "—"} · foto {sync.refrescado_en ?? "—"}.
      </p>

      <div className="fin-kpis">
        <div className="fin-kpi"><b>{mm(T.venta)} M</b><span>venta sin IVA, mes en curso</span></div>
        <div className="fin-kpi"><b>{mm(T.cogs)} M</b><span>COGS teórico ({T.venta ? Math.round((-100 * T.cogs) / T.venta) : 0} % de la venta)</span></div>
        <div className="fin-kpi"><b className={T.ebitda < 0 ? "fin-neg" : ""}>{mm(T.ebitda)} M</b><span>EBITDA directo, mes en curso</span></div>
        <div className="fin-kpi"><b>{Math.round(margenT)} %</b><span>margen EBITDA directo</span></div>
      </div>

      <div className="card">
        <table className="mst-tabla fin-tabla">
          <thead><tr>
            <th>Tienda</th><th className="num">Venta MTD</th><th className="num" title="Venta del mes proyectada con el ritmo que lleva">Proy. mes</th>
            <th className="num">COGS %</th><th className="num">EBITDA MTD</th><th className="num">Margen</th>
            <th title="Líneas del mes que todavía son teóricas, devengadas o estimadas (no reales)">Estimadas</th>
            <th className="num" title="Último mes cerrado por contabilidad: lo que estimó el método vs lo que registró el cierre">Último cierre (est / real)</th>
          </tr></thead>
          <tbody>
            {filas.map((f) => {
              const venta = Number(f.venta), ebitda = Number(f.ebitda ?? 0), cogs = Number(f.cogs);
              const p = proy(venta, f.dias);
              const bandera = p < 35_000_000 ? "no" : p < 45_000_000 ? "mid" : "ok";
              return (
                <tr key={f.short_code}>
                  <td>
                    <Link href={ruta(`/finanzas/${f.short_code}`)}><b>{f.short_code}</b></Link>
                    <span className="muted mini"> {f.ciudad ?? ""}</span>
                  </td>
                  <td className="num">{mm(venta)}</td>
                  <td className="num">{mm(p)}<span className={"fin-chip " + bandera} title={bandera === "no" ? "Bajo 35 MM/mes: con esta venta la tienda muy probablemente pierde plata (regla de rentabilidad)" : bandera === "mid" ? "Entre 35 y 45 MM/mes: pan para vender pan" : "Sobre 45 MM/mes"}>{bandera === "no" ? "<35" : bandera === "mid" ? "35–45" : "ok"}</span></td>
                  <td className="num">{venta ? Math.round((-100 * cogs) / venta) : 0} %</td>
                  <td className={"num " + (ebitda < 0 ? "fin-neg" : "fin-pos")}><b>{mm(ebitda)}</b></td>
                  <td className="num">{pct(f.margen)}</td>
                  <td>{f.estimadas > 0 ? <span className="fin-est">{f.estimadas} línea(s)</span> : <span className="fin-pos">todo real</span>}</td>
                  <td className="num muted">
                    {f.cierre_mes ? <>{etiquetaMes(mesIso(f.cierre_mes))}: {mm(f.cierre_est)} / <b>{mm(f.cierre_real)}</b></> : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr className="res">
            <td>Total {filas.length} tiendas</td>
            <td className="num">{mm(T.venta)}</td><td className="num">{mm(filas.reduce((s, f) => s + proy(Number(f.venta), f.dias), 0))}</td>
            <td className="num">{T.venta ? Math.round((-100 * T.cogs) / T.venta) : 0} %</td>
            <td className={"num " + (T.ebitda < 0 ? "fin-neg" : "fin-pos")}>{mm(T.ebitda)}</td>
            <td className="num">{Math.round(margenT)} %</td><td /><td />
          </tr></tfoot>
        </table>
      </div>
      <p className="mst-hint">Cifras en millones de pesos sin IVA. Lo que no es real se ve en <i className="fin-est">cursiva gris</i> dentro de cada tienda. El COGS es el teórico del POS (receta × venta): en los cierres queda ~6 % por debajo del contable, que es justo la merma que el módulo de operaciones va a medir.</p>
    </div>
  );
}
