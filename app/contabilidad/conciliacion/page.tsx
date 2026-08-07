import { pool } from "@/lib/db";
import { ETIQUETA, type Estado } from "@/lib/estados";
import { FilaFactura, type FacturaRow } from "./FilaFactura";

export const dynamic = "force-dynamic"; // siempre lee el estado vivo

async function cargar(): Promise<{ filas: FacturaRow[]; conceptos: string[]; destinos: string[] }> {
  const filas = await pool.query<FacturaRow>(
    `SELECT f.cufe, f.nombre_proveedor, f.nit_proveedor, f.numero, f.fecha_emision,
            f.total, f.responsabilidad_dian,
            e.estado, e.concepto, e.destino, e.plazo_dias, e.fecha_vencimiento,
            p.concepto_sug, p.destino_sug, p.confianza
       FROM facturas f
       JOIN factura_estado e USING (cufe)
       LEFT JOIN factura_propuesta p USING (cufe)
      ORDER BY (e.estado = 'capturada') DESC, f.fecha_emision DESC`
  );
  const c = await pool.query<{ nombre: string }>("SELECT nombre FROM maestro_conceptos WHERE activo ORDER BY nombre");
  const d = await pool.query<{ nombre: string }>("SELECT nombre FROM maestro_destinos WHERE activo ORDER BY nombre");
  return {
    filas: filas.rows,
    conceptos: c.rows.map((r) => r.nombre),
    destinos: d.rows.map((r) => r.nombre),
  };
}

export default async function ConciliacionPage() {
  const { filas, conceptos, destinos } = await cargar();
  const porClasificar = filas.filter((f) => f.estado === "capturada").length;

  return (
    <div className="container">
      <h1>🧾 Conciliación de pagos</h1>
      <p className="sub">
        {filas.length} facturas · <strong>{porClasificar}</strong> por clasificar.
        El humano revisa <strong>concepto · destino · plazo</strong>; cada cambio queda en la bitácora.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Proveedor</th>
              <th>Factura</th>
              <th className="num">Valor</th>
              <th>Propuesta máquina</th>
              <th>Concepto</th>
              <th>Destino</th>
              <th>Plazo</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <FilaFactura key={f.cufe} f={f} conceptos={conceptos} destinos={destinos} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="chain-note">
        🔒 Cada guardado escribe el cambio <em>y</em> su evento en la misma transacción; la bitácora
        es append-only y encadenada por hash (imposible editar o borrar sin romper la cadena).
      </p>
      <p className="chain-note">
        Estados: {Object.entries(ETIQUETA).map(([k, v]) => `${v}`).join(" → ")}
      </p>
    </div>
  );
}
