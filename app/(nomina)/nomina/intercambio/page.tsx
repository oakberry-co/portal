import { tiendas } from "@/lib/rrhh/db";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { Head, Aviso, Vacio, Nota } from "../_lib/ui";

// INTERCAMBIO DE TURNOS: un colaborador propone cambiar su turno con otro; el
// supervisor aprueba. Fase 5: en Oak-Crew está vacío desde agosto. La pantalla
// muestra el flujo; nada escribe todavía.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  const TS = (await tiendas()).filter((t) => t.activa && (p.tipo !== "admin_punto" || t.id === p.tiendaId));
  return (
    <>
      <Head titulo="Intercambio de turnos" sub="Un colaborador propone cambiar su turno con otro; el supervisor aprueba." />
      <Aviso sp={sp} />
      <div className="nm-card"><Vacio>No hay solicitudes de intercambio pendientes.</Vacio></div>
      <div className="nm-card">
        <h3>Proponer intercambio <small>fase 5 · inactivo</small></h3>
        <div className="nm-form">
          <label>Tienda<select disabled>{TS.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></label>
          <label>Mi turno (fecha)<input type="date" disabled /></label>
          <label>Compañero<input placeholder="Se elige de la tienda" disabled /></label>
          <label>Su turno (fecha)<input type="date" disabled /></label>
          <label className="full">Motivo<input placeholder="Ej.: cita médica, estudio" disabled /></label>
        </div>
        <div className="nm-acts" style={{ marginTop: 12 }}><button type="button" title="Todavía no hace nada">Proponer</button><button type="button" className="ghost" title="Todavía no hace nada">Cancelar</button></div>
      </div>
      <Nota><b>Fase 5.</b> En Oak-Crew está vacío desde agosto. Si aparece la necesidad, el flujo es: propone → acepta el compañero → aprueba el supervisor → se reescriben los dos turnos con bitácora.</Nota>
    </>
  );
}
