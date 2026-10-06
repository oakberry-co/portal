import { empleados, marcaciones, solicitudes, tiendas, turnos, type TurnoDb } from "@/lib/rrhh/db";
import { periodo } from "@/lib/rrhh/calc";
import { saldoVacacionesDe } from "@/lib/rrhh/saldos";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { cop, esDominical, hh, hora, horasDe } from "@/lib/rrhh/motor";
import { DIAS, esFecha, fechaCorta, fechaLarga, hoyBogota, lunesDe, mas, quincenaDe } from "@/lib/rrhh/fechas";
import { Head, Kpi, Pill, Nota, Aviso, Filtros, Vacio, A } from "../_lib/ui";

// MI HORARIO: lo que ve el colaborador desde el celular — su semana publicada,
// su quincena (horas marcadas vs planeadas, recargos, saldo de vacaciones) y sus
// solicitudes. RRHH y el admin de punto pueden mirar la vista de cualquiera de
// su alcance con ?e= para ver exactamente lo que la persona ve.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  const hoy = hoyBogota();
  // quién se mira: el colaborador solo a sí mismo; los demás eligen dentro de su alcance
  const elegibles = p.tipo === "colaborador" ? [p.empleado] : await empleados(p.tipo === "admin_punto" ? { tiendaId: p.tiendaId } : {});
  const e = p.tipo === "colaborador" ? p.empleado : (elegibles.find((x) => String(x.activo_id) === sp.e) ?? p.empleado ?? elegibles[0] ?? null);
  if (!e) {
    return <><Head titulo="Mi horario" /><Aviso sp={sp} /><Vacio>No hay un empleado que mostrar.</Vacio></>;
  }
  // el colaborador solo ve lo publicado: un borrador puede cambiar y no es promesa
  const soloPublicados = p.tipo === "colaborador";
  const lun = lunesDe(esFecha(sp.s) ? sp.s : hoy), dom = mas(lun, 6);
  const dias = Array.from({ length: 7 }, (_, i) => mas(lun, i));
  const q = quincenaDe(hoy);
  const [TS, MS, TQ, MQ, TIENDAS, saldo, S] = await Promise.all([
    turnos(lun, dom, { empleadoId: e.activo_id, soloPublicados }),
    marcaciones(lun, dom, { empleadoId: e.activo_id }),
    turnos(q.desde, q.hasta, { empleadoId: e.activo_id, soloPublicados }),
    marcaciones(q.desde, q.hasta, { empleadoId: e.activo_id }),
    tiendas(),
    saldoVacacionesDe(e.activo_id),
    solicitudes({ empleadoId: e.activo_id }),
  ]);
  const alm = Object.fromEntries(TIENDAS.map((t) => [t.id, t.almuerzo_min]));
  const tiendaDe = (id: string) => TIENDAS.find((t) => t.id === id);
  // las dos cifras de la quincena salen del MISMO motor: real (marcación) y plan (turnos)
  const real = periodo([e], TQ, MQ, q.desde, q.hasta, "real", alm), plan = periodo([e], TQ, MQ, q.desde, q.hasta, "plan", alm);
  const lr = real.lineas[0];
  // solo alertan los días ya pasados: hoy todavía puede marcar y el futuro aún no toca
  const alertas = lr.alertas.filter((a) => a.slice(0, 10) < hoy);
  const pctHoras = plan.trabajadas ? Math.round((real.trabajadas / plan.trabajadas) * 100) : 0;
  const pend = S.filter((s) => s.estado === "pendiente").length;
  const qsE = p.tipo === "colaborador" ? "" : `&e=${e.activo_id}`;
  const nav = (s: string) => `/nomina/mi-horario?s=${s}${qsE}`;
  const tono = (x: string) => (x === "aprobado" ? "ok" : x === "rechazado" ? "bad" : "warn");

  const chip = (t: TurnoDb) => {
    if (t.tipo === "descanso") return <span className={"nm-chip desc" + (t.estado === "borrador" ? " borrador" : "")}>😴 Descanso</span>;
    if (t.tipo === "ausencia") return <span className={"nm-chip aus" + (t.estado === "borrador" ? " borrador" : "")}>Permiso</span>;
    const h = horasDe(t); const cls = esDominical(t.fecha) ? "f" : h.nocturna > 0 || h.nocturna_dominical > 0 ? "n" : "d";
    return <span className={"nm-chip " + cls + (t.estado === "borrador" ? " borrador" : "")}>{hora(t.inicio)} – {hora(t.fin)}</span>;
  };

  return (
    <>
      <Head titulo={p.tipo === "colaborador" ? "Mi horario" : `Horario de ${e.nombre_completo.split(" ").slice(0, 2).join(" ")}`}
        sub={<>{e.nombre_completo} · {tiendaDe(e.punto)?.nombre ?? e.punto} · {e.cargo.toLowerCase()}</>}
        acts={<><A href="/nomina/marcar" className="btn">🤳 Marcar</A><A href="/nomina/solicitudes" className="btn ghost">Pedir permiso</A></>} />
      <Aviso sp={sp} />
      {!e.consentimiento_firmado_en && <div className="nm-aviso err">Falta el consentimiento de datos e imagen firmado: sin él no se puede marcar. Pídelo a RRHH.</div>}
      {p.tipo !== "colaborador" && (
        <Filtros>
          <select name="e" defaultValue={String(e.activo_id)}>{elegibles.map((x) => <option key={x.activo_id} value={x.activo_id}>{x.nombre_completo}{p.tipo === "rrhh" ? ` · ${tiendaDe(x.punto)?.nombre ?? x.punto}` : ""}</option>)}</select>
          <input type="hidden" name="s" value={lun} />
          <span className="sep" />
          <Pill tono="info">viendo lo que ve la persona{soloPublicados ? "" : " (incluye borradores)"}</Pill>
        </Filtros>
      )}

      <div className="nm-card">
        <h3>Semana del {fechaLarga(lun)}<small>{fechaCorta(lun)} – {fechaCorta(dom)}</small></h3>
        <div className="nm-filtros">
          <A href={nav(mas(lun, -7))} className="btn ghost">‹ Anterior</A>
          <A href={nav(lunesDe(hoy))} className="btn ghost">Hoy</A>
          <A href={nav(mas(lun, 7))} className="btn ghost">Siguiente ›</A>
          <span className="sep" />
          <Pill tono="gris">{hh(TS.filter((t) => t.tipo === "programado").reduce((a, t) => a + Object.entries(horasDe(t)).filter(([k]) => k !== "descanso" && k !== "ausencia").reduce((s, [, v]) => s + v, 0), 0))} planeadas</Pill>
        </div>
        <div className="nm-sem" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
          {dias.map((d, i) => <div key={d} className={"h" + (esDominical(d) ? " dom" : "")}>{DIAS[i]}<small>{fechaCorta(d)}{d === hoy ? " · hoy" : ""}</small></div>)}
          {dias.map((d) => {
            const t = TS.find((x) => x.fecha === d);
            const ms = MS.filter((m) => m.fecha === d && m.estado !== "rechazada");
            const ent = ms.find((m) => m.tipo === "entrada"), sal = [...ms].reverse().find((m) => m.tipo === "salida");
            return (
              <div key={d} className={"cel" + (esDominical(d) ? " dom" : "")} style={{ flexDirection: "column", alignItems: "stretch", gap: 3 }}>
                {t ? chip(t) : <span className="nm-chip add">{soloPublicados ? "sin publicar" : "—"}</span>}
                {(ent || sal) && <small className="nm-sub" style={{ textAlign: "center" }}>marcó {ent?.hhmm ?? "—"}{sal ? ` → ${sal.hhmm}` : ""}</small>}
              </div>
            );
          })}
        </div>
        <div className="nm-leyenda">
          <span><i style={{ background: "#e9f2ff" }} />Diurna</span><span><i style={{ background: "#ece6fa" }} />Nocturna</span>
          <span><i style={{ background: "#fde7e1" }} />Dominical/festivo</span><span><i style={{ background: "#fff6d6" }} />Descanso</span><span><i style={{ background: "#f6f1e4" }} />Permiso</span>
          {!soloPublicados && <span>punteado = borrador (la persona aún no lo ve)</span>}
        </div>
      </div>

      <div className="nm-card">
        <h3>Mi quincena<small>{fechaCorta(q.desde)} – {fechaCorta(q.hasta)}</small></h3>
        <div className="nm-kpis">
          <Kpi label="Horas marcadas" valor={hh(real.trabajadas)} sub={`de ${hh(plan.trabajadas)} planeadas (${pctHoras} %)`} tono={plan.trabajadas && pctHoras < 80 ? "warn" : "ok"} />
          <Kpi label="Recargos acumulados" valor={cop(lr.costo.recargos)} sub="nocturnos, dominicales y festivos" />
          <Kpi label="Turnos marcados" valor={lr.nTurnos} sub={`${plan.lineas[0].nTurnos} planeados`} />
          <Kpi label="Días sin marcar" valor={alertas.length} tono={alertas.length ? "bad" : "ok"} sub={alertas.length ? "no se pagan hasta aclararlos" : "todo al día"} />
          <Kpi label="Vacaciones disponibles" valor={saldo == null ? "—" : `${saldo} d`} sub={saldo == null ? "RRHH no ha cargado tu saldo" : "días hábiles"} tono={saldo != null && saldo < 0 ? "bad" : undefined} />
        </div>
        {alertas.length > 0 && (
          <div className="nm-nota" style={{ marginBottom: 12 }}>
            <b>Días con turno y sin marcación completa:</b> {alertas.map((a) => a.replace(": sin marcación", "").replace(": marcó sin turno", " (sin turno)")).join(" · ")}. Habla con tu administrador de punto para que la revise.
          </div>
        )}
        <p className="nm-sub">El básico de la quincena es el salario del contrato ÷ 2; las horas solo suman recargos y extras. Lo que se paga sale de la marcación aprobada, no del plan.</p>
      </div>

      <div className="nm-card nm-scroll">
        <h3>Mis solicitudes<small>{pend ? `${pend} pendiente${pend > 1 ? "s" : ""}` : "últimas 5"}</small></h3>
        {S.length === 0 ? <Vacio>Sin solicitudes todavía. <A href="/nomina/solicitudes">Pedir vacaciones o permiso</A>.</Vacio> : (
          <table className="nm-tabla">
            <thead><tr><th>Tipo</th><th>Fechas</th><th className="num">Días háb.</th><th>Estado</th></tr></thead>
            <tbody>{S.slice(0, 5).map((s) => (
              <tr key={s.id}><td className="nm-nombre">{s.tipo}</td><td className="mono">{s.desde} → {s.hasta}</td><td className="num">{s.dias_habiles}</td>
                <td><Pill tono={tono(s.estado)}>{s.estado}</Pill>{s.decision_nota && <div className="nm-sub">{s.decision_nota}</div>}</td></tr>
            ))}</tbody>
          </table>
        )}
        <div className="nm-acts" style={{ marginTop: 10 }}><A href="/nomina/solicitudes" className="btn ghost">Ver todas / pedir permiso</A><A href="/nomina/marcar" className="btn ghost">Ir a marcar</A></div>
      </div>
      <Nota>Ves tu horario, tus horas y lo que te van a pagar; <b>no</b> la nómina de los demás. Si un turno no aparece es porque tu administrador aún no publicó la semana.</Nota>
    </>
  );
}
