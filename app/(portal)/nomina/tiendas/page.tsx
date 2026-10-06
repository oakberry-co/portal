import { cargarEmpleados, TIENDAS } from "../_lib/datos";
import { hora } from "../_lib/motor";
import { Head, Btn, Pill, Nota } from "../_lib/ui";

// TIENDAS: vienen del maestro de tiendas del DW (staging.store_master); acá se
// agrega lo que la marcación necesita: horario y geocerca (radio en metros).
export default async function Tiendas() {
  const EMPLEADOS = await cargarEmpleados();
  return (
    <>
      <Head titulo="Centros / Tiendas" sub="Ubicaciones, horario y geocerca para la marcación. La lista nace de store_master del DW; no se duplica." acts={<Btn ghost>Sincronizar con el DW</Btn>} />
      <div className="nm-emp">
        {TIENDAS.map((t) => {
          const n = EMPLEADOS.filter((e) => e.punto === t.id).length;
          return (
            <div className="c" key={t.id}>
              <b>{t.nombre} {!t.activa && <Pill tono="bad">cerrada</Pill>}</b>
              <div className="r"><span>Dirección</span><span>{t.direccion}, {t.ciudad}</span></div>
              <div className="r"><span>Centro de costo</span><span>{t.centroCosto} · {t.nombre}</span></div>
              <div className="r"><span>Empleados</span><span>{n}{n === 0 && t.activa && <Pill tono="warn"> sin personal en el maestro</Pill>}</span></div>
              <div className="r"><span>Horario</span><span>{hora(t.apertura)} – {hora(t.cierre)}</span></div>
              <div className="r"><span>Geocerca</span><span>GPS ✓ · radio {t.radioM} m</span></div>
              <div className="r"><span>Almuerzo</span><span>0 min (configurable)</span></div>
              <div className="acts"><Btn ghost>Editar horario</Btn><Btn ghost>Ajustar geocerca</Btn></div>
            </div>
          );
        })}
      </div>
      <Nota><b>Diferencia con Oak-Crew:</b> Calle 140 existe en Oak-Crew con 4 personas pero no en el maestro; Viva Barranquilla sigue en el maestro con 2 personas y es tienda en cierre. Las dos listas están desactualizadas en sentidos opuestos: el maestro manda y RRHH lo corrige.</Nota>
    </>
  );
}
