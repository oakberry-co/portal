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
const { resolverCuenta, faltaParaCausar, carrilDe } = require(path.join(tmp, "causacion.js"));

// Una factura que SÍ se puede causar. Cada prueba le rompe una cosa.
const OK = {
  concepto: "Toppings", destino: "Oakberry Zona T", retencion_ok: true,
  centro_costo: "18", cuenta_proveedor: "14050501", cuenta_concepto: "14050501",
  cuenta_valida: true, anulada: false, causacion_estado: null,
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

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s): ${fallos.join(", ")}\n`
                          : "\n✅ todo en orden\n");
process.exit(fallos.length ? 1 : 0);
