#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE LA SEMANA DE PAGO (Regla 14).
//
// El tablero de Pagos reparte lo listo para pagar en ATRASADAS, ESTA SEMANA y
// PRÓXIMOS PAGOS. Hasta sep-2026 "esta semana" era `>=`: esta semana y todas
// las que vinieran. Nunca mordió porque las retenciones se confirmaban de a una
// y cerca del vencimiento. El 9-sep-2026 el contador confirmó 183 de golpe
// desde el Excel, la columna se llenó con cuatro semanas de facturas bajo un
// título que decía "esta semana", y un clic sobre NUTRELLE (ninguna marcada =
// todas) mandó 64 a Validación — diez con plazo hasta la semana siguiente:
// $8,3M que habrían salido 7 a 11 días antes de lo negociado.
//
// Este centinela fija:
//   · la semana de pago se mide por la FECHA DE PAGO (el día de pago anterior o
//     igual al vencimiento), no por la semana del vencimiento — una factura que
//     vence el martes se paga el miércoles ANTERIOR;
//   · la fecha programada a mano manda sobre el vencimiento;
//   · cada factura cae en UN solo recuadro y "próxima" es exactamente lo que el
//     servidor se niega a mover sin la marca de adelantar;
//   · la semana ISO no se corre con la hora local ni con el cambio de año;
//   · ni la pantalla ni el servidor tienen una copia propia de la regla.
//
//   node scripts/test_semana_pagos.js

const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sem-"));
try { execFileSync("npx", ["tsc", "lib/semana-pago.ts", "--outDir", tmp, "--module", "commonjs",
                           "--target", "es2020", "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" }); } catch {}
const M = require(path.join(tmp, "semana-pago.js"));

// El día del incidente: miércoles 9-sep-2026 (semana 37), y se paga los miércoles.
const HOY = "2026-09-09";
const MIER = 3;
const f = (vence, extra = {}) => ({ fecha_emision: "2026-09-01", fecha_vencimiento: vence, fecha_pago_prog: null, ...extra });
const cuando = (x) => M.cuandoSePaga(x, MIER, HOY);

console.log("\n1) FE2823 — vence el miércoles 16-sep: se paga el 16 y es PRÓXIMA, no de esta semana");
check(M.fechaPagoDe(f("2026-09-16"), MIER) === "2026-09-16", "se paga el mismo miércoles 16", M.fechaPagoDe(f("2026-09-16"), MIER));
check(cuando(f("2026-09-16")) === "proxima", "cae en Próximos pagos", cuando(f("2026-09-16")));

console.log("\n2) La semana se mide por la FECHA DE PAGO, no por la del vencimiento");
check(M.fechaPagoDe(f("2026-09-15"), MIER) === "2026-09-09", "vence el martes 15 → se paga el miércoles 9 (el ANTERIOR)");
check(cuando(f("2026-09-15")) === "esta_semana", "…y por eso es de ESTA semana aunque venza la próxima");
check(M.fechaPagoDe(f("2026-09-20"), MIER) === "2026-09-16", "vence el domingo 20 → se paga el miércoles 16");
check(cuando(f("2026-09-20")) === "proxima", "…próxima");
check(cuando(f("2026-09-10")) === "esta_semana", "vence el jueves 10 → se paga hoy → esta semana");
check(cuando(f("2026-09-07")) === "atrasada", "vence el lunes 7 → se pagaba el miércoles 2 → ATRASADA");
check(M.fechaPagoDe(f("2026-09-09"), MIER) === "2026-09-09", "vence el mismo día de pago → ese día");

console.log("\n3) Sin plazo, la factura se trata como vencida al llegar (el error que se ve)");
check(M.fechaPagoDe(f(null), MIER) === "2026-08-26", "sin vencimiento → día de pago anterior a la emisión (1-sep → 26-ago)");
check(cuando(f(null)) === "atrasada", "…y sale como atrasada, no escondida en próximos");

console.log("\n4) La fecha programada a mano MANDA sobre el vencimiento");
check(cuando(f("2026-09-10", { fecha_pago_prog: "2026-09-30" })) === "proxima", "vence esta semana pero se programó al 30 → próxima");
check(cuando(f("2026-09-30", { fecha_pago_prog: "2026-09-09" })) === "esta_semana", "vence el 30 pero se programó para hoy → esta semana");
check(M.fechaPagoDe(f("2026-09-30", { fecha_pago_prog: "2026-09-11T00:00:00.000Z" }), MIER) === "2026-09-11", "la programada llega como timestamp y se lee como día");

