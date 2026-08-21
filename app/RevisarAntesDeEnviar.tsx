"use client";

// PASO DE CONFIRMACIÓN + AVISO DE "PROCESANDO".
//
// Dos problemas distintos del mismo momento —el envío— y los dos se ven solo en
// celular:
//
//  1. El proveedor llena diez campos con el pulgar, en la calle, y le da enviar
//     sin releer. Si escribió mal el NIT o adjuntó la foto equivocada, nadie lo
//     nota hasta que contabilidad abre la bandeja días después. Un resumen de
//     una pantalla antes de enviar cuesta 5 segundos y ahorra ese viaje.
//
//  2. Subir 4 archivos desde datos móviles puede tardar medio minuto. Sin aviso,
//     la página se ve congelada: el proveedor le da otra vez, o cierra. Por eso
//     el estado "procesando" es explícito y dice que NO cierre.
//
// Compartido por las dos landings para que digan lo mismo.

import { CLASES_DOC } from "@/lib/areas";
import { enLetras } from "@/lib/letras";

export type FilaResumen = { etiqueta: string; valor: string; letras?: string };
export type CampoResumen = { name: string; etiqueta: string; formato?: "money" | "pct" };

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

/** El proveedor tiene que poder RECONOCER lo que escribió. "1500000" obliga a
 *  contar ceros con el dedo; "$1.500.000" se lee de un golpe, que es justo lo
 *  que se le está pidiendo hacer en este paso. */
function formatear(valor: string, formato?: "money" | "pct"): string {
  if (formato === "money") {
    const n = Number(valor.replace(/[^\d]/g, ""));
    return Number.isFinite(n) && n > 0 ? cop.format(n) : valor;
  }
  if (formato === "pct") {
    const n = Number(valor.replace(",", ".").replace(/[^\d.]/g, ""));
    return Number.isFinite(n) && n > 0 ? `${n}%` : valor;
  }
  return valor;
}

/** Saca del formulario lo que el proveedor va a confirmar. Lee el FormData real
 *  —no un estado paralelo— para que lo que se muestra sea exactamente lo que se
 *  va a enviar. */
/** `clases` = los documentos que ESTE envío pide de verdad.
 *
 *  Sin este parámetro, la pantalla de revisión listaba como "falta" todo lo que
 *  no estuviera adjunto según la lista GLOBAL — incluidos los papeles que el
 *  formulario nunca mostró. Al proveedor recurrente, que solo sube el soporte,
 *  le decía que le faltaban la certificación, el RUT y la cédula justo antes de
 *  enviar: un aviso alarmante y falso, en el peor momento posible (Regla 18). */
export function resumenDe(fd: FormData, campos: CampoResumen[],
                          clases: readonly { name: string; label: string }[] = CLASES_DOC): {
  filas: FilaResumen[]; docs: { label: string; nombre: string | null }[];
} {
  const filas = campos
    .map(({ name, etiqueta, formato }) => {
      const bruto = String(fd.get(name) ?? "").trim();
      if (bruto === "") return { etiqueta, valor: "" };
      // EL VALOR, ADEMÁS, EN LETRAS. "14.934.024" y "149.340" se parecen cuando
      // uno va rápido con el pulgar; "CATORCE MILLONES..." y "CIENTO CUARENTA Y
      // NUEVE MIL..." no se parecen en nada. Es el truco que las facturas usan
      // desde siempre — el documento que originó esto lo trae impreso.
      const n = formato === "money" ? Number(bruto.replace(/[^\d]/g, "")) : NaN;
      return {
        etiqueta, valor: formatear(bruto, formato),
        ...(Number.isFinite(n) && n > 0 ? { letras: enLetras(n) } : {}),
      };
    })
    .filter((f) => f.valor !== "");
  const docs = clases.map((c) => {
    const f = fd.get(c.name);
    return { label: c.label, nombre: f instanceof File && f.size > 0 ? f.name : null };
  });
  return { filas, docs };
}

export function RevisarAntesDeEnviar({ filas, docs, pending, onCorregir, textoEnviar }: {
  filas: FilaResumen[];
  docs: { label: string; nombre: string | null }[];
  pending: boolean;
  onCorregir: () => void;
  textoEnviar: string;
}) {
  if (pending) {
    return (
      <div className="pub-procesando" role="status" aria-live="polite">
        <div className="pub-spinner" aria-hidden="true" />
        <h3>Subiendo tus documentos…</h3>
        <p>
          Puede tardar hasta un minuto si estás con datos móviles.
          <b> No cierres esta página</b> ni le des enviar otra vez.
        </p>
      </div>
    );
  }

  const faltan = docs.filter((d) => !d.nombre);

  return (
    <div className="pub-revisar">
      <div className="pub-sec">Revisa antes de enviar</div>
      <p className="pub-hint">
        <b>Mira bien el valor.</b> Está escrito en letras justo debajo para que puedas
        comprobarlo contra tu documento — si dice otra cosa, corrígelo antes de enviar.
      </p>

      <dl className="pub-resumen">
        {filas.map((f) => (
          <div key={f.etiqueta} className={f.letras ? "pub-resumen-plata" : undefined}>
            <dt>{f.etiqueta}</dt>
            <dd>
              {f.valor}
              {f.letras && <em>{f.letras}</em>}
            </dd>
          </div>
        ))}
      </dl>

      <div className="pub-resumen-docs">
        {docs.map((d) => (
          <span key={d.label} className={"pub-doc-chip" + (d.nombre ? " ok" : " falta")}>
            {d.nombre ? "✓" : "✗"} {d.label}
            {d.nombre && <i>{d.nombre}</i>}
          </span>
        ))}
      </div>

      {/* Los 4 documentos son obligatorios para poder aprobar. Se avisa ACÁ,
          antes de enviar, y no después por correo: mandarlo incompleto le cuesta
          al proveedor una semana de ida y vuelta. */}
      {faltan.length > 0 && (
        <div className="pub-aviso">
          ⚠️ Te {faltan.length === 1 ? "falta" : "faltan"} {faltan.map((d) => d.label).join(", ")}.
          Puedes enviarlo así, pero <b>no podremos programar el pago</b> hasta que lo recibamos.
        </div>
      )}

      <div className="pub-acciones">
        <button type="button" className="pub-btn ghost" onClick={onCorregir}>← Corregir</button>
        <button type="submit" className="pub-btn">{textoEnviar}</button>
      </div>
    </div>
  );
}
