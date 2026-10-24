// TABLERO DE CONCILIACIÓN — cuatro números arriba de la tabla, para saber qué
// tan atrasado está el trabajo antes de ponerse a buscar fila por fila.
// Patrón tomado de la referencia de Cifrato (03_contabilidad/conciliacion_pagos/
// 10_referencia_ux_cifrato.md): "atraso crítico" con umbral explícito.
// Componente de servidor: solo cuenta lo que ya trajo el cargador.
import type { FacturaRow } from "./FacturaCard";
import { ATRASO_CRITICO_DIAS, VENTANA_DIAS, copN, cuentasDe, diasEnPortal, enVentana, num } from "./_cuentas";
import { ruta } from "@/lib/ruta";

export function ResumenConciliacion({ filas, puedeClasificar }: { filas: FacturaRow[]; puedeClasificar: boolean }) {
  const ahora = Date.now();
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  // Por clasificar y sin XML: solo la ventana de trabajo (lo viejo es herencia
  // del Sheet). Para pagar: todo, porque una vencida es plata real aunque sea vieja.
  const pend = filas.filter((f) => f.estado === "capturada" && enVentana(f, ahora));
  const atrasadas = pend.filter((f) => diasEnPortal(f, ahora) > ATRASO_CRITICO_DIAS);
  // Sin XML hace 7 días o más: ya no llega solo (FacturaCard explica el 93 %).
  const sinXml = filas.filter((f) => f.origen === "dian" && enVentana(f, ahora)
    && Math.floor((ahora - new Date(f.fecha_emision).getTime()) / 86_400_000) >= 7);
  const paraPago = filas.filter((f) => {
    const venc = f.fecha_vencimiento ? new Date(f.fecha_vencimiento) : null;
    return !!venc && venc <= hoy && (f.estado === "retenciones_ok" || f.estado === "aprobada_pago");
  });
  const suma = (xs: FacturaRow[], valor: (f: FacturaRow) => number) => xs.reduce((a, f) => a + valor(f), 0);

  const tarjetas = [
    { k: "pend", titulo: "Por clasificar", n: pend.length, plata: suma(pend, (f) => num(f.total)),
      nota: `sin concepto ni destino · últimos ${VENTANA_DIAS} días`, tono: pend.length ? "warn" : "ok" },
    { k: "atraso", titulo: "Con atraso crítico", n: atrasadas.length, plata: suma(atrasadas, (f) => num(f.total)),
      nota: `más de ${ATRASO_CRITICO_DIAS} días sin clasificar · últimos ${VENTANA_DIAS} días`, tono: atrasadas.length ? "bad" : "ok" },
    { k: "xml", titulo: "Sin XML (7+ días)", n: sinXml.length, plata: suma(sinXml, (f) => num(f.total)),
      nota: "pedírselo al proveedor: sin él no hay soporte del IVA", tono: sinXml.length ? "warn" : "ok" },
    { k: "pago", titulo: "Para pagar ya", n: paraPago.length, plata: suma(paraPago, (f) => cuentasDe(f).valorAPagar),
      nota: "vencidas con retención lista", tono: paraPago.length ? "warn" : "ok" },
  ];

  return (
    <section className="resumen-conc" aria-label="Estado de la conciliación">
      <div className="resumen-tarjetas">
        {tarjetas.map((t) => (
          <div key={t.k} className={"resumen-tarjeta " + t.tono}>
            <div className="rt-titulo">{t.titulo}</div>
            <div className="rt-n">{t.n.toLocaleString("es-CO")}</div>
            <div className="rt-plata">{copN(t.plata)}</div>
            <div className="rt-nota">{t.nota}</div>
          </div>
        ))}
      </div>
      {puedeClasificar && pend.length > 0 && (
        <a className="resumen-cola" href={ruta("/contabilidad/conciliacion/cola")}>
          ▶ Revisar en fila <span>({pend.length} por clasificar de los últimos {VENTANA_DIAS} días, las más atrasadas primero)</span>
        </a>
      )}
    </section>
  );
}
