import { empleados, solicitudes, tiendas, type Solicitud } from "@/lib/rrhh/db";
import { crearSolicitud, decidirSolicitud, aprobarSolicitud, rechazarSolicitud } from "@/lib/rrhh/actions";
import { perspectiva, puedeRevisar } from "@/lib/rrhh/perspectiva";
import { TIPOS_AUSENCIA } from "@/lib/rrhh/catalogos";
import { hoyBogota } from "@/lib/rrhh/fechas";
import { alarmasDe } from "@/lib/rrhh/alarmas";
import { Head, Pill, Nota, Aviso, Filtros, Vacio, A } from "../_lib/ui";

// SOLICITUDES: el colaborador pide (o RRHH / el admin en su nombre) y quien
// revisa la tienda aprueba o rechaza. Al aprobar, la ausencia reemplaza el turno
// planeado y entra al cálculo con su % de pago (lo hace la acción, no la pantalla).
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  const hoy = hoyBogota();
  // la perspectiva decide qué se ve: lo mío, mi tienda, o todo (con filtro opcional)
  const tiendaId = p.tipo === "admin_punto" ? p.tiendaId : p.tipo === "rrhh" ? sp.t || "" : "";
  const filtro = p.tipo === "colaborador" ? { empleadoId: p.empleado.activo_id } : tiendaId ? { tiendaId } : {};
  const [S, TODOS, TIENDAS] = await Promise.all([solicitudes(filtro), empleados({ incluirInactivos: true }), tiendas()]);
  const empDe = (id: number) => TODOS.find((e) => e.activo_id === id);
  const tiendaDe = (id: string) => TIENDAS.find((t) => t.id === id);
  // Pendientes sin alarmas calculadas (sembradas o anteriores a la regla): se calculan al mostrar.
  const pend = await Promise.all(S.filter((s) => s.estado === "pendiente").map(async (s) => {
    if ((s.alertas ?? []).length) return s;
    const e = empDe(s.empleado_id); if (!e) return s;
    try { return { ...s, alertas: await alarmasDe(e, s.tipo, s.desde, s.hasta) }; } catch { return s; }
  }));
  const hist = S.filter((s) => s.estado !== "pendiente").sort((a, b) => b.id - a.id).slice(0, 50);
  // a quién se le puede pedir desde acá: RRHH a cualquiera activo, el admin a su tienda
  const pedibles = TODOS.filter((e) => e.activo && (p.tipo === "rrhh" || e.punto === tiendaId));
  const tono = (e: string) => (e === "aprobado" ? "ok" : e === "rechazado" ? "bad" : "warn");

  const Fila = ({ s }: { s: Solicitud }) => {
    const e = empDe(s.empleado_id); const t = tiendaDe(e?.punto ?? "");
    const cat = TIPOS_AUSENCIA.find((x) => x.tipo === s.tipo);
    const revisa = s.estado === "pendiente" && e && puedeRevisar(p, e.punto);
    return (
      <tr>
        <td className="nm-nombre">{e?.nombre_completo ?? `#${s.empleado_id}`}<div className="nm-sub">{t?.nombre ?? e?.punto}</div></td>
        <td>{s.tipo}{cat && !cat.remunerada && <div className="nm-sub">no remunerada</div>}{cat && cat.remunerada && cat.pct < 100 && <div className="nm-sub">{cat.pct} %</div>}</td>
        <td className="mono">{s.desde} → {s.hasta}</td>
        <td className="num">{s.dias_habiles}</td>
        <td className="nm-sub">{s.motivo || "—"}{s.soporte_nombre && <div>📎 {s.soporte_nombre}</div>}{cat?.soporte && !s.soporte_nombre && <Pill tono="bad">sin soporte</Pill>}{(s.alertas ?? []).length > 0 && <div className="nm-alarmas">{(s.alertas ?? []).map((a, i) => <Pill key={i} tono={a.nivel === "roja" ? "bad" : "warn"}>{a.nivel === "roja" ? "⛔ " : "⚠ "}{a.texto}</Pill>)}</div>}</td>
        <td>
          {revisa ? (
            <form action={decidirSolicitud} className="nm-inline" style={{ flexWrap: "wrap" }}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="volver" value="/nomina/solicitudes" />
              <input name="nota" placeholder="Nota (opcional)" maxLength={120} style={{ width: 150 }} />
              <button type="submit" formAction={aprobarSolicitud}>Aprobar</button>
              <button type="submit" formAction={rechazarSolicitud} className="danger">Rechazar</button>
            </form>
          ) : (
            <><Pill tono={tono(s.estado)}>{s.estado}</Pill>{s.decidido_por && <div className="nm-sub">{s.decidido_por}{s.decision_nota ? ` · ${s.decision_nota}` : ""}</div>}</>
          )}
        </td>
      </tr>
    );
  };
  const cab = (ultima: string) => <thead><tr><th>Empleado</th><th>Tipo</th><th>Fechas</th><th className="num">Días háb.</th><th>Motivo / soporte</th><th>{ultima}</th></tr></thead>;

  return (
    <>
      <Head titulo={p.tipo === "colaborador" ? "Mis solicitudes" : "Solicitudes"}
        sub={p.tipo === "colaborador" ? "Vacaciones, permisos e incapacidades. Las aprueba tu administrador de punto o RRHH." : "Vacaciones, permisos e incapacidades: el colaborador pide (o RRHH en su nombre), el supervisor aprueba."}
        acts={<A href="#nueva" className="btn">+ Nueva solicitud</A>} />
      <Aviso sp={sp} />
      {p.tipo === "rrhh" && (
        <Filtros>
          <select name="t" defaultValue={tiendaId}><option value="">Todas las tiendas</option>{TIENDAS.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select>
          <span className="sep" />
          <Pill tono={pend.length ? "warn" : "ok"}>{pend.length} por aprobar</Pill>
        </Filtros>
      )}
      <div className="nm-card nm-scroll">
        <h3>Por aprobar <small>{pend.length}</small></h3>
        {pend.length === 0 ? <Vacio>Nada pendiente.</Vacio> : (
          <table className="nm-tabla">{cab(p.tipo === "colaborador" ? "Estado" : "Decisión")}<tbody>{pend.map((s) => <Fila key={s.id} s={s} />)}</tbody></table>
        )}
      </div>
      <div className="nm-card nm-scroll">
        <h3>Historial <small>últimas {hist.length}</small></h3>
        {hist.length === 0 ? <Vacio>Sin solicitudes decididas todavía.</Vacio> : (
          <table className="nm-tabla">{cab("Estado")}<tbody>{hist.map((s) => <Fila key={s.id} s={s} />)}</tbody></table>
        )}
      </div>

      <div className="nm-card" id="nueva">
        <h3>Nueva solicitud</h3>
        <form action={crearSolicitud} encType="multipart/form-data">
          <input type="hidden" name="volver" value="/nomina/solicitudes#nueva" />
          <div className="nm-form">
            {p.tipo === "colaborador" ? (
              <label>Para<input readOnly value={p.empleado.nombre_completo} /></label>
            ) : (
              <label>Empleado<select name="empleado_id" required>
                {pedibles.map((e) => <option key={e.activo_id} value={e.activo_id}>{e.nombre_completo}{p.tipo === "rrhh" ? ` · ${tiendaDe(e.punto)?.nombre ?? e.punto}` : ""}</option>)}
              </select></label>
            )}
            <label>Tipo<select name="tipo" required>
              {TIPOS_AUSENCIA.map((t) => <option key={t.tipo} value={t.tipo}>{t.tipo} · {t.remunerada ? `remunerada ${t.pct} %` : "no remunerada"}{t.soporte ? " · exige soporte" : ""}{t.descuentaVac ? " · descuenta vacaciones" : ""}</option>)}
            </select></label>
            <label>Desde<input type="date" name="desde" defaultValue={hoy} required /></label>
            <label>Hasta<input type="date" name="hasta" defaultValue={hoy} required /></label>
            <label className="full">Motivo (opcional)<input name="motivo" maxLength={200} /></label>
            <label className="full">Soporte (obligatorio para incapacidad, cita médica, maternidad/paternidad, votación y suspensión)<input type="file" name="soporte" accept=".pdf,image/*" /></label>
          </div>
          <div className="nm-acts" style={{ marginTop: 12 }}><button type="submit">Enviar solicitud</button></div>
        </form>
      </div>
      <Nota><b>Alarmas de viabilidad:</b> al pedir, la app revisa reemplazo en la tienda, anticipación (vacaciones 15 días, permisos 3), choques con otra ausencia, frecuencia de no remunerados y si toca domingo/festivo. ⛔ roja = aprobar exige escribir el motivo; ⚠ ámbar = aviso. </Nota><Nota>Los días se cuentan <b>hábiles</b> (lun–sáb sin festivos). Al aprobar, la ausencia entra a la planificación (reemplaza el turno) y al cálculo con su % de pago. Vacaciones solo si hay saldo disponible.</Nota>
    </>
  );
}
