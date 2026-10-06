import { cargarEmpleados, solicitudesDe, TIPOS_AUSENCIA, saldoVacaciones, CORTE_SALDOS, tienda } from "../_lib/datos";
import { Head, Kpi, Sel, Pill, Nota, Btn } from "../_lib/ui";

// GESTIÓN DE AUSENCIAS: saldos desde una FECHA DE CORTE (ventana de
// implementación), no desde el ingreso. Catálogo con remunerada/%/soporte.
export default async function Ausencias() {
  const EMPLEADOS = await cargarEmpleados();
  const SOLICITUDES = solicitudesDe(EMPLEADOS);
  const saldos = EMPLEADOS.map((e) => ({ e, s: saldoVacaciones(e, SOLICITUDES) }));
  const pend = SOLICITUDES.filter((s) => s.estado === "pendiente").length;
  return (
    <>
      <Head titulo="Gestión de ausencias" sub={<>Saldos de vacaciones y permisos · corte de implementación <b>{CORTE_SALDOS}</b></>} acts={<><Btn ghost>Cargar saldos iniciales</Btn><Btn ghost>Exportar</Btn></>} />
      <div className="nm-kpis">
        <Kpi label="Empleados" valor={EMPLEADOS.length} />
        <Kpi label="Vacaciones disponibles (total)" valor={saldos.reduce((a, x) => a + x.s.disponible, 0).toFixed(1) + " d"} sub="días hábiles" />
        <Kpi label="Solicitudes pendientes" valor={pend} tono={pend ? "warn" : "ok"} />
        <Kpi label="Días usados desde el corte" valor={saldos.reduce((a, x) => a + x.s.usadas, 0)} />
      </div>
      <div className="nm-filtros"><Sel opts={["Todos", "Con solicitudes pendientes", "Con vacaciones disponibles", "Sin vacaciones disponibles"]} /><Sel opts={["Ordenar: nombre", "Más vacaciones", "Menos vacaciones"]} /></div>
      <div className="nm-grid2">
        <div className="nm-card nm-scroll">
          <h3>Saldos por empleado</h3>
          <table className="nm-tabla">
            <thead><tr><th>Empleado</th><th>Tienda</th><th className="num">Saldo al corte</th><th className="num">Acumuladas</th><th className="num">Usadas</th><th className="num">Disponibles</th><th>Pend.</th></tr></thead>
            <tbody>{saldos.map(({ e, s }) => (
              <tr key={e.activo_id}><td className="nm-nombre">{e.nombre_completo}</td><td className="nm-sub">{tienda(e.punto)?.nombre}</td>
                <td className="num">{s.inicial}</td><td className="num">{s.acum}</td><td className="num">{s.usadas}</td><td className="num"><b>{s.disponible}</b></td>
                <td>{SOLICITUDES.some((x) => x.empleadoId === e.activo_id && x.estado === "pendiente") ? <Pill tono="warn">1</Pill> : "—"}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div>
          <div className="nm-card">
            <h3>Catálogo de ausencias <small>lo que Oak-Crew no tiene</small></h3>
            <table className="nm-tabla">
              <thead><tr><th>Tipo</th><th>Remunerada</th><th className="num">% pago</th><th>Descuenta vac.</th><th>Soporte</th></tr></thead>
              <tbody>{TIPOS_AUSENCIA.map((t) => (
                <tr key={t.tipo}><td className="nm-nombre">{t.tipo}</td><td>{t.remunerada ? <Pill tono="ok">sí</Pill> : <Pill tono="bad">no</Pill>}</td><td className="num">{t.pct}%</td><td>{t.descuentaVac ? "sí" : "—"}</td><td>{t.soporte ? "obligatorio" : "—"}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <Nota><b>Días hábiles</b>, no calendario (Oak-Crew cuenta 26-sep→3-oct como 8 días). La <b>incapacidad</b> se paga al 66,67 % desde el día 3 con soporte de la EPS. Suspensión y ausencia injustificada existen como tipo para que no se registren como «Otro / aprobado» y se paguen.</Nota>
        </div>
      </div>
    </>
  );
}
