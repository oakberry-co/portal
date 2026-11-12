"use client";

// EL FORMULARIO DE COBRO DE RD — pensado para el celular, que es de donde llega
// casi todo (creadores e influencers, desde el enlace de WhatsApp).
//
// Lo mismo que aprendimos en Colombia, sin repetir los errores:
//  · Dos pasos: llenar → revisar → enviar. El formulario NUNCA se desmonta (se
//    oculta): desmontarlo perdería los archivos ya elegidos.
//  · El valor en LETRAS debajo de la casilla, y con la moneda correcta.
//  · El neto ESTIMADO a la vista: a una persona física se le retiene ISR. Que se
//    entere acá y no cuando le llegue menos plata de la que esperaba.
//  · Quien ya cobró con la misma cuenta no vuelve a subir cédula ni comprobante.

import { useActionState, useRef, useState } from "react";
import { enviarCuentaCobroRD, type ResultadoRD } from "./actions";
import { CasillasDocumentos } from "../../CasillasDocumentos";
import { RevisarAntesDeEnviar, type FilaResumen } from "../../RevisarAntesDeEnviar";
import { BANCOS_RD, CLASES_DOC_RD, CONCEPTOS_RD, concepto as conceptoDe, letrasRD, mesesElegibles,
         mesLegible, montoRD, plata } from "@/lib/rd/catalogo";
import { problemaId, verificaId, type TipoId } from "@/lib/rd/identidad";
import { propuesta } from "@/lib/rd/retenciones";
import { ruta } from "@/lib/ruta";

const SOLO_SOPORTE = CLASES_DOC_RD.filter((c) => c.clase === "soporte");
const miles = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 0 });

/** Casilla de dinero en la moneda elegida. Al TECLEAR solo entran dígitos (nadie
 *  fabrica un decimal sin querer); al PEGAR se interpreta el número del
 *  documento ('RD$1,250.00' → 1.250), que es el caso que rompió en Colombia. */
function CasillaMontoRD({ name, etiqueta, moneda, requerido, onValor }: {
  name: string; etiqueta: string; moneda: string; requerido: boolean; onValor: (n: number | null) => void;
}) {
  const [n, setN] = useState<number | null>(null);
  const poner = (v: number | null) => {
    const x = v != null && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
    setN(x); onValor(x);
  };
  return (
    <label className="pub-monto">
      {etiqueta}{requerido ? " *" : ""}
      <input name={name} required={requerido} inputMode="numeric"
             placeholder={moneda === "USD" ? "US$ 0" : "RD$ 0"}
             value={n == null ? "" : miles.format(n)}
             onChange={(e) => poner(Number(e.target.value.replace(/\D/g, "")) || null)}
             onPaste={(e) => { e.preventDefault(); poner(montoRD(e.clipboardData.getData("text"))); }} />
      {n != null && <em className="pub-monto-letras">{letrasRD(n, moneda)}</em>}
    </label>
  );
}

