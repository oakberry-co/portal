"use client";

// LOS DOCUMENTOS SIN FACTURA DIAN, EN CONCILIACIÓN.
//
// Cuentas de cobro aprobadas y gastos internos (servicios públicos y otros):
// gastos de verdad, que hay que clasificar igual que una factura antes de
// pagarlos. Antes se aprobaban y saltaban directo a Pagos: se pagaban bien, pero
// quedaban sin concepto ni destino, y el destino vacío no se llena solo.
//
// VAN EN LA MISMA TABLA que las facturas (23-ago-2026). Estaban en un bloque
// aparte arriba, y era un cajón distinto para el mismo trabajo: el equipo tiene
// que clasificar, retener y pagar exactamente igual. En la columna de la factura
// dicen SIN FACTURA, que es toda la diferencia que hay que ver.
//
// LO QUE SÍ SIGUE SIENDO DISTINTO, y hay que saberlo: **no tienen CUFE**, y el
// Excel de retenciones usa el CUFE como llave para volver (Regla 15: lo que sale
// tiene que poder volver). Por eso estas filas NO viajan en ese Excel — sus
// retenciones se hacen con el botón de la fila, que abre el modal. Meterlas al
// Excel sin darles una llave de round-trip sería mandar filas que no pueden
// regresar, que es peor que no mandarlas.
//
// Se pintan ARRIBA de las facturas y no se ordenan con ellas: son pocas y son
// las que se quedan sin hacer si se pierden entre 4.000 filas.

import { useState, useTransition } from "react";
import { semanaISO } from "@/lib/orden-facturas";
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
  if (!docs.length) return null;

  return (
    <>
      {docs.map((d) => (
        <FilaDoc key={d.id} d={d} conceptos={conceptos} destinos={destinos} puedeClasificar={puedeClasificar} />
      ))}
    </>
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

  const aPagar = d.valor_a_pagar ?? d.valor;

  return (
    <div className={"fila" + (falta.length ? " pend" : "")}>
      <div className="c-prov">
        <div className="prov" title={d.descripcion ?? d.razon_social}>{d.razon_social}</div>
        <div className="muted mini">
          NIT {d.num_doc}
          {d.numero ? ` · ${d.numero}` : ""}
          {d.area ? ` · área ${d.area}` : ""}
        </div>
      </div>

      {/* Toda la diferencia que hay que ver está acá: no hay número de factura
          porque no hay factura. La referencia (CC-46 / SP-51) va debajo, que es
          con la que el equipo la nombra. */}
      <div className="c-num mono" title={`${ETIQUETA_TIPO[d.tipo] ?? d.tipo}${d.tipo_detalle ? " · " + d.tipo_detalle : ""}${d.origen === "interno" ? " · lo cargó el equipo" : " · lo envió el proveedor"}`}>
        <span className="c-sinfac">SIN FACTURA</span>
        <span className="muted mini nodian-ref2">{d.ref}</span>
      </div>

      <div className="c-fecha"><span title="Fecha del documento">{ddmm(d.fecha)}</span></div>
      <div className="c-sem">{semanaISO(d.fecha)}</div>
      <div className="c-valor num">{$(d.valor)}</div>

      <form onSubmit={guardar} style={{ display: "contents" }}>
        <input type="hidden" name="id" value={d.id} />
        <div className="c-field">
          <Combobox name="concepto" label="concepto" options={conceptos} defaultValue={d.concepto ?? ""} placeholder="Concepto" />
        </div>
        <div className="c-field">
          <Combobox name="destino" label="destino" options={destinos} defaultValue={d.destino ?? ""} placeholder="Destino" />
        </div>
        <div className="c-plazo">
          <input name="plazo_dias" type="number" min={0} defaultValue={d.plazo_dias ?? ""} placeholder="días"
                 title="Plazo (días) desde la fecha del documento" />
        </div>
        <button type="submit" className="c-btn" disabled={pending || !puedeClasificar}
                title={puedeClasificar ? "Confirmar clasificación" : "Solo lectura para tu rol (contador)"}>
          {pending ? "…" : "Clasif."}
        </button>
      </form>

      <div className="c-pagar">
        <div className="num accent">{$(aPagar)}</div>
        <div className="muted mini">ret {$(d.reten_total ?? 0)}{d.retencion_ok ? " ✓" : ""}</div>
      </div>

      {/* El Excel de retenciones va por CUFE y estas filas no tienen: sus
          retenciones se hacen por acá. Lo dice el title, para que quien baje el
          Excel y no las vea sepa por qué. */}
      <button type="button" className="c-btn ghost" onClick={() => setModal(true)} disabled={!puedeClasificar}
              title="Retenciones de este documento (no viaja en el Excel: no tiene CUFE)">Reten.</button>
      {/* Sin equivalente al desvío de cuenta por factura: se deja el hueco para
          que las columnas de las dos clases de fila sigan alineadas. */}
      <span />

      <div className="c-docs">
        {d.soporte_url
          ? <a href={d.soporte_url} target="_blank" rel="noreferrer" className="chip" title="Documento soporte">PDF</a>
          : <span className="chip off" title="Sin documento soporte adjunto">PDF</span>}
      </div>

      {/* LOS MISMOS TRES SEMÁFOROS que una factura, y no un texto propio: es el
          mismo estado (clasificado · retenido · pagado) y verlo escrito distinto
          obliga a leer dos idiomas en la misma columna. */}
      <div className="c-sems">
        <span className="sem" title={d.concepto && d.destino ? "Clasificado" : "Falta clasificar (concepto y destino)"}>
          <i className={"luz " + (d.concepto && d.destino ? "ok" : "no")} />Clasif
        </span>
        <span className="sem" title={d.retencion_ok ? "Retenciones confirmadas" : "Faltan retenciones (aunque sean cero)"}>
          <i className={"luz " + (d.retencion_ok ? "ok" : "no")} />Reten
        </span>
        <span className="sem" title={falta.length ? `Aún no pasa a Pagos: falta ${falta.join(", ")}` : "En el tablero de Pagos"}>
          <i className={"luz " + (falta.length ? "no" : "ok")} />Pago
        </span>
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
