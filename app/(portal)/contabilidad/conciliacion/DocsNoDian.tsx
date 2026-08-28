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
import { ajustarMonto } from "@/lib/valor-actions";
import { faltaParaPagos } from "@/lib/falta-pagos";
import { etiquetaPeriodo, etiquetaForma, vaAlBanco } from "@/lib/gastos-periodicos";

export type DocNoDianUI = {
  id: number; ref: string; tipo: string; tipo_detalle: string | null; origen: string;
  razon_social: string; num_doc: string; numero: string | null;
  descripcion: string | null; area: string | null;
  fecha: string;
  // NULL = gasto periódico esperando su monto. No es cero: es "todavía no
  // sabemos cuánto", y confundirlos deja un gasto de $0 listo para pagarse.
  valor: number | null;
  plantilla_id: number | null; periodo: string | null; vence: string | null;
  forma_pago: string | null; referencia_pago: string | null;
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
const $ = (n: number | null | undefined) => (n == null ? "—" : cop.format(Math.round(n)));
/** Como se escribe la plata en Colombia: el punto separa MILES. */
const milesCO = (raw: string) => {
  const d = raw.replace(/[^\d]/g, "");
  return d ? Number(d).toLocaleString("es-CO") : "";
};
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** Hoy en Bogotá: la fecha se compara contra un vencimiento, y en UTC después de
 *  las 7 p.m. un gasto que vence mañana ya aparecería como "vence hoy". */
const hoyBta = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const diasHasta = (iso: string) =>
  Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(hoyBta + "T00:00:00Z")) / 86400000);
const ddmm = (s: string) => { const d = new Date(s + (s.length === 10 ? "T00:00:00" : "")); return `${String(d.getDate()).padStart(2, "0")}/${MESES[d.getMonth()]}`; };

const ETIQUETA_TIPO: Record<string, string> = {
  cuenta_cobro: "Cuenta de cobro",
  servicio_publico: "Servicio público",
  arriendo: "Arriendo",
  administracion: "Administración",
  seguro: "Seguro / póliza",
  impuesto: "Impuesto",
  otro: "Otro gasto",
};

