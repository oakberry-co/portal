import { redirect } from "next/navigation";
import { perspectiva, puedePlanificar } from "@/lib/rrhh/perspectiva";
import { empleados, tiendas, turnos } from "@/lib/rrhh/db";
import { guardarTurno, borrarTurno, copiarSemanaAnterior, publicarSemana, guardarAlmuerzo } from "@/lib/rrhh/actions";
import { hoyBogota, lunesDe, mas, DIAS, fechaCorta, fechaLarga, hm } from "@/lib/rrhh/fechas";
import { esDominical, hora, horasDe, sumar, horasVacias, totalTrabajadas, reglasEn, hh } from "@/lib/rrhh/motor";
import { Head, Aviso, A, Pill, Nota } from "../_lib/ui";

// PLANIFICACIÓN: la grilla semanal por tienda. La carga el administrador de
// punto (responsable). Clic en una celda vacía = nuevo turno; clic en un chip =
// editarlo. El formulario vive en la misma página (sin JS): ?f=FECHA&e=ID.
export default async function Planificacion({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  if (p.tipo === "colaborador") redirect("/nomina/mi-horario");
  const TS = await tiendas();
  const tId = p.tipo === "admin_punto" ? p.tiendaId : (TS.find((x) => x.id === sp.t)?.id ?? TS.find((x) => x.activa)!.id);
  const t = TS.find((x) => x.id === tId)!;
  const hoy = hoyBogota();
  const lun = sp.s && /^\d{4}-\d{2}-\d{2}$/.test(sp.s) ? lunesDe(sp.s) : lunesDe(hoy);
  const dom = mas(lun, 6);
  const dias = Array.from({ length: 7 }, (_, i) => mas(lun, i));
  const [E, T] = await Promise.all([empleados({ tiendaId: tId }), turnos(lun, dom, { tiendaId: tId })]);
  const r = reglasEn(dom);
  const base = `/nomina/planificacion?t=${encodeURIComponent(tId)}&s=${lun}`;
  const semana = (s: string) => `/nomina/planificacion?t=${encodeURIComponent(tId)}&s=${s}`;
  const puede = puedePlanificar(p, tId);
  const fSel = sp.f && dias.includes(sp.f) ? sp.f : null;
  const eSel = E.find((x) => String(x.activo_id) === sp.e) ?? null;
  const tSel = fSel && eSel ? T.find((x) => x.empleadoId === eSel.activo_id && x.fecha === fSel) ?? null : null;
  const publicados = T.filter((x) => x.estado === "publicado").length;
  return (
    <>
      <Head titulo="Planificación" sub={<>Semana {fechaLarga(lun)} — {fechaLarga(dom)} · <b>{t.nombre}</b> · horario {hora(t.apertura)}–{hora(t.cierre)} · {publicados === T.length && T.length ? <Pill tono="ok">publicada</Pill> : <Pill tono="warn">{T.length - publicados} en borrador</Pill>}</>}
        acts={<><A className="btn ghost" href={semana(mas(lun, -7))}>‹ Anterior</A><A className="btn ghost" href={semana(lunesDe(hoy))}>Hoy</A><A className="btn ghost" href={semana(mas(lun, 7))}>Siguiente ›</A>
          {puede && <form action={copiarSemanaAnterior}><input type="hidden" name="tienda_id" value={tId} /><input type="hidden" name="semana" value={lun} /><button type="submit" className="ghost">Copiar semana anterior</button></form>}
          {puede && <form action={publicarSemana}><input type="hidden" name="tienda_id" value={tId} /><input type="hidden" name="semana" value={lun} /><button type="submit">Publicar semana</button></form>}</>} />
      <Aviso sp={sp} />
      <div className="nm-filtros">
        {p.tipo === "rrhh" && (
          <form method="get" className="nm-inline"><input type="hidden" name="s" value={lun} /><label className="nm-sub">Tienda</label>
            <select name="t" defaultValue={tId}>{TS.filter((x) => x.activa).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select><button type="submit" className="ghost">Ir</button></form>
        )}
        {puede && (
          <form action={guardarAlmuerzo} className="nm-inline"><input type="hidden" name="tienda_id" value={tId} /><input type="hidden" name="volver" value={base} /><label className="nm-sub">Almuerzo</label>
            <input name="almuerzo_min" type="number" min={0} max={120} step={15} defaultValue={t.almuerzo_min} style={{ width: 64 }} /><span className="nm-sub">min (se descuenta del tramo diurno)</span><button type="submit" className="ghost">Guardar</button></form>
        )}
      </div>
      {(fSel && eSel && puede) && (
        <div className="nm-modal">
          <h3 style={{ margin: "0 0 10px" }}>{tSel ? "Editar turno" : "Nuevo turno"} · {eSel.nombre_completo} · {DIAS[dias.indexOf(fSel)]} {fechaCorta(fSel)} {esDominical(fSel) && <Pill tono="bad">dominical/festivo</Pill>}</h3>
          <form action={guardarTurno} className="nm-form">
            {tSel && <input type="hidden" name="id" value={tSel.id} />}
            <input type="hidden" name="empleado_id" value={eSel.activo_id} /><input type="hidden" name="tienda_id" value={tId} /><input type="hidden" name="fecha" value={fSel} /><input type="hidden" name="volver" value={`${base}&f=${fSel}&e=${eSel.activo_id}`} />
            <label>Tipo<select name="tipo" defaultValue={tSel?.tipo ?? "programado"}><option value="programado">Turno regular</option><option value="descanso">Día de descanso (7 h)</option></select></label>
            <label>Hora inicio<input name="inicio" type="time" step={1800} defaultValue={tSel && tSel.tipo === "programado" ? hm(tSel.inicio) : hm(Math.max(t.apertura, 9))} /></label>
            <label>Hora fin<input name="fin" type="time" step={1800} defaultValue={tSel && tSel.tipo === "programado" ? hm(tSel.fin) : hm(Math.min(t.cierre, 17))} /></label>
            <div className="nm-acts" style={{ alignSelf: "end" }}><button type="submit">Guardar</button><A className="btn ghost" href={base}>Cancelar</A></div>
          </form>
          {tSel && <form action={borrarTurno} style={{ marginTop: 8 }}><input type="hidden" name="id" value={tSel.id} /><input type="hidden" name="tienda_id" value={tId} /><input type="hidden" name="semana" value={lun} /><button type="submit" className="danger">Borrar turno</button></form>}
          <div className="nm-sub" style={{ marginTop: 8 }}>Se valida al guardar: dentro del horario de la tienda, ≤ 9 h/día, ≤ {r.jornadaSemanal} h/semana, sin solapes; avisa si queda al límite o con menos de 10 h de descanso.</div>
        </div>
      )}
      <div className="nm-card">
        <div className="nm-sem">
          <div className="h" style={{ alignItems: "flex-start" }}>Empleado · h/sem</div>
          {dias.map((d, i) => <div key={d} className={"h" + (esDominical(d) ? " dom" : "")}>{DIAS[i]}<small>{fechaCorta(d)}</small></div>)}
          {E.map((e) => {
            const mios = T.filter((x) => x.empleadoId === e.activo_id);
            const tot = totalTrabajadas(mios.reduce((a, x) => sumar(a, horasDe(x)), horasVacias()));
            const tono = tot > e.jornada_semanal ? "bad" : tot > e.jornada_semanal - 1 || mios.length < 3 ? "warn" : "ok";
            return (
              <Fila key={e.activo_id} nombre={e.nombre_completo} sub={<>{hh(tot)}/{e.jornada_semanal}h <Pill tono={tono}>{tot > e.jornada_semanal ? "excede" : tono === "warn" ? (mios.length < 3 ? "incompleta" : "al límite") : "ok"}</Pill></>}>
                {dias.map((d) => {
                  const x = mios.find((y) => y.fecha === d);
                  const href = `${base}&f=${d}&e=${e.activo_id}`;
                  const inner = !x ? <span className="nm-chip add" title="Agregar turno">+</span>
                    : x.tipo === "descanso" ? <span className={"nm-chip desc" + (x.estado === "borrador" ? " borrador" : "")}>😴 Descanso</span>
                    : x.tipo === "ausencia" ? <span className="nm-chip aus">Permiso</span>
                    : <span className={"nm-chip " + (esDominical(d) ? "f" : horasDe(x).nocturna > 0 ? "n" : "d") + (x.estado === "borrador" ? " borrador" : "")}>{hora(x.inicio)} – {hora(x.fin)}</span>;
                  return <div key={d} className={"cel" + (esDominical(d) ? " dom" : "")}>{puede && d >= e.fecha_ingreso ? <A href={href}>{inner}</A> : inner}</div>;
                })}
              </Fila>
            );
          })}
          {!E.length && <div style={{ gridColumn: "1 / -1" }} className="nm-sub">Esta tienda no tiene personal en el maestro.</div>}
        </div>
      </div>
      <Nota>Se planea hasta 2 meses adelante. <b>Borrador</b> = solo lo ve el administrador; al <b>publicar</b> el equipo lo ve en <i>Mi horario</i>. Lo planeado alimenta el forecast de costo; la nómina sale de la <b>marcación</b>. Publicar exige ≥ 3 turnos (o descansos) por persona.</Nota>
    </>
  );
}
function Fila({ nombre, sub, children }: { nombre: string; sub: React.ReactNode; children: React.ReactNode }) {
  return <><div className="e"><b>{nombre}</b><small>{sub}</small></div>{children}</>;
}
