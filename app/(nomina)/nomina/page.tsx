import { redirect } from "next/navigation";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { empleados, tiendas, turnos, marcaciones, solicitudes } from "@/lib/rrhh/db";
import { hoyBogota, lunesDe, mas, DIAS, fechaCorta, fechaLarga } from "@/lib/rrhh/fechas";
import { esDominical, hora, horasDe } from "@/lib/rrhh/motor";
import { Head, Kpi, Aviso, A, Pill } from "./_lib/ui";

// DASHBOARD: la semana de todas las tiendas de un vistazo, y lo que hay que
// atender hoy (marcaciones fuera de radio, solicitudes, semanas sin planear).
export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  if (p.tipo === "colaborador") redirect("/nomina/mi-horario");
  const hoy = hoyBogota();
  const lun = sp.s && /^\d{4}-\d{2}-\d{2}$/.test(sp.s) ? lunesDe(sp.s) : lunesDe(hoy);
  const dom = mas(lun, 6);
  const dias = Array.from({ length: 7 }, (_, i) => mas(lun, i));
  const tId = p.tipo === "admin_punto" ? p.tiendaId : sp.t || undefined;
  const [TS, E, T, Mhoy, S] = await Promise.all([
    tiendas(), empleados(tId ? { tiendaId: tId } : {}), turnos(lun, dom, tId ? { tiendaId: tId } : {}),
    marcaciones(mas(hoy, -7), hoy, { ...(tId ? { tiendaId: tId } : {}), estado: "registrada" }), solicitudes({ estado: "pendiente", ...(tId ? { tiendaId: tId } : {}) }),
  ]);
  const activas = TS.filter((t) => t.activa && (!tId || t.id === tId));
  const prog = T.filter((t) => t.tipo === "programado");
  const sinPlan = activas.filter((t) => prog.filter((x) => x.tiendaId === t.id).length < 3);
  const borrador = T.filter((t) => t.estado === "borrador").length;
  const fueraRadio = Mhoy.filter((m) => !m.dentro).length;
  const chip = (t: (typeof T)[number]) => {
    if (t.tipo === "descanso") return <span className="nm-chip desc">😴 Descanso</span>;
    if (t.tipo === "ausencia") return <span className="nm-chip aus">Permiso</span>;
    const h = horasDe(t); const cls = esDominical(t.fecha) ? "f" : h.nocturna > 0 ? "n" : "d";
    return <span className={"nm-chip " + cls + (t.estado === "borrador" ? " borrador" : "")}>{hora(t.inicio)} – {hora(t.fin)}</span>;
  };
  const qs = (s: string) => `/nomina?s=${s}${tId ? "&t=" + encodeURIComponent(tId) : ""}`;
  return (
    <>
      <Head titulo="Dashboard" sub={<>{fechaLarga(lun)} — {fechaLarga(dom)}{p.tipo === "admin_punto" && <> · <b>{TS.find((t) => t.id === p.tiendaId)?.nombre}</b></>}</>}
        acts={<><A className="btn ghost" href={qs(mas(lun, -7))}>‹ Anterior</A><A className="btn ghost" href={qs(lunesDe(hoy))}>Hoy</A><A className="btn ghost" href={qs(mas(lun, 7))}>Siguiente ›</A></>} />
      <Aviso sp={sp} />
      <div className="nm-kpis">
        <Kpi label="Empleados activos" valor={E.filter((e) => TS.find((t) => t.id === e.punto)?.activa).length} />
        <Kpi label="Ubicaciones" valor={activas.length} />
        <Kpi label="Turnos esta semana" valor={prog.length} sub={borrador ? `${borrador} en borrador (sin publicar)` : "todos publicados"} tono={borrador ? "warn" : "ok"} />
        <Kpi label="Marcaciones por revisar" valor={fueraRadio} sub="fuera de radio, últimos 7 días" tono={fueraRadio ? "bad" : "ok"} />
        <Kpi label="Solicitudes pendientes" valor={S.length} tono={S.length ? "warn" : "ok"} />
        <Kpi label="Tiendas sin planear" valor={sinPlan.length} sub={sinPlan.map((t) => t.nombre).join(", ") || "todas planeadas"} tono={sinPlan.length ? "bad" : "ok"} />
      </div>
      {p.tipo === "rrhh" && (
        <form method="get" className="nm-filtros">
          <input type="hidden" name="s" value={lun} />
          <select name="t" defaultValue={tId ?? ""}><option value="">Todas las ubicaciones</option>{TS.filter((t) => t.activa).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select>
          <button type="submit" className="ghost">Aplicar</button>
        </form>
      )}
      <div className="nm-leyenda">
        <span><i style={{ background: "#e9f2ff" }} />Diurna</span><span><i style={{ background: "#ece6fa" }} />Nocturna</span>
        <span><i style={{ background: "#fde7e1" }} />Dominical/festivo</span><span><i style={{ background: "#fff6d6" }} />Descanso</span><span><i style={{ background: "#f6f1e4" }} />Permiso</span><span><i style={{ border: "1px dashed var(--purple)", background: "#fff" }} />Borrador</span>
      </div>
      {activas.map((t) => {
        const emps = E.filter((e) => e.punto === t.id);
        return (
          <div className="nm-card" key={t.id}>
            <h3>{t.nombre}<small>{t.direccion}, {t.ciudad}</small>{sinPlan.includes(t) && <Pill tono="bad">semana sin planear</Pill>} <A href={`/nomina/planificacion?t=${encodeURIComponent(t.id)}&s=${lun}`} className="nm-sub">planificar →</A></h3>
            <div className="nm-sem">
              <div className="h" style={{ alignItems: "flex-start" }}>Empleado</div>
              {dias.map((d, i) => <div key={d} className={"h" + (esDominical(d) ? " dom" : "")}>{DIAS[i]}<small>{fechaCorta(d)}</small></div>)}
              {emps.map((e) => (
                <Fila key={e.activo_id} nombre={e.nombre_completo} cargo={e.cargo}>
                  {dias.map((d) => { const t2 = T.find((x) => x.empleadoId === e.activo_id && x.fecha === d); return <div key={d} className={esDominical(d) ? "dom" : ""}>{t2 ? chip(t2) : <span className="nm-chip add">—</span>}</div>; })}
                </Fila>
              ))}
              {!emps.length && <div style={{ gridColumn: "1 / -1" }} className="nm-sub">Sin personal asignado en el maestro.</div>}
            </div>
          </div>
        );
      })}
    </>
  );
}
function Fila({ nombre, cargo, children }: { nombre: string; cargo: string; children: React.ReactNode }) {
  return <><div className="e"><b>{nombre}</b><small>{cargo}</small></div>{children}</>;
}
