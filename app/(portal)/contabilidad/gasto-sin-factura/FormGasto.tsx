"use client";

import { useActionState, useMemo, useState } from "react";
import { crearGastoSinFactura } from "./actions";
import { TIPOS_GASTO, DIAS_AVISO } from "@/lib/gastos-periodicos";
import type { Resultado } from "@/lib/resultado";
import { ruta } from "@/lib/ruta";

/** El valor se escribe como se escribe en Colombia: con puntos de miles. Se
 *  formatea mientras se teclea para que nadie mande $9.870 creyendo que puso
 *  $9.870.000 — el servidor vuelve a limpiarlo de todos modos. */
const milesCO = (raw: string) => {
  const d = raw.replace(/[^\d]/g, "");
  return d ? Number(d).toLocaleString("es-CO") : "";
};

export type ProveedorConocido = { nit: string; nombre: string };

export function FormGasto({ proveedores }: { proveedores: ProveedorConocido[] }) {
  const [res, action, pending] = useActionState<Resultado | null, FormData>(crearGastoSinFactura, null);
  const [tipo, setTipo] = useState<string>("servicio_publico");
  const [razon, setRazon] = useState("");
  const [nit, setNit] = useState("");
  const [valor, setValor] = useState("");
  const [archivo, setArchivo] = useState<string | null>(null);
  const [repite, setRepite] = useState(false);

  // A quién ya le hemos pagado. Escribir el nombre trae el NIT solo: el NIT es
  // la llave con la que después se le encuentra la cuenta y se cruza la
  // causación, y hacer que alguien lo busque para el recibo del agua es la
  // fricción que hace que el gasto no se cargue.
  const porNombre = useMemo(
    () => new Map(proveedores.map((p) => [p.nombre.toLowerCase(), p.nit])), [proveedores]);

  function elegirProveedor(v: string) {
    setRazon(v);
    const hallado = porNombre.get(v.trim().toLowerCase());
    if (hallado) setNit(hallado);
  }

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

        {/* El "otro, ¿cuál?" aparece SOLO cuando hace falta: un "otro" sin decir
            cuál es una fila que dentro de un mes nadie sabe leer. */}
        {tipo === "otro" ? (
          <label className="campo">
            <span>¿Cuál gasto?</span>
            <input name="tipo_detalle" required placeholder="Impuesto predial BOG001" />
          </label>
        ) : <input type="hidden" name="tipo_detalle" value="" />}

        <label className="campo">
          <span>¿A quién se le paga?</span>
          <input name="razon_social" required list="proveedores-conocidos" autoComplete="off"
                 value={razon} onChange={(e) => elegirProveedor(e.target.value)}
                 placeholder="ENEL COLOMBIA / EPM / …" />
          <datalist id="proveedores-conocidos">
            {proveedores.map((p) => <option key={p.nit} value={p.nombre} />)}
          </datalist>
          <i>Si ya le hemos pagado, elígelo de la lista y el NIT se llena solo.</i>
        </label>

        <label className="campo">
          <span>NIT o cédula</span>
          <input name="num_doc" required inputMode="numeric" value={nit}
                 onChange={(e) => setNit(e.target.value)} placeholder="860063875" />
          <i>Sin dígito de verificación.</i>
        </label>

        <label className="campo">
          <span>Número de referencia</span>
          <input name="referencia_pago" placeholder="El número que se teclea para pagar" />
          <i><b>Cópiala del recibo, no de memoria.</b> Si está mal, la plata se le abona a
             otro cliente del mismo proveedor y no da ningún error.</i>
        </label>

        <label className="campo">
          <span>N° del recibo</span>
          <input name="numero" placeholder="El consecutivo del documento" />
        </label>

        <label className="campo">
          <span>Valor</span>
          <input name="valor" required inputMode="numeric" value={valor}
                 onChange={(e) => setValor(milesCO(e.target.value))} placeholder="480.000" />
          <i>En pesos. El punto separa miles.</i>
        </label>

        <label className="campo">
          <span>Link de pago (opcional)</span>
          <input name="link_pago" placeholder="enel.com.co · el link de la factura" />
          <i>Dónde se paga. Aparece al lado de la referencia cuando toque pagarlo.</i>
        </label>

        <label className="campo ancho">
          <span>Documento soporte (opcional)</span>
          <input name="doc_soporte" type="file" accept=".pdf,.doc,.docx,image/*"
                 onChange={(e) => setArchivo(e.target.files?.[0]?.name ?? null)} />
          <i>{archivo ? `📎 ${archivo}` : "El recibo. Si no lo tienes ahora, se puede adjuntar después — pero el gasto queda sin respaldo hasta entonces."}</i>
        </label>
      </div>

      {/* ─── ¿SE REPITE? ───────────────────────────────────────────────────
          Si este gasto vuelve todos los meses, se marca acá y desde el mes
          siguiente la obligación aparece sola en Conciliación —antes de que
          llegue el recibo— esperando solo su monto. Todo lo demás ya se
          preguntó arriba, así que aquí queda una sola casilla. */}
      <div className={"gasto-repite" + (repite ? " on" : "")}>
        <label className="repite-check">
          <input type="checkbox" name="repetir" value="si" checked={repite}
                 onChange={(e) => setRepite(e.target.checked)} />
          <b>Este gasto se repite todos los meses</b>
          <i>Mismo proveedor, misma referencia. Lo único que cambia es el monto.</i>
        </label>

        {repite && (
          <div className="gasto-grid">
            <label className="campo">
              <span>Día máximo de pago</span>
              <input name="dia_pago" type="number" min={1} max={31} inputMode="numeric" placeholder="5" required />
              <i>El día del mes en que vence. Si cae fin de semana o festivo se paga el día
                 hábil <b>anterior</b> — un servicio público pagado tarde se corta.</i>
            </label>
            <p className="campo repite-nota">
              Aparecerá en Conciliación <b>{DIAS_AVISO} días antes</b> de vencerse, con su
              concepto y su destino ya puestos. Lo único que habrá que hacer cada mes es
              escribir cuánto llegó.
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
            ✓ Guardado. Ya está en <a href={ruta("/contabilidad/conciliacion")}>Conciliación de pagos</a>
            {repite ? ", y el mes entrante vuelve a aparecer solo." : ", esperando concepto y destino."}
          </span>
        )}
      </div>
    </form>
  );
}
