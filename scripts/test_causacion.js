#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE LA CAUSACIÓN (Regla 14).
//
// Causar escribe en un sistema externo y no se deshace solo: el asiento queda en
// Siigo y anularlo es un trámite a mano. Y el centro de costo del asiento ES la
// tienda del P&L, así que causar con el centro equivocado le mueve el costo a
// otra tienda sin dar ningún error.
//
// Lo que este test fija, y que es fácil "simplificar" por accidente:
//   · La retención confirmada por el contador es un requisito DURO. Nuestra
//     propuesta coincide con la suya el 30% de las veces; sin su confirmación,
//     causar es inventar plata.
//   · El proveedor manda sobre el concepto para la cuenta (96% vs 92%).
//   · Una cuenta que no está en el plan BLOQUEA (o Siigo rechaza el asiento, o
//     —peor— lo acepta y el gasto queda en el lugar equivocado del balance).
//   · Una factura anulada por nota crédito NUNCA llega a "lista".
//   · 'error' vuelve a ser causable (Siigo rechazó, no escribió nada);
//     'causada' no vuelve nunca.
//
//   node scripts/test_causacion.js

const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`);
  if (!ok) fallos.push(t);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "caus-"));
try {
  execFileSync("npx", ["tsc", "lib/causacion.ts", "--outDir", tmp, "--module", "commonjs",
                       "--target", "es2020", "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" });
} catch {}
const { resolverCuenta, faltaParaCausar, carrilDe, finDeMes, avisoNotaCredito } =
  require(path.join(tmp, "causacion.js"));

// Una factura que SÍ se puede causar. Cada prueba le rompe una cosa.
const OK = {
  concepto: "Toppings", destino: "Oakberry Zona T", retencion_ok: true,
  centro_costo: "18", cuenta_proveedor: "14050501", cuenta_concepto: "14050501",
  cuenta_valida: true, anulada: false, causacion_estado: null,
  nc_sin_ref: 0, nc_sin_ref_detalle: null,
};
const sin = (campo, valor = null) => ({ ...OK, [campo]: valor });

console.log("\nCENTINELA DE CAUSACIÓN\n");

check(faltaParaCausar(OK).length === 0, "la factura completa no tiene nada pendiente");
check(carrilDe(OK) === "lista", "y cae en 'listas para causar'");

for (const [campo, etiqueta] of [["concepto", "sin concepto"], ["destino", "sin destino"],
                                 ["centro_costo", "destino sin centro de costo"]]) {
  const f = faltaParaCausar(sin(campo));
  check(f.length > 0 && carrilDe(sin(campo)) === "incompleta", `${etiqueta} → incompleta`, f[0]);
}

// EL REQUISITO DURO. Si esto deja de bloquear, se causan retenciones inventadas.
const sinRet = faltaParaCausar(sin("retencion_ok", false));
check(sinRet.some((m) => m.includes("retención")),
      "sin la confirmación del contador NO se causa", sinRet[0]);

// La cuenta: proveedor sobre concepto, y sin ninguna de las dos, se bloquea.
check(resolverCuenta(OK).fuente === "proveedor", "el proveedor manda sobre el concepto");
check(resolverCuenta({ ...OK, cuenta_proveedor: null }).fuente === "concepto",
      "sin cuenta del proveedor, decide el concepto");
const sinCuenta = { ...OK, cuenta_proveedor: null, cuenta_concepto: null };
check(resolverCuenta(sinCuenta).cuenta === null && faltaParaCausar(sinCuenta).length > 0,
      "sin cuenta por ningún lado → incompleta");

// Una cuenta que no existe en el plan es peor que ninguna: entra sin error.
const cuentaMala = { ...OK, cuenta_valida: false };
check(faltaParaCausar(cuentaMala).some((m) => m.includes("plan de cuentas")),
      "cuenta que no está en el plan → bloquea", faltaParaCausar(cuentaMala)[0]);

// Anulada por nota crédito: el proveedor ya nos devolvió esa plata.
const anulada = { ...OK, anulada: true };
check(carrilDe(anulada) === "incompleta" && faltaParaCausar(anulada)[0].includes("nota crédito"),
      "anulada por nota crédito NUNCA llega a listas");

// Reintentable vs definitivo.
check(carrilDe({ ...OK, causacion_estado: "error" }) === "lista",
      "'error' vuelve a ser causable (Siigo rechazó, no escribió nada)");
check(carrilDe({ ...OK, causacion_estado: "causada" }) === "causada",
      "'causada' no vuelve atrás");

// Decir TODO lo que falta, no lo primero: quien lo arregla merece saber
// cuántos viajes va a dar (Regla 18).
const roto = { ...OK, concepto: null, destino: null, retencion_ok: false };
check(faltaParaCausar(roto).length >= 3, "lista TODO lo que falta, no solo lo primero",
      `${faltaParaCausar(roto).length} motivos`);

// NOTAS CRÉDITO SIN REFERENCIA. El 24% de las notas crédito no dice qué factura
// corrige. Una del mismo proveedor por el mismo valor puede ser la que anula
// ésta, y causarla registraría un gasto ya devuelto.
//   1 candidata  -> BLOQUEA (no se puede afirmar otra cosa razonable)
//   2 o más      -> AVISA, porque cruzar por valor no puede AFIRMAR: hay 414
//                   pares (NIT, monto) repetidos entre facturas de 2026 (Regla 3)
const unaNC = { ...OK, nc_sin_ref: 1, nc_sin_ref_detalle: "NC123 (2026-08-20)" };
check(carrilDe(unaNC) === "incompleta" && faltaParaCausar(unaNC)[0].includes("nota crédito"),
      "UNA nota crédito que calza bloquea la causación");
check(avisoNotaCredito(unaNC) === null,
      "…y no se muestra como simple aviso: es bloqueo, no sugerencia");
const variasNC = { ...OK, nc_sin_ref: 3, nc_sin_ref_detalle: "NC1 · NC2 · NC3" };
check(carrilDe(variasNC) === "lista" && (avisoNotaCredito(variasNC) || "").includes("3"),
      "VARIAS avisan pero no bloquean (no se puede afirmar cuál es)");
check(avisoNotaCredito(OK) === null, "sin notas crédito, sin ruido");

// EL CARRIL «NO SE CAUSA». Sin él, una factura que alguien ya resolvió se ve
// igual que una que nadie ha mirado, y «quedó por fuera» deja de significar algo.
check(carrilDe({ ...OK, causacion_estado: "no_causa" }) === "no_causa",
      "«no se causa» es su propio carril, no desaparece");
check(carrilDe({ ...OK, causacion_estado: "causada" }) === "causada",
      "y no se confunde con causada");

// LA RETENCIÓN SIGUE SIENDO REQUISITO DURO (decisión del 7-sep: NO se quita).
// Causar es el momento del abono en cuenta, o sea el momento legal de retener:
// causar sin la retención confirmada deja la CxP inflada y la retención sin
// practicar a tiempo.
check(faltaParaCausar({ ...OK, retencion_ok: false }).some((m) => m.includes("retención")),
      "la retención del contador sigue siendo obligatoria para causar");

// EL FIN DE MES. Tumbó la pantalla en producción: los atajos armaban el rango
// pegándole "-31" al mes y `2026-09-31` no existe — Postgres responde «out of
// range» y la página se cae entera con un digest. Cuatro meses del año tienen
// 30 días y febrero cambia con los bisiestos.
for (const [mes, esperado] of [["2026-09", "2026-09-30"], ["2026-04", "2026-04-30"],
                               ["2026-06", "2026-06-30"], ["2026-11", "2026-11-30"],
                               ["2026-02", "2026-02-28"], ["2024-02", "2024-02-29"],
                               ["2026-01", "2026-01-31"], ["2026-12", "2026-12-31"]]) {
  check(finDeMes(mes) === esperado, `fin de ${mes}`, finDeMes(mes));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s): ${fallos.join(", ")}\n`
                          : "\n✅ todo en orden\n");
process.exit(fallos.length ? 1 : 0);