export function FormCuentaCobroRD() {
  const [estado, action, pending] = useActionState<ResultadoRD | null, FormData>(enviarCuentaCobroRD, null);
  const [tipoPersona, setTipoPersona] = useState<"fisica" | "juridica" | null>(null);
  const [tipoId, setTipoId] = useState<TipoId>("cedula");
  const [numId, setNumId] = useState("");
  const [moneda, setMoneda] = useState("DOP");
  const [concepto, setConcepto] = useState("");
  const [tieneNcf, setTieneNcf] = useState(false);
  const [banco, setBanco] = useState("");
  const [yaCobre, setYaCobre] = useState(false);
  const [valor, setValor] = useState<number | null>(null);
  const [itbis, setItbis] = useState<number | null>(null);
  const [paso, setPaso] = useState<"datos" | "revisar">("datos");
  const [resumen, setResumen] = useState<{ filas: FilaResumen[]; docs: { label: string; nombre: string | null }[] }>({ filas: [], docs: [] });
  const formRef = useRef<HTMLFormElement>(null);
  const meses = mesesElegibles();
  const c = conceptoDe(concepto);
  const esJuridica = tipoPersona === "juridica";
  const conNcf = esJuridica || tieneNcf;
  const clases = yaCobre ? SOLO_SOPORTE : CLASES_DOC_RD;

  // Aviso EN VIVO del documento: longitud mala = error; dígito que no verifica =
  // aviso (hay cédulas viejas válidas que no pasan el Luhn).
  const idMal = numId ? problemaId(tipoId, numId) : null;
  const idNoVerifica = numId && !idMal && !verificaId(tipoId, numId);

  const hoy = new Date().toISOString().slice(0, 10);
  const est = valor && tipoPersona ? propuesta(tipoPersona, valor, conNcf ? (itbis ?? 0) : 0, hoy) : null;

  function revisar() {
    const f = formRef.current;
    if (!f || !f.reportValidity()) return;
    const fd = new FormData(f);
    const g = (k: string) => String(fd.get(k) ?? "").trim();
    const filas: FilaResumen[] = [
      { etiqueta: esJuridica ? "Razón social" : "Nombre", valor: g("nombre") },
      { etiqueta: "Identificación", valor: `${tipoId === "rnc" ? "RNC" : tipoId === "cedula" ? "Cédula" : "Pasaporte"} ${g("num_id")}` },
      { etiqueta: "WhatsApp", valor: g("telefono") },
      { etiqueta: "Concepto", valor: c ? (c.id === "otro" ? g("concepto_otro") : c.label) : "" },
      { etiqueta: "Mes del servicio", valor: mesLegible(g("periodo")) },
      ...(valor ? [{ etiqueta: "Valor" + (conNcf ? " (sin ITBIS)" : ""), valor: plata(valor, moneda), letras: letrasRD(valor, moneda) }] : []),
      ...(conNcf && itbis ? [{ etiqueta: "ITBIS", valor: plata(itbis, moneda) }] : []),
      ...(conNcf ? [{ etiqueta: "NCF", valor: g("ncf").toUpperCase() }] : []),
      { etiqueta: "Cuenta", valor: `${banco === "__otro" ? g("banco_otro") : banco} · ${g("tipo_cuenta")} · ${g("num_cuenta")}` },
      { etiqueta: "Titular de la cuenta", valor: g("titular_cuenta") },
    ].filter((x) => x.valor);
    const docs = clases.map((k) => {
      const v = fd.get(k.name);
      return { label: k.label, nombre: v instanceof File && v.size > 0 ? v.name : null };
    });
    setResumen({ filas, docs });
    setPaso("revisar");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (estado?.ok) {
    return (
      <div className="pub-ok">
        <div className="pub-ok-ico">✓</div>
        <h2>¡Recibido!</h2>
        <p>Tu cuenta de cobro <b>{estado.ref}</b> llegó a Oakberry RD. La revisamos y te escribimos por WhatsApp. Gracias 💜</p>
        {estado.aviso && <p className="pub-aviso">⚠️ {estado.aviso}</p>}
        <a className="pub-btn ghost" href={ruta("/cuentas-de-cobro/rd")}>Enviar otra</a>
      </div>
    );
  }

  // Paso 0: ¿persona o empresa? Decide qué documento, si hay NCF obligatorio y
  // si se retiene ISR — mejor preguntarlo una vez, antes del formulario.
  if (tipoPersona === null) {
    return (
      <div className="pub-elige">
        <p className="pub-elige-tit">¿Cómo nos cobras?</p>
        <button type="button" className="pub-opt" onClick={() => { setTipoPersona("fisica"); setTipoId("cedula"); }}>
          <b>Como persona</b>
          <i>Creador, influencer, fotógrafo, freelance. Con tu cédula; si no tienes NCF, nosotros emitimos el comprobante.</i>
        </button>
        <button type="button" className="pub-opt ghost" onClick={() => { setTipoPersona("juridica"); setTipoId("rnc"); setTieneNcf(true); }}>
          <b>Como empresa</b>
          <i>Con RNC y factura con NCF de crédito fiscal.</i>
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="pub-form" ref={formRef}>
      <input type="hidden" name="tipo_persona" value={tipoPersona} />
      <input type="hidden" name="tiene_ncf" value={conNcf ? "si" : "no"} />
      <div className={"pub-campos" + (paso === "datos" ? "" : " pub-oculto")}>
        <div className="pub-sec">{esJuridica ? "Tu empresa" : "Tus datos"}</div>
        <label className="pub-full">{esJuridica ? "Razón social *" : "Nombre completo (como en tu cédula) *"}
          <input name="nombre" required autoComplete="name" placeholder={esJuridica ? "Ej. Producciones XYZ, S.R.L." : "Ej. Ana María Pérez"} />
        </label>
        <div className="pub-row">
          <label>Identificación
            <select name="tipo_id" value={tipoId} onChange={(e) => setTipoId(e.target.value as TipoId)} disabled={esJuridica}>
              {!esJuridica && <option value="cedula">Cédula</option>}
              <option value="rnc">RNC</option>
              {!esJuridica && <option value="pasaporte">Pasaporte (extranjeros)</option>}
            </select>
            {esJuridica && <input type="hidden" name="tipo_id" value="rnc" />}
          </label>
          <label>Número *
            <input name="num_id" required inputMode={tipoId === "pasaporte" ? "text" : "numeric"}
                   placeholder={tipoId === "rnc" ? "1-01-85004-3" : tipoId === "cedula" ? "001-1234567-8" : ""}
                   value={numId} onChange={(e) => setNumId(e.target.value)} />
            {idMal && <em className="pub-dv-mal">{idMal}</em>}
            {idNoVerifica && <em className="pub-dv-mal">Este número no pasa la verificación. Revísalo contra tu documento.</em>}
          </label>
        </div>
        {(estado?.pedirConfirmarId || idNoVerifica) && (
          <div className="pub-check">
            <label className="pub-switch">
              <input type="checkbox" name="confirmo_id" value="1" />
              Lo revisé y mi número está bien escrito
            </label>
          </div>
        )}
        <div className="pub-row">
          <label>WhatsApp *<input name="telefono" required inputMode="tel" autoComplete="tel" placeholder="809 555 1234" /></label>
          <label>Correo *<input name="correo" type="email" required autoComplete="email" placeholder="correo@dominio.com" /></label>
        </div>
        {!esJuridica && (
          <label className="pub-full">Instagram (si eres creador)
            <input name="instagram" placeholder="@tuusuario" autoCapitalize="off" />
          </label>
        )}

        <div className="pub-sec">El cobro</div>
        <label className="pub-full">Concepto *
          <select name="concepto" required value={concepto} onChange={(e) => setConcepto(e.target.value)}>
            <option value="">Selecciona…</option>
            {CONCEPTOS_RD.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
        {concepto === "otro" && (
          <label className="pub-full">¿Qué servicio es? *<input name="concepto_otro" required placeholder="Ej. Alquiler de sonido" /></label>
        )}
        <label className="pub-full">Descripción / detalle *
          <textarea name="descripcion" rows={2} required placeholder="Ej. 2 reels + 3 historias de la apertura de Plaza Andalucía" />
        </label>
        <label className="pub-full">Enlaces de lo que publicaste o entregaste{c?.evidencia ? " *" : ""}
          <textarea name="enlaces" rows={2} required={!!c?.evidencia} autoCapitalize="off"
                    placeholder="https://www.instagram.com/reel/… (uno por línea)" />
        </label>
        <div className="pub-row">
          <label>Mes del servicio *
            <select name="periodo" required defaultValue={meses[0]}>
              {meses.map((m) => <option key={m} value={m}>{mesLegible(m)}</option>)}
            </select>
          </label>
          <label>Moneda *
            <select name="moneda" value={moneda} onChange={(e) => { setMoneda(e.target.value); setValor(null); setItbis(null); }}>
              <option value="DOP">Pesos dominicanos (RD$)</option>
              <option value="USD">Dólares (US$)</option>
            </select>
          </label>
        </div>

        {!esJuridica && (
          <div className="pub-check">
            <label className="pub-switch">
              <input type="checkbox" checked={tieneNcf} onChange={(e) => setTieneNcf(e.target.checked)} />
              Tengo RNC y te facturo con NCF
            </label>
          </div>
        )}
        <div className="pub-row">
          <CasillaMontoRD key={"v" + moneda} name="valor" moneda={moneda} requerido onValor={setValor}
                          etiqueta={conNcf ? "Valor sin ITBIS" : "Valor a cobrar"} />
          {conNcf && (
            <CasillaMontoRD key={"i" + moneda} name="itbis_facturado" moneda={moneda} requerido={false} onValor={setItbis}
                            etiqueta="ITBIS de tu factura (si lleva)" />
          )}
        </div>
        {conNcf && (
          <div className="pub-row">
            <label>NCF de tu factura *
              <input name="ncf" required autoCapitalize="characters" placeholder="B0100000001 o E310000000001" />
            </label>
            <label>Fecha de la factura *<input name="fecha_ncf" type="date" required /></label>
          </div>
        )}
        {est && (est.isrMonto > 0 || est.itbisMonto > 0) && (
          <p className="pub-hint">
            Por ley, la empresa le retiene a una persona física {Math.round(est.isrTasa * 100)} % de ISR
            {est.itbisMonto > 0 ? " y el ITBIS facturado" : ""} y lo paga a la DGII a tu nombre.
            Recibirías aproximadamente <b>{plata(est.neto, moneda)}</b>.
          </p>
        )}

        <div className="pub-sec">¿A dónde te pagamos?</div>
        <div className="pub-row">
          <label>Banco *
            <select name="banco" required value={banco} onChange={(e) => setBanco(e.target.value)}>
              <option value="">Selecciona…</option>
              {BANCOS_RD.map((b) => <option key={b} value={b}>{b}</option>)}
              <option value="__otro">Otro — no está en la lista</option>
            </select>
          </label>
          <label>Tipo de cuenta *
            <select name="tipo_cuenta" required defaultValue="">
              <option value="">Selecciona…</option>
              <option value="ahorros">Ahorros</option>
              <option value="corriente">Corriente</option>
            </select>
          </label>
        </div>
        {banco === "__otro" && (
          <label className="pub-full">¿Cuál banco? *<input name="banco_otro" required /></label>
        )}
        <div className="pub-row">
          <label>Número de cuenta *<input name="num_cuenta" required inputMode="numeric" placeholder="Solo dígitos" /></label>
          <label>Titular de la cuenta *<input name="titular_cuenta" required placeholder="A nombre de quién está" /></label>
        </div>

        <div className="pub-sec">Documentos</div>
        <div className="pub-check">
          <label className="pub-switch">
            <input type="checkbox" checked={yaCobre} onChange={(e) => setYaCobre(e.target.checked)} />
            Ya les cobré antes a esta MISMA cuenta (no vuelvo a subir cédula ni comprobante)
          </label>
        </div>
        <p className="pub-hint">
          Toca cada uno para adjuntarlo. Sirven fotos o PDF, <b>sin contraseña</b>.
          {yaCobre && <> Si la cuenta es otra, desmarca la casilla: una cuenta nueva necesita su comprobante.</>}
        </p>
        <CasillasDocumentos key={yaCobre ? "s" : "t"} documento={numId} clases={clases} />
      </div>

      {estado?.error && <div className="pub-err">{estado.error}</div>}

      {paso === "datos" ? (
        <button className="pub-btn" type="button" onClick={revisar}>Revisar y enviar →</button>
      ) : (
        <RevisarAntesDeEnviar filas={resumen.filas} docs={resumen.docs} pending={pending}
                              onCorregir={() => setPaso("datos")} textoEnviar="Enviar cuenta de cobro" />
      )}
    </form>
  );
}
