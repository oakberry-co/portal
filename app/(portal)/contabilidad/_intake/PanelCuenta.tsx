"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";

// Lo que la bandeja tiene que mostrar ANTES de dejar aprobar: qué documentos
// llegaron, qué dice la certificación del banco y a qué cuenta se pagaría.
// Compartido por las dos bandejas (cuentas de cobro y cotizaciones) para que
// digan exactamente lo mismo.

import { CLASES_DOC, etiquetaClase, type DocGuardado } from "@/lib/areas";
import { cola, FALTA_CUENTA, type CertEstado, type CuentaMaestro } from "@/lib/certificaciones";
import { BANCOS } from "@/lib/bancos";
import { guardarCuenta } from "@/lib/certificacion-actions";
import { ErrorAccion } from "./ErrorAccion";
import type { Resultado } from "@/lib/resultado";

export type DocIntake = DocGuardado & { nombre?: string; path?: string; tipo?: string };

/** Los 4 documentos pedidos, cada uno presente (link) o ausente (rojo), más los
 *  sueltos. Se pinta la LISTA COMPLETA y no solo lo que llegó: un documento que
 *  falta tiene que verse, no deducirse por ausencia. */
export function DocsIntake({ docs, soloSoporte = false }: {
  docs: DocIntake[];
  /** Proveedor recurrente: solo trae el soporte. Pintar en rojo los otros tres
   *  como "falta" sería mentirle al revisor — no los tenía que mandar. */
  soloSoporte?: boolean;
}) {
  const lista = docs ?? [];
  const PEDIDOS = soloSoporte ? CLASES_DOC.filter((c) => c.clase === "soporte") : CLASES_DOC;
  const tipados = lista.filter((d) => d.clase && d.clase !== "otro");
  const extras = lista.filter((d) => !d.clase || d.clase === "otro");
  const viejo = tipados.length === 0;   // envío anterior a los documentos tipados

  return (
    <div className="cc-docs">
      {viejo
        ? lista.map((d, i) => <ChipDoc key={i} doc={d} etiqueta={etiquetaClase(d.clase)} />)
        : PEDIDOS.map((c) => {
            const d = tipados.find((x) => x.clase === c.clase);
            if (!d) return <span key={c.clase} className="cc-doc falta" title={`El proveedor no adjuntó: ${c.label}`}>✗ {c.label} — falta</span>;
            return <ChipDoc key={c.clase} doc={d} etiqueta={c.label} />;
          })}
      {extras.map((d, i) => <ChipDoc key={"x" + i} doc={d} etiqueta="Documento" />)}
    </div>
  );
}

function ChipDoc({ doc, etiqueta }: { doc: DocIntake; etiqueta: string }) {
  if (doc.estado === "pendiente" || !(doc.path ?? "").trim()) {
    return <span className="cc-doc falta" title={"No llegó a Drive: " + (doc.nombre ?? etiqueta)}>⚠️ {etiqueta} — no subió</span>;
  }
  return <a href={doc.path} target="_blank" rel="noopener noreferrer" className="cc-doc">📎 {etiqueta}</a>;
}

/** Qué se le ha escrito al proveedor. Sin esto, el equipo no sabe si el
 *  proveedor ya se enteró y termina escribiéndole por WhatsApp "por si acaso"
 *  (Regla 18: el loop humano tiene que cerrar Y verse). */
export type CorreoEnviado = { tipo: string; estado: string; enviado_en: string | null; error: string | null };

const NOMBRE_CORREO: Record<string, string> = {
  certificacion_invalida: "le pedimos la certificación real",
  aprobacion: "le avisamos que aprobamos y le pedimos la factura",
  pago_hecho: "le avisamos que le pagamos",
};

export function CorreosIntake({ correos }: { correos: CorreoEnviado[] }) {
  if (!correos?.length) return null;
  const dia = (s: string | null) =>
    s ? new Date(s).toLocaleDateString("es-CO", { day: "2-digit", month: "short" }) : "";
  return (
    <div className="cc-correos">
      {correos.map((c, i) => (
        <span key={i} className={"cc-correo " + c.estado}
              title={c.error ?? (c.estado === "enviado" ? "Enviado por correo" : "En cola de envío")}>
          {c.estado === "enviado" ? "✉️" : c.estado === "fallido" ? "⚠️" : "🕓"}{" "}
          {NOMBRE_CORREO[c.tipo] ?? c.tipo}
          {c.estado === "enviado" ? ` · ${dia(c.enviado_en)}` : c.estado === "fallido" ? " · no salió" : " · en cola"}
        </span>
      ))}
    </div>
  );
}

/** EL PASO FINAL, y el más importante: alguien abre el documento y ESCRIBE la
 *  cuenta. No un "confirmo que revisé" —eso se marca sin mirar— sino doble
 *  digitación contra dos fuentes independientes.
 *
 *  Si coincide con lo que leyó el OCR, la cuenta queda confirmada por partida
 *  doble. Si NO coincide, no se resuelve solo: se muestran los dos números y
 *  decide quien tiene el documento delante. */
/** LA CUENTA: tres campos y un botón. No se compara con nada.
 *
 *  Lo que el lector sacó del documento se usa para PRECARGAR (no para decidir):
 *  ahorra teclear y quien revisa lo está mirando contra el papel de todos modos.
 *  Antes esto eran tres pantallas —el choque contra el OCR, la alarma de "cambió
 *  la cuenta" y sus dos salidas— y aprobar era un trámite de cinco pasos. */
