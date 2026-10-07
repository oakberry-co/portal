import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { ruta } from "@/lib/ruta";
import { claseMetodo, diaIso, etiquetaMes, marcaMetodo, mesIso, mm, pct, SHORT_CODE_OK } from "@/lib/finanzas";

// EL P&L DE UNA TIENDA: líneas × meses (los últimos 7, el actual al día), con
// el método de cada cifra a la vista; debajo, cómo le fue al método contra el
// último cierre contable, y los últimos 14 días.
export const dynamic = "force-dynamic";

type Celda = { mes: Date; seccion: string; orden: number; linea: string; valor: string; metodo: string | null; fuente: string | null };
type Rec = { mes: Date; linea: string; estimado: string | null; cierre: string | null; brecha: string | null; brecha_pct: string | null };
type Dia = { fecha: Date; venta: string; cogs: string; rappi: string; ebitda: string };

async function cargar(tienda: string) {
  const pool = getPool();
  const celdas = (await pool.query<Celda>(`
    SELECT mes, seccion, orden, linea, valor, metodo, fuente
      FROM fin_pnl_mes
     WHERE short_code = $1
       AND mes >= date_trunc('month', (now() AT TIME ZONE 'America/Bogota'))::date - INTERVAL '6 months'
     ORDER BY mes, orden`, [tienda])).rows;
  const rec = (await pool.query<Rec>(`
    SELECT mes, linea, estimado, cierre, brecha, brecha_pct
      FROM fin_reconciliacion
     WHERE short_code = $1 AND mes = (SELECT max(mes) FROM fin_reconciliacion WHERE short_code = $1)
     ORDER BY abs(coalesce(brecha, 0)) DESC`, [tienda])).rows;
  const dias = (await pool.query<Dia>(`
    SELECT fecha,
           sum(valor) FILTER (WHERE seccion = '1. Ingresos') AS venta,
           sum(valor) FILTER (WHERE seccion = '2. COGS') AS cogs,
           sum(valor) FILTER (WHERE linea IN ('Plataformas Rappi (comisión)', 'Marketing Rappi (Ads)')) AS rappi,
           sum(valor) FILTER (WHERE seccion IN ('1. Ingresos', '2. COGS', '3. Gastos operativos')) AS ebitda
      FROM fin_pnl_dia
     WHERE short_code = $1 AND fecha >= (now() AT TIME ZONE 'America/Bogota')::date - 14
     GROUP BY fecha ORDER BY fecha DESC`, [tienda])).rows;
  return { celdas, rec, dias };
}

