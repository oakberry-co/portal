"use client";

import { useState, type ReactNode } from "react";
import { revisarCuentaCobro } from "./actions";
import { etiquetaClase } from "@/lib/areas";

/** Nombre del documento por su clase; los viejos (sin clase) caen al genérico. */
const etiquetaDoc = (clase?: string) => (clase && clase !== "otro" ? etiquetaClase(clase) : "Documento");

export type CuentaCobro = {
  id: number; razon_social: string; tipo_doc: string | null; num_doc: string;
  contacto: string | null; correo: string | null; telefono: string | null; area: string | null;
  concepto: string | null; descripcion: string | null; valor: number | null;
  banco: string | null; tipo_cuenta: string | null; num_cuenta: string | null;
  documentos: { nombre: string; path: string; tipo: string; clase?: string; estado?: string }[];
  estado: string; nota_revision: string | null; revisado_por: string | null; creado_en: string;
};

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const $ = (n: number | null) => (n == null ? "—" : cop.format(Math.round(n)));
const fecha = (s: string) => new Date(s).toLocaleDateString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const TABS = [
  { key: "recibida", label: "Por revisar" },
  { key: "aprobada", label: "Aprobadas" },
  { key: "pagada", label: "Pagadas" },
  { key: "rechazada", label: "Rechazadas" },
] as const;

function Accion({ id, accion, children, ghost }: { id: number; accion: string; children: ReactNode; ghost?: boolean }) {
  return (
    <form action={revisarCuentaCobro} style={{ display: "inline" }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="accion" value={accion} />
      <button type="submit" className={"cc-act" + (ghost ? " ghost" : "")}>{children}</button>
    </form>
  );
}

export function CuentasCobroView({ items }: { items: CuentaCobro[] }) {
  const [tab, setTab] = useState<string>("recibida");
  const cuenta = (k: string) => items.filter((i) => i.estado === k).length;
  const lista = items.filter((i) => i.estado === tab);

  return (
    <div>
      <div className="pg-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            {t.label}<i>{cuenta(t.key)}</i>
          </button>
        ))}
      </div>

      {!lista.length ? (
        <div className="pg-empty">No hay cuentas de cobro en este estado.</div>
      ) : (
        <div className="cc-list">
          {lista.map((c) => (
            <div key={c.id} className="cc-card">
              <div className="cc-head">
                <div>
                  <div className="cc-nom">{c.razon_social}</div>
                  <div className="muted mini">{c.tipo_doc} {c.num_doc}{c.area ? ` · ${c.area}` : ""} · {fecha(c.creado_en)}</div>
                </div>
                <div className="cc-valor">{$(c.valor)}</div>
              </div>

              <div className="cc-grid">
                {c.concepto && <div><i>Concepto</i>{c.concepto}</div>}
                {c.descripcion && <div className="cc-wide"><i>Detalle</i>{c.descripcion}</div>}
                <div><i>Contacto</i>{c.contacto ?? "—"}{c.telefono ? ` · ${c.telefono}` : ""}</div>
                {c.correo && <div><i>Correo</i>{c.correo}</div>}
                {(c.banco || c.num_cuenta) && <div className="cc-wide"><i>Pago a</i>{c.banco ?? ""} {c.tipo_cuenta ?? ""} {c.num_cuenta ?? ""}</div>}
              </div>

              {c.documentos?.length > 0 && (
                <div className="cc-docs">
                  {c.documentos.map((d, i) =>
                    d.estado === "pendiente" ? (
                      <span key={i} className="cc-doc falta" title={"No llegó a Drive: " + d.nombre}>
                        ⚠️ {etiquetaDoc(d.clase)} — no subió
                      </span>
                    ) : (
                      <a key={i} href={d.path} target="_blank" rel="noopener noreferrer" className="cc-doc">
                        📎 {etiquetaDoc(d.clase)}
                      </a>
                    )
                  )}
                </div>
              )}

              {c.nota_revision && <div className="cc-nota">📝 {c.nota_revision}</div>}
              {c.revisado_por && <div className="muted mini">Revisó: {c.revisado_por.split("@")[0]}</div>}

              <div className="cc-acts">
                {c.estado === "recibida" && <><Accion id={c.id} accion="aprobar">✓ Aprobar</Accion><Accion id={c.id} accion="rechazar" ghost>Rechazar</Accion></>}
                {c.estado === "aprobada" && <><Accion id={c.id} accion="pagar">💸 Marcar pagada</Accion><Accion id={c.id} accion="reabrir" ghost>Reabrir</Accion></>}
                {(c.estado === "pagada" || c.estado === "rechazada") && <Accion id={c.id} accion="reabrir" ghost>Reabrir</Accion>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
