import { TIENDAS } from "../_lib/datos";
import { Head, Btn, Vacio, Nota } from "../_lib/ui";

// TURNOS EXTRA: el supervisor publica un hueco, los colaboradores se postulan.
// En Oak-Crew nadie lo usa (0 registros). Fase 5: se construye solo con caso real.
export default function TurnosExtra() {
  return (
    <>
      <Head titulo="Turnos extra" sub="Huecos de personal que se publican y a los que el equipo se postula." acts={<Btn>+ Crear turno extra</Btn>} />
      <div className="nm-kpis"><div className="nm-kpi"><i>Abiertos</i><b>0</b></div><div className="nm-kpi"><i>Con voluntario</i><b>0</b></div><div className="nm-kpi"><i>Cubiertos este mes</i><b>0</b></div></div>
      <div className="nm-card"><Vacio>No hay turnos extra publicados.</Vacio></div>
      <div className="nm-card">
        <h3>Crear turno extra</h3>
        <div className="nm-form">
          <label>Ubicación<select>{TIENDAS.filter((t) => t.activa).map((t) => <option key={t.id}>{t.nombre}</option>)}</select></label>
          <label>Fecha<input type="date" /></label><label>Hora inicio<input type="time" defaultValue="08:00" /></label><label>Hora fin<input type="time" defaultValue="16:00" /></label>
          <label className="full">Motivo<input placeholder="Ej.: incapacidad de un compañero, evento" /></label>
        </div>
        <div className="nm-acts" style={{ marginTop: 12 }}><Btn>Publicar</Btn><Btn ghost>Cancelar</Btn></div>
      </div>
      <Nota><b>Fase 5.</b> Solo se construye cuando haya un caso real. El hueco que sí existe hoy lo detecta el optimizador venta-vs-personal (bowls por persona-hora), no este formulario.</Nota>
    </>
  );
}
