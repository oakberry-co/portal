import { HOY, quincenaDe, tienda, TIENDAS, solicitudesDe, fechaLarga, cargarEmpleados } from "../_lib/datos";
import { periodo } from "../_lib/calc";
import { TIPOS, reglasEn, hh, totalTrabajadas } from "../_lib/motor";
import { Head, Kpi, Sel, Btn, Nota } from "../_lib/ui";

// REPORTES: horas por tipo, por tienda y por empleado. Mismo motor que Costos.
export default async function Reportes() {
  const EMPLEADOS = await cargarEmpleados();
  const SOLICITUDES = solicitudesDe(EMPLEADOS);
  const q = quincenaDe(HOY);
  const P = periodo(EMPLEADOS, q.desde, q.hasta);
  const r = reglasEn(q.hasta);
  const trab = totalTrabajadas(P.horas);
  return (
    <>
      <Head titulo="Reportes" sub={<>Horas por tipo · {fechaLarga(q.desde)} — {fechaLarga(q.hasta)}</>} acts={<><Btn ghost>Excel</Btn><Btn ghost>PDF</Btn></>} />
      <div className="nm-filtros"><Sel opts={["Quincenal", "Por semana", "Por mes", "Fechas específicas"]} /><Sel opts={["Todas las tiendas", ...TIENDAS.filter((t) => t.activa).map((t) => t.nombre)]} /><Sel opts={["Todos los empleados"]} /><Sel opts={["Planeado + real", "Solo real (marcado)", "Solo planeado"]} /></div>
      <div className="nm-kpis">
        <Kpi label="Turnos" valor={P.tot.nTurnos} sub={`${hh(trab)} trabajadas`} />
        <Kpi label="Descansos" valor={P.horas.descanso / 7} sub={`${hh(P.horas.descanso)} a tarifa base`} />
        <Kpi label="Empleados activos" valor={P.lineas.length} />
        <Kpi label="Ausencias en el período" valor={SOLICITUDES.filter((s) => s.estado === "aprobado" && s.hasta >= q.desde && s.desde <= q.hasta).length} sub="prorrateadas al período" />
      </div>
      <div className="nm-grid2">
        <div className="nm-card">
          <h3>Resumen por tipo de hora</h3>
          <table className="nm-tabla"><thead><tr><th>Tipo</th><th>Franja</th><th className="num">Recargo</th><th className="num">Horas</th></tr></thead>
            <tbody>{TIPOS.map((t) => (<tr key={t.id}><td className="nm-nombre">{t.label}</td><td className="nm-sub">{t.desc}</td><td className="num">{t.id === "descanso" || t.id === "ausencia" ? "base" : `+${r.recargo[t.id]}%`}</td><td className="num"><b>{hh(P.horas[t.id])}</b></td></tr>))}
              <tr className="tot"><td colSpan={3}>Total</td><td className="num">{hh(trab + P.horas.descanso + P.horas.ausencia)}</td></tr></tbody></table>
        </div>
        <div className="nm-card">
          <h3>Turnos y horas por tienda</h3>
          <table className="nm-tabla"><thead><tr><th>Tienda</th><th className="num">Personas</th><th className="num">Turnos</th><th className="num">Horas</th><th className="num">Noct.</th><th className="num">Dom/fest.</th></tr></thead>
            <tbody>{Object.entries(P.porTienda).sort((a, b) => b[1].total - a[1].total).map(([p, v]) => (<tr key={p}><td className="nm-nombre">{tienda(p)?.nombre}</td><td className="num">{v.n}</td><td className="num">{v.nTurnos}</td><td className="num">{hh(totalTrabajadas(v.horas))}</td><td className="num">{hh(v.horas.nocturna + v.horas.nocturna_dominical)}</td><td className="num">{hh(v.horas.dominical + v.horas.nocturna_dominical)}</td></tr>))}</tbody></table>
        </div>
      </div>
      <div className="nm-card nm-scroll">
        <h3>Horas por empleado</h3>
        <table className="nm-tabla"><thead><tr><th>Empleado</th><th>Tienda</th>{TIPOS.map((t) => <th key={t.id} className="num" title={t.label}>{t.label.split(" ")[0]}</th>)}<th className="num">Total</th></tr></thead>
          <tbody>{P.lineas.sort((a, b) => totalTrabajadas(b.horas) - totalTrabajadas(a.horas)).map((l) => (<tr key={l.e.activo_id}><td className="nm-nombre">{l.e.nombre_completo}</td><td className="nm-sub">{tienda(l.e.punto)?.nombre}</td>{TIPOS.map((t) => <td key={t.id} className="num">{l.horas[t.id] ? hh(l.horas[t.id]) : "—"}</td>)}<td className="num"><b>{hh(totalTrabajadas(l.horas))}</b></td></tr>))}</tbody></table>
      </div>
      <Nota>Ley 789/2002, 2101/2021 y 2466/2025. Máximo {r.jornadaSemanal} h/semana desde jul-2026. Nocturno {r.nocturnoDesde}:00–0{r.nocturnoHasta}:00. <b>Las mismas horas de esta pantalla son las de Costos, Nómina y Cumplimiento</b> (un solo motor).</Nota>
    </>
  );
}
