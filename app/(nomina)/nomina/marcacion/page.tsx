import { redirect } from "next/navigation";
import { perspectiva, puedeRevisar } from "@/lib/rrhh/perspectiva";
import { empleados, tiendas, turnos, marcaciones } from "@/lib/rrhh/db";
import { revisarMarcacion, aprobarMarcacion, rechazarMarcacion, aprobarMarcacionesDia } from "@/lib/rrhh/actions";
import { hoyBogota, mas, fechaLarga, hm } from "@/lib/rrhh/fechas";
import { Head, Kpi, Aviso, A, Pill, Nota } from "../_lib/ui";
import { ruta } from "@/lib/ruta";

// MARCACIONES: lo que marcó el equipo, día por día, para que el administrador
// de punto revise. Lo que está dentro del radio se aprueba en bloque; lo que
// quedó fuera se decide una por una, viendo la selfie.
export default async function Marcaciones({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  if (p.tipo === "colaborador") redirect("/nomina/marcar");
  const hoy = hoyBogota();
  const fecha = sp.f && /^\d{4}-\d{2}-\d{2}$/.test(sp.f) ? sp.f : hoy;
  const TS = await tiendas();
  const tId = p.tipo === "admin_punto" ? p.tiendaId : sp.t || undefined;
  const [E, T, M] = await Promise.all([empleados(tId ? { tiendaId: tId } : {}), turnos(fecha, fecha, tId ? { tiendaId: tId } : {}), marcaciones(fecha, fecha, tId ? { tiendaId: tId } : {})]);
  const prog = T.filter((t) => t.tipo === "programado");
  const entradas = M.filter((m) => m.tipo === "entrada");
  const fuera = M.filter((m) => !m.dentro && m.estado === "registrada");
  const sinMarcar = prog.filter((t) => !entradas.some((m) => m.empleado_id === t.empleadoId));
  const tarde = entradas.filter((m) => { const t = prog.find((x) => x.empleadoId === m.empleado_id); return t && m.hora > t.inicio + 10 / 60; });
  const base = (f: string) => `/nomina/marcacion?f=${f}${tId ? "&t=" + encodeURIComponent(tId) : ""}`;
  const porTienda = [...new Set(M.map((m) => m.tienda_id))];
  return (
    <>
      <Head titulo="Marcaciones" sub={<>{fechaLarga(fecha)} · entradas y salidas con selfie y GPS</>}
        acts={<><A className="btn ghost" href={base(mas(fecha, -1))}>‹ Día anterior</A><A className="btn ghost" href={base(hoy)}>Hoy</A>{fecha < hoy && <A className="btn ghost" href={base(mas(fecha, 1))}>Siguiente ›</A>}</>} />
      <Aviso sp={sp} />
      <div className="nm-kpis">
        <Kpi label="Turnos programados" valor={prog.length} />
        <Kpi label="Entradas marcadas" valor={entradas.length} sub={`${sinMarcar.length} sin marcar`} tono={sinMarcar.length ? "warn" : "ok"} />
        <Kpi label="Fuera de radio por revisar" valor={fuera.length} tono={fuera.length ? "bad" : "ok"} />
        <Kpi label="Llegadas tarde (>10 min)" valor={tarde.length} tono={tarde.length ? "warn" : "ok"} />
        <Kpi label="Aprobadas" valor={M.filter((m) => m.estado === "aprobada").length} sub={`${M.filter((m) => m.estado === "rechazada").length} rechazadas`} />
      </div>
      {p.tipo === "rrhh" && (
        <form method="get" className="nm-filtros"><input type="hidden" name="f" value={fecha} />
          <select name="t" defaultValue={tId ?? ""}><option value="">Todas las ubicaciones</option>{TS.filter((t) => t.activa).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select><button type="submit" className="ghost">Aplicar</button></form>
      )}
      {porTienda.map((tiendaId) => {
        const t = TS.find((x) => x.id === tiendaId)!; const ms = M.filter((m) => m.tienda_id === tiendaId);
        const pendDentro = ms.filter((m) => m.estado === "registrada" && m.dentro).length;
        return (
          <div className="nm-card nm-scroll" key={tiendaId}>
            <h3>{t.nombre}<small>{ms.length} marcaciones</small>
              {puedeRevisar(p, tiendaId) && pendDentro > 0 && <form action={aprobarMarcacionesDia} style={{ display: "inline", marginLeft: 10 }}><input type="hidden" name="tienda_id" value={tiendaId} /><input type="hidden" name="fecha" value={fecha} /><button type="submit" className="ghost" style={{ fontSize: 11.5, padding: "4px 9px" }}>Aprobar las {pendDentro} dentro del radio</button></form>}
            </h3>
            <table className="nm-tabla">
              <thead><tr><th>Hora</th><th>Empleado</th><th>Tipo</th><th>Turno</th><th>GPS</th><th>Selfie</th><th>Estado</th><th>Revisión</th></tr></thead>
              <tbody>{ms.map((m) => {
                const e = E.find((x) => x.activo_id === m.empleado_id); const tu = prog.find((x) => x.empleadoId === m.empleado_id);
                const diff = tu ? Math.round((m.hora - (m.tipo === "entrada" ? tu.inicio : tu.fin)) * 60) : null;
                return (
                  <tr key={m.id}>
                    <td className="mono">{m.hhmm}</td><td className="nm-nombre">{e?.nombre_completo ?? m.empleado_id}</td>
                    <td>{m.tipo === "entrada" ? <Pill tono="info">entrada</Pill> : <Pill tono="gris">salida</Pill>}</td>
                    <td className="nm-sub">{tu ? `${hm(tu.inicio)}–${hm(tu.fin)}` : "sin turno"} {diff != null && Math.abs(diff) > 10 && <Pill tono="warn">{diff > 0 ? "+" : ""}{diff} min</Pill>}</td>
                    <td className="nm-sub">{m.distancia_m ?? "—"} m · ±{m.precision_m ?? "?"} · {m.metodo}</td>
                    <td>{m.tiene_selfie ? <a href={ruta(`/nomina/marcacion/selfie/${m.id}`)} target="_blank"><img className="nm-selfie" src={ruta(`/nomina/marcacion/selfie/${m.id}`)} alt="" /></a> : "—"}</td>
                    <td>{m.dentro ? <Pill tono="ok">en radio</Pill> : <Pill tono="bad">fuera</Pill>} {m.estado !== "registrada" && <Pill tono={m.estado === "aprobada" ? "ok" : "bad"}>{m.estado}</Pill>}{m.nota && <div className="nm-sub">{m.nota}</div>}</td>
                    <td>{m.estado === "registrada" && puedeRevisar(p, tiendaId) ? (
                      <form action={revisarMarcacion} className="acts"><input type="hidden" name="id" value={m.id} /><input name="nota" placeholder="nota" style={{ width: 90, fontSize: 11, padding: "3px 6px", border: "1px solid var(--border)", borderRadius: 6 }} />
                        <button type="submit" formAction={aprobarMarcacion}>Aprobar</button><button type="submit" formAction={rechazarMarcacion} className="danger">Rechazar</button></form>
                    ) : <span className="nm-sub">{m.revisado_por ? `por ${m.revisado_por.split(" como ")[0]}` : "—"}</span>}</td>
                  </tr>);
              })}</tbody>
            </table>
          </div>
        );
      })}
      {sinMarcar.length > 0 && <div className="nm-card"><h3>Sin marcar <small>{sinMarcar.length} con turno programado</small></h3><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{sinMarcar.map((t) => <Pill key={t.id} tono="warn">{E.find((e) => e.activo_id === t.empleadoId)?.nombre_completo} · {hm(t.inicio)}</Pill>)}</div></div>}
      {!M.length && <div className="nm-card"><p className="nm-sub">Nadie marcó este día.</p></div>}
      <Nota>Solo lo <b>aprobado</b> (o lo registrado dentro del radio) entra a nómina. Un turno programado sin marcación vale 0 h y sale como alerta en Reportes y Nómina: si la persona sí trabajó, el administrador registra la marcación manual con nota.</Nota>
    </>
  );
}
