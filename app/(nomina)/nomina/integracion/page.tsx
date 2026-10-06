import { redirect } from "next/navigation";
import { tiendas, ventasPorTienda } from "@/lib/rrhh/db";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { mm } from "@/lib/rrhh/motor";
import { hoyBogota, mesDe, MESES } from "@/lib/rrhh/fechas";
import { Head, Aviso, Pill, Nota } from "../_lib/ui";

// VENTAS (DW): de dónde salen las ventas que cruzan con el costo laboral. Nada
// de llaves Toteat en esta app: un sync (scripts/sync_rrhh_ventas.py, por
// crear) copia analytics.ventas_diarias de BigQuery a rrhh_ventas_dia y acá
// solo se muestra si llegó o no.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  if (p.tipo !== "rrhh") redirect("/nomina/perfil");

  // mes anterior completo: es el que el incentivo y el P&L miran
  const hoy = hoyBogota();
  const [y, m] = hoy.split("-").map(Number);
  const mesAnt = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const rangoMes = mesDe(`${mesAnt}-01`);
  const [TS, ventas] = await Promise.all([tiendas(), ventasPorTienda(rangoMes.desde, rangoMes.hasta)]);
  const haySync = Object.keys(ventas).length > 0;
  const [ya, ma] = mesAnt.split("-").map(Number);
  const totalMes = Object.values(ventas).reduce((a, v) => a + v, 0);

  return (
    <>
      <Head titulo="Ventas (DW)" sub={<>De dónde salen las ventas que cruzan con el costo laboral. Sin API keys de Toteat en esta app. · {haySync ? <Pill tono="ok">sincronizada</Pill> : <Pill tono="warn">sin sync del DW</Pill>}</>} />
      <Aviso sp={sp} />
      {!haySync && (
        <div className="nm-card">
          <h3>Todavía no hay ventas en esta base</h3>
          <p className="nm-sub" style={{ margin: 0, lineHeight: 1.5 }}>
            La tabla <code>rrhh_ventas_dia</code> está vacía para {MESES[ma - 1]} {ya}. La llenará el sync <code>scripts/sync_rrhh_ventas.py</code> (por crear) leyendo
            <code> analytics.ventas_diarias</code> de BigQuery (Toteat, sin IVA, hora Bogotá) y cruzando <code>store_key</code> → <code>rrhh_tiendas.id</code>. Mientras tanto, en <b>Incentivos</b> la venta del mes se digita a mano.
          </p>
        </div>
      )}
      <div className="nm-card nm-scroll">
        <h3>Tiendas <small>{TS.length} · venta {MESES[ma - 1]} {ya}{haySync ? ` · total ${mm(totalMes)}` : ""}</small></h3>
        <table className="nm-tabla"><thead><tr><th>Tienda</th><th>id (rrhh_tiendas)</th><th>Fuente</th><th className="num">Venta {MESES[ma - 1]} (sin IVA)</th><th>Estado</th></tr></thead>
          <tbody>{TS.map((t) => { const v = ventas[t.id]; return (
            <tr key={t.id}><td className="nm-nombre">{t.nombre}{t.ciudad && <div className="nm-sub">{t.ciudad}</div>}</td><td className="mono nm-sub">{t.id}{t.centro_costo ? ` · CC ${t.centro_costo}` : ""}</td><td className="nm-sub">analytics.ventas_diarias → rrhh_ventas_dia</td><td className="num">{v ? mm(v) : "—"}</td>
              <td>{!t.activa ? <Pill tono="gris">cerrada</Pill> : v ? <Pill tono="ok">sincronizada</Pill> : haySync ? <Pill tono="warn">sin POS en el DW</Pill> : <Pill tono="warn">sin sync del DW</Pill>}</td></tr>); })}</tbody></table>
      </div>
      <Nota>Oak-Crew pedía una API key de Toteat por tienda para traer ventas y nunca quedó conectada (ingresos $0). Acá el camino es el inverso: el costo laboral se exporta a BigQuery (<b>rrhh_manelfoods.costo_diario_tienda</b>) y el P&L diario se arma en el DW con ventas, COGS y el resto.</Nota>
    </>
  );
}
