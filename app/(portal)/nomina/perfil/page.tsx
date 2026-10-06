import { marcaciones, tiendas, turnos } from "@/lib/rrhh/db";
import { periodo } from "@/lib/rrhh/calc";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { saldoVacacionesDe } from "@/lib/rrhh/saldos";
import { cop, hh } from "@/lib/rrhh/motor";
import { hoyBogota, quincenaDe, fechaCorta } from "@/lib/rrhh/fechas";
import { Head, Aviso, Pill, Nota, A } from "../_lib/ui";

// MI PERFIL: lo que ve cada colaborador al entrar desde su celular. Sus datos
// de la ficha, su quincena en curso (horas MARCADAS, no planeadas) y su saldo
// de vacaciones. Pasa por el mismo periodo() que Nómina: la cifra que ve acá
// es la que le van a pagar.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  const u = p.usuario;
  const e = p.empleado;
  const hoy = hoyBogota();
  const q = quincenaDe(hoy);

  let quincena: { horas: number; recargos: number; neto: number; alertas: string[]; nTurnos: number } | null = null;
  let saldoVac: number | null = null;
  let nombreTienda = "—";
  if (e) {
    const [T, M, TS, saldo] = await Promise.all([turnos(q.desde, q.hasta, { empleadoId: e.activo_id }), marcaciones(q.desde, q.hasta, { empleadoId: e.activo_id }), tiendas(), saldoVacacionesDe(e.activo_id)]);
    const P = periodo([e], T, M, q.desde, q.hasta, "real", Object.fromEntries(TS.map((t) => [t.id, t.almuerzo_min])));
    const l = P.lineas[0];
    quincena = { horas: P.trabajadas, recargos: l.costo.recargos, neto: l.ded.neto, alertas: l.alertas, nTurnos: l.nTurnos };
    saldoVac = saldo;
    nombreTienda = TS.find((t) => t.id === e.punto)?.nombre ?? e.punto;
  }
  const rolTexto = { rrhh: "RRHH", admin_punto: "administrador de punto", colaborador: "colaborador" }[p.tipo];

  return (
    <>
      <Head titulo="Mi perfil" sub={<>{u.email} · <Pill tono="info">{rolTexto}</Pill></>} />
      <Aviso sp={sp} />
      {!e && p.tipo === "rrhh" && (
        <div className="nm-card"><div className="nm-vacio">Tu correo no está en el maestro de empleados: entras como RRHH por el rol del portal ({u.rol}). No hay quincena propia que mostrar.</div></div>
      )}
      <div className="nm-grid2">
        <div className="nm-card"><h3>Datos</h3>
          <div className="nm-form">
            <label>Correo<input readOnly value={e?.email ?? u.email} /></label>
            <label>Rol en el portal<input readOnly value={u.rol} /></label>
            {e && (<>
              <label>Nombre<input readOnly value={e.nombre_completo} /></label>
              <label>Tienda<input readOnly value={nombreTienda} /></label>
              <label>Cargo<input readOnly value={e.cargo} /></label>
              <label>Rol en nómina<input readOnly value={e.rol_app} /></label>
              <label>Fecha de ingreso<input readOnly value={e.fecha_ingreso} /></label>
              <label>Contrato<input readOnly value={e.tipo_contrato ?? "—"} /></label>
              <label>Jornada semanal<input readOnly value={`${e.jornada_semanal} h`} /></label>
              <label>Consentimiento datos/imagen<input readOnly value={e.consentimiento_firmado_en ? `firmado el ${e.consentimiento_firmado_en}` : "sin firmar"} /></label>
            </>)}
          </div>
          {e && <div style={{ marginTop: 10 }}>{e.consentimiento_firmado_en ? <Pill tono="ok">consentimiento firmado</Pill> : <Pill tono="warn">consentimiento pendiente</Pill>}</div>}
          <div className="nm-acts" style={{ marginTop: 12 }}>
            <button type="button" className="ghost" title="Todavía no hace nada">Cambiar celular (código por WhatsApp)</button>
            <button type="button" className="ghost" title="Todavía no hace nada">Cambiar contraseña</button>
          </div>
        </div>
        <div className="nm-card"><h3>Mi quincena <small>{fechaCorta(q.desde)} – {fechaCorta(q.hasta)} · origen: marcación</small></h3>
          {e && quincena ? (
            <>
              <table className="nm-tabla"><tbody>
                <tr><td>Horas marcadas</td><td className="num">{hh(quincena.horas)}</td></tr>
                <tr><td>Turnos trabajados</td><td className="num">{quincena.nTurnos}</td></tr>
                <tr><td>Recargos acumulados</td><td className="num">{cop(quincena.recargos)}</td></tr>
                <tr><td>Neto estimado a hoy</td><td className="num"><b>{cop(quincena.neto)}</b></td></tr>
                <tr><td>Vacaciones disponibles</td><td className="num">{saldoVac == null ? <span className="nm-sub">sin saldo cargado</span> : `${saldoVac} d`}</td></tr>
                <tr><td>Alertas</td><td className="num">{quincena.alertas.length ? <Pill tono="warn">{quincena.alertas.length}</Pill> : <Pill tono="ok">0</Pill>}</td></tr>
              </tbody></table>
              {quincena.alertas.length > 0 && <div className="nm-sub" style={{ marginTop: 6 }}>{quincena.alertas.slice(0, 5).join(" · ")}{quincena.alertas.length > 5 ? " …" : ""}</div>}
            </>
          ) : <div className="nm-vacio">Sin ficha de empleado: no hay quincena que mostrar.</div>}
          <div className="nm-acts" style={{ marginTop: 12 }}>
            <A href="/nomina/mi-horario" className="btn">Ver mi horario</A>
            <A href="/nomina/marcar" className="btn ghost">Marcar</A>
            <A href="/nomina/solicitudes" className="btn ghost">Pedir permiso</A>
          </div>
        </div>
      </div>
      <Nota>El colaborador ve su horario, sus horas y lo que le van a pagar; <b>no</b> ve la nómina de los demás. El administrador de punto ve su tienda. RRHH y el decisor ven todo. El neto es una estimación a hoy con las marcaciones aprobadas: la cifra final sale al aprobar la quincena.</Nota>
    </>
  );
}
