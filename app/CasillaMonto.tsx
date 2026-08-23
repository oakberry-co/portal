"use client";

// LA CASILLA DEL DINERO.
//
// Es la casilla que produjo COT-0026: la cotización de ENDIPACK decía
// `TOTAL A PAGAR $ 149.340,24` y quedó registrada como `$ 14.934.024` — cien
// veces más, con 100% de adelanto. No fue mala fe ni un dedo torcido: el
// proveedor COPIÓ el total de su documento y el sistema le quitó los puntos y la
// coma, dejando los centavos convertidos en pesos.
//
// Dos defensas, y ninguna estorba al que escribe normal:
//
//  1. AL PEGAR se interpreta como plata colombiana (lib/pesos.ts): '149.340,24'
//     entra como 149.340, no como 14.934.024. Es el caso que rompió, porque el
//     total se copia del documento, no se teclea.
//  2. AL TECLEAR solo entran dígitos. Así nadie puede FABRICAR un decimal
//     escribiendo, y '1500' sigue siendo mil quinientos.
//
// Y debajo, el monto EN LETRAS mientras escribe. '14.934.024' y '149.340' se
// parecen cuando uno va rápido con el pulgar; 'CATORCE MILLONES…' y 'CIENTO
// CUARENTA Y NUEVE MIL…' no se parecen en nada. Es el mismo truco que las
// facturas traen impreso desde siempre.

import { useState } from "react";
import { pesos } from "@/lib/pesos";
import { enLetras } from "@/lib/letras";

const milesCO = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

export function CasillaMonto({ etiqueta, ancho }: { etiqueta: string; ancho?: boolean }) {
  const [n, setN] = useState<number | null>(null);

  const poner = (v: number | null) =>
    setN(v != null && Number.isFinite(v) && v > 0 ? Math.round(v) : null);

  return (
    <label className={ancho ? "pub-full pub-monto" : "pub-monto"}>
      {etiqueta} *
      <input
        name="valor" required inputMode="numeric" placeholder="$ 0"
        value={n == null ? "" : milesCO.format(n)}
        onChange={(e) => poner(Number(e.target.value.replace(/\D/g, "")) || null)}
        onPaste={(e) => {
          // El caso real: el total se COPIA del documento, con sus puntos y su
          // coma. Se interpreta a la colombiana en vez de borrar separadores.
          e.preventDefault();
          poner(pesos(e.clipboardData.getData("text")));
        }}
      />
      {n != null && <em className="pub-monto-letras">{enLetras(n)}</em>}
    </label>
  );
}
