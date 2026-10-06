import { cargarEmpleados, solicitudesDe, TIPOS_AUSENCIA, empleado, tienda, type Solicitud } from "../_lib/datos";
import { Head, Btn, Pill, Tabs, Nota } from "../_lib/ui";

export default async function Solicitudes() {
  const EMPLEADOS = await cargarEmpleados();
  const SOLICITUDES = solicitudesDe(EMPLEADOS);
  const pend = SOLICITUDES.filter((s) => s.estado === "pendiente");
  const hist = SOLICITUDES.filter((s) => s.estado !== "pendiente");
  const tono = (e: string) => (e === "aprobado" ? "ok" : e === "rechazado" ? "bad" : "warn");
  const Fila = ({ s, acts }: { s: Solicitud; acts?: boolean }) => { const e = empleado(EMPLEADOS, s.empleadoId); return (
    <tr><td className="nm-nombre">{e?.nombre_completo}<div className="nm-sub">{tienda(e?.punto ?? "")?.nombre}</div></td><td>{s.tipo}</td><td className="mono">{s.desde} → {s.hasta}</td><td className="num">{s.dias}</td><td className="nm-sub">{s.motivo || "—"}</td>
      <td>{acts ? <div className="nm-acts"><Btn>Aprobar</Btn><Btn danger>Rechazar</Btn></div> : <Pill tono={tono(s.estado)}>{s.estado}</Pill>}</td></tr>); };
  return (
    <>
      <Head titulo="Solicitudes" sub="Vacaciones, permisos e incapacidades: el colaborador pide (o RRHH en su nombre), el supervisor aprueba." acts={<Btn>+ Nueva solicitud</Btn>} />
      <Tabs items={[{ href: "/nomina/solicitudes", label: `Por aprobar (${pend.length})` }, { href: "/nomina/solicitudes?tab=hist", label: "Historial" }]} actual="/nomina/solicitudes" />
      <div className="nm-card nm-scroll">
        <h3>Por aprobar</h3>
        <table className="nm-tabla"><thead><tr><th>Empleado</th><th>Tipo</th><th>Fechas</th><th className="num">Días háb.</th><th>Motivo</th><th>Acción</th></tr></thead>
          <tbody>{pend.map((s) => <Fila key={s.id} s={s} acts />)}</tbody></table>
      </div>
      <div className="nm-card nm-scroll">
        <h3>Historial</h3>
        <table className="nm-tabla"><thead><tr><th>Empleado</th><th>Tipo</th><th>Fechas</th><th className="num">Días háb.</th><th>Motivo</th><th>Estado</th></tr></thead>
          <tbody>{hist.map((s) => <Fila key={s.id} s={s} />)}</tbody></table>
      </div>
      <div className="nm-card">
        <h3>Nueva solicitud</h3>
        <div className="nm-form">
          <label>Empleado<select><option>Para mí</option>{EMPLEADOS.map((e) => <option key={e.activo_id}>{e.nombre_completo}</option>)}</select></label>
          <label>Tipo<select>{TIPOS_AUSENCIA.map((t) => <option key={t.tipo}>{t.tipo}</option>)}</select></label>
          <label>Fecha inicio<input type="date" /></label><label>Fecha fin<input type="date" /></label>
          <label className="full">Motivo (opcional)<input /></label>
          <label className="full">Soporte (obligatorio para incapacidad, cita médica, maternidad/paternidad)<input type="file" /></label>
        </div>
        <div className="nm-acts" style={{ marginTop: 12 }}><Btn>Enviar solicitud</Btn><Btn ghost>Cancelar</Btn></div>
      </div>
      <Nota>Al aprobar, la ausencia entra a la planificación (reemplaza el turno) y al cálculo con su % de pago. Se avisa por WhatsApp al colaborador y al administrador de punto.</Nota>
    </>
  );
}
