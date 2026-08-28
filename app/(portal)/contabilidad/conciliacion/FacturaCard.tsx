"use client";

import { memo, useState, useTransition } from "react";
import { type Estado } from "@/lib/estados";
import { Combobox } from "./Combobox";
import { semanaISO } from "@/lib/orden-facturas";
import { CuentaDestinoModal } from "./CuentaDestinoModal";
import { guardarClasificacion, marcarTipoPago } from "./actions";
import { RetencionesModal } from "./RetencionesModal";

export type FacturaRow = {
  cufe: string;
  nombre_proveedor: string | null;
  nit_proveedor: string;
  numero: string;
  fecha_emision: string | Date;
  sincronizado_en: string | Date | null;
  subtotal: string | null;
  iva: string | null;
  total: string | null;
  // 'xml' = llegó su documento por correo · 'dian' = la vimos en el barrido de
  // la DIAN y el XML nunca llegó (no hay ítems, ni subtotal, ni referencia de
  // nota crédito). Sin este dato, una factura sin subtotal se ve igual que un
  // bug del parser.
  origen: string | null;
  responsabilidad_dian: string | null;
  link_drive: string | null;
  // Soporte archivado a mano por compras en Drive (tabla `factura_soportes`).
  soporte_url: string | null;
  // Desvío de pago de ESTA factura (no toca el maestro). Ver CuentaDestinoModal.
  cta_dest_banco: string | null; cta_dest_tipo: string | null; cta_dest_numero: string | null;
  cta_dest_titular: string | null; cta_dest_doc: string | null;
  cta_dest_tipo_doc: string | null;
  cta_dest_motivo: string | null; cta_dest_por: string | null;
  // La del maestro, para poder mostrar de dónde se desvía.
  cb_banco: string | null; cb_num_cuenta: string | null;
  // Notas crédito: `doc_tipo`/`ref_*` es qué ES este documento; `nc_aplicada` es
  // lo que le quitan las notas que lo corrigen.
  doc_tipo: string | null; ref_numero: string | null; ref_motivo: string | null;
  nc_aplicada: number | null; nc_detalle: string | null;
  n_soportes: number | null;
  destino_drive: string | null;
  estado: Estado;
  concepto: string | null;
  destino: string | null;
  plazo_dias: number | null;
  fecha_vencimiento: string | Date | null;
  retencion_ok: boolean;
  reten_total: string | null;
  retefuente: string | null;
  reteiva: string | null;
  reteica: string | null;
  valor_a_pagar: string | null;
  otros_valor: string | null;
  otros_concepto: string | null;
  observaciones: string | null;
  pago_estado: string | null;
  fecha_pago_prog: string | Date | null;
  tipo_pago: string | null;
  // El cruce con la cotización abonada: cuánto se adelantó y de qué cotización.
  abono_aplicado: number | null;
  cot_id: number | null;
  cot_codigo: string | null;
  concepto_sug: string | null;
  destino_sug: string | null;
  confianza: string | null;
  plazo_sug: number | null;
  retefuente_sug: string | null;
  reteiva_sug: string | null;
  reteica_sug: string | null;
  ret_rf: string | null;
  ret_ica: string | null;
  // Lo que el equipo ya viene practicando para el CONCEPTO de esta factura.
  rc_rf: string | null; rc_ica: string | null; rc_aplica: boolean | null;
  rc_n: number | null; rc_conc: string | null; rc_fuente: string | null;
  ret_iva: string | null;
};

/** Parche que devuelven las acciones para actualizar la fila en sitio (optimista). */
export type FilaPatch = Partial<FacturaRow>;

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const copN = (n: number) => cop.format(Math.round(n || 0));
const num = (s: string | number | null) => (s != null && s !== "" ? Number(s) : 0);
const contents = { display: "contents" as const };

