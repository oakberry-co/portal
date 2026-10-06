import { cargarEmpleados, TIENDAS, tienda } from "../_lib/datos";
import { cop } from "../_lib/motor";
import { Head, Btn, Sel, Pill, Nota } from "../_lib/ui";

// EMPLEADOS: el maestro de nómina es la biblia. A diferencia de Oak-Crew, la
// ficha trae CONTRATO (salario, tipo, entidades) — sin eso no hay nómina.
export default async function Empleados() {
  const EMPLEADOS = await cargarEmpleados();
  return (
    <>
      <Head titulo="Empleados" sub={<>{EMPLEADOS.length} activos en el maestro de nómina · fuente: <b>activos manel foods nomina en vivo.xlsx</b> (RRHH)</>}
        acts={<><Btn ghost>Ver ex-empleados</Btn><Btn ghost>Enviar correo a activos</Btn><Btn>+ Nuevo empleado</Btn></>} />
      <div className="nm-filtros">
        <input placeholder="Buscar por nombre o cédula" style={{ minWidth: 260 }} />
        <Sel opts={["Todas las ubicaciones", ...TIENDAS.map((t) => t.nombre)]} />
        <Sel opts={["Todos los cargos", "Administrador de punto", "Auxiliar punto de venta"]} />
        <span className="sep" /><Pill tono="info">Vista: tarjetas</Pill>
      </div>
      <div className="nm-emp">
        {EMPLEADOS.map((e) => {
          const t = tienda(e.punto);
          const falta: string[] = [];
          if (!e.eps || !e.afp) falta.push("afiliaciones");
          return (
            <div className="c" key={e.activo_id}>
              <b>{e.nombre_completo}</b>
              <div className="r"><span>Cargo</span><span>{cap(e.cargo)}</span></div>
              <div className="r"><span>Tienda</span><span>{t?.nombre ?? e.punto}{t && !t.activa && <Pill tono="bad"> cerrada</Pill>}</span></div>
              <div className="r"><span>Salario</span><span>{cop(e.salario)} {e.auxilio_transporte && <Pill tono="gris">+ aux</Pill>}</span></div>
              <div className="r"><span>Contrato</span><span>{cap(e.tipo_contrato)} · desde {e.fecha_ingreso}</span></div>
              <div className="r"><span>EPS / AFP / ARL</span><span>{[e.eps, e.afp, e.arl].map(cap).join(" · ")}</span></div>
              <div className="r"><span>Consentimiento datos/imagen</span><span><Pill tono="warn">pendiente firma</Pill></span></div>
              <div className="acts"><Btn ghost>Editar</Btn><Btn ghost>Contrato</Btn><Btn ghost>Tarjeta NFC</Btn><Btn danger>Desactivar</Btn></div>
            </div>
          );
        })}
      </div>
      <h2>Ficha de empleado (formulario)</h2>
      <div className="nm-card">
        <div className="nm-form">
          <label>Nombres<input placeholder="Nombres" /></label><label>Apellidos<input placeholder="Apellidos" /></label>
          <label>Tipo documento<select><option>CC</option><option>CE</option><option>PEP/PPT</option><option>TI</option><option>PA</option></select></label>
          <label>Número documento<input /></label>
          <label>Correo (invitación)<input type="email" /></label><label>Celular<input /></label>
          <label>Rol<select><option>Colaborador</option><option>Colaborador tiempo parcial</option><option>Administrador de punto</option><option>Supervisor</option><option>Gestor RRHH</option></select></label>
          <label>Tienda principal<select>{TIENDAS.map((t) => <option key={t.id}>{t.nombre}</option>)}</select></label>
          <label>Fecha inicio<input type="date" /></label><label>Fecha terminación<input type="date" /></label>
          <label className="full" style={{ marginTop: 6 }}>Contrato (lo que Oak-Crew no tiene)</label>
          <label>Salario mensual<input placeholder="$ 1.750.905" /></label>
          <label>Tipo de contrato<select><option>Indefinido</option><option>Fijo</option><option>Obra o labor</option><option>Aprendiz</option></select></label>
          <label>Jornada semanal<select><option>42 h (tiempo completo)</option><option>Medio tiempo</option><option>Por horas</option></select></label>
          <label>Auxilio de transporte<select><option>Sí (≤ 2 SMLMV)</option><option>No</option></select></label>
          <label>EPS<input /></label><label>AFP<input /></label><label>ARL<input /></label><label>Caja de compensación<input /></label>
          <label>Banco<input /></label><label>Cuenta<input /></label>
          <label className="full">Consentimiento de datos e imagen (firmado) — obligatorio para habilitar la marcación<input type="file" /></label>
        </div>
        <div className="nm-acts" style={{ marginTop: 12 }}><Btn>Guardar</Btn><Btn ghost>Cancelar</Btn></div>
      </div>
      <Nota><b>Regla:</b> una persona con turnos y sin contrato vigente, o con fecha de inicio futura, dispara un centinela y no entra a nómina como «Desconocido»: se corrige la ficha, no el cálculo.</Nota>
    </>
  );
}
const cap = (s: string) => (s || "").toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()).replace(/\bEps\b/, "EPS").replace(/\bAfp\b/, "AFP").replace(/\bArl\b/, "ARL");
