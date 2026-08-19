"use client";

// Lo que la bandeja tiene que mostrar ANTES de dejar aprobar: qué documentos
// llegaron, qué dice la certificación del banco y a qué cuenta se pagaría.
// Compartido por las dos bandejas (cuentas de cobro y cotizaciones) para que
// digan exactamente lo mismo.

import { CLASES_DOC, etiquetaClase, type DocGuardado } from "@/lib/areas";
import { cola, type CertEstado, type CuentaMaestro } from "@/lib/certificaciones";
import { confirmarCambioCuenta, rechazarCambioCuenta, darClaveCertificacion } from "@/lib/certificacion-actions";

export type DocIntake = DocGuardado & { nombre?: string; path?: string; tipo?: string };

/** Los 4 documentos pedidos, cada uno presente (link) o ausente (rojo), más los
 *  sueltos. Se pinta la LISTA COMPLETA y no solo lo que llegó: un documento que
 *  falta tiene que verse, no deducirse por ausencia. */
export function DocsIntake({ docs }: { docs: DocIntake[] }) {
  const lista = docs ?? [];
  const tipados = lista.filter((d) => d.clase && d.clase !== "otro");
  const extras = lista.filter((d) => !d.clase || d.clase === "otro");
  const viejo = tipados.length === 0;   // envío anterior a los documentos tipados

  return (
    <div className="cc-docs">
      {viejo
        ? lista.map((d, i) => <ChipDoc key={i} doc={d} etiqueta={etiquetaClase(d.clase)} />)
        : CLASES_DOC.map((c) => {
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

/** La cuenta a la que se pagaría + por qué no se puede aprobar todavía. */
export function PanelCuenta({ cert, cuenta, bloqueo }: {
  cert: CertEstado | null; cuenta: CuentaMaestro; bloqueo: string | null;
}) {
  const cambio = cert?.estado === "valida" && !cert.aplicada && !!cert.cuenta_anterior;

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
          <form action={darClaveCertificacion} className="cc-clave">
            <input type="hidden" name="cert_id" value={cert.id} />
            <input name="clave" placeholder="Clave del documento" autoComplete="off" maxLength={80} />
            <button type="submit" className="cc-act">Reintentar con esta clave</button>
          </form>
          <div className="cc-clave-nota">
            La clave se usa una vez y se borra; no queda guardada ni en la bitácora.
            Si es una contraseña que el proveedor usa en otras partes, mejor pídele el archivo sin candado.
          </div>
        </div>
      )}

      {/* CAMBIO DE CUENTA: el caso peligroso. La cuenta anterior sigue intacta. */}
      {cambio && (
        <div className="cc-cambio">
          <div>
            ⚠️ <b>Cambió la cuenta.</b> Este NIT ya tenía <b>{cola(cert!.cuenta_anterior)}</b> y la certificación
            de este envío trae <b>{cola(cert!.num_cuenta)}</b> ({cert!.banco ?? "banco no leído"}).
            Confírmalo con el proveedor por un canal que ya conozcas antes de aceptar.
          </div>
          <div className="cc-cambio-acts">
            <form action={confirmarCambioCuenta} style={{ display: "inline" }}>
              <input type="hidden" name="cert_id" value={cert!.id} />
              <button type="submit" className="cc-act">✓ Sí, cambió: usar la nueva</button>
            </form>
            <form action={rechazarCambioCuenta} style={{ display: "inline" }}>
              <input type="hidden" name="cert_id" value={cert!.id} />
              <button type="submit" className="cc-act ghost">✗ No la reconozco</button>
            </form>
          </div>
        </div>
      )}

      {bloqueo && !cambio && <div className="cc-bloqueo">🔒 No se puede aprobar: {bloqueo}</div>}
    </div>
  );
}
