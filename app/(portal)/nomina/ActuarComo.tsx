import { actuarComo } from "@/lib/rrhh/actions";
import type { Perspectiva } from "@/lib/rrhh/perspectiva";

// SOLO EN PRUEBAS: actuar como cualquier persona del maestro inventado, para
// validar las tres vistas (RRHH · administrador de punto · colaborador) con un
// solo login. En producción la perspectiva sale del correo con el que entras.
export function ActuarComo({ p, empleados }: { p: Perspectiva; empleados: { id: number; nombre: string; rol: string; tienda: string }[] }) {
  const actual = p.tipo === "rrhh" ? "rrhh" : String(p.empleado.activo_id);
  const admins = empleados.filter((e) => e.rol === "admin_punto"), cols = empleados.filter((e) => e.rol === "colaborador");
  return (
    <form action={actuarComo} className="nm-como">
      <label>Actuar como <small>(solo pruebas)</small></label>
      <select name="como" defaultValue={actual}>
        <option value="rrhh">RRHH / decisor (ve todo)</option>
        <optgroup label="Administradores de punto">{admins.map((e) => <option key={e.id} value={e.id}>{e.tienda} · {e.nombre}</option>)}</optgroup>
        <optgroup label="Colaboradores">{cols.map((e) => <option key={e.id} value={e.id}>{e.tienda} · {e.nombre}</option>)}</optgroup>
      </select>
      <input type="hidden" name="volver" value="/nomina" />
      <button type="submit">Cambiar</button>
      <div className="nm-como-quien">{p.tipo === "rrhh" ? "Viendo como RRHH" : `${p.tipo === "admin_punto" ? "Admin de punto" : "Colaborador"}: ${p.empleado.nombre_completo}`}</div>
    </form>
  );
}
