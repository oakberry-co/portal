"use client";

import { useTransition } from "react";
import { agregarUsuario, cambiarRol, toggleUsuario } from "./actions";

export type UsuarioRow = { email: string; nombre: string | null; rol: string; activo: boolean; creado_en: string };

// Roles con etiqueta amigable (el valor es el rol real de la tabla `usuarios`).
const ROLES = [
  { v: "admin", l: "Administrador — acceso total" },
  { v: "causador", l: "Contador — retenciones + descargar pagos" },
  { v: "conciliador", l: "Conciliador — clasifica y retiene (sin pagos)" },
  { v: "pagador", l: "Pagador — opera pagos (sin clasificar)" },
];

export function ConfiguracionView({ usuarios, yo }: { usuarios: UsuarioRow[]; yo: string }) {
  const [pending, start] = useTransition();
  const call = (accion: (fd: FormData) => Promise<void>, fd: FormData, err: string) =>
    start(async () => { try { await accion(fd); } catch (e) { alert(err + ": " + (e as Error).message); } });

  function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    call(agregarUsuario, new FormData(form), "No se pudo dar acceso");
    form.reset();
  }
  function onRol(email: string, rol: string) {
    const fd = new FormData(); fd.set("email", email); fd.set("rol", rol);
    call(cambiarRol, fd, "No se pudo cambiar el rol");
  }
  function onToggle(email: string) {
    const fd = new FormData(); fd.set("email", email);
    call(toggleUsuario, fd, "No se pudo cambiar el estado");
  }

  return (
    <div className={"pg-config" + (pending ? " busy" : "")}>
      <section className="pg-cfg-card">
        <h3>Dar acceso a un correo</h3>
        <p className="muted">
          Escribe el correo de quien quieras que entre y elígele su rol. Los <b>@manelfoods.com entran
          como admin automáticamente</b> — agrégalos aquí solo si quieres darles un rol distinto. Los
          <b> externos</b> (contadores, etc.) SÍ deben agregarse aquí para poder entrar.
        </p>
        <form onSubmit={onAdd} className="pg-cfg-form">
          <input name="email" type="email" placeholder="correo@dominio.com" required />
          <input name="nombre" placeholder="Nombre (opcional)" />
          <select name="rol" defaultValue="causador">
            {ROLES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
          </select>
          <button type="submit" disabled={pending}>Dar acceso</button>
        </form>
      </section>

      <section className="pg-cfg-card">
        <h3>Quién tiene acceso</h3>
        <table className="mst-tabla">
          <thead><tr><th>Correo</th><th>Nombre</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
          <tbody>{usuarios.map((u) => {
            const esYo = u.email.toLowerCase() === yo.toLowerCase();
            return (
              <tr key={u.email} className={u.activo ? "" : "off"}>
                <td><b>{u.email}</b>{esYo && <span className="ft hum" style={{ marginLeft: 6 }}>tú</span>}</td>
                <td>{u.nombre ?? "—"}</td>
                <td>
                  <select value={u.rol} disabled={esYo || pending}
                    onChange={(e) => onRol(u.email, e.target.value)}
                    title={esYo ? "No puedes cambiar tu propio rol" : undefined}>
                    {ROLES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
                  </select>
                </td>
                <td>{u.activo ? <span className="ft hum">activo</span> : <span className="ft off">inactivo</span>}</td>
                <td>
                  <button type="button" className="mst-toggle on" disabled={esYo || pending}
                    onClick={() => onToggle(u.email)}
                    title={esYo ? "No puedes desactivarte a ti mismo" : ""}>
                    {u.activo ? "desactivar" : "activar"}
                  </button>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </section>
    </div>
  );
}
