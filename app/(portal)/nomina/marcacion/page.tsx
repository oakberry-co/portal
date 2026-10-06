import { HOY, marcacionesDe, empleado, tienda, fechaLarga, turnosEntre, cargarEmpleados } from "../_lib/datos";
import { hora } from "../_lib/motor";
import { Head, Kpi, Pill, Btn, Nota } from "../_lib/ui";

// MARCACIÓN: lo que la fase 2 produce. Desde CUALQUIER celular: el colaborador
// entra con su usuario, selfie + GPS; dentro de la geocerca vale, fuera no.
export default async function Marcacion() {
  const EMPLEADOS = await cargarEmpleados();
  const ms = marcacionesDe(EMPLEADOS, HOY);
  const prog = turnosEntre(EMPLEADOS, HOY, HOY).filter((t) => t.tipo === "programado");
  const entradas = ms.filter((m) => m.tipo === "entrada");
  const fuera = entradas.filter((m) => !m.valida);
  const tarde = entradas.filter((m) => { const t = prog.find((x) => x.empleadoId === m.empleadoId); return t && m.ts.slice(11) > hm(t.inicio + 10 / 60); });
  return (
    <>
      <Head titulo="Marcación" sub={<>{fechaLarga(HOY)} · entradas y salidas con selfie y GPS · piloto <b>Zona G</b></>} acts={<Btn ghost>Exportar día</Btn>} />
      <div className="nm-kpis">
        <Kpi label="Turnos programados hoy" valor={prog.length} />
        <Kpi label="Entradas marcadas" valor={entradas.length} sub={`${prog.length - entradas.length} sin marcar`} tono={prog.length - entradas.length > 0 ? "warn" : "ok"} />
        <Kpi label="Fuera de geocerca" valor={fuera.length} sub="no valen; el supervisor decide" tono={fuera.length ? "bad" : "ok"} />
        <Kpi label="Llegadas tarde (>10 min)" valor={tarde.length} tono={tarde.length ? "warn" : "ok"} />
      </div>
      <div className="nm-grid2">
        <div>
          <div className="nm-card" style={{ background: "var(--lav-soft)" }}>
            <h3>Cómo se ve en el celular</h3>
            <div className="nm-phone"><div className="scr">
              <div style={{ fontSize: 12, color: "var(--lav)" }}>Hola, <b>Néstor</b> · Zona G</div>
              <div className="cam">🤳</div>
              <div className="gps">📍 A 23 m de Zona G · dentro del radio (120 m)<br />Turno de hoy: 1:00 PM – 9:00 PM</div>
              <button className="big" type="button">Marcar ENTRADA</button>
              <button className="big out" type="button">Marcar salida</button>
              <div style={{ fontSize: 10.5, color: "var(--lav)" }}>La foto y la ubicación se guardan como evidencia (60 días). Hora del servidor.</div>
            </div></div>
          </div>
          <div className="nm-card">
            <h3>Geocerca · Zona G</h3>
            <div className="nm-geo">
              <div className="r" /><div className="p t" style={{ left: "50%", top: "50%" }} title="Tienda" />
              <div className="p ok" style={{ left: "46%", top: "42%" }} /><div className="p ok" style={{ left: "56%", top: "58%" }} /><div className="p ok" style={{ left: "52%", top: "38%" }} />
              <div className="p bad" style={{ left: "14%", top: "28%" }} title="Fuera del radio" /><div className="p bad" style={{ left: "82%", top: "70%" }} />
            </div>
            <div className="nm-sub" style={{ marginTop: 6 }}>Radio 120 m. Verde = válida · Rojo = fuera del radio (no vale, queda registrada para revisión).</div>
          </div>
        </div>
        <div className="nm-card">
          <h3>Marcaciones de hoy <small>{ms.length} registros</small></h3>
          <div className="nm-scroll">
            <table className="nm-tabla">
              <thead><tr><th>Hora</th><th>Empleado</th><th>Tienda</th><th>Tipo</th><th>GPS</th><th>Estado</th></tr></thead>
              <tbody>{ms.map((m) => { const e = empleado(EMPLEADOS, m.empleadoId), t = tienda(m.tiendaId); return (
                <tr key={m.id}>
                  <td className="mono">{m.ts.slice(11)}</td><td className="nm-nombre">{e?.nombre_completo}</td><td>{t?.nombre}</td>
                  <td>{m.tipo === "entrada" ? <Pill tono="info">entrada</Pill> : <Pill tono="gris">salida</Pill>}</td>
                  <td className="nm-sub">{m.distanciaM} m · {m.metodo}</td>
                  <td>{m.valida ? <Pill tono="ok">válida</Pill> : <Pill tono="bad">fuera de radio</Pill>}</td>
                </tr>); })}</tbody>
            </table>
          </div>
        </div>
      </div>
      <Nota><b>Plan vs real:</b> cuando lo marcado difiere del turno planeado (llegó tarde, salió antes, se quedó más), el supervisor aprueba la diferencia. Solo lo <b>aprobado</b> pasa a nómina. Requisito previo: consentimiento de datos e imagen firmado en la ficha.</Nota>
    </>
  );
}
const hm = (x: number) => `${String(Math.floor(x)).padStart(2, "0")}:${String(Math.round((x % 1) * 60)).padStart(2, "0")}`;
