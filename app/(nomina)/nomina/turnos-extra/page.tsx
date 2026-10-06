import { tiendas } from "@/lib/rrhh/db";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { Head, Aviso, Vacio, Nota } from "../_lib/ui";

// TURNOS EXTRA: el supervisor publica un hueco, los colaboradores se postulan.
// En Oak-Crew nadie lo usa (0 registros). Fase 5: se construye solo con caso
// real. La pantalla queda para que se vea el flujo; nada escribe todavía.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  const TS = (await tiendas()).filter((t) => t.activa && (p.tipo !== "admin_punto" || t.id === p.tiendaId));
  return (
    <>
      <Head titulo="Turnos extra" sub="Huecos de personal que se publican y a los que el equipo se postula." acts={<button type="button" title="Todavía no hace nada">+ Crear turno extra</button>} />
      <Aviso sp={sp} />
      <div className="nm-kpis"><div className="nm-kpi"><i>Abiertos</i><b>0</b></div><div className="nm-kpi"><i>Con voluntario</i><b>0</b></div><div className="nm-kpi"><i>Cubiertos este mes</i><b>0</b></div></div>
      <div className="nm-card"><Vacio>No hay turnos extra publicados.</Vacio></div>
      <div className="nm-card">
        <h3>Crear turno extra <small>fase 5 · inactivo</small></h3>
        <div className="nm-form">
          <label>Ubicación<select disabled>{TS.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></label>
          <label>Fecha<input type="date" disabled /></label><label>Hora inicio<input type="time" defaultValue="08:00" disabled /></label><label>Hora fin<input type="time" defaultValue="16:00" disabled /></label>
          <label className="full">Motivo<input placeholder="Ej.: incapacidad de un compañero, evento" disabled /></label>
        </div>
        <div className="nm-acts" style={{ marginTop: 12 }}><button type="button" title="Todavía no hace nada">Publicar</button><button type="button" className="ghost" title="Todavía no hace nada">Cancelar</button></div>
      </div>
      <Nota><b>Fase 5.</b> Solo se construye cuando haya un caso real. El hueco que sí existe hoy lo detecta el optimizador venta-vs-personal (bowls por persona-hora), no este formulario.</Nota>
    </>
  );
}
