"use client";

import { useActionState, useState } from "react";
import { crearGastoSinFactura } from "./actions";
import { TIPOS_GASTO, FORMAS_PAGO } from "@/lib/gastos-periodicos";
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
  // La recurrencia se despliega, no se pide siempre: la mayoría de los gastos
  // que entran por acá son de una sola vez, y siete campos más en pantalla los
  // vuelve un trámite.
  const [repite, setRepite] = useState(false);
  const [forma, setForma] = useState<string>("pse");

  const formaSel = FORMAS_PAGO.find((f) => f.valor === forma);

  // El formulario NO se desmonta al terminar: si algo salió mal, lo escrito
  // sigue ahí. Rehacerlo desde cero por un campo es lo que hace que la gente
  // vuelva a pagar por fuera del portal.
  return (
    <form action={action} className="card gasto-form">
      <div className="gasto-grid">
        <label className="campo">
          <span>¿Qué es?</span>
          <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} required>
            {TIPOS_GASTO.map((t) => <option key={t.valor} value={t.valor}>{t.label}</option>)}
          </select>
          <i>{TIPOS_GASTO.find((t) => t.valor === tipo)?.ayuda}</i>
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

      {/* ─── ¿SE REPITE? ───────────────────────────────────────────────────
          Acá está el giro: si este gasto vuelve todos los meses, se parametriza
          UNA vez y a partir del mes siguiente la obligación aparece sola en
          Conciliación —antes de que llegue el recibo— esperando solo su monto.
          Deja de ser una forma de registrar lo que ya pasó y pasa a ser la lista
          de lo que la empresa debe este mes. */}
      <div className={"gasto-repite" + (repite ? " on" : "")}>
        <label className="repite-check">
          <input type="checkbox" name="repetir" value="si" checked={repite}
                 onChange={(e) => setRepite(e.target.checked)} />
          <b>Este gasto se repite todos los meses</b>
          <i>Mismo proveedor, misma fecha, misma referencia. Lo único que cambia es el monto.</i>
        </label>

        {repite && (
          <div className="gasto-grid">
            <label className="campo">
              <span>¿Cómo se paga?</span>
              <select name="forma_pago" value={forma} onChange={(e) => setForma(e.target.value)}>
                {FORMAS_PAGO.map((f) => <option key={f.valor} value={f.valor}>{f.label}</option>)}
              </select>
              <i>{formaSel?.ayuda}</i>
            </label>

            <label className="campo">
              <span>Día de pago</span>
              <input name="dia_pago" type="number" min={1} max={31} inputMode="numeric" placeholder="5" />
              <i>El día del mes en que vence. Si cae fin de semana o festivo se paga el día hábil ANTERIOR — un servicio público pagado tarde se corta.</i>
            </label>

            {forma !== "transferencia" && (
              <label className="campo">
                <span>Referencia de pago</span>
                <input name="referencia_pago" placeholder="El número que se teclea en la página" />
                <i><b>Cópiala del recibo, no de memoria.</b> Si está mal, la plata se le abona a otro
                   cliente del mismo proveedor y no da ningún error.</i>
              </label>
            )}

            <label className="campo">
              <span>¿Dónde se paga? (opcional)</span>
              <input name="sitio_pago" placeholder="enel.com.co · oficina · banco" />
            </label>

            <label className="campo">
              <span>Avisar con</span>
              <input name="dias_anticipacion" type="number" min={0} max={60} defaultValue={10} inputMode="numeric" />
              <i>Días antes del vencimiento en que aparece en Conciliación, para que dé tiempo de conseguir el recibo.</i>
            </label>

            <label className="campo">
              <span>Hasta cuándo (opcional)</span>
              <input name="vigente_hasta" type="date" />
              <i>Si la tienda cierra o el contrato termina. Sin fecha, sigue hasta que se dé de baja a mano.</i>
            </label>

            <p className="campo ancho repite-nota">
              El concepto y el destino se ponen una sola vez, al clasificar el primer mes en
              Conciliación: de ahí suben solos a la plantilla y los meses siguientes ya nacen
              clasificados.
            </p>
          </div>
        )}
      </div>

      <div className="gasto-pie">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Guardando…" : repite ? "Guardar y programar" : "Guardar y enviar a Conciliación"}
        </button>
        {res && !res.ok && <span className="gasto-err">⚠ {res.error}</span>}
        {res && res.ok && (
          <span className="gasto-ok">
            ✓ Guardado. Ya está en <a href="/contabilidad/conciliacion">Conciliación de pagos</a>
            {repite ? ", y el mes entrante vuelve a aparecer solo." : ", esperando concepto y destino."}
          </span>
        )}
      </div>
    </form>
  );
}
