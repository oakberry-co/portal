import { HOY, quincenaDe, mas, tienda, TIENDAS, fechaLarga, cargarEmpleados } from "../_lib/datos";
import { periodo } from "../_lib/calc";
import { cop, mm, hh, totalTrabajadas, reglasEn } from "../_lib/motor";
import { Head, Kpi, Sel, Btn, Pill, Nota } from "../_lib/ui";

// NÓMINA QUINCENAL: salario FIJO del contrato (no horas × tarifa, que es lo que
// en Oak-Crew dejaba a la gente bajo medio mínimo) + recargos por las horas
// MARCADAS y aprobadas − deducciones del empleado + novedades.
export default async function Quincena() {
  const EMPLEADOS = await cargarEmpleados();
  const q = quincenaDe(mas(HOY, -16));            // última quincena cerrada
  const P = periodo(EMPLEADOS, q.desde, q.hasta);
  const r = reglasEn(q.hasta);
  const lineas = P.lineas.map((l) => {
    const basico = Math.round(l.e.salario / 2);                        // salario fijo quincenal
    const recargos = l.costo.recargos;
    const ausNoRem = 0;                                                   // novedades (muestra)
    const ibc = basico + recargos - ausNoRem;
    const salud = Math.round(ibc * 0.04), pension = Math.round(ibc * 0.04), fsp = l.e.salario >= 4 * r.smlmv ? Math.round(ibc * 0.01) : 0;
    const aux = l.costo.auxilio;
    return { l, basico, recargos, ausNoRem, ibc, salud, pension, fsp, aux, neto: ibc + aux - salud - pension - fsp };
  }).sort((a, b) => b.neto - a.neto);
  const S = (f: (x: typeof lineas[number]) => number) => lineas.reduce((a, x) => a + f(x), 0);
  const cerrada = q.hasta < HOY;
  return (
    <>
      <Head titulo="Nómina" sub={<>Quincena {fechaLarga(q.desde)} — {fechaLarga(q.hasta)} · <Pill tono="warn">Borrador</Pill></>}
        acts={<><Btn ghost>PDF</Btn><Btn ghost>Excel novedades (Siigo Nómina)</Btn><Btn>{cerrada ? "Aprobar quincena" : "Se aprueba al cierre"}</Btn></>} />
      <div className="nm-filtros"><Sel opts={["Quincenal", "Mensual"]} /><Sel opts={["Todas las tiendas", ...TIENDAS.filter((t) => t.activa).map((t) => t.nombre)]} /><Sel opts={["Todos los empleados"]} /><span className="sep" /><Pill tono="info">Origen: marcación aprobada</Pill></div>
      <div className="nm-kpis">
        <Kpi label="Total devengado" valor={mm(S((x) => x.ibc + x.aux))} sub="básico + recargos + transporte" />
        <Kpi label="Deducciones" valor={mm(S((x) => x.salud + x.pension + x.fsp))} sub="salud 4 % + pensión 4 % + FSP" />
        <Kpi label="Auxilio transporte" valor={mm(S((x) => x.aux))} />
        <Kpi label="Neto a pagar" valor={mm(S((x) => x.neto))} tono="hl" />
        <Kpi label="Costo empleador" valor={mm(S((x) => x.ibc + x.aux) + P.tot.carga)} sub={`+ carga ${mm(P.tot.carga)}`} />
      </div>
      <div className="nm-card nm-scroll">
        <table className="nm-tabla"><thead><tr><th>Empleado</th><th>Tienda</th><th className="num">Horas</th><th className="num">Básico</th><th className="num">Recargos</th><th className="num">Desc./aus.</th><th className="num">IBC</th><th className="num">Salud 4%</th><th className="num">Pensión 4%</th><th className="num">FSP</th><th className="num">Aux. transp.</th><th className="num">Neto</th></tr></thead>
          <tbody>{lineas.map((x) => (<tr key={x.l.e.activo_id}><td className="nm-nombre">{x.l.e.nombre_completo}</td><td className="nm-sub">{tienda(x.l.e.punto)?.nombre}</td><td className="num">{hh(totalTrabajadas(x.l.horas))}</td><td className="num">{cop(x.basico)}</td><td className="num">{cop(x.recargos)}</td><td className="num">{x.ausNoRem ? "−" + cop(x.ausNoRem) : "—"}</td><td className="num">{cop(x.ibc)}</td><td className="num">{cop(x.salud)}</td><td className="num">{cop(x.pension)}</td><td className="num">{x.fsp ? cop(x.fsp) : "—"}</td><td className="num">{cop(x.aux)}</td><td className="num"><b>{cop(x.neto)}</b></td></tr>))}
            <tr className="tot"><td colSpan={3}>Total</td><td className="num">{cop(S((x) => x.basico))}</td><td className="num">{cop(S((x) => x.recargos))}</td><td className="num">—</td><td className="num">{cop(S((x) => x.ibc))}</td><td className="num">{cop(S((x) => x.salud))}</td><td className="num">{cop(S((x) => x.pension))}</td><td className="num">{cop(S((x) => x.fsp))}</td><td className="num">{cop(S((x) => x.aux))}</td><td className="num">{cop(S((x) => x.neto))}</td></tr></tbody></table>
      </div>
      <div className="nm-grid2">
        <div className="nm-card">
          <h3>Novedades de la quincena</h3>
          <table className="nm-tabla"><thead><tr><th>Tipo</th><th>Empleado</th><th className="num">Valor</th><th>Estado</th></tr></thead>
            <tbody>
              <tr><td>Incapacidad EPS (3 días, 66,67 %)</td><td className="nm-sub">—muestra—</td><td className="num">−$58.364</td><td><Pill tono="ok">aplicada</Pill></td></tr>
              <tr><td>Préstamo (cuota 2/6)</td><td className="nm-sub">—muestra—</td><td className="num">−$100.000</td><td><Pill tono="ok">aplicada</Pill></td></tr>
              <tr><td>Incentivo del mes (no salarial)</td><td className="nm-sub">—muestra—</td><td className="num">+$250.000</td><td><Pill tono="warn">pendiente cierre</Pill></td></tr>
            </tbody></table>
          <div className="nm-acts" style={{ marginTop: 10 }}><Btn ghost>+ Novedad</Btn></div>
        </div>
        <div className="nm-card">
          <h3>Condiciones para aprobar</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.9 }}>
            <li>{cerrada ? "✅" : "⏳"} La quincena terminó ({q.hasta}).</li>
            <li>✅ Todas las marcaciones del período están aprobadas por el supervisor.</li>
            <li>✅ Ningún empleado sin contrato vigente.</li>
            <li>✅ Diferencia contra el motor de costos = $0 (misma fuente).</li>
            <li>⏳ Aprueba el decisor (admin). Queda en bitácora con hash.</li>
          </ul>
        </div>
      </div>
      <Nota><b>Diferencia clave con Oak-Crew:</b> el básico es el salario del contrato ÷ 2, no horas planeadas × tarifa. Las horas solo suman recargos y extras. IBC sin auxilio; FSP sobre 4 SMLMV; incapacidad al 66,67 %; descansos remunerados dentro del básico. La salida es el <b>Excel de novedades</b> que Siigo Nómina importa (no tiene API).</Nota>
    </>
  );
}