console.log("\n5) repartir(): cada factura cae en UN recuadro y la suma es la entrada");
const lote = [f("2026-09-16"), f("2026-09-15"), f("2026-09-20"), f("2026-09-10"), f("2026-09-07"), f(null),
              f("2026-09-10", { fecha_pago_prog: "2026-09-30" }), f("2026-10-15")];
const r = M.repartir(lote, MIER, HOY);
check(r.atrasadas.length + r.estaSemana.length + r.proximas.length === lote.length, "nada se pierde ni se duplica",
      `${r.atrasadas.length} + ${r.estaSemana.length} + ${r.proximas.length} = ${lote.length}`);
check(r.atrasadas.length === 2 && r.estaSemana.length === 2 && r.proximas.length === 4, "2 atrasadas · 2 esta semana · 4 próximas");
check(r.estaSemana.every((x) => cuando(x) === "esta_semana"), "en 'esta semana' no hay ninguna futura");

console.log("\n6) adelantadas() es EXACTAMENTE lo que el servidor se niega a mover sin la marca");
const ad = M.adelantadas(lote, MIER, HOY);
check(ad.length === r.proximas.length && ad.every((x) => r.proximas.includes(x)), "las adelantadas son las próximas, ni una más ni una menos");
check(M.adelantadas(r.estaSemana.concat(r.atrasadas), MIER, HOY).length === 0, "el atajo 'ninguna marcada = todas' de las columnas nunca trae una futura");

console.log("\n7) La semana ISO no se corre con la hora local ni con el cambio de año");
check(M.semanaISO("2026-09-14") === "2026-W38", "lunes 14-sep = W38", M.semanaISO("2026-09-14"));
check(M.semanaISO("2026-09-13") === "2026-W37", "domingo 13-sep sigue siendo W37", M.semanaISO("2026-09-13"));
check(M.semanaISO("2026-12-31") === "2026-W53", "2026 tiene 53 semanas", M.semanaISO("2026-12-31"));
check(M.semanaISO("2027-01-04") === "2027-W01", "4-ene-2027 = W01", M.semanaISO("2027-01-04"));
check("2027-W01" > "2026-W53", "…y como texto la W01 de 2027 va DESPUÉS de la W53 de 2026");
check(M.lunesDe("2026-09-16") === "2026-09-14" && M.lunesDe("2026-09-13") === "2026-09-07", "lunesDe: miércoles 16 → 14; domingo 13 → 7");

console.log("\n8) Hoy por defecto es el día de BOGOTÁ (Regla 1)");
const hoyBog = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dowBog = new Date(hoyBog + "T00:00:00Z").getUTCDay() || 7;
check(M.cuandoSePaga(f(hoyBog), dowBog) === "esta_semana", "una factura que vence hoy (Bogotá) es de esta semana sin pasar 'hoy'");

console.log("\n9) Ni la pantalla ni el servidor tienen su propia copia de la regla");
const vista = fs.readFileSync(path.join(RAIZ, "app/(portal)/contabilidad/pagos/PagosView.tsx"), "utf8");
const accion = fs.readFileSync(path.join(RAIZ, "app/(portal)/contabilidad/pagos/actions.ts"), "utf8");
check(/repartir\(pendientes, diaPago, hoy\)/.test(vista), "la vista reparte con lib/semana-pago");
check(!/>= hoySem/.test(vista) && !/function semanaISO/.test(vista) && !/function sugPago/.test(vista), "la vista no volvió a copiar el filtro ni el calendario");
check(/adelantadas\(rows, diaPago\)/.test(accion) && /fd\.get\("adelantar"\)/.test(accion), "asignarCuenta usa adelantadas() y exige la marca 'adelantar'");
check(/adelantadas_cufes/.test(accion), "el evento nombra las adelantadas (lo lee el centinela de datos)");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fallos.length ? `\n❌ ${fallos.length} regla(s) rota(s)` : "\n✅ La semana de pago se reparte como debe");
process.exit(fallos.length ? 1 : 0);
