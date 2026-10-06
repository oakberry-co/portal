import { Head, Vacio, Nota } from "../_lib/ui";

export default function Intercambio() {
  return (
    <>
      <Head titulo="Intercambio de turnos" sub="Un colaborador propone cambiar su turno con otro; el supervisor aprueba." />
      <div className="nm-card"><Vacio>No hay solicitudes de intercambio pendientes.</Vacio></div>
      <Nota><b>Fase 5.</b> En Oak-Crew está vacío desde agosto. Si aparece la necesidad, el flujo es: propone → acepta el compañero → aprueba el supervisor → se reescriben los dos turnos con bitácora.</Nota>
    </>
  );
}
