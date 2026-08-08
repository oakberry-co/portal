import { getPool } from "@/lib/db";
import { MaestrosView, type MaestrosData } from "./MaestrosView";

export const dynamic = "force-dynamic";

async function cargar(): Promise<MaestrosData> {
  const pool = getPool();
  const [conceptos, destinos, proveedores, cuentas, retenciones, plazos] = await Promise.all([
    pool.query("SELECT nombre, cuenta_puc, activo, creado_por FROM maestro_conceptos ORDER BY activo DESC, nombre"),
    pool.query("SELECT nombre, short_code, activo, creado_por FROM maestro_destinos ORDER BY activo DESC, nombre"),
    pool.query("SELECT nit, nombre, concepto_default, destino_default, cuenta_puc_default, retencion_hint, plazo_dias, fuente FROM maestro_proveedores ORDER BY nombre NULLS LAST"),
    pool.query("SELECT codigo, nombre, activo FROM maestro_cuentas_puc ORDER BY codigo"),
    pool.query("SELECT nit_proveedor, tipo, tarifa, base, fuente FROM maestro_retenciones ORDER BY nit_proveedor"),
    pool.query("SELECT nit_proveedor, plazo_dias, creado_por FROM maestro_plazos ORDER BY nit_proveedor"),
  ]);
  return {
    conceptos: conceptos.rows, destinos: destinos.rows, proveedores: proveedores.rows,
    cuentas: cuentas.rows, retenciones: retenciones.rows, plazos: plazos.rows,
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
