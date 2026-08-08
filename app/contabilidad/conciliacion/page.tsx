import { getPool } from "@/lib/db";
import { ETIQUETA } from "@/lib/estados";
import { ConciliacionView } from "./ConciliacionView";
import { SyncPanel } from "./SyncPanel";
import type { FacturaRow } from "./FacturaCard";

export const dynamic = "force-dynamic"; // siempre lee el estado vivo

type SyncStatus = { ultima: string | null; nuevas: number | null; pendiente: string | null };

function haceCuanto(d: Date): string {
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return d.toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function hora(d: Date): string {
  return d.toLocaleString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" });
}

async function cargar(): Promise<{ filas: FacturaRow[]; conceptos: string[]; destinos: string[]; sync: SyncStatus }> {
  const pool = getPool();
  const filas = await pool.query<FacturaRow>(
    `SELECT f.cufe, f.nombre_proveedor, f.nit_proveedor, f.numero, f.fecha_emision,
            f.subtotal, f.iva, f.total, f.responsabilidad_dian, f.sincronizado_en,
            e.estado, e.concepto, e.destino, e.plazo_dias, e.fecha_vencimiento,
            e.retencion_ok, e.reten_total, e.retefuente, e.reteiva, e.reteica, e.valor_a_pagar,
            p.concepto_sug, p.destino_sug, p.confianza,
            p.retefuente_sug, p.reteiva_sug, p.reteica_sug
       FROM facturas f
       JOIN factura_estado e USING (cufe)
       LEFT JOIN factura_propuesta p USING (cufe)
      ORDER BY (e.estado = 'capturada') DESC, f.fecha_emision DESC`
  );
  const c = await pool.query<{ nombre: string }>("SELECT nombre FROM maestro_conceptos WHERE activo ORDER BY nombre");
  const d = await pool.query<{ nombre: string }>("SELECT nombre FROM maestro_destinos WHERE activo ORDER BY nombre");

  // Estado del sync: último evento 'sync' + si hay una solicitud pendiente.
  const s = await pool.query<{ creado_en: Date; nuevas: number | null }>(
    "SELECT creado_en, (valor_nuevo->>'facturas_nuevas')::int AS nuevas FROM eventos WHERE tipo = 'sync' ORDER BY id DESC LIMIT 1"
  );
  const pend = await pool.query<{ solicitado_por: string; solicitado_en: Date }>(
    "SELECT solicitado_por, solicitado_en FROM sync_solicitudes WHERE estado = 'pendiente' ORDER BY id DESC LIMIT 1"
  );
  const sync: SyncStatus = {
    ultima: s.rows[0] ? haceCuanto(new Date(s.rows[0].creado_en)) : null,
    nuevas: s.rows[0]?.nuevas ?? null,
    pendiente: pend.rows[0]
      ? `Solicitada por ${pend.rows[0].solicitado_por.split("@")[0]} · ${hora(new Date(pend.rows[0].solicitado_en))}`
      : null,
  };

  return { filas: filas.rows, conceptos: c.rows.map((r) => r.nombre), destinos: d.rows.map((r) => r.nombre), sync };
}

export default async function ConciliacionPage() {
  let data: Awaited<ReturnType<typeof cargar>>;
  try {
    data = await cargar();
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

  const { filas, conceptos, destinos, sync } = data;

  return (
    <div className="container">
      <h1>🧾 Conciliación de pagos</h1>
      <SyncPanel ultima={sync.ultima} nuevas={sync.nuevas} pendiente={sync.pendiente} />
      <ConciliacionView filas={filas} conceptos={conceptos} destinos={destinos} />

      <p className="chain-note">
        🔒 Cada guardado escribe el cambio <em>y</em> su evento en la misma transacción; la bitácora
        es append-only y encadenada por hash (imposible editar o borrar sin romper la cadena).
      </p>
      <p className="chain-note">Estados: {Object.values(ETIQUETA).join(" → ")}</p>
    </div>
  );
}