function EscribirCuenta({ cert, nit, cuenta, docUrl }: {
  cert: CertEstado | null; nit: string; cuenta: CuentaMaestro; docUrl?: string;
}) {
  const [banco, setBanco] = useState(cuenta?.banco ?? cert?.banco ?? "");
  const [tipo, setTipo] = useState(cuenta?.tipo_cuenta ?? cert?.tipo_cuenta ?? "");
  const [num, setNum] = useState(cuenta?.num_cuenta ?? cert?.num_cuenta ?? "");
  const [err, setErr] = useState("");
  const [listo, setListo] = useState(false);
  const [pend, start] = useTransition();

  const guardar = () => start(async () => {
    setErr("");
    try {
      const fd = new FormData();
      if (cert?.id) fd.set("cert_id", String(cert.id));
      fd.set("nit", nit);
      fd.set("banco", banco);
      fd.set("tipo_cuenta", tipo);
      fd.set("num_cuenta", num);
      await guardarCuenta(fd);
      setListo(true);
    } catch (e) { setErr((e as Error).message); }
  });

  return (
    <div className="cc-verif">
      <div className="cc-verif-tit">
        {listo ? "✓ Cuenta guardada en el maestro" : "Cuenta bancaria del proveedor"}
      </div>
      <p>
        {docUrl
          ? <>Abre <a href={docUrl} target="_blank" rel="noopener noreferrer"><b>la certificación</b></a> y escribe
             lo que ves en el papel.</>
          : <>Escribe la cuenta como aparece en la certificación.</>}{" "}
        Se guarda en el maestro: <b>a esa cuenta se le manda plata</b>.
      </p>
      <div className="cc-verif-form">
        {/* Lista cerrada porque el nombre se traduce a un código para el archivo
            del banco; uno escrito a mano no resuelve y la fila sale vacía. */}
        <select value={banco} onChange={(e) => setBanco(e.target.value)} disabled={pend} aria-label="Banco">
          <option value="">Banco…</option>
          {BANCOS.map((b) => <option key={b.codigo} value={b.nombre}>{b.nombre}</option>)}
        </select>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} disabled={pend} aria-label="Tipo de cuenta">
          <option value="">Tipo…</option>
          <option value="ahorros">Ahorros</option>
          <option value="corriente">Corriente</option>
        </select>
        <input value={num} onChange={(e) => { setNum(e.target.value); setListo(false); }}
               inputMode="numeric" placeholder="Número de cuenta" autoComplete="off" disabled={pend} />
        <button type="button" className="cc-act"
                disabled={pend || !banco || !tipo || num.replace(/\D/g, "").length < 5}
                onClick={guardar}>
          {pend ? "…" : listo ? "Guardada ✓" : "Guardar cuenta"}
        </button>
      </div>
      {err && <ErrorAccion msg={err} />}
    </div>
  );
}

/** Un botón que decide sobre la certificación. Se queda con el resultado: si el
 *  servidor dice que no, el motivo se lee acá y no en una pantalla en blanco. */
function BotonCert({ certId, accion, ghost, children }: {
  certId: number;
  accion: (prev: Resultado | null, fd: FormData) => Promise<Resultado>;
  ghost?: boolean; children: ReactNode;
}) {
  const [res, run, pend] = useActionState<Resultado | null, FormData>(accion, null);
  return (
    <>
      <form action={run} style={{ display: "inline" }}>
        <input type="hidden" name="cert_id" value={certId} />
        <button type="submit" className={"cc-act" + (ghost ? " ghost" : "")} disabled={pend}>
          {pend ? "…" : children}
        </button>
      </form>
      {res?.error && <ErrorAccion msg={res.error} />}
    </>
  );
}

/** La cuenta a la que se pagaría + por qué no se puede aprobar todavía. */
export function PanelCuenta({ cert, cuenta, nit, bloqueo, docUrl, operar = true }: {
  cert: CertEstado | null; cuenta: CuentaMaestro; nit: string;
  bloqueo: string | null; docUrl?: string;
  /** false = solo lectura (el contador): ve la cuenta, no la escribe. */
  operar?: boolean;
}) {
  return (
    <div className="cc-cuenta">
      <div className="cc-cuenta-linea">
        <i>Se pagaría a</i>
        {cuenta?.num_cuenta ? (
          <span>
            <b>{cuenta.banco ?? "—"}</b> {cuenta.tipo_cuenta ?? ""} {cola(cuenta.num_cuenta)}
            <span className="cc-badge ok">✓ en el maestro</span>
          </span>
        ) : <span className="muted">sin cuenta registrada</span>}
      </div>

      {operar
        ? <EscribirCuenta cert={cert} nit={nit} cuenta={cuenta} docUrl={docUrl} />
        : <div className="cc-verif esperando">Esperando que compras escriba la cuenta del proveedor.</div>}

      {/* El motivo se pinta solo si NO es la cuenta. Cuando lo que falta es la
          cuenta, el formulario de aquí arriba ya lo está pidiendo — repetirlo en
          rojo es lo que hacía ver el trámite trancado cuando en realidad está
          esperando diez segundos de alguien. El botón de aprobar sigue apagado
          igual: eso no cambia. */}
      {bloqueo && bloqueo !== FALTA_CUENTA && (
        <div className="cc-bloqueo">🔒 No se puede aprobar: {bloqueo}</div>
      )}
    </div>
  );
}
