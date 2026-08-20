"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";

// Lo que la bandeja tiene que mostrar ANTES de dejar aprobar: qué documentos
// llegaron, qué dice la certificación del banco y a qué cuenta se pagaría.
// Compartido por las dos bandejas (cuentas de cobro y cotizaciones) para que
// digan exactamente lo mismo.

import { CLASES_DOC, etiquetaClase, type DocGuardado } from "@/lib/areas";
import { cola, mismaCuenta, unaEsLaOtraConPrefijo, type CertEstado, type CuentaMaestro } from "@/lib/certificaciones";
import { confirmarCambioCuenta, mantenerCuentaDelMaestro, rechazarCambioCuenta,
         darClaveCertificacion, verificarCuenta } from "@/lib/certificacion-actions";
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
function VerificarCuenta({ cert, docUrl }: { cert: CertEstado; docUrl?: string }) {
  const [valor, setValor] = useState("");
  const [choque, setChoque] = useState<{ leida: string; escrita: string } | null>(null);
  const [pend, start] = useTransition();

  if (cert.cuenta_verificada) {
    return (
      <div className="cc-verif ok">
        ✓ <b>Cuenta verificada contra el documento</b> — {cola(cert.cuenta_verificada)}
        {cert.verificada_por && <i> · la revisó {cert.verificada_por.split("@")[0]}</i>}
      </div>
    );
  }

  const enviar = (forzar: boolean) => start(async () => {
    try {
      const fd = new FormData();
      fd.set("cert_id", String(cert.id));
      fd.set("cuenta", forzar ? (choque?.escrita ?? valor) : valor);
      if (forzar) fd.set("forzar", "1");
      const r = await verificarCuenta(fd);
      if (r?.discrepa) setChoque({ leida: r.leida, escrita: r.escrita });
      else setChoque(null);
    } catch (e) { alert((e as Error).message); }
  });

  return (
    <div className="cc-verif">
      <div className="cc-verif-tit">🔍 Falta el paso final: verifica la cuenta</div>
      <p>
        {docUrl
          ? <>Abre <a href={docUrl} target="_blank" rel="noopener noreferrer"><b>la certificación</b></a> y escribe
             el número de cuenta que ves en el papel.</>
          : <>Abre la certificación y escribe el número de cuenta que ves en el papel.</>}{" "}
        No copiamos lo que leyó el sistema a propósito: <b>a esa cuenta se le manda plata</b>.
      </p>

      {!choque ? (
        <div className="cc-verif-form">
          <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="numeric"
                 placeholder="Número de cuenta del documento" autoComplete="off" disabled={pend} />
          <button type="button" className="cc-act" disabled={pend || valor.replace(/\D/g, "").length < 6}
                  onClick={() => enviar(false)}>Verificar</button>
        </div>
      ) : (
        <div className="cc-choque">
          <div><b>No coinciden.</b> Mira bien el documento y dinos cuál es el número que aparece:</div>
          <div className="cc-choque-ops">
            <div><i>El sistema leyó</i><b className="mono">{choque.leida || "—"}</b></div>
            <div><i>Tú escribiste</i><b className="mono">{choque.escrita}</b></div>
          </div>
          <div className="cc-cambio-acts">
            <button type="button" className="cc-act" disabled={pend} onClick={() => enviar(true)}>
              La del documento es la que escribí
            </button>
            <button type="button" className="cc-act ghost" disabled={pend}
                    onClick={() => { setChoque(null); setValor(""); }}>
              Me equivoqué, escribir de nuevo
            </button>
          </div>
        </div>
      )}
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
export function PanelCuenta({ cert, cuenta, bloqueo, docUrl, operar = true }: {
  cert: CertEstado | null; cuenta: CuentaMaestro; bloqueo: string | null; docUrl?: string;
  /** false = solo lectura (el contador): ve el estado, no decide sobre la cuenta. */
  operar?: boolean;
}) {
  // ORDEN: primero se VERIFICA (un humano lee el papel), después se decide si
  // la cuenta cambió. Al revés quedaba un callejón sin salida — confirmar el
  // cambio exige una cuenta verificada, y la verificación no se mostraba hasta
  // resolver el cambio. Es además el orden con sentido: hasta que alguien no lea
  // el documento no se sabe SI cambió, porque lo que leyó el OCR puede estar mal.
  const verificada = (cert?.cuenta_verificada ?? "").trim();
  const pedirVerificacion = cert?.estado === "valida" && !!cert.num_cuenta && !verificada;
  // La que de verdad iría al banco es la que escribió el humano.
  const cambio = cert?.estado === "valida" && !cert.aplicada && !!cert.cuenta_anterior
              && !!verificada && !mismaCuenta(cert.cuenta_anterior, verificada);
  // El mismo número con el prefijo del banco delante NO es un cambio de cuenta,
  // y presentarlo como tal ('•••8827 por •••8827') hace que el revisor deje de
  // creerle a la alarma — que es justo la alarma que no queremos que ignore.
  const soloPrefijo = cambio && unaEsLaOtraConPrefijo(cert!.cuenta_anterior, verificada);

  return (
    <div className="cc-cuenta">
      <div className="cc-cuenta-linea">
        <i>Se pagaría a</i>
        {cuenta?.num_cuenta ? (
          <span>
            <b>{cuenta.banco ?? "—"}</b> {cuenta.tipo_cuenta ?? ""} {cola(cuenta.num_cuenta)}
            {cuenta.certificada
              ? <span className="cc-badge ok" title="La cuenta la leímos de la certificación que emite el banco">✓ certificada por el banco</span>
              : <span className="cc-badge tibio" title="Cuenta cargada a mano por el equipo, no leída de una certificación">cargada a mano</span>}
          </span>
        ) : cert?.estado === "valida" && cert.num_cuenta ? (
          // Todavía no está en el maestro: entra AL APROBAR. Se muestra igual,
          // porque es la cuenta que el revisor está a punto de habilitar.
          <span>
            <b>{cert.banco ?? "—"}</b> {cola(cert.num_cuenta)}
            <span className="cc-badge tibio" title="Sale de la certificación; se registra en el maestro de pagos al aprobar">
              se registra al aprobar
            </span>
          </span>
        ) : <span className="muted">sin cuenta registrada</span>}
      </div>

      {/* Qué vio el lector. Un 'pendiente' no es un error: es que aún no corre. */}
      {cert && cert.estado !== "valida" && cert.estado !== "protegido" && (
        <div className={"cc-cert " + (cert.estado === "pendiente" ? "esperando" : "malo")}>
          {cert.estado === "pendiente"
            ? "⏳ Certificación bancaria recibida, sin leer todavía (el lector corre cada 15 minutos)."
            : <>❌ Certificación rechazada: {cert.motivo ?? cert.estado}</>}
        </div>
      )}

      {/* PROTEGIDA: el documento puede estar perfecto, solo tiene candado. Ya se
          intentó con el documento del proveedor (así lo cifran los bancos). Si
          el equipo consiguió la clave por WhatsApp o teléfono, la escribe acá:
          se usa una vez y se borra, nunca queda guardada. */}
      {cert?.estado === "protegido" && (
        <div className="cc-cert protegido">
          <div>🔒 <b>El certificado viene con clave</b> y no abrió con el documento del proveedor.
            Ya se le pidió por correo que lo mande sin candado. Si te dio la clave por otro lado,
            escríbela y el lector lo reintenta en su próxima corrida.</div>
          {operar && <form action={darClaveCertificacion} className="cc-clave">
            <input type="hidden" name="cert_id" value={cert.id} />
            <input name="clave" placeholder="Clave del documento" autoComplete="off" maxLength={80} />
            <button type="submit" className="cc-act">Reintentar con esta clave</button>
          </form>}
          <div className="cc-clave-nota">
            La clave se usa una vez y se borra; no queda guardada ni en la bitácora.
            Si es una contraseña que el proveedor usa en otras partes, mejor pídele el archivo sin candado.
          </div>
        </div>
      )}

      {/* PRIMERO el paso humano: sin leer el papel no se decide nada más. */}
      {pedirVerificacion && cert && (operar
        ? <VerificarCuenta cert={cert} docUrl={docUrl} />
        : <div className="cc-verif esperando">🔍 Esperando que compras verifique la cuenta contra el documento.</div>)}

      {/* CAMBIO DE CUENTA: el caso peligroso. La cuenta anterior sigue intacta. */}
      {cambio && (
        <div className="cc-cambio">
          {soloPrefijo ? (
            <div>
              ⚠️ <b>La misma cuenta, escrita distinto.</b> El certificado de {cert!.banco ?? "el banco"} trae{" "}
              <b>{verificada}</b> y en el maestro está <b>{cert!.cuenta_anterior}</b>: <b>terminan igual</b>,
              así que casi seguro es la misma cuenta con el prefijo del banco delante.
              Elige cuál es la que va al archivo del banco.
            </div>
          ) : (
            <div>
              ⚠️ <b>Cambió la cuenta.</b> Este NIT ya tenía <b>{cola(cert!.cuenta_anterior)}</b> y la certificación
              de este envío trae <b>{cola(verificada)}</b> ({cert!.banco ?? "banco no leído"}).
              Confírmalo con el proveedor por un canal que ya conozcas antes de aceptar.
            </div>
          )}
          {operar && <div className="cc-cambio-acts">
            <BotonCert certId={cert!.id} accion={confirmarCambioCuenta}>
              {soloPrefijo ? "✓ Usar la del certificado" : "✓ Sí, cambió: usar la nueva"}
            </BotonCert>
            {/* Cuando es el mismo número con prefijo, la salida NO es matar la
                certificación de un proveedor honesto: es quedarse con el formato
                que el banco ya acepta. Rechazar sigue disponible para el caso de
                verdad sospechoso, que es el otro. */}
            {soloPrefijo ? (
              <BotonCert certId={cert!.id} accion={mantenerCuentaDelMaestro} ghost>
                ✓ Dejar la del maestro
              </BotonCert>
            ) : (
              <BotonCert certId={cert!.id} accion={rechazarCambioCuenta} ghost>
                ✗ No la reconozco
              </BotonCert>
            )}
          </div>}
        </div>
      )}

      {bloqueo && !cambio && !pedirVerificacion && (
        <div className="cc-bloqueo">🔒 No se puede aprobar: {bloqueo}</div>
      )}
    </div>
  );
}
