import { redirect } from "next/navigation";

// RD ya no tiene pantalla propia (19-nov-2026): se revisa en Contabilidad ›
// Cuentas de cobro y se paga en Contabilidad › Pagos, con el selector de país.
// Esta ruta queda para marcadores y enlaces viejos. En esta carpeta siguen la
// bandeja (BandejaRD.tsx), sus acciones, su cargador y el Excel del 606.
export default function CuentasCobroRDRedirige() {
  redirect("/contabilidad/cuentas-de-cobro?pais=rd");
}
