import { cargarEmpleados, TIENDAS, HOY, lunesDe, mas, DIAS, fechaCorta, fechaLarga, turnosEntre, tienda } from "../_lib/datos";
import { esDominical, hora, horasDe, sumar, horasVacias, totalTrabajadas, reglasEn, hh } from "../_lib/motor";
import { Head, Btn, Sel, Pill, Nota } from "../_lib/ui";

// PLANIFICACIÓN: la grilla semanal por tienda. La cargan los administradores
// de punto (responsables). Valida al guardar lo que Oak-Crew no valida:
// solapes, 42 h/sem, descanso entre turnos, semana incompleta.
export default async function Planificacion({ searchParams }: { searchParams?: Promise<{ t?: string }> }) {
  const EMPLEADOS = await cargarEmpleados();
  const sp = await searchParams;
  const tId = (TIENDAS.find((x) => x.id === sp?.t) ?? TIENDAS.find((x) => x.id === "ZONA G") ?? TIENDAS[0]).id;
  const t = tienda(tId)!;
  const lun = lunesDe(HOY), dom = mas(lun, 6);
  const dias = Array.from({ length: 7 }, (_, i) => mas(lun, i));
  const turnos = turnosEntre(EMPLEADOS, lun, dom).filter((x) => x.tiendaId === tId);
  const emps = EMPLEADOS.filter((e) => e.punto === tId);
  const r = reglasEn(HOY);
  return (
    <>
      <Head titulo="Planificación" sub={<>Semana {fechaLarga(lun)} — {fechaLarga(dom)} · <b>{t.nombre}</b> · horario {hora(t.apertura)}–{hora(t.cierre)}</>}
        acts={<><Btn ghost>‹ Semana anterior</Btn><Btn ghost>Semana siguiente ›</Btn><Btn ghost>Copiar semana anterior</Btn><Btn>Publicar semana</Btn></>} />
      <div className="nm-filtros">
        <label style={{ fontSize: 12, color: "var(--lav)", fontWeight: 700 }}>Tienda</label>
        <Sel opts={TIENDAS.filter((x) => x.activa).map((x) => x.nombre)} def={t.nombre} />
        <label style={{ fontSize: 12, color: "var(--lav)", fontWeight: 700 }}>Almuerzo</label>
        <input defaultValue="0" style={{ width: 60 }} /> <span className="nm-sub">min · vigente desde 1-sep-2026</span>
        <span className="sep" /><Btn ghost>+ Agregar empleado de otra tienda</Btn>
      </div>
      <div className="nm-card">
        <div className="nm-sem">
          <div className="h" style={{ alignItems: "flex-start" }}>Empleado · h/sem</div>
          {dias.map((d, i) => <div key={d} className={"h" + (esDominical(d) ? " dom" : "")}>{DIAS[i]}<small>{fechaCorta(d)}</small></div>)}
          {emps.map((e) => {
            const mios = turnos.filter((x) => x.empleadoId === e.activo_id);
            const tot = totalTrabajadas(mios.reduce((a, x) => sumar(a, horasDe(x)), horasVacias()));
            const tono = tot > r.jornadaSemanal ? "bad" : tot >= r.jornadaSemanal - 2 ? "warn" : "ok";
            return (
              <>
                <div className="e" key={e.activo_id}><b>{e.nombre_completo}</b><small>{hh(tot)}/{r.jornadaSemanal}h <Pill tono={tono}>{tono === "bad" ? "excede" : tono === "warn" ? "al límite" : "ok"}</Pill></small></div>
                {dias.map((d) => { const x = mios.find((y) => y.fecha === d); return (
                  <div key={d} className={esDominical(d) ? "dom" : ""}>
                    {!x ? <span className="nm-chip add" title="Agregar turno">+</span>
                      : x.tipo === "descanso" ? <span className="nm-chip desc">😴 Descanso</span>
                      : x.tipo === "ausencia" ? <span className="nm-chip aus">Permiso</span>
                      : <span className={"nm-chip " + (esDominical(d) ? "f" : horasDe(x).nocturna > 0 ? "n" : "d")}>{hora(x.inicio)} – {hora(x.fin)}</span>}
                  </div>); })}
              </>
            );
          })}
        </div>
      </div>
      <div className="nm-grid2">
        <div className="nm-card">
          <h3>Asignar turno</h3>
          <div className="nm-form">
            <label>Empleado<select>{emps.map((e) => <option key={e.activo_id}>{e.nombre_completo}</option>)}</select></label>
            <label>Tipo<select><option>Turno regular</option><option>Día de descanso (7 h)</option></select></label>
            <label>Fecha<select>{dias.map((d, i) => <option key={d}>{DIAS[i]} {fechaCorta(d)}</option>)}</select></label>
            <label>Hora inicio<select>{[8, 9, 10, 11, 12, 13, 14].map((h) => <option key={h}>{hora(h)}</option>)}</select></label>
            <label>Hora fin<select>{[16, 17, 18, 19, 20, 21, 22].map((h) => <option key={h}>{hora(h)}</option>)}</select></label>
          </div>
          <div className="nm-acts" style={{ marginTop: 12 }}><Btn>Guardar</Btn><Btn ghost>Cancelar</Btn><Btn danger>Borrar turno</Btn></div>
        </div>
        <div className="nm-card">
          <h3>Validaciones al guardar</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.8 }}>
            <li>No se solapa con otro turno de la misma persona.</li>
            <li>Máximo {r.jornadaSemanal} h/semana y 9 h/día (jornada flexible art. 161d).</li>
            <li>Descanso mínimo entre salida y siguiente entrada.</li>
            <li>Un día de descanso por semana; se avisa si lleva 3 domingos seguidos.</li>
            <li>Dentro del horario de la tienda ({hora(t.apertura)}–{hora(t.cierre)}).</li>
            <li>Semana incompleta (menos de 3 turnos por persona) → centinela a RRHH.</li>
          </ul>
        </div>
      </div>
      <Nota>Se planea hasta 2 meses adelante. Lo planeado alimenta el <b>forecast de costo</b> por tienda y día; la nómina sale de la <b>marcación</b>, no de esta grilla.</Nota>
    </>
  );
}
