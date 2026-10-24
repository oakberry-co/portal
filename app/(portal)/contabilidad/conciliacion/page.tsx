import { ETIQUETA } from "@/lib/estados";
import { ConciliacionView } from "./ConciliacionView";
import { SyncPanel } from "./SyncPanel";
import { ResumenConciliacion } from "./ResumenConciliacion";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { cargarConciliacion } from "./_cargar";

export const dynamic = "force-dynamic"; // siempre lee el estado vivo

export default async function ConciliacionPage() {
  let data: Awaited<ReturnType<typeof cargarConciliacion>>;
  try {
    data = await cargarConciliacion();
  } catch (e) {
    // El deploy funciona; solo falta la base (o el esquema). Mensaje amable, no un 500.
    return (
      <div className="container">
        <h1>🧾 Conciliación de pagos</h1>
        <p className="sub">La app está desplegada ✅, pero falta conectar la base de datos.</p>
        <div className="card" style={{ maxWidth: 680 }}>
          <h3>Falta la base de datos</h3>
          <p>
            Conecta Neon en Vercel (Storage → Create Database → Neon) y aplica{" "}
            <code>db/schema.sql</code>. Luego esta pantalla se llena sola.
          </p>
          <p className="hint" style={{ marginTop: 10 }}>Detalle: {(e as Error).message}</p>
        </div>
      </div>
    );
  }

  const { filas, conceptos, destinos, sync, docsNoDian } = data;
  const { rol } = await getCurrentUser();
  const puedeClasificar = puede(rol, "clasificar");  // contador (causador) = false
  // El contador SÍ sube el Excel de retenciones: es justo su trabajo.
  const puedeRetenciones = puede(rol, "retenciones");

  return (
    <div className="container">
      <h1>🧾 Conciliación de pagos</h1>
      <SyncPanel ultima={sync.ultima} nuevas={sync.nuevas} pendiente={sync.pendiente} />
      <ResumenConciliacion filas={filas} puedeClasificar={puedeClasificar} />
      <ConciliacionView filas={filas} conceptos={conceptos} destinos={destinos} noDian={docsNoDian}
                        puedeClasificar={puedeClasificar} puedeExport={puede(rol, "retenciones")}
                        puedeRetenciones={puedeRetenciones}
                        puedeRevertir={puede(rol, "revertir_pago")} puedeCruzar={puede(rol, "cruzar_nota")} />

      <p className="chain-note">
        🔒 Cada guardado escribe el cambio <em>y</em> su evento en la misma transacción; la bitácora
        es append-only y encadenada por hash (imposible editar o borrar sin romper la cadena).
      </p>
      <p className="chain-note">Estados: {Object.values(ETIQUETA).join(" → ")}</p>
    </div>
  );
}
