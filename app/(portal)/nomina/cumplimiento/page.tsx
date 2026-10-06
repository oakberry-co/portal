import { redirect } from "next/navigation";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { reglasEn, hh, totalTrabajadas, horasDe } from "@/lib/rrhh/motor";
import { fechaLarga, hoyBogota, mas, lunesDe } from "@/lib/rrhh/fechas";
import { Head, Kpi, Pill, Bar, Nota, Aviso, Filtros, A } from "../_lib/ui";
import { cargarPeriodo, conParams, origenDe, semanaDeUrl } from "../reportes/_periodo";

export const dynamic = "force-dynamic";

// CUMPLIMIENTO: jornada (42 h), exceso diario (9 h), descanso semanal.
// Alertas con umbral razonable: 39 h NO es "cerca del límite"; el aviso
// empieza sobre 41 h. Semana por `s` (lunes). Origen: plan para la semana en
// curso y las futuras (lo que se va a trabajar), real para las pasadas (lo
// que de verdad se trabajó), salvo que `o` diga otra cosa.
export default async function Cumplimiento({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  if (p.tipo === "colaborador") redirect("/nomina/mi-horario");
  const hoy = hoyBogota();
  const sem = semanaDeUrl(sp.s, hoy);
  const lun = sem.desde, dom = sem.hasta;
  const enCurso = lunesDe(hoy) <= lun;
  const origen = origenDe(sp.o, enCurso ? "plan" : "real");
  const tiendaId = p.tipo === "admin_punto" ? p.tiendaId : sp.t || undefined;
  const { P, TS, nombreTienda } = await cargarPeriodo(lun, dom, { tiendaId }, origen);
  const r = reglasEn(dom);
  const filas = P.lineas.filter((l) => l.turnos.length > 0 || l.alertas.length > 0).map((l) => {
    const mios = l.turnos;
    const prog = mios.filter((t) => t.tipo === "programado");
    const tot = totalTrabajadas(l.horas);
    const excesoDia = prog.filter((t) => totalTrabajadas(horasDe(t)) > 9).length;
    const noct = prog.filter((t) => (horasDe(t).nocturna + horasDe(t).nocturna_dominical) > 0).length;
    const domf = prog.filter((t) => (horasDe(t).dominical + horasDe(t).nocturna_dominical) > 0).length;
    const sinDescanso = !mios.some((t) => t.tipo === "descanso");
    const alertas: string[] = [];
    if (tot > r.jornadaSemanal) alertas.push(`Excede: ${hh(tot)} / ${r.jornadaSemanal}h`);
    else if (tot > r.jornadaSemanal - 1) alertas.push(`Al límite: ${hh(tot)} / ${r.jornadaSemanal}h`);
    if (excesoDia) alertas.push(`${excesoDia} día(s) > 9 h`);
    if (sinDescanso && prog.length >= 6) alertas.push("Sin día de descanso");
    if (prog.length < 3) alertas.push("Semana incompleta");
    if (l.alertas.length) alertas.push(`${l.alertas.length} día(s) sin marcación`);
    const estado: "bad" | "warn" | "ok" = tot > r.jornadaSemanal || excesoDia || (sinDescanso && prog.length >= 6) ? "bad" : alertas.length ? "warn" : "ok";
    return { l, tot, excesoDia, noct, domf, alertas, estado };
  }).sort((a, b) => b.tot - a.tot);
  const n = (k: string) => filas.filter((f) => f.estado === k).length;
  const nav = (s: string) => conParams("/nomina/cumplimiento", { s, t: p.tipo === "admin_punto" ? undefined : tiendaId, o: sp.o });
  const tiendasVisibles = TS.filter((t) => (t.activa || t.id === tiendaId) && (!tiendaId || t.id === tiendaId));
  return (
    <>
      <Head titulo="Cumplimiento legal" sub={<>Jornada máx. {r.jornadaSemanal} h/semana (Ley 2101) · semana {fechaLarga(lun)} — {fechaLarga(dom)} · <Pill tono={origen === "real" ? "info" : "gris"}>{origen === "real" ? "marcación aprobada" : "planeado"}</Pill></>}
        acts={<>
          <A className="btn ghost" href={nav(mas(lun, -7))}>‹ Anterior</A>
          <A className="btn ghost" href={nav(lunesDe(hoy))}>Esta semana</A>
          <A className="btn ghost" href={nav(mas(lun, 7))}>Siguiente ›</A>
        </>} />
      <Aviso sp={sp} />
      <Filtros>
        <input type="hidden" name="s" value={lun} />
        {p.tipo !== "admin_punto" && (
          <select name="t" defaultValue={tiendaId ?? ""}><option value="">Todas las tiendas</option>{TS.filter((t) => t.activa || t.id === tiendaId).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select>
        )}
        <select name="o" defaultValue={origen}><option value="plan">Planeado (turnos)</option><option value="real">Real (marcado)</option></select>
      </Filtros>
      <div className="nm-kpis">
        <Kpi label="Con turnos" valor={filas.length} />
        <Kpi label="En cumplimiento" valor={n("ok")} tono="ok" />
        <Kpi label="Con aviso" valor={n("warn")} tono="warn" sub="al límite, semana incompleta o sin marcar" />
        <Kpi label="Incumplen" valor={n("bad")} tono={n("bad") ? "bad" : "ok"} sub={`> ${r.jornadaSemanal} h, > 9 h/día o sin descanso`} />
      </div>
      <div className="nm-card nm-scroll">
        <h3>Detalle por empleado</h3>
        {filas.length === 0 ? <div className="nm-vacio">Nadie con turnos{origen === "real" ? " ni marcaciones" : ""} en esta semana.</div> : (
        <table className="nm-tabla"><thead><tr><th>Empleado</th><th>Tienda</th><th className="num">Horas / límite</th><th>Progreso</th><th className="num">&gt; 9 h/día</th><th className="num">Noct.</th><th className="num">Dom/fest.</th><th>Alertas</th></tr></thead>
          <tbody>{filas.map((f) => (<tr key={f.l.e.activo_id}><td className="nm-nombre">{f.l.e.nombre_completo}</td><td className="nm-sub">{nombreTienda(f.l.e.punto)}</td><td className="num">{hh(f.tot)} / {r.jornadaSemanal}h</td><td><Bar pct={f.tot / r.jornadaSemanal * 100} tono={f.estado} /></td><td className="num">{f.excesoDia || "—"}</td><td className="num">{f.noct || "—"}</td><td className="num">{f.domf || "—"}</td><td>{f.alertas.length ? f.alertas.map((a) => <Pill key={a} tono={f.estado === "bad" ? "bad" : "warn"}>{a}</Pill>) : <Pill tono="ok">ok</Pill>}</td></tr>))}</tbody></table>)}
      </div>
      <div className="nm-card">
        <h3>Por tienda</h3>
        <div className="nm-emp">{tiendasVisibles.map((t) => { const fs = filas.filter((f) => f.l.e.punto === t.id); const prom = fs.length ? fs.reduce((a, f) => a + f.tot, 0) / fs.length : 0; const bad = fs.filter((f) => f.estado === "bad").length; return (
          <div className="c" key={t.id}><b>{t.nombre} {bad ? <Pill tono="bad">{bad} incumple</Pill> : <Pill tono="ok">OK</Pill>}</b><div className="r"><span>Empleados</span><span>{fs.length}</span></div><div className="r"><span>Prom. horas/semana</span><span>{hh(+prom.toFixed(1))}</span></div><div className="r"><span>Cumplimiento</span><span>{fs.length ? Math.round((fs.length - bad) / fs.length * 100) : 100}%</span></div></div>); })}</div>
      </div>
      <Nota>Ley 2466/2025 (art. 162 CST): registro diario por trabajador con horas diurnas/nocturnas, y la carga de la prueba es del empleador. Este registro sale de la <b>marcación</b>, no del Excel. Se revisan también: descanso entre turnos, domingos al mes y personas con turnos sin contrato.</Nota>
    </>
  );
}