function ddmm(d: string | Date | null): string {
  if (!d) return "—";
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}`;
}

export const FacturaCard = memo(function FacturaCard({
  f, conceptos, destinos, onSaved, puedeClasificar,
}: {
  f: FacturaRow;
  conceptos: string[];
  destinos: string[];
  onSaved: (cufe: string, patch: FilaPatch) => void;
  puedeClasificar: boolean;   // false = contador (solo puede Reten., no clasificar)
}) {
  const [modal, setModal] = useState(false);
  const [modalCta, setModalCta] = useState(false);
  const [det, setDet] = useState(false);
  const [pending, start] = useTransition();
  const [faltaDest, setFaltaDest] = useState(false);

  const total = num(f.total);
  const subtotal = num(f.subtotal);
  const iva = num(f.iva);
  // La DIAN la reportó pero su XML nunca llegó: existe y hay que pagarla, pero
  // no sabemos su base gravable. Se marca en la tarjeta Y se le avisa al modal
  // de retenciones, que sin esto multiplicaría por un subtotal 0 y dejaría la
  // retención en cero sin decir nada.
  const sinXml = f.origen === "dian";
  // La alarma ENVEJECE en vez de bloquear. Medido sobre 1.160 facturas de
  // jul-ago: el 82% del XML llega en 24 horas, el 93% en 7 días. O sea, el que
  // no llegó en una semana ya no llega solo — hay que pedírselo al proveedor.
  // Antes de los 7 días avisar sería ruido; después, callarse sería perder el
  // soporte del IVA descontable y de la deducción del costo.
  const diasSinXml = sinXml
    ? Math.floor((Date.now() - new Date(f.fecha_emision).getTime()) / 86_400_000)
    : 0;
  const conf = f.confianza != null ? Math.round(Number(f.confianza) * 100) : null;
  const confBaja = conf != null && conf < 85;

  const pend = f.estado === "capturada";
  const clasificada = f.estado !== "capturada";
  const locked = ["aprobada_pago", "pagada", "causada"].includes(f.estado);
  // Clasificación y retenciones son INDEPENDIENTES: se pueden hacer al tiempo,
  // una no desbloquea la otra. Semáforos separados (al final de la fila).
  const retEditable = !locked;
  const retencionDone = f.retencion_ok;

  // Semáforo de ESTADO DE PAGO: verde = pagada, naranja = movida de semana
  // (reprogramada y sin pagar), rojo = pendiente por pagar.
  const pagada = f.estado === "pagada" || f.estado === "causada" || f.pago_estado === "pagado";
  //  <7d  gris   — todavía puede llegar solo, no molestar
  //  ≥7d  ámbar  — pedirlo: ya no llega solo
  //  ≥15d y PAGADA → rojo: se pagó y seguimos sin el soporte. Esa es la plata
  //  que se pierde de verdad, porque el pago ya no es palanca para reclamarlo.
  const nivelXml = !sinXml ? "" : pagada && diasSinXml >= 15 ? " urge"
                   : diasSinXml >= 7 ? " pide" : "";

  const movida = !pagada && !!f.fecha_pago_prog;
  const pagoLuz = pagada ? "ok" : movida ? "mid" : "no";
  const pagoTitle = pagada ? "Pagada" : movida ? "Movida de semana (reprogramada)" : "Pendiente por pagar";

  // Crédito/Débito: 'debito' = NO entra a Pagos (no se paga; ej. Éxito). El
  // proveedor APRENDE su default → sus próximas facturas lo heredan.
  const esDebito = (f.tipo_pago ?? "credito") === "debito";
  function onTipo() {
    const nuevo = esDebito ? "credito" : "debito";
    start(async () => {
      try {
        const fd = new FormData(); fd.set("cufe", f.cufe); fd.set("tipo", nuevo);
        const patch = await marcarTipoPago(fd);
        onSaved(f.cufe, patch as FilaPatch);
      } catch (err) { alert("No se pudo cambiar crédito/débito: " + (err as Error).message); }
    });
  }

  // Resumen de retenciones: lo confirmado si existe, si no la sugerencia (preview).
  /** Una línea del desglose. Se muestra el CONFIRMADO si existe; si no, la
   *  propuesta, marcada como tal. Una línea en cero no se pinta: "ReteIVA $0"
   *  ocupa el mismo espacio que un dato y no dice nada. */
  const linea = (nombre: string, confirmado: string | null, sugerido: string | null) => {
    const val = f.retencion_ok ? Number(confirmado ?? 0) : Number(confirmado ?? sugerido ?? 0);
    if (!(val > 0)) return null;
    const esSug = !f.retencion_ok && confirmado == null;
    return (
      <tr key={nombre}>
        <td>{nombre}{esSug && <i className="det-sug"> propuesta</i>}</td>
        <td className="num neg">− {copN(val)}</td>
      </tr>
    );
  };

  const retenTotal = f.retencion_ok && f.reten_total != null
    ? num(f.reten_total)
    : num(f.retefuente_sug) + num(f.reteiva_sug) + num(f.reteica_sug);
  const otros = num(f.otros_valor);
  // Lo que las notas crédito le quitan a ESTA factura. Se resta acá y no solo
  // en Pagos: si la grilla dijera un número y el tablero otro, el equipo dejaría
  // de creerle a los dos. Nunca baja de cero — una nota mayor que la factura no
  // genera un pago negativo, genera un saldo a favor, y eso lo cruza una persona.
  const notaCredito = Number(f.nc_aplicada ?? 0);
  const valorAPagar = Math.max(0, total - retenTotal - otros - notaCredito);

  // Vencimiento (día de pago) y si ya toca pagar.
  const venc = f.fecha_vencimiento ? new Date(f.fecha_vencimiento) : null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const paraPago = !!venc && venc <= hoy && (f.estado === "retenciones_ok" || f.estado === "aprobada_pago");

  // Guardado OPTIMISTA: llama la acción y parchea la fila en sitio (sin recargar
  // ni reordenar). El semáforo pasa de rojo a verde y la fila se queda donde está.
  function onClasif(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // No dejar avanzar sin DESTINO (pedido de Daniel): la factura debe ir a un
    // destino/centro de costo antes de clasificarse.
    if (!String(fd.get("destino") ?? "").trim()) {
      setFaltaDest(true);
      return;
    }
    setFaltaDest(false);
    start(async () => {
      try {
        const patch = await guardarClasificacion(fd);
        onSaved(f.cufe, patch as FilaPatch);
      } catch (err) {
        alert("No se pudo guardar la clasificación: " + (err as Error).message);
      }
    });
  }

  return (
    <div className={"fila" + (pend ? " pend" : "") + (locked ? " locked" : "")}>
      <div className="c-prov">
        <div className="prov" title={f.nombre_proveedor ?? ""}>{f.nombre_proveedor ?? "—"}</div>
        <div className="muted mini">NIT {f.nit_proveedor}{f.responsabilidad_dian ? ` · ${f.responsabilidad_dian}` : ""}</div>
      </div>

      {/* Un documento que ES una nota crédito y una factura que TIENE notas se
          leen distinto y por eso se marcan distinto: la primera resta, la
          segunda quedó rebajada. Sin la marca, ver un valor negativo o un saldo
          más bajo de lo esperado parece un error del sistema. */}
      <div className="c-num mono" title={`Factura ${f.numero}`}>
        {f.numero}
        {f.doc_tipo === "CreditNote" && (
          <span className="c-esnc" title={`Nota crédito de la factura ${f.ref_numero ?? "—"} · ${f.ref_motivo ?? ""}`}>NC</span>
        )}
        {Number(f.nc_aplicada) > 0 && (
          <span className="c-tienenc" title={`Le descuentan notas crédito: ${f.nc_detalle ?? ""}`}>−NC</span>
        )}
        {sinXml && (
          <span className={"c-sinxml" + nivelXml}
            title={
              nivelXml === " urge"
                ? `Se pagó y todavía no tenemos el XML (${diasSinXml} días). Sin el documento no hay soporte del IVA descontable ni de la deducción del costo. Pídeselo al proveedor a compras@manelfoods.com — cuando lo mande, la factura se completa sola.`
                : nivelXml === " pide"
                ? `${diasSinXml} días sin el XML. El 93% llega en la primera semana, así que este ya no va a llegar solo: pídeselo al proveedor a compras@manelfoods.com. Se puede pagar igual; lo que falta es el soporte.`
                : "La DIAN la reportó y su XML todavía no llega al correo. Se puede clasificar y pagar con normalidad. Lo que falta es el detalle: no hay ítems ni base gravable. Si el proveedor lo manda, la factura se completa sola."
            }>
            sin XML{diasSinXml >= 7 ? ` · ${diasSinXml}d` : ""}
          </span>
        )}
      </div>
      <div className="c-fecha">
        <span title="Fecha de emisión (DIAN)">{ddmm(f.fecha_emision)}</span>
        {f.sincronizado_en && (
          <span className="lleg" title="Fecha en que llegó la factura al portal (recepción). Con esta fecha + plazo se calcula el día de pago.">
            llegó {ddmm(f.sincronizado_en)}
          </span>
        )}
      </div>
      <div className="c-sem">{semanaISO(f.fecha_emision)}</div>
      <div className="c-valor num">{copN(total)}</div>

      {/* Clasificación */}
      <form onSubmit={onClasif} style={contents}>
        <input type="hidden" name="cufe" value={f.cufe} />
        <div className="c-field">
          {conf != null && <span className={"dot " + (confBaja ? "warn" : "ok")} title={`Máquina: "${f.concepto_sug ?? "—"}" · ${conf}%`} />}
          <Combobox name="concepto" label="concepto" options={conceptos} defaultValue={f.concepto ?? f.concepto_sug ?? ""} placeholder="Concepto" />
        </div>
        <div className={"c-field" + (faltaDest ? " falta" : "")} title={faltaDest ? "Ponle un destino antes de clasificar" : undefined}>
          <Combobox name="destino" label="destino" options={destinos} defaultValue={f.destino ?? f.destino_sug ?? ""} placeholder="Destino" />
        </div>
        <div className="c-plazo">
          <input name="plazo_dias" type="number" min={0} defaultValue={f.plazo_dias ?? f.plazo_sug ?? ""} placeholder="días" disabled={locked} title={f.plazo_sug != null && f.plazo_dias == null ? `Plazo sugerido del proveedor: ${f.plazo_sug} días` : "Plazo (días)"} />
          {venc && <span className={"venc" + (paraPago ? " due" : "")} title={paraPago ? "Ya vencido — para pago" : "Día de pago (recepción + plazo)"}>{paraPago ? "⏰ " : "→ "}{ddmm(venc)}</span>}
        </div>
        <button type="submit" className="c-btn" disabled={locked || pending || !puedeClasificar} title={puedeClasificar ? "Confirmar clasificación" : "Solo lectura para tu rol (contador)"}>{pending ? "…" : "Clasif."}</button>
      </form>

      {/* PASAR POR ENCIMA muestra el desglose de lo retenido. Un total pelado no
          se puede revisar: para saber si "ret $588.600" está bien hay que ver de
          qué se compone, y hasta hoy eso obligaba a abrir el modal factura por
          factura. Va en hover Y en clic — en celular no hay hover (Regla 20). */}
      <div className="c-pagar det-wrap"
           onMouseEnter={() => setDet(true)} onMouseLeave={() => setDet(false)}>
        <div className="num accent" title="Valor a pagar = total − retenciones">{copN(valorAPagar)}</div>
        <button type="button" className="muted mini det-btn" onClick={() => setDet((v) => !v)}
                aria-expanded={det}>
          ret {copN(retenTotal)}{f.retencion_ok ? " ✓" : ""}
        </button>
        {det && (
          <div className="det-pop" role="dialog" aria-label="Detalle de la retención">
            <div className="det-tit">{f.retencion_ok ? "Lo que se le retuvo" : "Lo que se le retendría"}</div>
            <table><tbody>
              <tr><td>Total factura</td><td className="num">{copN(total)}</td></tr>
              {Number(f.nc_aplicada) > 0 && (
                <tr><td>Notas crédito<i className="det-sug"> {f.nc_detalle}</i></td>
                    <td className="num neg">− {copN(Number(f.nc_aplicada))}</td></tr>
              )}
              {linea("ReteFuente", f.retefuente, f.retefuente_sug)}
              {linea("ReteIVA", f.reteiva, f.reteiva_sug)}
              {linea("ReteICA", f.reteica, f.reteica_sug)}
              {Number(f.otros_valor) > 0 && (
                <tr><td>{f.otros_concepto || "Otros"}</td><td className="num neg">− {copN(Number(f.otros_valor))}</td></tr>
              )}
              {Number(f.abono_aplicado) > 0 && (
                <tr><td>Adelanto ya pagado</td><td className="num neg">− {copN(Number(f.abono_aplicado))}</td></tr>
              )}
              <tr className="det-tot"><td>Se le paga</td><td className="num">{copN(valorAPagar)}</td></tr>
            </tbody></table>
            {f.observaciones && <div className="det-obs">“{f.observaciones}”</div>}
            {!f.retencion_ok && (
              <div className="det-aviso">Todavía nadie la confirmó: estos valores son la propuesta.</div>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        className="c-btn ghost"
        disabled={!retEditable}
        onClick={() => setModal(true)}
        title="Abrir retenciones (independiente de la clasificación)"
      >
        Reten.
      </button>

      {/* Desviar el pago de ESTA factura a otra cuenta. Es la excepción rara y
          se ve como tal: amarillo cuando está puesta, para que no pase de
          agache en una revisión. */}
      <button
        type="button"
        className={"c-btn ghost" + (f.cta_dest_numero ? " c-desvio" : "")}
        disabled={f.pago_estado === "pagado"}
        onClick={() => setModalCta(true)}
        title={f.cta_dest_numero
          ? `Esta factura se paga a ${f.cta_dest_banco} ••••${f.cta_dest_numero.slice(-4)} — ${f.cta_dest_motivo ?? ""}`
          : "Pagar esta factura a una cuenta distinta de la del maestro (solo esta)"}
      >
        {f.cta_dest_numero ? "↪ Cuenta" : "Cuenta"}
      </button>

      <div className="c-docs">
        <a
          className="ic dian"
          href={`https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${encodeURIComponent(f.cufe)}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Ver el documento oficial en la DIAN (por CUFE) — guía para clasificar"
        >
          DIAN
        </a>
        {f.link_drive ? (
          <a className="ic pdf" href={f.link_drive} target="_blank" rel="noopener noreferrer"
             title="Descargar el PDF de la factura del proveedor">PDF</a>
        ) : (
          <span className="ic pdf off" title="Sin PDF del proveedor — usa el documento DIAN">PDF</span>
        )}
        {/* Soporte archivado a mano por compras en Drive (COMPRAS/AÑO/MES/DESTINO).
            Es otra cosa que el PDF del buzón DIAN: trae la clasificación por tienda. */}
        {f.soporte_url && (
          <a className="ic sop" href={f.soporte_url} target="_blank" rel="noopener noreferrer"
             title={`Soporte archivado por compras${f.destino_drive ? ` — carpeta ${f.destino_drive}` : ""}` +
                    (f.n_soportes && f.n_soportes > 1 ? ` (${f.n_soportes} archivos)` : "")}>
            📎{f.n_soportes && f.n_soportes > 1 ? f.n_soportes : ""}
          </a>
        )}
      </div>

      {/* Semáforos (al final): Clasificación · Retención · Estado de pago */}
      <div className="c-sems">
        <span className="sem" title={clasificada ? "Clasificado" : "Falta clasificar"}>
          <i className={"luz " + (clasificada ? "ok" : "no")} />Clasif
        </span>
        <span className="sem" title={retencionDone ? "Retenciones hechas" : "Faltan retenciones"}>
          <i className={"luz " + (retencionDone ? "ok" : "no")} />Reten
        </span>
        <span className="sem" title={pagoTitle}>
          <i className={"luz " + pagoLuz} />Pago
        </span>
        <button type="button" className={"cd-toggle " + (esDebito ? "deb" : "cred")} disabled={pending || !puedeClasificar} onClick={onTipo}
          title={esDebito
            ? "Débito — NO entra a Pagos (no se paga, ej. Éxito). Clic para volver a Crédito."
            : "Crédito — a pagar (entra a Pagos). Clic para marcar Débito (no se paga)."}>
          {esDebito ? "Débito" : "Crédito"}
        </button>
      </div>

      {modalCta && (
        <CuentaDestinoModal
          cufe={f.cufe}
          factura={f.numero}
          proveedor={f.nombre_proveedor ?? f.nit_proveedor}
          actual={f.cta_dest_numero ? {
            banco: f.cta_dest_banco, tipo: f.cta_dest_tipo, numero: f.cta_dest_numero,
            titular: f.cta_dest_titular, doc: f.cta_dest_doc,
            tipoDoc: f.cta_dest_tipo_doc,
            motivo: f.cta_dest_motivo, por: f.cta_dest_por,
          } : null}
          cuentaMaestro={{ banco: f.cb_banco, numero: f.cb_num_cuenta }}
          onClose={() => setModalCta(false)}
        />
      )}

      {modal && (
        <RetencionesModal
          cufe={f.cufe}
          proveedor={f.nombre_proveedor ?? f.nit_proveedor}
          subtotal={subtotal}
          sinXml={sinXml}
          iva={iva}
          total={total}
          retefuente={f.retefuente}
          reteiva={f.reteiva}
          reteica={f.reteica}
          retefuente_sug={f.retefuente_sug}
          reteiva_sug={f.reteiva_sug}
          reteica_sug={f.reteica_sug}
          tarRf={f.ret_rf}
          tarIva={f.ret_iva}
          tarIca={f.ret_ica}
          regla={f.rc_rf != null || f.rc_aplica === false ? {
            retefuente: f.rc_rf, reteica: f.rc_ica, aplica: f.rc_aplica ?? true,
            n_casos: f.rc_n ?? 0, concordancia: f.rc_conc, fuente: f.rc_fuente ?? "aprendida",
          } : null}
          concepto={f.concepto}
          otros_valor={f.otros_valor}
          otros_concepto={f.otros_concepto}
          observaciones={f.observaciones}
          yaConfirmada={f.retencion_ok}
          onSaved={onSaved}
          onClose={() => setModal(false)}
        />
      )}
    </div>
  );
});
