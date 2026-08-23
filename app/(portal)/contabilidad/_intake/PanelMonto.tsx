"use client";

// LA ALARMA DEL MONTO — Y SOLO CUANDO HAY ALGO QUE DECIR.
//
// El portal lee el documento soporte y saca todos los montos que trae. Si el
// valor registrado no está entre ellos, lo dice y muestra los que sí están, para
// que el revisor lo compruebe en vez de creérselo. En cualquier otro caso NO
// PINTA NADA: ni "coincide", ni "todavía no lo he leído", ni "no pude leerlo".
//
// Eso último es deliberado (21-ago-2026). El proceso es manual: la máquina
// contando lo que le pasó al OCR es ruido en una tarjeta donde alguien está
// trabajando, y una tarjeta que siempre tiene cajas de colores es una tarjeta
// que se lee en diagonal — justo el día que la caja dice algo importante.
//
// Tampoco bloquea: una cotización la arma cada proveedor a su manera y el lector
// se equivoca. Quien decide es el humano, con el botón de corregir al lado.
//
// El caso que lo justifica (COT-0026, 21-ago-2026): el papel decía
// `TOTAL A PAGAR $ 149.340,24` y el proveedor tecleó `$ 14.934.024` — el mismo
// número sin la coma, cien veces más, con 100% de adelanto.

import { montosLegibles, veredicto, type ValorEstado } from "@/lib/valor-documento";

const $ = (n: number | null | undefined) =>
  n == null ? "—" : "$ " + new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(n);

export function PanelMonto({ val, declarado, docUrl }: {
  val: ValorEstado | null;
  /** El monto que la solicitud tiene HOY. */
  declarado: number | null;
  /** El documento soporte, para abrirlo sin buscarlo. */
  docUrl?: string;
}) {
  const candidatos = val?.candidatos ?? [];
  // Sin lectura, o leída y cuadra, o ilegible: SILENCIO. Solo se habla cuando el
  // valor registrado no aparece en el papel, que es lo único accionable.
  if (!val || val.estado === "pendiente") return null;
  const v = veredicto(declarado, candidatos);
  if (v.estado !== "no_cuadra") return null;

  return (
    <div className="cc-monto malo">
      <div>
        ⚠️ <b>Ojo con el monto: no aparece en el documento.</b> {v.motivo}
        <div className="cc-monto-cands">
          Registrado <b>{$(declarado)}</b> · en el documento: {montosLegibles(candidatos)}
        </div>
      </div>

      {docUrl && (
        <p className="cc-monto-abrir">
          <a href={docUrl} target="_blank" rel="noopener noreferrer">Abrir el documento soporte →</a>
        </p>
      )}

    </div>
  );
}
