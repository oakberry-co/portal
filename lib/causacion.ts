// QUÉ SE PUEDE CAUSAR, Y CON QUÉ CUENTA. Módulo PURO (sin base ni sesión): lo
// usan la pantalla, el server action y el centinela. Una sola copia de la regla
// — el candado de aprobación de Pagos ya se rompió una vez por tener dos.
//
// CAUSAR es registrar la factura en la contabilidad (Siigo). No es un trámite
// contable más: el centro de costo del asiento ES la tienda del P&L, así que una
// factura causada con el centro equivocado le mueve el costo a otra tienda sin
// dar ningún error. Y una factura que NO se causa deja su IVA sin descontar.
//
// Las tres decisiones del asiento y de dónde sale cada una:
//
//   · CENTRO DE COSTO  ← el DESTINO que clasificó el equipo → maestro_destinos.
//     Medido contra 1.093 facturas ya causadas: decidirlo por el destino acierta
//     99,5%; por la moda histórica del proveedor —como se hacía— solo 60,2%.
//   · CUENTA PUC       ← el proveedor (96%), y si no lo tiene, el concepto.
//   · RETENCIÓN        ← SIEMPRE la que confirmó el contador. Nunca la calculamos:
//     nuestra propuesta coincide con la suya apenas el 30% de las veces
//     (marcador_retenciones.py en el repo datawarehouse), y proponer con ese
//     número sería inventar plata. Por eso `retencion_ok` es un requisito duro.

export type FuenteCuenta = "proveedor" | "concepto" | null;

export type DatosCausacion = {
  concepto: string | null;
  destino: string | null;
  retencion_ok: boolean;
  centro_costo: string | null;        // de maestro_destinos, vía el destino
  cuenta_proveedor: string | null;    // maestro_proveedores.cuenta_puc_default
  cuenta_concepto: string | null;     // maestro_conceptos.cuenta_puc
  cuenta_valida: boolean;             // ¿la cuenta resuelta está en el plan?
  anulada: boolean;                   // una nota crédito la referencia por CUFE
  causacion_estado: string | null;
  /** Notas crédito del MISMO proveedor por el MISMO valor que NO dicen a qué
   *  factura pertenecen. La DIAN escribe la referencia en el XML y el 76% la
   *  trae; el resto hay que emparejarlo a mano.
   *   · 1 candidata  → BLOQUEA: causar sería registrar un gasto que ya fue devuelto.
   *   · 2 o más      → AVISA: cruzar por valor es inviable como afirmación
   *     (414 pares NIT+monto se repiten entre facturas de 2026), así que la
   *     coincidencia SUGIERE y decide un humano (Regla 3). */
  nc_sin_ref: number;
  nc_sin_ref_detalle: string | null;
};

/** La cuenta con la que se causaría, y de dónde salió.
 *
 *  El proveedor manda sobre el concepto porque es más preciso (96% vs 92%) y
 *  porque es más específico: si alguien se tomó el trabajo de fijarle cuenta a
 *  ESTE proveedor, sabe algo que el concepto genérico no. */
export function resolverCuenta(d: DatosCausacion): { cuenta: string | null; fuente: FuenteCuenta } {
  if (d.cuenta_proveedor) return { cuenta: d.cuenta_proveedor, fuente: "proveedor" };
  if (d.cuenta_concepto) return { cuenta: d.cuenta_concepto, fuente: "concepto" };
  return { cuenta: null, fuente: null };
}

/** Qué le falta para poder causarse. Vacío = está lista.
 *
 *  Devuelve TODO lo que falta, no lo primero: quien tiene que arreglarlo
 *  merece saber cuántos viajes va a dar (Regla 18). */
export function faltaParaCausar(d: DatosCausacion): string[] {
  if (d.anulada) return ["la anuló una nota crédito — esta factura no se causa"];
  if (d.nc_sin_ref === 1) {
    return [`hay una nota crédito del mismo proveedor por el mismo valor que no ` +
            `dice qué factura corrige (${d.nc_sin_ref_detalle ?? ""}). Si es ésta, ` +
            `causarla registra un gasto que ya fue devuelto — resolvelo antes`];
  }
  const falta: string[] = [];
  if (!d.concepto) falta.push("sin concepto");
  if (!d.destino) falta.push("sin destino");
  else if (!d.centro_costo)
    falta.push(`el destino «${d.destino}» no tiene centro de costo en Maestros`);
  if (!d.retencion_ok) falta.push("el contador no ha confirmado la retención");
  const { cuenta } = resolverCuenta(d);
  if (!cuenta) falta.push("el proveedor no tiene cuenta contable");
  else if (!d.cuenta_valida)
    falta.push(`la cuenta ${cuenta} no está en el plan de cuentas`);
  return falta;
}

export type Carril = "incompleta" | "lista" | "causada" | "no_causa";

/** En cuál de las tres ventanas va.
 *
 *  'error' de una corrida anterior vuelve a "lista": Siigo la rechazó y NO
 *  escribió nada, así que es reintentable. Lo único que no vuelve nunca es
 *  'causada' — deshacer eso se hace en Siigo, a mano, y con motivo. */
export function carrilDe(d: DatosCausacion): Carril {
  if (d.causacion_estado === "causada") return "causada";
  // Decidida a mano: sale de las listas de trabajo pero NO desaparece. Sin este
  // carril, una factura que alguien ya resolvió se ve igual que una que nadie
  // ha mirado, y «por fuera» deja de significar algo.
  if (d.causacion_estado === "no_causa") return "no_causa";
  return faltaParaCausar(d).length === 0 ? "lista" : "incompleta";
}

/** ¿Hay que avisar de una nota crédito que podría anular esta factura?
 *  Con 2 o más candidatas no se puede afirmar cuál es — se muestra y decide
 *  un humano. Con 1 no es aviso: es bloqueo (ver `faltaParaCausar`). */
export function avisoNotaCredito(d: DatosCausacion): string | null {
  if (d.nc_sin_ref < 2) return null;
  return `${d.nc_sin_ref} notas crédito de este proveedor por este mismo valor no ` +
         `dicen qué factura corrigen. Si alguna es ésta, causarla duplicaría el gasto.`;
}

/** Etiqueta corta de por qué la cuenta es la que es, para mostrarla al lado.
 *  Una cuenta sin procedencia visible es una cuenta que nadie va a auditar. */
export function explicarCuenta(f: FuenteCuenta): string {
  if (f === "proveedor") return "fijada para este proveedor";
  if (f === "concepto") return "según el concepto";
  return "sin resolver";
}


/** Último día real de un mes `YYYY-MM`, como `YYYY-MM-DD`.
 *
 *  Nació de tumbar la pantalla: los atajos de fecha armaban el fin de rango
 *  pegándole "-31" al mes, y `2026-09-31` NO EXISTE — Postgres responde
 *  «date/time field value out of range» y la página entera se cae con un
 *  digest, sin decir qué pasó. Pasa en abril, junio, septiembre, noviembre y
 *  todos los febreros.
 *
 *  `new Date(año, mes, 0)` es el día 0 del mes siguiente = el último del mes
 *  pedido, y ya sabe de años bisiestos. Se arma con partes locales (no ISO)
 *  para que la zona horaria no lo corra un día. */
export function finDeMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  if (!a || !m) return mes;
  const d = new Date(a, m, 0);          // día 0 del mes siguiente
  return `${a}-${String(m).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
