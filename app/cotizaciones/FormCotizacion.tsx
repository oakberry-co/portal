"use client";

import { useActionState, useRef, useState } from "react";
import { enviarCotizacion, reconocerProveedor, type Reconocido, type Resultado } from "./actions";
import { CasillasDocumentos } from "../CasillasDocumentos";
import { RevisarAntesDeEnviar, resumenDe, type FilaResumen } from "../RevisarAntesDeEnviar";
import { AREAS, PLAZOS_NEGOCIADOS, DOCS_COTIZACION, DOCS_RECURRENTE } from "@/lib/areas";

const CAMPOS = [
  { name: "razon_social", etiqueta: "Razón social" },
  { name: "nit", etiqueta: "NIT" },
  { name: "contacto", etiqueta: "Contacto" },
  { name: "telefono", etiqueta: "Teléfono" },
  { name: "correo", etiqueta: "Correo" },
  { name: "numero_cotizacion", etiqueta: "Tu n° de cotización" },
  { name: "area", etiqueta: "Área" },
  { name: "valor", etiqueta: "Valor cotizado", formato: "money" as const },
  { name: "adelanto_pct", etiqueta: "% de adelanto", formato: "pct" as const },
  { name: "concepto", etiqueta: "Concepto" },
];

export function FormCotizacion() {
  const [estado, action, pending] = useActionState<Resultado | null, FormData>(enviarCotizacion, null);
  // Primero: ¿nos conoces? Quien ya nos cotizó (o cobró) no repite documentos.
  const [modo, setModo] = useState<"nuevo" | "recurrente" | null>(null);
  const [recon, setRecon] = useState<Reconocido | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [docBusca, setDocBusca] = useState("");
  const esRecurrente = modo === "recurrente" && !!recon?.ok;
  // Dos pasos: llenar -> revisar -> enviar. El formulario NUNCA se desmonta (se
  // oculta), porque desmontarlo perdería los archivos ya elegidos.
  const [paso, setPaso] = useState<"datos" | "revisar">("datos");
  const [resumen, setResumen] = useState<{ filas: FilaResumen[]; docs: { label: string; nombre: string | null }[] }>({ filas: [], docs: [] });
  const formRef = useRef<HTMLFormElement>(null);
  // Para que el aviso de "tiene clave" diga CUÁL documento probaríamos.
  const [doc, setDoc] = useState("");

  function revisar() {
    const f = formRef.current;
    if (!f || !f.reportValidity()) return;   // validación nativa, antes de ocultar nada
    setResumen(resumenDe(new FormData(f), esRecurrente
      ? CAMPOS.filter((c) => !["razon_social", "contacto", "telefono"].includes(c.name))
      : CAMPOS, esRecurrente ? DOCS_RECURRENTE : DOCS_COTIZACION));
    setPaso("revisar");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (estado?.ok) {
    return (
      <div className="pub-ok">
        <div className="pub-ok-ico">✓</div>
        <h2>¡Cotización recibida!</h2>
        <p>Guárdala con este código y ponlo en tu factura final cuando la emitas:</p>
        <div className="pub-cot">{estado.codigo}</div>
        <p>El equipo de Oakberry la revisa y te contacta. Gracias 💜</p>
        {estado.aviso && <p className="pub-aviso">⚠️ {estado.aviso}</p>}
        <a className="pub-btn ghost" href="/cotizaciones">Enviar otra</a>
      </div>
    );
  }

  // Paso 0: elegir camino. Va ANTES del formulario y no dentro, porque en este
  // punto todavía no hay archivos elegidos que se puedan perder al desmontar.
  if (modo === null) {
    return (
      <div className="pub-elige">
        <p className="pub-elige-tit">¿Ya habías trabajado con Oakberry?</p>
        <button type="button" className="pub-opt" onClick={() => setModo("recurrente")}>
          <b>Sí, ya les he cotizado o cobrado</b>
          <i>Te pedimos solo la cotización y el valor. El anticipo va a la cuenta de siempre.</i>
        </button>
        <button type="button" className="pub-opt ghost" onClick={() => setModo("nuevo")}>
          <b>Es mi primera vez</b>
          <i>Te pedimos tus datos y tres documentos, una sola vez.</i>
        </button>
      </div>
    );
  }

  // Paso 0b: reconocerte por tu NIT. Si no aparece, sigue como nuevo — un camino
  // sin salida en un formulario público es un proveedor que no cotiza.
  if (modo === "recurrente" && !recon?.ok) {
    return (
      <div className="pub-elige">
        <p className="pub-elige-tit">Tu NIT</p>
        <p className="pub-hint">El mismo con el que nos cotizaste o nos cobraste antes.</p>
        <input className="pub-doc-busca" inputMode="numeric" autoFocus
               placeholder="900123456" value={docBusca}
               onChange={(e) => { setDocBusca(e.target.value); setRecon(null); }} />
        <button type="button" className="pub-btn" disabled={buscando || docBusca.replace(/\D/g, "").length < 5}
                onClick={async () => {
                  setBuscando(true);
                  setRecon(await reconocerProveedor(docBusca));
                  setBuscando(false);
                }}>
          {buscando ? "Buscando…" : "Continuar"}
        </button>
        {recon && !recon.ok && (
          <div className="pub-err">
            No encontramos ese NIT entre nuestros proveedores. Puede ser que nos hayas cotizado con
            otro número, o que sea tu primera vez.
          </div>
        )}
        <button type="button" className="pub-link" onClick={() => { setModo("nuevo"); setRecon(null); }}>
          Mejor lleno todo como proveedor nuevo →
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="pub-form" ref={formRef}>
      <div className={"pub-campos" + (paso === "datos" ? "" : " pub-oculto")}>
      {esRecurrente ? (
        <>
          <input type="hidden" name="recurrente" value="1" />
          <input type="hidden" name="nit" value={docBusca} />
          <div className="pub-reconocido">
            ✓ <b>Te reconocimos, {recon!.nombre}.</b>
            {recon!.cuenta && <> El anticipo va a tu cuenta {recon!.banco ? recon!.banco + " " : ""}<b>{recon!.cuenta}</b>, la de siempre.</>}
            <br />
            <span>No tienes que subir RUT ni certificación otra vez.{" "}
              <button type="button" className="pub-link inline"
                      onClick={() => { setModo("nuevo"); setRecon(null); }}>
                ¿Cambiaste de cuenta? Entra como nuevo
              </button>
            </span>
          </div>
          <label className="pub-full">Correo electrónico *
            <input name="correo" type="email" required placeholder="correo@dominio.com" />
          </label>
        </>
      ) : (
        <>
      <div className="pub-sec">Tus datos</div>
      <label className="pub-full">Razón social / Nombre *
        <input name="razon_social" required placeholder="Ej. Servicios XYZ S.A.S." />
      </label>
      <div className="pub-row">
        <label>NIT *<input name="nit" required inputMode="numeric" placeholder="900123456"
                 onChange={(e) => setDoc(e.target.value)} /></label>
        <label>Teléfono / WhatsApp *<input name="telefono" required inputMode="tel" placeholder="300 000 0000" /></label>
      </div>
      <div className="pub-row">
        <label>Nombre de contacto *<input name="contacto" required placeholder="Quién responde" /></label>
        <label>Correo electrónico *<input name="correo" type="email" required placeholder="correo@dominio.com" /></label>
      </div>
        </>
      )}

      <div className="pub-sec">La cotización</div>
      <div className="pub-row">
        <label>Número de tu cotización *
          <input name="numero_cotizacion" required placeholder="El consecutivo que tú le pusiste" />
        </label>
        <label>Área con la que trataste *
          <select name="area" required defaultValue="">
            <option value="">Selecciona…</option>
            {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <label className="pub-full">Valor cotizado (COP) *<input name="valor" required inputMode="numeric" placeholder="$ 0" /></label>
      <label className="pub-full">Concepto *<input name="concepto" required placeholder="¿Qué cotizas?" /></label>
      <label className="pub-full">Descripción / detalle *
        <textarea name="descripcion" rows={2} required placeholder="Detalle de la propuesta" />
      </label>

      {/* El adelanto es OBLIGATORIO: este formulario existe solo para cotizaciones
          con anticipo. Sin anticipo no hay nada que pagar por adelantado y el
          trámite es la factura, que ya tiene su propio carril. */}
      <div className="pub-row">
        <label>% de adelanto *
          <input name="adelanto_pct" required inputMode="decimal" min={1} max={100}
                 type="number" step="1" placeholder="50" />
        </label>
        <label>Plazo del saldo
          <select name="plazo_dias" defaultValue="30">
            {PLAZOS_NEGOCIADOS.map((p) => (
              <option key={p.valor} value={p.valor}>{p.label}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="pub-hint">
        ¿No hay anticipo? Entonces no necesitas registrar la cotización: mándanos
        directamente la factura a <b>compras@manelfoods.com</b>.
      </p>

      <div className="pub-sec">{esRecurrente ? "Tu cotización" : "Documentos"}</div>
      <p className="pub-hint">
        {esRecurrente ? (
          <>Adjunta la cotización de este servicio. <b>En PDF o Word</b>, sin contraseña.</>
        ) : (
          <>
            Toca cada uno para adjuntarlo. <b>Tu cuenta la tomamos de la certificación
            bancaria</b>, así que no tienes que escribirla. La certificación y la cotización
            van en <b>PDF o Word</b>; el RUT puede ser foto.
            <br /><b>Ninguno con contraseña</b> — si tu banco te lo entrega con clave, ábrelo
            y vuelve a guardarlo sin candado.
          </>
        )}
      </p>
      {/* La CÉDULA no se pide acá (21-ago-2026): este formulario pide NIT, no
          tipo de documento, porque quien cotiza es una empresa. La lista de
          obligatorios vive en lib/areas.ts y la usan también la bandeja y la
          página de "completar" — si solo se quitara de la pantalla, la bandeja
          seguiría diciendo "falta la cédula" y nadie podría aprobar. */}
      <CasillasDocumentos documento={esRecurrente ? docBusca : doc}
                          clases={esRecurrente ? DOCS_RECURRENTE : DOCS_COTIZACION} />

      </div>

      {estado?.error && <div className="pub-err">{estado.error}</div>}

      {paso === "datos" ? (
        <button className="pub-btn" type="button" onClick={revisar}>Revisar y enviar →</button>
      ) : (
        <RevisarAntesDeEnviar filas={resumen.filas} docs={resumen.docs} pending={pending}
                              onCorregir={() => setPaso("datos")} textoEnviar="Enviar cotización" />
      )}
    </form>
  );
}
