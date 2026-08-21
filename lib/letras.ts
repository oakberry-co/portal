// EL MONTO, EN LETRAS.
//
// Nace de COT-0026 (21-ago-2026): el proveedor tecleó `$ 14.934.024` cuando su
// cotización decía `$ 149.340,24`. Escribió los centavos como pesos. Vio el
// número formateado en la pantalla de revisión y no le sonó raro — porque
// "14.934.024" y "149.340" se parecen bastante cuando uno va rápido con el
// pulgar.
//
// "CATORCE MILLONES..." y "CIENTO CUARENTA Y NUEVE MIL..." no se parecen en
// nada. Es exactamente el truco que usan las facturas y los cheques desde hace
// un siglo, y el documento de ENDIPACK lo trae impreso: "SON: CIENTO CUARENTA Y
// NUEVE MIL TRECIENTOS CUARENTA PESOS".
//
// Módulo PURO, sin dependencias: lo usa la pantalla pública de revisión.

const UNIDADES = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE",
  "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE",
  "DIECIOCHO", "DIECINUEVE", "VEINTE"];
const DECENAS = ["", "", "VEINTI", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA",
  "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS",
  "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

function hasta999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100), r = n % 100;
  const centena = CENTENAS[c];
  let resto = "";
  if (r <= 20) resto = UNIDADES[r];
  else {
    const d = Math.floor(r / 10), u = r % 10;
    // 21-29 van pegadas ("VEINTIDÓS"); de 30 en adelante con "Y".
    resto = d === 2 ? DECENAS[2] + UNIDADES[u].toLowerCase().toUpperCase()
          : DECENAS[d] + (u ? " Y " + UNIDADES[u] : "");
  }
  return [centena, resto].filter(Boolean).join(" ");
}

/** El valor en pesos, escrito. Se usa para que el proveedor RECONOZCA lo que
 *  escribió antes de mandarlo — no para contabilidad. */
export function enLetras(pesos: number): string {
  const n = Math.round(Math.abs(pesos));
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "CERO PESOS";

  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];

  if (millones === 1) partes.push("UN MILLÓN");
  else if (millones > 1) partes.push(hasta999(millones) + " MILLONES");
  if (miles === 1) partes.push("MIL");
  else if (miles > 1) partes.push(hasta999(miles) + " MIL");
  if (resto > 0) partes.push(hasta999(resto));

  // "UN MILLÓN DE PESOS", no "UN MILLÓN PESOS": el "de" solo aparece cuando la
  // cifra termina en millones redondos, que es como se escribe en una factura.
  const de = millones > 0 && miles === 0 && resto === 0 ? " DE" : "";
  return partes.join(" ") + de + " PESOS";
}
