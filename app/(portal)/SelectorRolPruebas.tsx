import { EN_PRUEBAS } from "@/lib/ambiente";
import { ROLES } from "@/lib/rol_pruebas";
import { mirarComoRol } from "./acciones_pruebas";
import type { Rol } from "@/lib/auth";

// LOS CUATRO ROLES, A UN CLIC — solo en el ambiente.
//
// Va en la barra de arriba y no en la franja roja, porque la franja también
// corona las dos landings PÚBLICAS (un proveedor no tiene por qué ver esto) y
// porque ahí no hay sesión que consultar.
//
// Son botones y no un `<select>`: un select necesita JavaScript o un segundo
// clic en "cambiar", y el rol activo se lee de un vistazo cuando está pintado.
export function SelectorRolPruebas({ rol }: { rol: Rol }) {
  if (!EN_PRUEBAS) return null; // comodidad; la seguridad está en la acción
  return (
    <form action={mirarComoRol} className="rolp">
      <span className="rolp-lbl">mirar como</span>
      {ROLES.map((r) => (
        <button
          key={r}
          type="submit"
          name="rol"
          value={r}
          aria-pressed={r === rol}
          className={"rolp-btn" + (r === rol ? " on" : "")}
        >
          {r}
        </button>
      ))}
    </form>
  );
}
