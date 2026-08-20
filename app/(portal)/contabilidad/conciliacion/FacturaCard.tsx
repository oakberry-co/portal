"use client";

import { memo, useState, useTransition } from "react";
import { type Estado } from "@/lib/estados";
import { Combobox } from "./Combobox";
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
  responsabilidad_dian: string | null;
  link_drive: string | null;
  // Soporte archivado a mano por compras en Drive (tabla `factura_soportes`).
  soporte_url: string | null;
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
function semanaISO(d: string | Date | null): string {
  if (!d) return "—";
  const x = new Date(d);
  const t = new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return "S" + Math.ceil(((t.getTime() - ys.getTime()) / 86400000 + 1) / 7);
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
  const [pending, start] = useTransition();
  const [faltaDest, setFaltaDest] = useState(false);

  const total = num(f.total);
  const subtotal = num(f.subtotal);
  const iva = num(f.iva);
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
  const retenTotal = f.retencion_ok && f.reten_total != null
    ? num(f.reten_total)
    : num(f.retefuente_sug) + num(f.reteiva_sug) + num(f.reteica_sug);
  const otros = num(f.otros_valor);
  const valorAPagar = total - retenTotal - otros;

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

      <div className="c-num mono" title={`Factura ${f.numero}`}>{f.numero}</div>
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

      <div className="c-pagar">
        <div className="num accent" title="Valor a pagar = total − retenciones">{copN(valorAPagar)}</div>
        <div className="muted mini">ret {copN(retenTotal)}{f.retencion_ok ? " ✓" : ""}</div>
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

      {modal && (
        <RetencionesModal
          cufe={f.cufe}
          proveedor={f.nombre_proveedor ?? f.nit_proveedor}
          subtotal={subtotal}
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
