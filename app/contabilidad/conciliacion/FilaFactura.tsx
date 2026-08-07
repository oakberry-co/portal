import { guardarClasificacion } from "./actions";
import { ETIQUETA, type Estado } from "@/lib/estados";

export type FacturaRow = {
  cufe: string;
  nombre_proveedor: string | null;
  nit_proveedor: string;
  numero: string;
  fecha_emision: string | Date;
  total: string | null;
  responsabilidad_dian: string | null;
  estado: Estado;
  concepto: string | null;
  destino: string | null;
  plazo_dias: number | null;
  fecha_vencimiento: string | Date | null;
  concepto_sug: string | null;
  destino_sug: string | null;
  confianza: string | null;
};

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const fecha = (d: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

export function FilaFactura({
  f, conceptos, destinos,
}: { f: FacturaRow; conceptos: string[]; destinos: string[] }) {
  const conf = f.confianza != null ? Math.round(Number(f.confianza) * 100) : null;
  return (
    <tr>
      <td>
        <div className="prov">{f.nombre_proveedor ?? "—"}</div>
        <div className="muted">NIT {f.nit_proveedor}{f.responsabilidad_dian ? ` · ${f.responsabilidad_dian}` : ""}</div>
      </td>
      <td>
        <div>{f.numero}</div>
        <div className="muted">{fecha(f.fecha_emision)}</div>
      </td>
      <td className="num">{f.total != null ? cop.format(Number(f.total)) : "—"}</td>
      <td>
        <div className="muted">
          {f.concepto_sug ?? "—"} / {f.destino_sug ?? "—"}
          {conf != null ? ` · ${conf}%` : ""}
        </div>
      </td>

      <td colSpan={3}>
        <form action={guardarClasificacion} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 90px auto", gap: 8, alignItems: "center", minWidth: 460 }}>
          <input type="hidden" name="cufe" value={f.cufe} />
          <span>
            <input name="concepto" list="lista-conceptos" defaultValue={f.concepto ?? f.concepto_sug ?? ""} placeholder="Concepto" />
          </span>
          <span>
            <input name="destino" list="lista-destinos" defaultValue={f.destino ?? f.destino_sug ?? ""} placeholder="Destino" />
          </span>
          <span>
            <input name="plazo_dias" type="number" min={0} defaultValue={f.plazo_dias ?? ""} placeholder="días" />
          </span>
          <button type="submit">Guardar</button>
        </form>
        {f.fecha_vencimiento ? <div className="hint">Vence: {fecha(f.fecha_vencimiento)}</div> : null}
      </td>

      <td><span className={`badge ${f.estado}`}>{ETIQUETA[f.estado]}</span></td>
      <td></td>

      {/* datalists compartidos (se repiten por fila pero el navegador los deduplica por id) */}
      <datalist id="lista-conceptos">
        {conceptos.map((c) => <option key={c} value={c} />)}
      </datalist>
      <datalist id="lista-destinos">
        {destinos.map((d) => <option key={d} value={d} />)}
      </datalist>
    </tr>
  );
}
