import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { redirect } from "next/navigation";
import { AREAS } from "@/lib/areas";
import { FormGasto } from "./FormGasto";

export const dynamic = "force-dynamic";

export default async function GastoSinFacturaPage() {
  const { rol } = await getCurrentUser();
  // PÁGINA PRIVADA: la abre alguien del equipo, ya autenticado. No es un portal
  // público — quien sube esto no es el proveedor, somos nosotros.
  if (!puede(rol, "clasificar")) redirect("/contabilidad/conciliacion");

  return (
    <div className="container">
      <h1>🧾 Gasto sin factura</h1>
      <p className="sub">
        Para lo que <b>nadie nos factura electrónicamente</b>: servicios públicos, impuestos,
        reembolsos. Se carga con su soporte y entra a <b>Conciliación de pagos</b> como un
        documento más — se le pone concepto y destino, se le practican retenciones, y de ahí
        pasa a Pagos.
      </p>
      <FormGasto areas={[...AREAS]} />
    </div>
  );
}
