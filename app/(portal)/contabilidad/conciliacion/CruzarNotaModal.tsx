"use client";

// CRUZAR UNA NOTA CRÉDITO CON SU FACTURA, A MANO (ver lib/cruzar-nota.ts).
//
// Caso Siigo (23-sep-2026): la nota y la factura entraron por el barrido de la
// DIAN sin XML, que es el único sitio donde una nota dice a qué factura
// corrige. La nota quedaba con «a pagar $0» y la factura completa en Pagos.
//
//   · El servidor decide si ESTA nota se puede cruzar y, si no, dice por qué
//     (ya la cruzó alguien, o el XML ya lo dijo). La pantalla no adivina.
//   · Se escoge entre las facturas del MISMO NIT, con su saldo de hoy. Si la
//     escogida ya está pagada, o la nota es más grande que el saldo, se avisa
//     antes de guardar: no se prohíbe, porque a veces es exactamente lo que
//     pasó (el proveedor descuenta en la siguiente factura).
//   · «No está en el portal» es para la nota que anula una factura que nunca
//     entró: deja de estar pendiente sin descontar de nada. Pide el porqué.

import { useEffect, useMemo, useState, useTransition } from "react";
import { candidatasDeNota, cruzarNotaCredito, quitarCruceNota } from "./actions";
import type { Cruzable, ResultadoCruce } from "@/lib/cruzar-nota";
import type { FilaPatch } from "./FacturaCard";
import { ModalPortal } from "../_ui/ModalPortal";

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const fecha = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");
const quien = (s: string | null | undefined) => (s ? s.split("@")[0] : "alguien");

const ESTADO: Record<string, string> = {
  capturada: "por clasificar", clasificada: "clasificada", retenciones_ok: "lista para pagar",
  aprobada_pago: "aprobada", pagada: "pagada", causada: "causada",
};

