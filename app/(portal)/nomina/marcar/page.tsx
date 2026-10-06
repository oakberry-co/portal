import { perspectiva } from "@/lib/rrhh/perspectiva";
import { empleados, tienda, marcaciones, turnos } from "@/lib/rrhh/db";
import { ahoraBogota } from "@/lib/rrhh/fechas";
import { hora } from "@/lib/rrhh/motor";
import { Head, Aviso, Nota, Pill } from "../_lib/ui";
import { Marcador } from "./Marcador";

// MARCAR: la pantalla del celular. Selfie + GPS, hora del servidor. Desde
// cualquier teléfono: la identidad es el usuario con el que entró.
export default async function Marcar({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  const { fecha } = ahoraBogota();
  // RRHH sin ficha propia puede marcar "por" alguien solo en pruebas (elige con ?e=)
  const E = p.tipo === "rrhh" && !p.empleado ? await empleados() : [];
  const e = p.tipo === "rrhh" ? (p.empleado ?? E.find((x) => String(x.activo_id) === sp.e) ?? E[0] ?? null) : p.empleado;
  if (!e) return <><Head titulo="Marcar" /><Nota>Tu usuario no está en el maestro de empleados: no hay a quién marcarle.</Nota></>;
  const [t, hoy, turnoHoy] = await Promise.all([tienda(e.punto), marcaciones(fecha, fecha, { empleadoId: e.activo_id }), turnos(fecha, fecha, { empleadoId: e.activo_id })]);
  const ult = hoy.at(-1);
  const siguiente: "entrada" | "salida" = !ult || ult.tipo === "salida" ? "entrada" : "salida";
  const th = turnoHoy[0];
  return (
    <>
      <Head titulo="Marcar" sub={<>Hola, <b>{e.nombre_completo.split(" ").at(-1)}</b> · {t?.nombre ?? e.punto}</>} />
      <Aviso sp={sp} />
      {p.tipo === "rrhh" && !p.empleado && E.length > 0 && (
        <form method="get" className="nm-filtros"><label className="nm-sub">Marcar como (solo RRHH/pruebas)</label><select name="e" defaultValue={e.activo_id}>{E.map((x) => <option key={x.activo_id} value={x.activo_id}>{x.nombre_completo}</option>)}</select><button className="ghost" type="submit">Ir</button></form>
      )}
      <div className="nm-grid2">
        <div className="nm-card" style={{ background: "var(--lav-soft)" }}>
          {!e.consentimiento_firmado_en ? (
            <div className="nm-phone"><div className="scr"><div className="cam">🔒</div><p>Falta tu <b>consentimiento de datos e imagen</b> firmado. Pídelo a RRHH para poder marcar.</p></div></div>
          ) : !t ? <Nota>Tu tienda no está configurada.</Nota> : (
            <Marcador empleadoId={e.activo_id} tienda={{ nombre: t.nombre, lat: t.lat, lng: t.lng, radio: t.radio_m }} siguiente={siguiente}
              turno={th ? (th.tipo === "programado" ? `${hora(th.inicio)} – ${hora(th.fin)}` : th.tipo === "descanso" ? "Descanso" : "Permiso") : "Sin turno planeado hoy"} />
          )}
        </div>
        <div className="nm-card">
          <h3>Hoy <small>{fecha}</small></h3>
          {hoy.length === 0 ? <p className="nm-sub">Todavía no has marcado.</p> : (
            <table className="nm-tabla"><tbody>{hoy.map((m) => <tr key={m.id}><td className="mono">{m.hhmm}</td><td>{m.tipo}</td><td className="nm-sub">{m.distancia_m} m · {m.metodo}</td><td>{m.dentro ? <Pill tono="ok">válida</Pill> : <Pill tono="bad">fuera de radio</Pill>}{m.estado !== "registrada" && <Pill tono={m.estado === "aprobada" ? "ok" : "bad"}>{m.estado}</Pill>}</td></tr>)}</tbody></table>
          )}
          <h3 style={{ marginTop: 16 }}>Cómo funciona</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.8 }}>
            <li>Permite la <b>cámara</b> y la <b>ubicación</b> cuando el navegador lo pida.</li>
            <li>Tómate la foto y toca <b>Marcar</b>. La hora la pone el servidor, no el teléfono.</li>
            <li>Si estás a más de {t?.radio_m ?? 120} m de la tienda, queda registrada <b>fuera de radio</b> y el administrador decide si vale.</li>
            <li>La foto se guarda como evidencia (60 días). Solo la ve RRHH y tu administrador.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