/** De dónde salió el documento, para el title de la fila. */
const ORIGEN: Record<string, string> = {
  interno: "lo cargó el equipo",
  periodico: "lo creó la plantilla del gasto periódico",
  portal_publico: "lo envió el proveedor",
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
  // que hace que la gente deje de usar la pantalla (Regla 18). Sale de la MISMA
  // función que decide el paso a Pagos: si acá dijera algo distinto, la fila
  // diría "listo" y el botón la rechazaría.
  const falta = faltaParaPagos(d);
  const esperaValor = d.valor == null;

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
        {/* CÓMO se paga y con QUÉ referencia. Va en la fila y no escondido en la
            plantilla porque quien concilia es quien va a entrar a la página del
            proveedor a pagarlo. La referencia se muestra siempre que exista: un
            gasto de una sola vez también se paga tecleándola. */}
        {(d.referencia_pago || (d.plantilla_id && !vaAlBanco(d.forma_pago))) && (
          <div className="muted mini">
            {!vaAlBanco(d.forma_pago) ? etiquetaForma(d.forma_pago) : null}
            {d.referencia_pago
              ? <>{!vaAlBanco(d.forma_pago) ? " · " : ""}ref <b className="mono">{d.referencia_pago}</b></>
              : null}
          </div>
        )}
      </div>

      {/* Toda la diferencia que hay que ver está acá: no hay número de factura
          porque no hay factura. La referencia (CC-46 / SP-51) va debajo, que es
          con la que el equipo la nombra. */}
      <div className="c-num mono" title={`${ETIQUETA_TIPO[d.tipo] ?? d.tipo}${d.tipo_detalle ? " · " + d.tipo_detalle : ""} · ${ORIGEN[d.origen] ?? d.origen}`}>
        <span className="c-sinfac">SIN FACTURA</span>
        <span className="muted mini nodian-ref2">{d.ref}</span>
        {/* De qué MES es. Tres recibos de luz de la misma tienda en la misma
            lista son indistinguibles sin esto. */}
        {d.periodo && <span className="muted mini nodian-ref2">🔁 {etiquetaPeriodo(d.periodo)}</span>}
      </div>

      <div className="c-fecha">
        <span title="Fecha del documento">{ddmm(d.fecha)}</span>
        {/* CUÁNTO FALTA PARA QUE SE VENZA. Un gasto sin factura no lo reclama
            nadie: no llega un correo del proveedor ni una factura vencida en la
            DIAN. Si acá no se ve, se entera la tienda cuando le cortan el
            servicio. */}
        {d.vence && <Vence iso={d.vence} />}
      </div>
      <div className="c-sem">{semanaISO(d.fecha)}</div>
      {/* EL VALOR ES LO ÚNICO QUE CAMBIA en un gasto periódico: nace vacío y se
          escribe acá, en la misma pantalla donde se revisa. Mandar a otra
          pantalla por un número es lo que hace que la gente pague por fuera. */}
      <div className="c-valor num">
        {esperaValor ? <PonerValor d={d} puede={puedeClasificar} /> : $(d.valor)}
      </div>

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
      <button type="button" className="c-btn ghost" onClick={() => setModal(true)}
              disabled={!puedeClasificar || esperaValor}
              title={esperaValor
                ? "Primero escribe el valor del mes: la retención es un porcentaje de él."
                : "Retenciones de este documento (no viaja en el Excel: no tiene CUFE)"}>Reten.</button>
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
        {/* El aviso de la cuenta bancaria solo aplica a lo que se TRANSFIERE. Un
            servicio público que se paga entrando a la página del proveedor no
            necesita ninguna cuenta, y avisarlo igual entrena a la gente a
            ignorar los avisos — que es peor que no ponerlos. */}
        {!d.tiene_banco && vaAlBanco(d.forma_pago) && (
          <span className="nodian-sinbanco" title="Sin cuenta bancaria en Maestros: no va a entrar al archivo del banco aunque se clasifique.">
            ⚠ sin cuenta
          </span>
        )}
      </div>

      {err && <div className="nodian-err">⚠ {err}</div>}
      {modal && d.valor != null && (
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

/** ESCRIBIR EL VALOR DEL MES.
 *
 *  Es el trabajo entero de un gasto periódico: todo lo demás —proveedor,
 *  referencia, concepto, destino— ya venía decidido de la plantilla. Por eso el
 *  campo está en la fila y no detrás de un modal: son varias filas seguidas y
 *  abrir y cerrar una ventana por cada número convierte un barrido en un
 *  trámite.
 *
 *  Escribe por el MISMO camino que la corrección de monto de la bandeja
 *  (`ajustarMonto`), que sabe distinguir LLENAR de CAMBIAR: llenar no pide
 *  motivo —no hay nada que justificar— y cambiar sí. Un segundo camino de
 *  escritura para el mismo dato es como se desincronizan. */
function PonerValor({ d, puede }: { d: DocNoDianUI; puede: boolean }) {
  const [v, setV] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("origen", "cuenta_cobro");
    fd.set("id", String(d.id));
    setErr(null);
    start(async () => {
      const r = await ajustarMonto(null, fd);
      if (!r.ok) setErr(r.error ?? "No se pudo guardar.");
    });
  }

  return (
    <form onSubmit={enviar} className="poner-valor" title="Cuánto llegó este mes">
      <input name="valor" inputMode="numeric" placeholder="¿cuánto?" value={v}
             onChange={(e) => setV(milesCO(e.target.value))} disabled={!puede} required />
      <button className="c-btn" disabled={pending || !puede || !v}>{pending ? "…" : "OK"}</button>
      {err && <div className="nodian-err">⚠ {err}</div>}
    </form>
  );
}

/** Cuánto falta para el vencimiento, con el mismo lenguaje que el tablero de
 *  Pagos: leer dos idiomas para el mismo estado obliga a traducir. */
function Vence({ iso }: { iso: string }) {
  const d = diasHasta(iso);
  const clase = d < 0 ? "lo" : d <= 3 ? "mid" : "hi";
  const texto = d < 0 ? `⏰ ${-d}d tarde` : d === 0 ? "⏰ vence hoy" : `faltan ${d}d`;
  return <span className={"nodian-vence " + clase} title={`Hay que pagarlo el ${iso}`}>{texto}</span>;
}
