"use client";

import { useActionState, useRef, useState } from "react";
import { enviarCuentaCobro, reconocerProveedor, type Reconocido, type Resultado } from "./actions";
import { CasillasDocumentos } from "../CasillasDocumentos";
import { CasillaDocumentoConDV } from "../CasillaDV";
import { CasillaMonto } from "../CasillaMonto";
import { RevisarAntesDeEnviar, resumenDe, type FilaResumen } from "../RevisarAntesDeEnviar";
import { AREAS, CLASES_DOC } from "@/lib/areas";
import { ruta } from "@/lib/ruta";

// Solo el soporte: al recurrente no se le vuelven a pedir los documentos de
// identidad, que es justo lo que lo hacía abandonar desde el celular.
const SOLO_SOPORTE = CLASES_DOC.filter((c) => c.clase === "soporte");

const CAMPOS = [
  { name: "razon_social", etiqueta: "Razón social" },
  { name: "num_doc", etiqueta: "Documento", formato: "doc" as const },
  { name: "contacto", etiqueta: "Contacto" },
  { name: "telefono", etiqueta: "Teléfono" },
  { name: "correo", etiqueta: "Correo" },
  { name: "area", etiqueta: "Área" },
  { name: "valor", etiqueta: "Valor a cobrar", formato: "money" as const },
  { name: "concepto", etiqueta: "Concepto" },
];

