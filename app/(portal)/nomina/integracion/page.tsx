import { TIENDAS, VENTAS_Q_SEP } from "../_lib/datos";
import { mm } from "../_lib/motor";
import { Head, Pill, Nota, Btn } from "../_lib/ui";

// VENTAS: vienen del DW (BigQuery), no de llaves Toteat guardadas en la app.
export default function Integracion() {
  return (
    <>
      <Head titulo="Ventas (DW)" sub="De dónde salen las ventas que cruzan con el costo laboral. Sin API keys de Toteat en esta app." acts={<Btn ghost>Ver última sincronización</Btn>} />
      <div className="nm-card">
        <table className="nm-tabla"><thead><tr><th>Tienda</th><th>store_key (DW)</th><th>Fuente</th><th className="num">Venta 16–30 sep (sin IVA)</th><th>Estado</th></tr></thead>
          <tbody>{TIENDAS.map((t) => <tr key={t.id}><td className="nm-nombre">{t.nombre}</td><td className="mono nm-sub">BOG_TP_… · staging.store_master</td><td className="nm-sub">analytics.ventas_diarias (Toteat, hora Bogotá)</td><td className="num">{VENTAS_Q_SEP[t.id] ? mm(VENTAS_Q_SEP[t.id]) : "—"}</td><td>{!t.activa ? <Pill tono="gris">cerrada</Pill> : VENTAS_Q_SEP[t.id] ? <Pill tono="ok">sincronizada</Pill> : <Pill tono="warn">sin POS en el DW</Pill>}</td></tr>)}</tbody></table>
      </div>
      <Nota>Oak-Crew pedía una API key de Toteat por tienda para traer ventas y nunca quedó conectada (ingresos $0). Acá el camino es el inverso: el costo laboral se exporta a BigQuery (<b>rrhh_manelfoods.costo_diario_tienda</b>) y el P&L diario se arma en el DW con ventas, COGS y el resto.</Nota>
    </>
  );
}
