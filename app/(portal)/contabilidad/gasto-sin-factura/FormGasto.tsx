"use client";

import { useActionState, useState } from "react";
import { crearGastoSinFactura } from "./actions";
import { TIPOS } from "./tipos";
import type { Resultado } from "@/lib/resultado";

/** El valor se escribe como se escribe en Colombia: con puntos de miles. Se
 *  formatea mientras se teclea para que nadie mande $9.870 creyendo que puso
 *  $9.870.000 — el servidor vuelve a limpiarlo de todos modos. */
const milesCO = (raw: string) => {
  const d = raw.replace(/[^\d]/g, "");
  return d ? Number(d).toLocaleString("es-CO") : "";
};

export function FormGasto({ areas }: { areas: string[] }) {
  const [res, action, pending] = useActionState<Resultado | null, FormData>(crearGastoSinFactura, null);
  const [tipo, setTipo] = useState<string>("servicio_publico");
  const [valor, setValor] = useState("");
  const [archivo, setArchivo] = useState<string | null>(null);

  // El formulario NO se desmonta al terminar: si algo salió mal, lo escrito
  // sigue ahí. Rehacerlo desde cero por un campo es lo que hace que la gente
  // vuelva a pagar por fuera del portal.
  return (
    <form action={action} className="card gasto-form">
      <div className="gasto-grid">
        <label className="campo">
          <span>¿Qué es?</span>
          <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} required>
            {TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.label}</option>)}
          </select>
          <i>{TIPOS.find((t) => t.valor === tipo)?.ayuda}</i>
        </label>

        {/* El "otro, ¿cuál?": obligatorio, porque un "otro" sin decir cuál es una
            fila que dentro de un mes nadie sabe leer. */}
        <label className="campo">
          <span>{tipo === "otro" ? "¿Cuál gasto?" : "Detalle (opcional)"}</span>
          <input name="tipo_detalle" required={tipo === "otro"}
                 placeholder={tipo === "otro" ? "Impuesto predial BOG001" : "Energía · agosto · Zona T"} />
        </label>

        <label className="campo">
          <span>¿A quién se le paga?</span>
          <input name="razon_social" required placeholder="ENEL COLOMBIA / EPM / …" />
        </label>

        <label className="campo">
          <span>NIT o cédula</span>
          <input name="num_doc" required inputMode="numeric" placeholder="860063875" />
          <i>Sin dígito de verificación. De este número sale la cuenta a la que se transfiere.</i>
        </label>

        <label className="campo">
          <span>N° del recibo</span>
          <input name="numero" placeholder="El consecutivo del documento" />
        </label>

        <label className="campo">
          <span>Fecha del documento</span>
          <input name="fecha_documento" type="date" />
          <i>Desde acá corre el plazo de pago.</i>
        </label>

        <label className="campo">
          <span>Valor</span>
          <input name="valor" required inputMode="numeric" value={valor}
                 onChange={(e) => setValor(milesCO(e.target.value))} placeholder="480.000" />
          <i>En pesos. El punto separa miles.</i>
        </label>

        <label className="campo">
          <span>Área (opcional)</span>
          <select name="area" defaultValue="">
            <option value="">—</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <i>El destino contable se elige después, en Conciliación.</i>
        </label>

        <label className="campo ancho">
          <span>Descripción (opcional)</span>
          <input name="descripcion" placeholder="Qué se pagó, para qué" />
        </label>

        <label className="campo ancho">
          <span>Documento soporte</span>
          <input name="doc_soporte" type="file" required accept=".pdf,.doc,.docx,image/*"
                 onChange={(e) => setArchivo(e.target.files?.[0]?.name ?? null)} />
          <i>{archivo ? `📎 ${archivo}` : "El recibo o la factura del servicio. Es obligatorio: un pago sin respaldo es justo lo que esto viene a evitar."}</i>
        </label>
      </div>

      <div className="gasto-pie">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Guardando…" : "Guardar y enviar a Conciliación"}
        </button>
        {res && !res.ok && <span className="gasto-err">⚠ {res.error}</span>}
        {res && res.ok && (
          <span className="gasto-ok">
            ✓ Guardado. Ya está en <a href="/contabilidad/conciliacion">Conciliación de pagos</a>, esperando concepto y destino.
          </span>
        )}
      </div>
    </form>
  );
}
