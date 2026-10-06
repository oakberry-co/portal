import { redirect } from "next/navigation";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { solicitudes } from "@/lib/rrhh/db";
import { TIPOS, reglasEn, hh, totalTrabajadas } from "@/lib/rrhh/motor";
import { fechaLarga, hoyBogota, quincenaDe, lunesDe } from "@/lib/rrhh/fechas";
import { Head, Kpi, Nota, Aviso, Filtros, Pill, A } from "../_lib/ui";
import { cargarPeriodo, origenDe, rangoDeUrl, conParams, quincenasRecientes } from "./_periodo";

export const dynamic = "force-dynamic";

// REPORTES: horas por tipo, por tienda y por empleado. Mismo motor que Costos,
// Nómina y Cumplimiento: estas horas son las que se pagan.
//
// Período por GET: per = quincena (q) | semana (s) | mes (m) | rango (desde/hasta).
// Origen: real (marcación aprobada, el default) o plan (turnos).
export default async function Reportes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  if (p.tipo === "colaborador") redirect("/nomina/mi-horario");
  const hoy = hoyBogota();
  // El administrador de punto solo ve su tienda: se fuerza el filtro y no hay selector.
  const tiendaId = p.tipo === "admin_punto" ? p.tiendaId : sp.t || undefined;
  const empleadoId = sp.e && /^\d+$/.test(sp.e) ? Number(sp.e) : undefined;
  const origen = origenDe(sp.o);
  const { per, desde, hasta } = rangoDeUrl(sp, hoy);
  const { P, E, TS, nombreTienda } = await cargarPeriodo(desde, hasta, { tiendaId, empleadoId }, origen);
  const aus = (await solicitudes({ estado: "aprobado", desde, hasta, tiendaId })).filter((s) => !empleadoId || s.empleado_id === empleadoId);
  const r = reglasEn(hasta);
  const trab = totalTrabajadas(P.horas);
  const qHoy = quincenaDe(hoy);
  const params = { per, q: sp.q, s: sp.s, m: sp.m, desde: sp.desde, hasta: sp.hasta, t: p.tipo === "admin_punto" ? undefined : tiendaId, e: empleadoId, o: origen };
  const lineas = [...P.lineas].sort((a, b) => totalTrabajadas(b.horas) - totalTrabajadas(a.horas));
  return (
    <>
      <Head titulo="Reportes" sub={<>Horas por tipo · {fechaLarga(desde)} — {fechaLarga(hasta)} · <Pill tono={origen === "real" ? "info" : "gris"}>{origen === "real" ? "marcación aprobada" : "planeado"}</Pill></>}
        acts={<>
          <A className="btn ghost" href={conParams("/nomina/reportes/export", params)}>Excel</A>
          <button type="button" className="ghost" title="Todavía no hace nada">PDF</button>
        </>} />
      <Aviso sp={sp} />
      <Filtros>
        <select name="per" defaultValue={per}>
          <option value="quincena">Quincenal</option><option value="semana">Por semana</option><option value="mes">Por mes</option><option value="rango">Fechas específicas</option>
        </select>
        {per === "quincena" && <select name="q" defaultValue={desde}>{quincenasRecientes(hoy).map((q) => <option key={q.desde} value={q.desde}>{q.desde === qHoy.desde ? "En curso · " : ""}{fechaLarga(q.desde)} – {Number(q.hasta.slice(8))}</option>)}</select>}
        {per === "semana" && <input type="date" name="s" defaultValue={lunesDe(desde)} title="Lunes de la semana" />}
        {per === "mes" && <input type="month" name="m" defaultValue={desde.slice(0, 7)} />}
        {per === "rango" && <><input type="date" name="desde" defaultValue={desde} /><input type="date" name="hasta" defaultValue={hasta} /></>}
        {p.tipo !== "admin_punto" && (
          <select name="t" defaultValue={tiendaId ?? ""}><option value="">Todas las tiendas</option>{TS.filter((t) => t.activa || t.id === tiendaId).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select>
        )}
        <select name="e" defaultValue={empleadoId ?? ""}><option value="">Todos los empleados</option>{E.map((e) => <option key={e.activo_id} value={e.activo_id}>{e.nombre_completo}</option>)}</select>
        <select name="o" defaultValue={origen}><option value="real">Solo real (marcado)</option><option value="plan">Solo planeado</option></select>
      </Filtros>
      <div className="nm-kpis">
        <Kpi label="Turnos" valor={P.tot.nTurnos} sub={`${hh(trab)} trabajadas`} />
        <Kpi label="Descansos" valor={Math.round(P.horas.descanso / 7)} sub={`${hh(P.horas.descanso)} a tarifa base`} />
        <Kpi label="Empleados" valor={P.lineas.length} sub={tiendaId ? nombreTienda(tiendaId) : "todas las tiendas"} />
        <Kpi label="Ausencias en el período" valor={aus.length} sub="solicitudes aprobadas que tocan el período" />
        <Kpi label="Días sin marcación" valor={P.tot.alertas} tono={P.tot.alertas ? "warn" : "ok"} sub={origen === "real" ? "turno programado sin marcar: no se paga" : "solo aplica al origen real"} />
      </div>
      <div className="nm-grid2">
        <div className="nm-card">
          <h3>Resumen por tipo de hora</h3>
          <table className="nm-tabla"><thead><tr><th>Tipo</th><th>Franja</th><th className="num">Recargo</th><th className="num">Horas</th></tr></thead>
            <tbody>{TIPOS.map((t) => (<tr key={t.id}><td className="nm-nombre">{t.label}</td><td className="nm-sub">{t.desc}</td><td className="num">{t.id === "descanso" || t.id === "ausencia" ? "base" : `+${r.recargo[t.id]}%`}</td><td className="num"><b>{hh(P.horas[t.id])}</b></td></tr>))}
              <tr className="tot"><td colSpan={3}>Total</td><td className="num">{hh(+(trab + P.horas.descanso + P.horas.ausencia).toFixed(2))}</td></tr></tbody></table>
        </div>
        <div className="nm-card">
          <h3>Turnos y horas por tienda</h3>
          {Object.keys(P.porTienda).length === 0 ? <div className="nm-vacio">Sin empleados en el período.</div> : (
          <table className="nm-tabla"><thead><tr><th>Tienda</th><th className="num">Personas</th><th className="num">Turnos</th><th className="num">Horas</th><th className="num">Noct.</th><th className="num">Dom/fest.</th><th className="num">Alertas</th></tr></thead>
            <tbody>{Object.entries(P.porTienda).sort((a, b) => b[1].total - a[1].total).map(([id, v]) => (<tr key={id}><td className="nm-nombre">{nombreTienda(id)}</td><td className="num">{v.n}</td><td className="num">{v.nTurnos}</td><td className="num">{hh(totalTrabajadas(v.horas))}</td><td className="num">{hh(v.horas.nocturna + v.horas.nocturna_dominical)}</td><td className="num">{hh(v.horas.dominical + v.horas.nocturna_dominical)}</td><td className="num">{v.alertas ? <Pill tono="warn">{v.alertas}</Pill> : "—"}</td></tr>))}</tbody></table>)}
        </div>
      </div>
      <div className="nm-card nm-scroll">
        <h3>Horas por empleado</h3>
        {lineas.length === 0 ? <div className="nm-vacio">No hay empleados con ese filtro.</div> : (
        <table className="nm-tabla"><thead><tr><th>Empleado</th><th>Tienda</th>{TIPOS.map((t) => <th key={t.id} className="num" title={t.label}>{t.label.split(" ")[0]}</th>)}<th className="num">Total</th><th>Alertas</th></tr></thead>
          <tbody>{lineas.map((l) => (<tr key={l.e.activo_id}><td className="nm-nombre">{l.e.nombre_completo}</td><td className="nm-sub">{nombreTienda(l.e.punto)}</td>{TIPOS.map((t) => <td key={t.id} className="num">{l.horas[t.id] ? hh(l.horas[t.id]) : "—"}</td>)}<td className="num"><b>{hh(totalTrabajadas(l.horas))}</b></td>
            <td>{l.alertas.length ? <Pill tono="warn">{l.alertas.length} sin marcación</Pill> : <Pill tono="ok">ok</Pill>}{l.alertas.length > 0 && <div className="nm-sub" title={l.alertas.join(", ")}>{l.alertas.slice(0, 3).map((a) => a.slice(5, 10)).join(" · ")}{l.alertas.length > 3 ? " …" : ""}</div>}</td></tr>))}</tbody></table>)}
      </div>
      <Nota>Ley 789/2002, 2101/2021 y 2466/2025. Máximo {r.jornadaSemanal} h/semana desde jul-2026. Nocturno {r.nocturnoDesde}:00–0{r.nocturnoHasta}:00. <b>Las mismas horas de esta pantalla son las de Costos, Nómina y Cumplimiento</b> (un solo motor). Un turno programado sin marcación aprobada no suma horas: aparece como alerta.</Nota>
    </>
  );
}
