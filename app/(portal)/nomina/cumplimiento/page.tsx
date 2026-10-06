import { HOY, lunesDe, mas, fechaLarga, tienda, TIENDAS, cargarEmpleados } from "../_lib/datos";
import { periodo } from "../_lib/calc";
import { reglasEn, hh, totalTrabajadas, horasDe } from "../_lib/motor";
import { Head, Kpi, Btn, Pill, Bar, Nota } from "../_lib/ui";

// CUMPLIMIENTO: jornada (42 h), exceso diario (9 h), descanso semanal,
// domingos seguidos. Alertas con umbral razonable: 39 h NO es "cerca del límite".
export default async function Cumplimiento() {
  const EMPLEADOS = await cargarEmpleados();
  const lun = lunesDe(HOY), dom = mas(lun, 6);
  const P = periodo(EMPLEADOS, lun, dom);
  const r = reglasEn(dom);
  const filas = P.lineas.map((l) => {
    const mios = P.turnos.filter((t) => t.empleadoId === l.e.activo_id);
    const tot = totalTrabajadas(l.horas);
    const excesoDia = mios.filter((t) => t.tipo === "programado" && totalTrabajadas(horasDe(t)) > 9).length;
    const noct = mios.filter((t) => t.tipo === "programado" && (horasDe(t).nocturna + horasDe(t).nocturna_dominical) > 0).length;
    const domf = mios.filter((t) => t.tipo === "programado" && (horasDe(t).dominical + horasDe(t).nocturna_dominical) > 0).length;
    const sinDescanso = !mios.some((t) => t.tipo === "descanso");
    const alertas: string[] = [];
    if (tot > r.jornadaSemanal) alertas.push(`Excede: ${hh(tot)} / ${r.jornadaSemanal}h`);
    else if (tot > r.jornadaSemanal - 1) alertas.push(`Al límite: ${hh(tot)} / ${r.jornadaSemanal}h`);
    if (excesoDia) alertas.push(`${excesoDia} día(s) > 9 h`);
    if (sinDescanso && mios.length >= 6) alertas.push("Sin día de descanso");
    if (mios.length < 3) alertas.push("Semana incompleta");
    return { l, tot, excesoDia, noct, domf, alertas, estado: tot > r.jornadaSemanal || excesoDia || (sinDescanso && mios.length >= 6) ? "bad" : alertas.length ? "warn" : "ok" };
  }).sort((a, b) => b.tot - a.tot);
  const n = (k: string) => filas.filter((f) => f.estado === k).length;
  return (
    <>
      <Head titulo="Cumplimiento legal" sub={<>Jornada máx. {r.jornadaSemanal} h/semana (Ley 2101) · semana {fechaLarga(lun)} — {fechaLarga(dom)}</>} acts={<><Btn ghost>‹ Anterior</Btn><Btn ghost>Esta semana</Btn><Btn ghost>Siguiente ›</Btn></>} />
      <div className="nm-kpis">
        <Kpi label="Con turnos" valor={filas.length} />
        <Kpi label="En cumplimiento" valor={n("ok")} tono="ok" />
        <Kpi label="Con aviso" valor={n("warn")} tono="warn" sub="al límite o semana incompleta" />
        <Kpi label="Incumplen" valor={n("bad")} tono={n("bad") ? "bad" : "ok"} sub="> 42 h, > 9 h/día o sin descanso" />
      </div>
      <div className="nm-card nm-scroll">
        <h3>Detalle por empleado</h3>
        <table className="nm-tabla"><thead><tr><th>Empleado</th><th>Tienda</th><th className="num">Horas / límite</th><th>Progreso</th><th className="num">&gt; 9 h/día</th><th className="num">Noct.</th><th className="num">Dom/fest.</th><th>Alertas</th></tr></thead>
          <tbody>{filas.map((f) => (<tr key={f.l.e.activo_id}><td className="nm-nombre">{f.l.e.nombre_completo}</td><td className="nm-sub">{tienda(f.l.e.punto)?.nombre}</td><td className="num">{hh(f.tot)} / {r.jornadaSemanal}h</td><td><Bar pct={f.tot / r.jornadaSemanal * 100} tono={f.estado === "ok" ? "ok" : f.estado === "warn" ? "warn" : "bad"} /></td><td className="num">{f.excesoDia || "—"}</td><td className="num">{f.noct || "—"}</td><td className="num">{f.domf || "—"}</td><td>{f.alertas.length ? f.alertas.map((a) => <Pill key={a} tono={f.estado === "bad" ? "bad" : "warn"}>{a}</Pill>) : <Pill tono="ok">ok</Pill>}</td></tr>))}</tbody></table>
      </div>
      <div className="nm-card">
        <h3>Por tienda</h3>
        <div className="nm-emp">{TIENDAS.filter((t) => t.activa).map((t) => { const fs = filas.filter((f) => f.l.e.punto === t.id); const prom = fs.length ? fs.reduce((a, f) => a + f.tot, 0) / fs.length : 0; const bad = fs.filter((f) => f.estado === "bad").length; return (
          <div className="c" key={t.id}><b>{t.nombre} {bad ? <Pill tono="bad">{bad} incumple</Pill> : <Pill tono="ok">OK</Pill>}</b><div className="r"><span>Empleados</span><span>{fs.length}</span></div><div className="r"><span>Prom. horas/semana</span><span>{hh(+prom.toFixed(1))}</span></div><div className="r"><span>Cumplimiento</span><span>{fs.length ? Math.round((fs.length - bad) / fs.length * 100) : 100}%</span></div></div>); })}</div>
      </div>
      <Nota>Ley 2466/2025 (art. 162 CST): registro diario por trabajador con horas diurnas/nocturnas, y la carga de la prueba es del empleador. Este registro sale de la <b>marcación</b>, no del Excel. Se revisan también: descanso entre turnos, domingos al mes y personas con turnos sin contrato.</Nota>
    </>
  );
}