export function CruzarNotaModal({ cufe, numero, proveedor, onSaved, onClose }: {
  cufe: string; numero: string; proveedor: string;
  onSaved: (cufe: string, patch: FilaPatch) => void;
  onClose: () => void;
}) {
  const [info, setInfo] = useState<Cruzable | null>(null);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<string>("");
  const [fuera, setFuera] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    let vivo = true;
    candidatasDeNota(cufe)
      .then((r) => { if (vivo) { setInfo(r); setFuera(r.soloFuera); setCargando(false); } })
      .catch((e) => { if (vivo) { setErr(e instanceof Error ? e.message : String(e)); setCargando(false); } });
    return () => { vivo = false; };
  }, [cufe]);

  const lista = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const c = info?.candidatas ?? [];
    return qq ? c.filter((x) => x.numero.toLowerCase().includes(qq) || x.fecha.includes(qq)) : c;
  }, [info, q]);
  const escogida = info?.candidatas.find((x) => x.cufe === sel) ?? null;

  function aplicar(r: ResultadoCruce) {
    onSaved(cufe, r.nota as FilaPatch);
    if (r.factura) onSaved(r.factura.cufe, { nc_aplicada: r.factura.nc_aplicada, nc_detalle: r.factura.nc_detalle } as FilaPatch);
    onClose();
  }

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("cufe", cufe);
    fd.set("cufe_factura", fuera ? "" : sel);
    fd.set("fuera_portal", fuera ? "1" : "");
    setErr(null);
    start(async () => {
      const r = await cruzarNotaCredito(fd);
      if (!r.ok || !r.patch) { setErr(r.error ?? "No se pudo cruzar la nota."); return; }
      aplicar(r.patch);
    });
  }

  function quitar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("cufe", cufe);
    setErr(null);
    start(async () => {
      const r = await quitarCruceNota(fd);
      if (!r.ok || !r.patch) { setErr(r.error ?? "No se pudo quitar el cruce."); return; }
      aplicar(r.patch);
    });
  }

  const n = info?.nota ?? null;
  const yaManual = n?.ref_fuente === "manual" || n?.ref_fuente === "fuera_portal";

  return (
    <ModalPortal>
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal rev-pago" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>¿De qué factura descuenta esta nota?</h3>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <p className="modal-sub">
          Nota crédito <b>{numero}</b> de <b>{proveedor}</b>. Una nota descuenta de la factura que
          corrige; si no se sabe cuál, no descuenta de nada y esa factura se paga completa.
        </p>

        {cargando && <p className="muted mini">Buscando las facturas de este proveedor…</p>}

        {n && (
          <div className="nc-nota-dato">
            <div>Nota del <b>{fecha(n.fecha)}</b> por <b>{cop.format(n.valor)}</b>
              {n.origen === "dian" ? <> · entró por el barrido de la DIAN, <b>sin XML</b></> : n.ref_numero ? null : <> · su XML <b>no trae</b> a qué factura corrige</>}
            </div>
            {n.ref_numero && n.ref_fuente !== "manual" && (
              <div className="muted mini">
                El documento dice que corrige <b>{n.ref_numero}</b>{n.ref_motivo ? ` (${n.ref_motivo})` : ""}
                {n.xml_en_portal ? " y esa factura está en el portal." : ", y esa factura no está en el portal."}
              </div>
            )}
          </div>
        )}

        {info && !info.puede && (
          <>
            <p className="rev-pago-no">⚠ {info.motivoNo}</p>
            {yaManual ? (
              <form onSubmit={quitar}>
                <label className="campo rev-pago-campo">
                  <span>Quitar el cruce: ¿por qué?</span>
                  <textarea name="motivo" required minLength={10}
                    placeholder="Era la factura equivocada: la nota corrige la 952034898, no la 952034897." />
                  <i>Queda en la bitácora con tu nombre. Si la factura ya se pagó con este descuento, no se puede: es ajuste con el contador.</i>
                </label>
                {err && <p className="rev-pago-no">⚠ {err}</p>}
                <div className="modal-pie">
                  <button type="button" className="pg-mini" onClick={onClose}>Cerrar</button>
                  <button type="submit" className="btn" disabled={pending}>{pending ? "Quitando…" : "Quitar el cruce"}</button>
                </div>
              </form>
            ) : (
              <div className="modal-pie"><button type="button" className="pg-mini" onClick={onClose}>Cerrar</button></div>
            )}
          </>
        )}

        {info?.puede && (
          <form onSubmit={enviar}>
            {!info.soloFuera && (
              <>
                <input className="nc-buscar" value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar por número o fecha…" disabled={fuera} />
                <div className="nc-lista" aria-disabled={fuera}>
                  {lista.length === 0 && <div className="nc-vacio">Este proveedor no tiene facturas en el portal{q ? " con ese número" : ""}.</div>}
                  {lista.map((x) => (
                    <label key={x.cufe} className={(sel === x.cufe ? "sel " : "") + (x.ya_pagada ? "pagada" : "")}>
                      <input type="radio" name="factura" value={x.cufe} checked={sel === x.cufe} disabled={fuera}
                        onChange={() => setSel(x.cufe)} />
                      <span>
                        <span className="num">{x.numero}</span> · {fecha(x.fecha)}
                        <span className="mini">
                          {ESTADO[x.estado] ?? x.estado}{x.ya_pagada ? " · ya pagada" : ""}
                          {x.nc_aplicada > 0 ? ` · ya le descuentan ${cop.format(x.nc_aplicada)}` : ""}
                        </span>
                      </span>
                      <span className="saldo">{cop.format(x.total)}<i>saldo {cop.format(x.saldo)}</i></span>
                    </label>
                  ))}
                </div>
                {escogida && !fuera && escogida.ya_pagada && (
                  <p className="nc-aviso mal">La factura {escogida.numero} ya está pagada: cruzar la nota acá no rebaja nada. Si el proveedor la va a descontar de otra factura, escoge esa.</p>
                )}
                {escogida && !fuera && !escogida.ya_pagada && n && n.valor > escogida.saldo && (
                  <p className="nc-aviso">La nota ({cop.format(n.valor)}) es mayor que el saldo de {escogida.numero} ({cop.format(escogida.saldo)}): esa factura queda en cero y sobran <b>{cop.format(n.valor - escogida.saldo)}</b> a favor, que se cruzan con otra factura cuando llegue.</p>
                )}
                {escogida && !fuera && !escogida.ya_pagada && n && n.valor <= escogida.saldo && (
                  <p className="nc-aviso">{escogida.numero} quedaría en <b>{cop.format(escogida.saldo - n.valor)}</b> por pagar.</p>
                )}
              </>
            )}

            <label className="rev-pago-check">
              <input type="checkbox" checked={fuera} disabled={info.soloFuera} onChange={(e) => { setFuera(e.target.checked); if (e.target.checked) setSel(""); }} />
              <span>
                <b>La factura que corrige no está en el portal.</b> {info.soloFuera
                  ? `El documento dice ${n?.ref_numero ?? "—"} y esa nunca entró: la nota deja de estar pendiente y no descuenta de nada.`
                  : "Anuló una factura que nunca entró (y el proveedor re-facturó). La nota deja de estar pendiente y no descuenta de nada."}
              </span>
            </label>

            <label className="campo rev-pago-campo">
              <span>{fuera ? "¿Por qué no está en el portal?" : "Nota (opcional)"}</span>
              <textarea name="nota" required={fuera} minLength={fuera ? 10 : 0}
                placeholder={fuera ? "Anula la FE66, que el proveedor reemplazó por la FE67 antes de mandarla." : "Ej.: el proveedor confirmó por correo que la nota es de esta factura."} />
              <i>Queda en la bitácora con tu nombre, pegado a la nota.</i>
            </label>

            {err && <p className="rev-pago-no">⚠ {err}</p>}
            <div className="modal-pie">
              <button type="button" className="pg-mini" onClick={onClose}>Cancelar</button>
              <button type="submit" className="btn" disabled={pending || (!fuera && !sel)}>
                {pending ? "Guardando…" : fuera ? "Marcar fuera del portal" : escogida ? `Descontar de ${escogida.numero}` : "Escoge una factura"}
              </button>
            </div>
          </form>
        )}

        {!cargando && !info && err && (
          <>
            <p className="rev-pago-no">⚠ {err}</p>
            <div className="modal-pie"><button type="button" className="pg-mini" onClick={onClose}>Cerrar</button></div>
          </>
        )}
      </div>
    </div>
    </ModalPortal>
  );
}