export default async function TiendaPage({ params }: { params: Promise<{ tienda: string }> }) {
  const { rol } = await getCurrentUser();
  if (!puede(rol, "finanzas")) redirect("/contabilidad/conciliacion");
  const { tienda } = await params;
  if (!SHORT_CODE_OK.test(tienda)) notFound();

  const { celdas, rec, dias } = await cargar(tienda);
  if (!celdas.length) notFound();

  const meses = [...new Set(celdas.map((c) => mesIso(c.mes)))].sort();
  const actual = meses[meses.length - 1];
  // Filas = líneas en el orden del P&L; columnas = meses.
  const lineas = new Map<string, { seccion: string; orden: number; linea: string; celdas: Map<string, Celda> }>();
  for (const c of celdas) {
    const k = c.linea;
    if (!lineas.has(k)) lineas.set(k, { seccion: c.seccion, orden: c.orden, linea: c.linea, celdas: new Map() });
    lineas.get(k)!.celdas.set(mesIso(c.mes), c);
  }
  const filas = [...lineas.values()].sort((a, b) => a.orden - b.orden);
  const secciones = [...new Set(filas.map((f) => f.seccion))];
  const esPct = (l: string) => /%/.test(l);
  const ultimoCierre = rec[0] ? mesIso(rec[0].mes) : null;

  return (
    <div className="container">
      <p className="mini"><Link href={ruta("/finanzas")}>← Finanzas</Link></p>
      <h1>💹 {tienda}</h1>
      <p className="sub">
        P&L al día: <b>{etiquetaMes(actual)}</b> en curso y los seis meses anteriores. Cada cifra lleva su método: lo que no es real va en <i className="fin-est">cursiva gris</i> (teórico, devengado o estimado) y se vuelve real cuando llega la factura con su mes del gasto o cierra la nómina.
      </p>

      <div className="card">
        <table className="mst-tabla fin-tabla">
          <thead><tr>
            <th>Línea</th>
            {meses.map((m) => <th key={m} className="num">{etiquetaMes(m)}{m === actual ? " ·al día" : ""}</th>)}
          </tr></thead>
          <tbody>
            {secciones.map((sec) => (
              <FragmentSeccion key={sec} sec={sec} filas={filas.filter((f) => f.seccion === sec)} meses={meses} esPct={esPct} />
            ))}
          </tbody>
        </table>
      </div>

      {rec.length > 0 && ultimoCierre && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>Cómo le fue al método en el último cierre ({etiquetaMes(ultimoCierre)})</h3>
          <p>Lo que este P&L dijo de ese mes (estimado) contra lo que registró la contabilidad de Julio (cierre). La brecha por línea es la calibración: donde se va mucho, el método de esa línea se ajusta.</p>
          <table className="mst-tabla fin-tabla">
            <thead><tr><th>Línea</th><th className="num">Estimado</th><th className="num">Cierre</th><th className="num">Brecha</th><th className="num">%</th></tr></thead>
            <tbody>
              {rec.map((r) => (
                <tr key={r.linea} className={r.linea === "EBITDA directo" ? "res" : ""}>
                  <td>{r.linea}</td>
                  <td className="num">{mm(r.estimado)}</td>
                  <td className="num">{r.cierre == null ? <span className="muted">sin línea en el cierre</span> : mm(r.cierre)}</td>
                  <td className={"num " + (Math.abs(Number(r.brecha ?? 0)) > 2_000_000 ? "fin-neg" : "")}>{mm(r.brecha)}</td>
                  <td className="num">{r.brecha_pct == null ? "—" : pct(r.brecha_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dias.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>Últimos 14 días</h3>
          <table className="mst-tabla fin-tabla">
            <thead><tr><th>Día</th><th className="num">Venta</th><th className="num">COGS teórico</th><th className="num">Rappi</th><th className="num">EBITDA directo del día</th></tr></thead>
            <tbody>
              {dias.map((d) => (
                <tr key={diaIso(d.fecha)}>
                  <td className="mono">{diaIso(d.fecha).slice(5)}</td>
                  <td className="num">{mm(d.venta)}</td>
                  <td className="num fin-est">{mm(d.cogs)}</td>
                  <td className="num">{mm(d.rappi)}</td>
                  <td className={"num " + (Number(d.ebitda) < 0 ? "fin-neg" : "fin-pos")}><b>{mm(d.ebitda)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mst-hint">El EBITDA de un día lleva la parte proporcional de los gastos del mes (nómina, arriendo, servicios…): un día flojo de venta sale negativo aunque el mes vaya bien.</p>
        </div>
      )}
    </div>
  );
}

function FragmentSeccion({ sec, filas, meses, esPct }: {
  sec: string; meses: string[]; esPct: (l: string) => boolean;
  filas: { seccion: string; orden: number; linea: string; celdas: Map<string, Celda> }[];
}) {
  return (
    <>
      <tr className="sec"><td colSpan={meses.length + 1}>{sec.replace(/^\d\. /, "")}</td></tr>
      {filas.map((f) => (
        <tr key={f.linea} className={sec.startsWith("9.") ? "res" : ""}>
          <td>{f.linea}</td>
          {meses.map((m) => {
            const c = f.celdas.get(m);
            if (!c) return <td key={m} className="num muted">—</td>;
            const v = Number(c.valor);
            const marca = marcaMetodo(c.metodo);
            return (
              <td key={m} className={"num " + claseMetodo(c.metodo) + (v < 0 && sec.startsWith("9.") ? " fin-neg" : "")}
                  title={`${c.metodo ?? ""}${c.fuente ? " · " + c.fuente : ""}`}>
                {esPct(f.linea) ? pct(v) : mm(v)}{marca ? <span className="fin-chip">{marca}</span> : null}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