export function FormCuentaCobro({ conceptos }: { conceptos: string[] }) {
  const [estado, action, pending] = useActionState<Resultado | null, FormData>(enviarCuentaCobro, null);
  // Primero: ¿nos conoces? Quien ya cobró antes no repite sus documentos.
  const [modo, setModo] = useState<"nuevo" | "recurrente" | null>(null);
  const [recon, setRecon] = useState<Reconocido | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [docBusca, setDocBusca] = useState("");
  const [concepto, setConcepto] = useState("");
  const esRecurrente = modo === "recurrente" && !!recon?.ok;
  // Dos pasos: llenar -> revisar -> enviar. El formulario NUNCA se desmonta (se
  // oculta), porque desmontarlo perdería los archivos ya elegidos.
  const [paso, setPaso] = useState<"datos" | "revisar">("datos");
  const [resumen, setResumen] = useState<{ filas: FilaResumen[]; docs: { label: string; nombre: string | null }[] }>({ filas: [], docs: [] });
  const formRef = useRef<HTMLFormElement>(null);
  // Para que el aviso de "tiene clave" diga CUÁL documento probaríamos.
  const [doc, setDoc] = useState("");
  // El dígito de verificación es cosa del NIT: una cédula no tiene.
  const [tipoDoc, setTipoDoc] = useState("NIT");

  function revisar() {
    const f = formRef.current;
    if (!f || !f.reportValidity()) return;   // validación nativa, antes de ocultar nada
    setResumen(resumenDe(new FormData(f), esRecurrente
      ? CAMPOS.filter((c) => !["razon_social", "contacto", "telefono"].includes(c.name))
      : CAMPOS, esRecurrente ? SOLO_SOPORTE : CLASES_DOC));
    setPaso("revisar");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (estado?.ok) {
    return (
      <div className="pub-ok">
        <div className="pub-ok-ico">✓</div>
        <h2>¡Recibido!</h2>
        <p>Tu cuenta de cobro llegó a Oakberry. El equipo de contabilidad la revisa y te contacta. Gracias 💜</p>
        {estado.aviso && <p className="pub-aviso">⚠️ {estado.aviso}</p>}
        <a className="pub-btn ghost" href={ruta("/cuentas-de-cobro")}>Enviar otra</a>
      </div>
    );
  }

  // Paso 0: elegir camino. Va ANTES del formulario y no dentro, porque en este
  // punto todavía no hay archivos elegidos que se puedan perder al desmontar.
  if (modo === null) {
    return (
      <div className="pub-elige">
        <p className="pub-elige-tit">¿Ya le habías cobrado a Oakberry?</p>
        <button type="button" className="pub-opt" onClick={() => setModo("recurrente")}>
          <b>Sí, ya les he cobrado</b>
          <i>Te pedimos solo el soporte y el valor. Te pagamos a la cuenta de siempre.</i>
        </button>
        <button type="button" className="pub-opt ghost" onClick={() => setModo("nuevo")}>
          <b>Es mi primera vez</b>
          <i>Te pedimos tus datos y cuatro documentos, una sola vez.</i>
        </button>
      </div>
    );
  }

  // Paso 0b: reconocerte por tu documento. Si no aparece, sigue como nuevo — un
  // camino sin salida en un formulario público es un proveedor que no cobra.
  if (modo === "recurrente" && !recon?.ok) {
    return (
      <div className="pub-elige">
        <p className="pub-elige-tit">Tu número de documento</p>
        <p className="pub-hint">El mismo con el que nos cobraste antes (NIT o cédula).</p>
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
            No encontramos ese documento entre nuestros proveedores. Puede ser que nos hayas cobrado con
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
          <input type="hidden" name="num_doc" value={docBusca} />
          <div className="pub-reconocido">
            ✓ <b>Te reconocimos, {recon!.nombre}.</b>
            {recon!.cuenta && <> Te pagamos a tu cuenta {recon!.banco ? recon!.banco + " " : ""}<b>{recon!.cuenta}</b>, la de siempre.</>}
            <br />
            <span>No tienes que subir el RUT ni la certificación otra vez.{" "}
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
      <label className="pub-full">Razón social / Nombre completo *
        <input name="razon_social" required placeholder="Ej. Servicios XYZ S.A.S." />
      </label>
      <div className="pub-row">
        <label>Tipo de documento
          <select name="tipo_doc" value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)}>
            <option value="NIT">NIT</option><option value="CC">Cédula (CC)</option>
            <option value="CE">Cédula extranjería (CE)</option><option value="PPT">PPT</option>
          </select>
        </label>
        <CasillaDocumentoConDV name="num_doc" etiqueta="Número de documento"
                               valor={doc} onValor={setDoc} pedirDV={tipoDoc === "NIT"} />
      </div>
      <div className="pub-row">
        <label>Nombre de contacto *<input name="contacto" required placeholder="Quién responde" /></label>
        <label>Teléfono / WhatsApp *<input name="telefono" required inputMode="tel" placeholder="300 000 0000" /></label>
      </div>
      <label className="pub-full">Correo electrónico *
        <input name="correo" type="email" required placeholder="correo@dominio.com" />
      </label>
        </>
      )}

      <div className="pub-sec">El cobro</div>
      <div className="pub-row">
        <label>Área con la que trataste *
          <select name="area" required defaultValue="">
            <option value="">Selecciona…</option>
            {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <CasillaMonto etiqueta="Valor a cobrar (COP)" />
      </div>
      <label className="pub-full">Concepto *
        {conceptos.length ? (
          <select name="concepto" required value={concepto} onChange={(e) => setConcepto(e.target.value)}>
            <option value="">Selecciona…</option>
            {conceptos.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="__otro">Otro — no está en la lista</option>
          </select>
        ) : (
          <input name="concepto" required placeholder="¿Por qué es el cobro?" />
        )}
      </label>
      {/* Salida de emergencia: una lista cerrada sin escape deja a alguien sin
          poder cobrar. Lo que escriba acá entra marcado y contabilidad decide si
          merece ser un concepto nuevo del maestro. */}
      {concepto === "__otro" && (
        <label className="pub-full">¿Cómo lo llamarías? *
          <input name="concepto_otro" required placeholder="Ej. Alquiler de sonido" />
        </label>
      )}
      <label className="pub-full">Descripción / detalle *
        <textarea name="descripcion" rows={2} required placeholder="Detalle del servicio o producto" />
      </label>

      {/* Los campos de banco/cuenta se quitaron a propósito (2026-08-17): la cuenta
          la lee el sistema de la CERTIFICACIÓN del banco. Teclearla era el punto
          por donde entraban los errores de dígito y el fraude. */}
      <div className="pub-sec">{esRecurrente ? "Tu soporte" : "Documentos"}</div>
      <p className="pub-hint">
        {esRecurrente ? (
          <>Adjunta tu cuenta de cobro o factura de este servicio. <b>En PDF o Word</b>, sin contraseña.</>
        ) : (
          <>
            Toca cada uno para adjuntarlo. <b>Tu cuenta la tomamos de la certificación
            bancaria</b>, así que no tienes que escribirla. La certificación y el soporte
            van en <b>PDF o Word</b>; el RUT puede ser foto.
            <br /><b>Ninguno con contraseña</b> — si tu banco te lo entrega con clave, ábrelo
            y vuelve a guardarlo sin candado.
          </>
        )}
      </p>
      <CasillasDocumentos documento={esRecurrente ? docBusca : doc}
                          clases={esRecurrente ? SOLO_SOPORTE : undefined} />

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
