"use client";

// LOS DOCUMENTOS SIN FACTURA DIAN, EN CONCILIACIÓN.
//
// Cuentas de cobro aprobadas y gastos internos (servicios públicos y otros):
// gastos de verdad, que hay que clasificar igual que una factura antes de
// pagarlos. Antes se aprobaban y saltaban directo a Pagos: se pagaban bien, pero
// quedaban sin concepto ni destino, y el destino vacío no se llena solo.
//
// Van en un bloque APARTE y no mezclados con las facturas, por la misma razón
// que en Pagos: no tienen CUFE. La grilla de facturas se ordena, se filtra y se
// exporta a Excel usando el CUFE como llave; una fila sin CUFE ahí adentro es
// una fila que el Excel de retenciones no puede devolver. Acá se ve que es otra
// cosa —lo dice la referencia CC-46 / SP-51, que no se parece a un CUFE— y aun
// así se trabaja igual.

import { useState, useTransition } from "react";
import { Combobox } from "./Combobox";
import { RetencionesCuentaCobro, type ReglaConcepto } from "../cuentas-de-cobro/RetencionesCuentaCobro";
import { clasificarDocumento } from "./actions";

export type DocNoDianUI = {
  id: number; ref: string; tipo: string; tipo_detalle: string | null; origen: string;
  razon_social: string; num_doc: string; numero: string | null;
  descripcion: string | null; area: string | null;
  fecha: string; valor: number;
  concepto: string | null; destino: string | null; plazo_dias: number | null;
  retencion_ok: boolean; reten_total: number | null;
  retefuente: number | null; reteiva: number | null; reteica: number | null;
  otros_valor: number | null; otros_concepto: string | null; observaciones: string | null;
  valor_a_pagar: number | null;
  n_docs: number; soporte_url: string | null; tiene_banco: boolean;
  iva_incluido: number | null;
  // Las tarifas que el proveedor ya tiene en el maestro (misma fuente que las
  // facturas): precargan el modal en vez de dejarlo en blanco.
  tar_rf: string | null; tar_iva: string | null; tar_ica: string | null;
  rc_rf: string | null; rc_ica: string | null; rc_aplica: boolean | null;
  rc_n: number | null; rc_conc: string | null; rc_fuente: string | null;
};

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const $ = (n: number) => cop.format(Math.round(n || 0));
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const ddmm = (s: string) => { const d = new Date(s + (s.length === 10 ? "T00:00:00" : "")); return `${String(d.getDate()).padStart(2, "0")}/${MESES[d.getMonth()]}`; };

const ETIQUETA_TIPO: Record<string, string> = {
  cuenta_cobro: "Cuenta de cobro",
  servicio_publico: "Servicio público",
  otro: "Otro gasto",
};

export function DocsNoDian({ docs, conceptos, destinos, puedeClasificar }: {
  docs: DocNoDianUI[]; conceptos: string[]; destinos: string[]; puedeClasificar: boolean;
}) {
  const [abierto, setAbierto] = useState(true);
  if (!docs.length) return null;

  const total = docs.reduce((s, d) => s + d.valor, 0);
  return (
    <div className="nodian">
      <div className="nodian-head" onClick={() => setAbierto((v) => !v)}>
        <span className="nodian-caret">{abierto ? "▾" : "▸"}</span>
        <b>🧾 Sin factura DIAN</b>
        <span className="nodian-n">{docs.length}</span>
        <span className="nodian-sub">
          cuentas de cobro y gastos sin factura electrónica · <b>{$(total)}</b> — clasifícalos y pasan a Pagos
        </span>
      </div>
      {abierto && docs.map((d) => (
        <FilaDoc key={d.id} d={d} conceptos={conceptos} destinos={destinos} puedeClasificar={puedeClasificar} />
      ))}
    </div>
  );
}

