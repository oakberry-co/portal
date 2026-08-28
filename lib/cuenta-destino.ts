// LA IDENTIDAD DEL TITULAR DE UN DESVÍO.
//
// Cuando una factura se paga a OTRA cuenta, el archivo del banco lleva el
// documento del dueño de esa cuenta — no el NIT del proveedor de la factura. Si
// los dos no cuadran, el banco rechaza la fila (y en el peor caso la deja pasar
// hacia un tercero que no es quien dice ser).
//
// Acá viven las revisiones que NO se pueden automatizar: se le señalan a la
// persona que está desviando el pago, en el momento en que lo hace, y ella
// corrige. Nada se reescribe solo (Regla 3: el parecido sugiere, nunca afirma).
//
// Nace del caso MTS CONSULTORÍA (ago-2026): dos facturas al mismo destino
// —COMETA CAPITAL SAS— quedaron una como "NIT" y otra como "Cédula", con el NIT
// escrito CON su dígito de verificación. El archivo del banco partió al mismo
// beneficiario en dos líneas y una declaraba una empresa como persona natural.

import { soloDigitos, digitoVerificacion, nitCanonico } from "./nit";
import { pareceRazonSocial } from "./davivienda";

/** Los únicos tipos de documento que ofrece el formulario del desvío. */
export const TIPOS_DOC_DESTINO = ["CC", "NIT", "CE"] as const;

export type RevisionTitular = { doc: string; error?: string };

/** Revisa la identidad del titular del desvío y devuelve el documento tal como
 *  debe guardarse (NIT sin dígito de verificación), o el motivo por el que una
 *  persona tiene que corregirlo antes de seguir. */
export function revisarTitularDestino(
  titular: string, tipoDoc: string, docBruto: string,
): RevisionTitular {
  const tipo = (tipoDoc ?? "").trim().toUpperCase();
  if (!(TIPOS_DOC_DESTINO as readonly string[]).includes(tipo)) {
    return { doc: "", error: "Elige el tipo de documento del titular de la cuenta (cédula, NIT o cédula de extranjería)." };
  }

  // El documento del titular NO es opcional en un desvío: si va vacío, el
  // archivo del banco cae al NIT del proveedor de la factura — o sea, manda la
  // plata a la cuenta de un tercero declarando a otro como dueño.
  const digitos = soloDigitos(docBruto);
  if (!digitos) {
    return { doc: "", error: "Escribe el documento del titular de la cuenta: es el que viaja al banco, y sin él sale el NIT del proveedor, que no es el dueño de esa cuenta." };
  }

  // Una razón social no tiene cédula. El archivo de Davivienda ya lo señala al
  // descargarlo, pero ahí ya es tarde: quien lo baja no sabe qué se quiso decir.
  if (tipo !== "NIT" && pareceRazonSocial(titular ?? "", "")) {
    return { doc: digitos, error: `"${titular}" es una empresa: su documento es un NIT, no una cédula. Cambia el tipo de documento a NIT.` };
  }

  if (tipo === "NIT") {
    // Escrito con guion o punto ('901.634.840-1'), el DV es explícito: se acepta
    // y se guarda la clave de la casa, el NIT SIN dígito de verificación.
    const canon = nitCanonico(docBruto);
    if (canon && canon !== digitos) return { doc: canon };
    // Escrito de corrido no se trunca a ciegas: se le pregunta. Una cédula de 10
    // dígitos tiene ~9% de dar un DV válido por casualidad, y truncarla la rompe.
    if (digitos.length === 10 && digitoVerificacion(digitos.slice(0, -1)) === digitos.slice(-1)) {
      return { doc: digitos, error: `${digitos} parece el NIT ${digitos.slice(0, -1)} con su dígito de verificación pegado. Escríbelo SIN el dígito (${digitos.slice(0, -1)}): así lo espera el banco y así está el maestro.` };
    }
  }
  return { doc: digitos };
}
