import { getPool } from "@/lib/db";
import { MaestrosView, type MaestrosData } from "./MaestrosView";

export const dynamic = "force-dynamic";

async function cargar(): Promise<MaestrosData> {
  const pool = getPool();
  const [conceptos, destinos, proveedores, cuentas, retenciones] = await Promise.all([
    pool.query("SELECT nombre, cuenta_puc, activo, creado_por FROM maestro_conceptos ORDER BY activo DESC, nombre"),
    pool.query("SELECT nombre, short_code, activo, creado_por FROM maestro_destinos ORDER BY activo DESC, nombre"),
    pool.query("SELECT nit, nombre, concepto_default, destino_default, cuenta_puc_default, retencion_hint, plazo_dias, fuente FROM maestro_proveedores ORDER BY nombre NULLS LAST"),
    pool.query("SELECT codigo, nombre, activo FROM maestro_cuentas_puc ORDER BY codigo"),
    pool.query(`SELECT r.nit_proveedor AS nit, mp.nombre,
                  max(CASE WHEN r.tipo='ReteFuente' THEN r.tarifa END)::text AS retefuente,
                  max(CASE WHEN r.tipo='ReteICA'    THEN r.tarifa END)::text AS reteica,
                  max(CASE WHEN r.tipo='ReteIVA'    THEN r.tarifa END)::text AS reteiva,
                  bool_or(r.fuente='humano') AS humano
                FROM maestro_retenciones r
                LEFT JOIN maestro_proveedores mp ON mp.nit = r.nit_proveedor
                GROUP BY r.nit_proveedor, mp.nombre
                ORDER BY mp.nombre NULLS LAST`),
  ]);
  return {
    conceptos: conceptos.rows, destinos: destinos.rows, proveedores: proveedores.rows,
    cuentas: cuentas.rows, retenciones: retenciones.rows,
  } as MaestrosData;
}

export default async function MaestrosPage() {
  let data: MaestrosData;
  try {
    data = await cargar();
  } catch (e) {
    return (
      <div className="container">
        <h1>📚 Maestros</h1>
        <p className="hint">No se pudo leer la base: {(e as Error).message}</p>
      </div>
    );
  }
  return (
    <div className="container">
      <h1>📚 Maestros</h1>
      <p className="sub">
        La nomenclatura y las reglas que hacen que las facturas se clasifiquen solas. Cada maestro se
        siembra de su fuente y <b>crece con lo que pones a mano aquí y con lo que haces en la grilla</b> —
        la meta es que cada vez más facturas entren ya clasificadas.
      </p>
      <MaestrosView data={data} />
    </div>
  );
}
