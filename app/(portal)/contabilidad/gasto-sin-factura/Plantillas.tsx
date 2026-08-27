"use client";

// LOS GASTOS QUE YA ESTÁN PROGRAMADOS.
//
// Viven en la MISMA página donde se cargan, y no escondidos en un maestro
// aparte, porque quien carga el recibo es quien sabe que cambió la referencia o
// que la tienda cerró. Un maestro que hay que ir a buscar es un maestro que
// envejece.

import { useActionState, useState, useTransition } from "react";
import { darDeBajaPlantilla, generarAhora } from "./actions";
import { etiquetaForma, etiquetaTipo } from "@/lib/gastos-periodicos";
import type { Resultado } from "@/lib/resultado";

export type PlantillaUI = {
  id: number; razon_social: string; num_doc: string;
  tipo: string; tipo_detalle: string | null;
  concepto: string | null; destino: string | null;
  forma_pago: string; referencia_pago: string | null; sitio_pago: string | null;
  dia_pago: number; vigente_hasta: string | null;
  meses: number; ultimo_periodo: string | null; ultimo_valor: number | null;
};

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

export function Plantillas({ filas }: { filas: PlantillaUI[] }) {
  const [gen, genPending] = useGenerar();

  return (
    <section className="card" style={{ marginTop: 22 }}>
      <div className="gasto-pie" style={{ marginTop: 0, justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15 }}>🔁 Gastos programados</h2>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 11.5 }}>
            Cada mes aparecen solos en Conciliación, esperando únicamente su monto.
          </p>
        </div>
        <button type="button" className="btn ghost" onClick={gen.correr} disabled={genPending}>
          {genPending ? "Generando…" : "Generar los que falten"}
        </button>
      </div>
      {gen.msg && <p className={gen.ok ? "gasto-ok" : "gasto-err"} style={{ marginTop: 8 }}>{gen.msg}</p>}

      {!filas.length ? (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
          Todavía no hay ninguno. Se crean marcando <b>“este gasto se repite”</b> al cargar un gasto
          arriba: la plantilla nace de un gasto real, con su proveedor y su soporte.
        </p>
      ) : (
        <table className="plantillas" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Proveedor</th><th>Qué es</th><th>Cómo se paga</th><th>Referencia</th>
              <th>Día</th><th>Historia</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((p) => <Fila key={p.id} p={p} />)}
          </tbody>
        </table>
      )}
    </section>
  );
}

function useGenerar() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(true);
  const correr = () => start(async () => {
    const r = await generarAhora();
    setOk(r.ok);
    setMsg(r.ok ? "✓ Listo: lo que faltaba ya está en Conciliación." : `⚠ ${r.error}`);
  });
  return [{ correr, msg, ok }, pending] as const;
}

function Fila({ p }: { p: PlantillaUI }) {
  const [baja, accion, pending] = useActionState<Resultado | null, FormData>(darDeBajaPlantilla, null);
  const [confirmando, setConfirmando] = useState(false);
  const [copiada, setCopiada] = useState(false);

  return (
    <tr>
      <td data-l="Proveedor">
        <div className="prov">{p.razon_social}</div>
        <div className="mini">NIT {p.num_doc}</div>
      </td>
      <td data-l="Qué es">
        {etiquetaTipo(p.tipo)}
        {p.tipo_detalle ? <div className="mini">{p.tipo_detalle}</div> : null}
        <div className="mini">
          {p.concepto ?? <b style={{ color: "var(--coral)" }}>sin concepto</b>}
          {" · "}
          {p.destino ?? <b style={{ color: "var(--coral)" }}>sin destino</b>}
        </div>
      </td>
      <td data-l="Cómo se paga">
        {etiquetaForma(p.forma_pago)}
        {p.sitio_pago ? <div className="mini">{p.sitio_pago}</div> : null}
      </td>
      <td data-l="Referencia">
        {/* SE COPIA, NO SE TECLEA. Una referencia mal transcrita le abona la
            plata a otro cliente del mismo proveedor y no da ningún error. */}
        {p.referencia_pago ? (
          <button type="button" className={"ref-copiar" + (copiada ? " copiada" : "")}
                  title="Copiar la referencia"
                  onClick={() => {
                    navigator.clipboard?.writeText(p.referencia_pago ?? "");
                    setCopiada(true); setTimeout(() => setCopiada(false), 1500);
                  }}>
            {copiada ? "✓ copiada" : p.referencia_pago}
          </button>
        ) : p.forma_pago === "transferencia" ? (
          <span className="mini">sale del maestro</span>
        ) : <span className="sin-ref">falta</span>}
      </td>
      <td data-l="Día de pago">
        {p.dia_pago}
        {p.vigente_hasta ? <div className="mini">hasta {p.vigente_hasta}</div> : null}
      </td>
      <td data-l="Historia">
        <div className="mini">{p.meses} {p.meses === 1 ? "mes" : "meses"}</div>
        {p.ultimo_valor != null && (
          <div className="mini">último {cop.format(p.ultimo_valor)}</div>
        )}
      </td>
      <td>
        {/* Sin etiqueta: el botón se explica solo. */}
        {!confirmando ? (
          <button type="button" className="btn ghost" onClick={() => setConfirmando(true)}>
            Dejar de generar
          </button>
        ) : (
          <form action={accion} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input type="hidden" name="id" value={p.id} />
            <input name="motivo" required placeholder="¿Por qué? (cerró la tienda…)"
                   style={{ fontSize: 16, padding: "6px 8px", borderRadius: 8,
                            border: "1px solid var(--border-lav)", minWidth: 0, flex: 1 }} />
            <button className="btn" disabled={pending}>{pending ? "…" : "Confirmar"}</button>
            <button type="button" className="btn ghost" onClick={() => setConfirmando(false)}>Cancelar</button>
          </form>
        )}
        {baja && !baja.ok && <div className="nodian-err">{baja.error}</div>}
      </td>
    </tr>
  );
}
