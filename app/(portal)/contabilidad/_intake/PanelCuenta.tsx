"use client";

// Lo que la bandeja tiene que mostrar ANTES de dejar aprobar: qué documentos
// llegaron, qué dice la certificación del banco y a qué cuenta se pagaría.
// Compartido por las dos bandejas (cuentas de cobro y cotizaciones) para que
// digan exactamente lo mismo.

import { CLASES_DOC, etiquetaClase, type DocGuardado } from "@/lib/areas";
import { cola, type CertEstado, type CuentaMaestro } from "@/lib/certificaciones";
import { confirmarCambioCuenta, rechazarCambioCuenta } from "@/lib/certificacion-actions";

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
      {cert && cert.estado !== "valida" && (
        <div className={"cc-cert " + (cert.estado === "pendiente" ? "esperando" : "malo")}>
          {cert.estado === "pendiente"
            ? "⏳ Certificación bancaria recibida, sin leer todavía (el lector corre cada 15 minutos)."
            : <>❌ Certificación rechazada: {cert.motivo ?? cert.estado}</>}
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