function FilaDoc({ d, conceptos, destinos, puedeClasificar }: {
  d: DocNoDianUI; conceptos: string[]; destinos: string[]; puedeClasificar: boolean;
}) {
  const regla: ReglaConcepto | null = d.rc_rf != null || d.rc_ica != null || d.rc_aplica != null
    ? { retefuente: d.rc_rf, reteica: d.rc_ica, aplica: d.rc_aplica ?? true,
        n_casos: d.rc_n ?? 0, concordancia: d.rc_conc, fuente: d.rc_fuente ?? "" }
    : null;
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState(false);

  // Lo que le falta, dicho con nombre propio. Un "no se puede" sin motivo es lo
  // que hace que la gente deje de usar la pantalla (Regla 18).
  const falta = [
    !d.concepto ? "concepto" : null,
    !d.destino ? "destino" : null,
    !d.retencion_ok ? "retenciones" : null,
  ].filter(Boolean) as string[];

  function guardar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr(null);
    start(async () => {
      const r = await clasificarDocumento(fd);
      if (!r.ok) setErr(r.error ?? "No se pudo guardar.");
    });
  }

  return (
    <div className="nodian-fila">
      <div className="nodian-quien">
        <span className="nodian-ref" title={`${ETIQUETA_TIPO[d.tipo] ?? d.tipo}${d.tipo_detalle ? " · " + d.tipo_detalle : ""}${d.origen === "interno" ? " · cargado por el equipo" : " · lo envió el proveedor"}`}>
          {d.ref}
        </span>
        <div>
          <b>{d.razon_social}</b>
          <div className="muted mini">
            NIT {d.num_doc}
            {d.numero ? ` · ${d.numero}` : ""}
            {d.tipo_detalle ? ` · ${d.tipo_detalle}` : ""}
            {d.area ? ` · área ${d.area}` : ""}
          </div>
          {d.descripcion && <div className="muted mini nodian-desc" title={d.descripcion}>{d.descripcion}</div>}
        </div>
      </div>
      <div className="nodian-fch">{ddmm(d.fecha)}</div>
      <div className="nodian-val num">{$(d.valor)}</div>

      <form onSubmit={guardar} className="nodian-form">
        <input type="hidden" name="id" value={d.id} />
        <Combobox name="concepto" label="concepto" options={conceptos} defaultValue={d.concepto ?? ""} placeholder="Concepto" />
        <Combobox name="destino" label="destino" options={destinos} defaultValue={d.destino ?? ""} placeholder="Destino" />
        <input name="plazo_dias" type="number" min={0} defaultValue={d.plazo_dias ?? ""} placeholder="días" className="nodian-plazo" title="Plazo (días) desde la fecha del documento" />
        <button type="submit" className="c-btn" disabled={pending || !puedeClasificar}
                title={puedeClasificar ? "Guardar clasificación" : "Solo lectura para tu rol"}>
          {pending ? "…" : "Clasif."}
        </button>
      </form>

      <div className="nodian-pagar">
        <div className="num accent">{$(d.valor_a_pagar ?? d.valor)}</div>
        <div className="muted mini">ret {$(d.reten_total ?? 0)}{d.retencion_ok ? " ✓" : ""}</div>
      </div>
      <button type="button" className="c-btn ghost" onClick={() => setModal(true)} disabled={!puedeClasificar}>Reten.</button>

      <div className="nodian-docs">
        {d.soporte_url
          ? <a href={d.soporte_url} target="_blank" rel="noreferrer" className="chip" title="Documento soporte">📎</a>
          : <span className="chip off" title="Sin documento soporte adjunto">📎</span>}
      </div>

      <div className="nodian-estado">
        {falta.length
          ? <span className="nodian-falta" title={`Para pasar a Pagos falta: ${falta.join(", ")}`}>falta {falta.join(" · ")}</span>
          : <span className="nodian-listo" title="Clasificado: ya está en el tablero de Pagos">✓ a Pagos</span>}
        {!d.tiene_banco && (
          <span className="nodian-sinbanco" title="Sin cuenta bancaria en Maestros: no va a entrar al archivo del banco aunque se clasifique.">
            ⚠ sin cuenta
          </span>
        )}
      </div>

      {err && <div className="nodian-err">⚠ {err}</div>}
      {modal && (
        <RetencionesCuentaCobro
          id={d.id} proveedor={d.razon_social} valor={d.valor} ivaIncluido={d.iva_incluido}
          retefuente={d.retefuente} reteiva={d.reteiva} reteica={d.reteica}
          tarRf={d.tar_rf} tarIva={d.tar_iva} tarIca={d.tar_ica}
          otrosValor={d.otros_valor} otrosConcepto={d.otros_concepto} observaciones={d.observaciones}
          yaConfirmada={d.retencion_ok} concepto={d.concepto} regla={regla}
          onClose={() => setModal(false)}
        />
      )}
    </div>
  );
}
