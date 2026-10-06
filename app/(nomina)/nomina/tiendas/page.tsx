import { redirect } from "next/navigation";
import { empleados, tiendas, type Tienda } from "@/lib/rrhh/db";
import { guardarTienda } from "@/lib/rrhh/actions";
import { perspectiva, puedePlanificar } from "@/lib/rrhh/perspectiva";
import { hora } from "@/lib/rrhh/motor";
import { hm } from "@/lib/rrhh/fechas";
import { Head, Pill, Nota, Aviso, Vacio } from "../_lib/ui";

// TIENDAS: la lista nace del maestro de tiendas del DW (staging.store_master) y
// acá se agrega lo que la marcación y la planificación necesitan: horario,
// geocerca (radio en metros) y almuerzo. El admin de punto solo toca la suya.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  if (p.tipo === "colaborador") redirect("/nomina/perfil");
  const [TODAS, E] = await Promise.all([tiendas(), empleados()]);
  const lista = p.tipo === "admin_punto" ? TODAS.filter((t) => t.id === p.tiendaId) : TODAS;
  const activas = TODAS.filter((t) => t.activa).length;
  return (
    <>
      <Head titulo="Centros / Tiendas" sub={<>{activas} activas · {TODAS.length - activas} cerradas · horario, geocerca y almuerzo para la marcación. La lista nace de store_master del DW; no se duplica.</>} />
      <Aviso sp={sp} />
      {lista.length === 0 ? <Vacio>No hay tiendas para mostrar.</Vacio> : (
        <div className="nm-emp">
          {lista.map((t) => {
            const n = E.filter((e) => e.punto === t.id).length;
            const sinGps = t.lat == null || t.lng == null;
            return (
              <div className="c" key={t.id} id={`t${t.id}`}>
                <b>{t.nombre} {!t.activa && <Pill tono="bad">cerrada</Pill>}</b>
                <div className="r"><span>Dirección</span><span>{[t.direccion, t.ciudad].filter(Boolean).join(", ") || "—"}</span></div>
                <div className="r"><span>Centro de costo</span><span>{t.centro_costo ?? "—"}</span></div>
                <div className="r"><span>Empleados</span><span>{n}{n === 0 && t.activa && <Pill tono="warn"> sin personal en el maestro</Pill>}</span></div>
                <div className="r"><span>Horario</span><span>{hora(t.apertura)} – {hora(t.cierre)}</span></div>
                <div className="r"><span>Geocerca</span><span>{sinGps ? <Pill tono="bad">sin coordenadas: nadie puede marcar</Pill> : <>GPS ✓ · radio {t.radio_m} m</>}</span></div>
                <div className="r"><span>Almuerzo</span><span>{t.almuerzo_min} min</span></div>
                {puedePlanificar(p, t.id) && (
                  <details className="nm-det" style={{ marginTop: 9 }}>
                    <summary>Editar horario y geocerca</summary>
                    <FormTienda t={t} />
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Nota><b>Diferencia con Oak-Crew:</b> acá el maestro manda. Una tienda sin coordenadas no deja marcar a nadie; una tienda cerrada no acepta turnos. El almuerzo se descuenta del tramo diurno de cada turno programado, la misma cifra en todas las pantallas.</Nota>
    </>
  );
}

/** Lo configurable de una tienda; nombre, dirección y centro de costo vienen del DW y no se editan acá. */
function FormTienda({ t }: { t: Tienda }) {
  return (
    <form action={guardarTienda} style={{ marginTop: 10 }}>
      <input type="hidden" name="id" value={t.id} />
      <input type="hidden" name="volver" value={`/nomina/tiendas#t${t.id}`} />
      <div className="nm-form" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <label>Apertura<input name="apertura" type="time" defaultValue={hm(t.apertura)} required /></label>
        <label>Cierre<input name="cierre" type="time" defaultValue={hm(t.cierre)} required /></label>
        <label>Radio geocerca (m)<input name="radio_m" type="number" min={30} max={1000} defaultValue={t.radio_m} required /></label>
        <label>Almuerzo (min)<input name="almuerzo_min" type="number" min={0} max={120} defaultValue={t.almuerzo_min} required /></label>
        <label>Latitud<input name="lat" type="number" step="any" defaultValue={t.lat ?? ""} placeholder="4.6xxxx" /></label>
        <label>Longitud<input name="lng" type="number" step="any" defaultValue={t.lng ?? ""} placeholder="-74.0xxxx" /></label>
        <label>Activa<select name="activa" defaultValue={t.activa ? "si" : "no"}><option value="si">Sí</option><option value="no">No (cerrada)</option></select></label>
      </div>
      <div className="nm-acts" style={{ marginTop: 10 }}><button type="submit">Guardar tienda</button></div>
    </form>
  );
}
