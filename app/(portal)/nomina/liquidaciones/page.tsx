import { cargarEmpleados, HOY } from "../_lib/datos";
import { cop, reglasEn } from "../_lib/motor";
import { Head, Btn, Vacio, Nota } from "../_lib/ui";

// LIQUIDACIONES: art. 64 CST. Las cesantías del año en curso (las anteriores ya
// están en el fondo), intereses prorrateados por días, contrato desde la ficha.
export default async function Liquidaciones() {
  const EMPLEADOS = await cargarEmpleados();
  const e = EMPLEADOS[0];
  const r = reglasEn(HOY);
  const retiro = HOY, iniAno = "2026-01-01";
  const dias = Math.round((new Date(retiro).getTime() - new Date(iniAno).getTime()) / 86400000) + 1;
  const base = e.salario + (e.auxilio_transporte ? r.auxilio : 0);
  const ces = Math.round(base * dias / 360), intCes = Math.round(ces * 0.12 * dias / 360);
  const prima = Math.round(base * Math.min(dias, 180) / 360), vac = Math.round(e.salario * dias / 720);
  const diasTrab = Math.round((new Date(retiro).getTime() - new Date(e.fecha_ingreso).getTime()) / 86400000);
  const indem = Math.round(e.salario * 30 / 30 + (diasTrab > 365 ? e.salario * 20 / 30 * ((diasTrab - 365) / 365) : 0));
  return (
    <>
      <Head titulo="Liquidaciones" sub="Liquidación final de contrato (art. 64 CST). Simulación antes de firmar." acts={<Btn ghost>PDF</Btn>} />
      <div className="nm-grid2">
        <div className="nm-card">
          <h3>Simular</h3>
          <div className="nm-form">
            <label>Empleado<select>{EMPLEADOS.map((x) => <option key={x.activo_id}>{x.nombre_completo}</option>)}</select></label>
            <label>Fecha de retiro<input type="date" defaultValue={retiro} /></label>
            <label>Causa<select><option>Renuncia voluntaria</option><option>Despido sin justa causa</option><option>Despido con justa causa</option><option>Terminación del contrato</option></select></label>
            <label>Tipo de contrato (de la ficha)<input readOnly value={e.tipo_contrato} /></label>
            <label>Salario (de la ficha)<input readOnly value={cop(e.salario)} /></label>
            <label>Fecha de ingreso (de la ficha)<input readOnly value={e.fecha_ingreso} /></label>
          </div>
          <div className="nm-acts" style={{ marginTop: 12 }}><Btn>Calcular</Btn><Btn ghost>Guardar liquidación</Btn></div>
        </div>
        <div className="nm-card">
          <h3>Resultado <small>{e.nombre_completo} · {diasTrab} días trabajados</small></h3>
          <table className="nm-tabla"><tbody>
            <tr><td className="nm-nombre">Cesantías (año en curso, {dias} días)</td><td className="num">{cop(ces)}</td></tr>
            <tr><td className="nm-nombre">Intereses de cesantías (12 % prorrateado)</td><td className="num">{cop(intCes)}</td></tr>
            <tr><td className="nm-nombre">Prima (semestre en curso)</td><td className="num">{cop(prima)}</td></tr>
            <tr><td className="nm-nombre">Vacaciones no disfrutadas</td><td className="num">{cop(vac)}</td></tr>
            <tr><td className="nm-nombre">Salario pendiente (días del mes)</td><td className="num">{cop(Math.round(e.salario * 6 / 30))}</td></tr>
            <tr><td className="nm-nombre">Indemnización (si aplica: sin justa causa, indefinido)</td><td className="num nm-sub">{cop(indem)}</td></tr>
            <tr className="tot"><td>Total (renuncia voluntaria)</td><td className="num">{cop(ces + intCes + prima + vac + Math.round(e.salario * 6 / 30))}</td></tr>
          </tbody></table>
        </div>
      </div>
      <div className="nm-card"><h3>Historial de liquidaciones</h3><Vacio>Ninguna todavía.</Vacio></div>
      <Nota>Oak-Crew calculaba las cesantías sobre toda la relación laboral (incluyendo años ya consignados al fondo) y los intereses al 12 % plano. Acá: solo el año en curso e intereses por días. El tipo de contrato sale de la ficha, no se pregunta al liquidar.</Nota>
    </>
  );
}
