import { getCurrentUser } from "@/lib/auth";
import { Head, Btn, Pill, Nota } from "../_lib/ui";

export default async function Perfil() {
  const u = await getCurrentUser();
  return (
    <>
      <Head titulo="Mi perfil" sub="Lo que ve cada colaborador al entrar desde su celular." />
      <div className="nm-grid2">
        <div className="nm-card"><h3>Datos</h3>
          <div className="nm-form"><label>Correo<input readOnly value={u.email} /></label><label>Rol<input readOnly value={u.rol} /></label><label>Celular<input placeholder="+57 …" /></label><label>Tienda<input readOnly value="—" /></label></div>
          <div className="nm-acts" style={{ marginTop: 12 }}><Btn ghost>Cambiar celular (código por WhatsApp)</Btn><Btn ghost>Cambiar contraseña</Btn></div>
        </div>
        <div className="nm-card"><h3>Mi quincena</h3>
          <table className="nm-tabla"><tbody><tr><td>Horas marcadas</td><td className="num">72h</td></tr><tr><td>Recargos acumulados</td><td className="num">$212.000</td></tr><tr><td>Vacaciones disponibles</td><td className="num">6,5 d</td></tr><tr><td>Consentimiento datos/imagen</td><td><Pill tono="ok">firmado</Pill></td></tr></tbody></table>
          <div className="nm-acts" style={{ marginTop: 12 }}><Btn>Ver mi horario</Btn><Btn ghost>Pedir permiso</Btn></div>
        </div>
      </div>
      <Nota>El colaborador ve su horario, sus horas y lo que le van a pagar; <b>no</b> ve la nómina de los demás. El administrador de punto ve su tienda. RRHH y el decisor ven todo.</Nota>
    </>
  );
}
