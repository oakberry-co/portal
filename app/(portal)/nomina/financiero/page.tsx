import { HOY, mesDe, mas, quincenaDe, tienda, VENTAS_Q_SEP, TIENDAS, MESES, cargarEmpleados } from "../_lib/datos";
import { periodo } from "../_lib/calc";
import { mm, cop, hh, totalTrabajadas } from "../_lib/motor";
import { Head, Kpi, Sel, Pill, Nota, Tabs } from "../_lib/ui";

// DASHBOARD FINANCIERO: costo laboral vs VENTAS (del DW, no de llaves Toteat
// en la app). Es la pieza del P&L diario que Oak-Crew nunca llenó.
export default async function Financiero() {
  const EMPLEADOS = await cargarEmpleados();
  const q = { desde: "2026-09-16", hasta: "2026-09-30" };           // última quincena cerrada con ventas
  const P = periodo(EMPLEADOS, q.desde, q.hasta);
  const m = mesDe(HOY); const M = periodo(EMPLEADOS, m.desde, m.hasta);
  const q1 = quincenaDe(HOY); const Q1 = periodo(EMPLEADOS, q1.desde, q1.hasta);
  const ventas = Object.values(VENTAS_Q_SEP).reduce((a, b) => a + b, 0);
  const pct = P.tot.total / ventas * 100;
  const filas = Object.entries(P.porTienda).map(([p, v]) => ({ p, costo: v.total, venta: VENTAS_Q_SEP[p] ?? 0, horas: totalTrabajadas(v.horas), n: v.n })).sort((a, b) => b.venta - a.venta);
  const tono = (x: number) => (x <= 18 ? "ok" : x <= 25 ? "warn" : "bad");
  return (
    <>
      <Head titulo="Dashboard financiero" sub={<>Costo laboral contra ventas sin IVA · quincena <b>16–30 sep 2026</b> (última cerrada con ventas en el DW)</>} />
      <Tabs items={[{ href: "/nomina/financiero", label: "Resumen" }, { href: "/nomina/financiero#tienda", label: "Por tienda" }, { href: "/nomina/financiero#proy", label: "Proyección" }, { href: "/nomina/financiero#prov", label: "Provisiones" }]} actual="/nomina/financiero" />
      <div className="nm-filtros"><Sel opts={["Quincena 16-30 sep", "Mes octubre (en curso)"]} /><Sel opts={["Todas las tiendas", ...TIENDAS.filter((t) => t.activa).map((t) => t.nombre)]} /></div>
      <div className="nm-kpis">
        <Kpi label="Ventas sin IVA" valor={mm(ventas)} sub="analytics.ventas_diarias (DW)" />
        <Kpi label="Costo laboral" valor={mm(P.tot.total)} sub="salarios + transporte + carga" />
        <Kpi label="% costo / venta" valor={pct.toFixed(1) + "%"} sub="meta ≤ 18 %" tono={tono(pct)} />
        <Kpi label="Venta por hora-persona" valor={cop(Math.round(ventas / totalTrabajadas(P.horas)))} sub={`${hh(totalTrabajadas(P.horas))} trabajadas`} />
        <Kpi label="Costo mes en curso" valor={mm(M.tot.total)} sub={`1ª quincena ${mm(Q1.tot.total)} · octubre`} />
      </div>
      <div className="nm-card nm-scroll" id="tienda">
        <h3>Por tienda <small>costo laboral vs venta</small></h3>
        <table className="nm-tabla"><thead><tr><th>Tienda</th><th className="num">Personas</th><th className="num">Horas</th><th className="num">Venta</th><th className="num">Costo laboral</th><th className="num">% costo/venta</th><th className="num">Venta / h-persona</th><th>Semáforo</th></tr></thead>
          <tbody>{filas.map((f) => { const p = f.venta ? f.costo / f.venta * 100 : null; return (
            <tr key={f.p}><td className="nm-nombre">{tienda(f.p)?.nombre}</td><td className="num">{f.n}</td><td className="num">{hh(f.horas)}</td><td className="num">{mm(f.venta)}</td><td className="num">{mm(f.costo)}</td><td className="num"><b>{p == null ? "—" : p.toFixed(1) + "%"}</b></td><td className="num">{f.venta && f.horas ? cop(Math.round(f.venta / f.horas)) : "—"}</td><td>{p == null ? <Pill tono="gris">sin venta</Pill> : <Pill tono={tono(p)}>{tono(p) === "ok" ? "sano" : tono(p) === "warn" ? "vigilar" : "pierde"}</Pill>}</td></tr>); })}
            <tr className="tot"><td>Total</td><td className="num">{P.lineas.length}</td><td className="num">{hh(totalTrabajadas(P.horas))}</td><td className="num">{mm(ventas)}</td><td className="num">{mm(P.tot.total)}</td><td className="num">{pct.toFixed(1)}%</td><td className="num">{cop(Math.round(ventas / totalTrabajadas(P.horas)))}</td><td /></tr></tbody></table>
        <div className="nm-sub" style={{ marginTop: 8 }}>Regla de la casa: bajo ~35 MM/mes de venta la tienda pierde plata; el % de personal es el primer dial.</div>
      </div>
      <div className="nm-grid2">
        <div className="nm-card" id="proy">
          <h3>Proyección {MESES[Number(HOY.slice(5, 7)) - 1]} <small>desde los turnos publicados</small></h3>
          <table className="nm-tabla"><tbody>
            <tr><td className="nm-nombre">Costo planeado del mes</td><td className="num"><b>{mm(M.tot.total)}</b></td></tr>
            <tr><td className="nm-nombre">Ejecutado (marcado y aprobado, al {HOY.slice(8)} del mes)</td><td className="num">{mm(periodo(EMPLEADOS, m.desde, mas(HOY, -1)).tot.total)}</td></tr>
            <tr><td className="nm-nombre">Forecast de venta del mes (DW)</td><td className="num">{mm(ventas * 2.05)}</td></tr>
            <tr className="tot"><td>% costo / venta proyectado</td><td className="num">{(M.tot.total / (ventas * 2.05) * 100).toFixed(1)}%</td></tr>
          </tbody></table>
        </div>
        <div className="nm-card" id="prov">
          <h3>Provisiones <small>acumulado del año</small></h3>
          <table className="nm-tabla"><tbody>
            <tr><td className="nm-nombre">Prima (semestre jul–dic)</td><td className="num">{mm(P.tot.prima * 6)}</td></tr>
            <tr><td className="nm-nombre">Cesantías (ene–dic)</td><td className="num">{mm(P.tot.cesantias * 18)}</td></tr>
            <tr><td className="nm-nombre">Intereses de cesantías (12 % anual, prorrateado)</td><td className="num">{mm(P.tot.cesantias * 18 * 0.12 * 9 / 12)}</td></tr>
            <tr><td className="nm-nombre">Vacaciones</td><td className="num">{mm(P.tot.vacaciones * 18)}</td></tr>
          </tbody></table>
          <div className="nm-sub" style={{ marginTop: 8 }}>Oak-Crew calculaba los intereses como 1 % de las cesantías (≈10× bajo) y no reiniciaba las cesantías por año.</div>
        </div>
      </div>
      <Nota>Las ventas entran del DW (vista <b>analytics.ventas_diarias</b>, sin IVA, por tienda y día). No se guardan llaves de Toteat en esta app. El P&L diario se arma en BigQuery: este costo laboral + ventas + COGS + resto.</Nota>
    </>
  );
}
