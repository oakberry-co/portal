import { redirect } from "next/navigation";

// El formulario de RD vive en /cuentas-de-cobro?pais=rd: la MISMA página que
// Colombia, con el selector de país (19-nov-2026). Esta ruta queda solo para
// los enlaces que ya se mandaron por WhatsApp. redirect() le pone solo el
// prefijo del ambiente de pruebas. El formulario y su acción siguen en esta
// carpeta (FormCuentaCobroRD.tsx, actions.ts) y los importa la página de arriba.
export default function CuentaDeCobroRDRedirige() {
  redirect("/cuentas-de-cobro?pais=rd");
}
