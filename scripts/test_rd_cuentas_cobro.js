#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE LAS CUENTAS DE COBRO DE RD (Regla 14: el módulo NACE con sus
// centinelas). Prueba los módulos puros REALES (lib/rd/*.ts compilados con tsc),
// no una copia:
//
//  1. Identidad: cédula (Luhn de la JCE) y RNC (módulo 11 de la DGII) contra
//     los ejemplos públicos de python-stdnum; canónico = solo dígitos con sus
//     ceros a la izquierda; teléfono 809/829/849 con el 1 delante (wa.me).
//  2. NCF: forma B/E, crédito fiscal sí, consumo con aviso, otros no.
//  3. La plata: 'RD$1,250.00' = 1.250 (no 125.000); letras con la moneda.
//  4. Retenciones: persona física 10 % ISR + 100 % ITBIS; jurídica 0 con aviso;
//     sin regla vigente = ERROR, nunca 0 % (Regla 6); el neto cuadra al centavo.
//  5. Candado: desvío de cuenta y titular ajeno piden confirmación con motivo;
//     la cuenta ya pagada hereda los documentos; la jurídica sin NCF no pasa.
//
//   node scripts/test_rd_cuentas_cobro.js

const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rdcc-"));
try {
  execFileSync("npx", ["tsc", "lib/rd/identidad.ts", "lib/rd/catalogo.ts", "lib/rd/retenciones.ts", "lib/rd/aprobacion.ts",
                       "lib/pesos.ts", "lib/letras.ts", "--outDir", tmp, "--rootDir", ".", "--module", "commonjs",
                       "--target", "es2020", "--skipLibCheck"],
               { cwd: RAIZ, stdio: "pipe" });
} catch (e) { /* tsc se queja del alias @/ pero igual emite; se resuelve abajo */ }
// El alias @/ no lo reescribe tsc: se apunta a la carpeta compilada.
for (const f of ["identidad", "catalogo", "retenciones", "aprobacion"]) {
  const p = path.join(tmp, "lib", "rd", f + ".js");
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/require\("@\//g, `require("${tmp}/`));
}
const R = (f) => require(path.join(tmp, "lib", "rd", f + ".js"));
const { cedulaVerifica, rncVerifica, idCanonico, problemaId, telefonoRD, revisarNcf } = R("identidad");
const { montoRD, letrasRD, centavos, mesesElegibles } = R("catalogo");
const { propuesta, netoAPagar, problemaRetencion, reglaEn } = R("retenciones");
const { bloqueoAprobacionRD, docsFaltanRD, cambioDeCuenta, titularAjeno } = R("aprobacion");

console.log("\n1) Identidad");
check(cedulaVerifica("00113918205"), "cédula de ejemplo (stdnum) verifica", "001-1391820-5");
check(cedulaVerifica("001-1391820-5"), "con guiones también");
check(!cedulaVerifica("00113918204"), "un dígito cambiado NO verifica");
check(rncVerifica("101850043"), "RNC de ejemplo de la DGII verifica", "1-01-85004-3");
check(!rncVerifica("101850042"), "RNC con dígito malo NO verifica");
check(idCanonico("cedula", "001-1391820-5") === "00113918205", "canónico conserva los ceros a la izquierda");
check(problemaId("cedula", "1391820-5") !== null, "cédula corta se rechaza con motivo");
check(problemaId("rnc", "00113918205") !== null, "11 dígitos no es un RNC");
check(telefonoRD("809 555 1234") === "18095551234", "teléfono de 10 dígitos gana el 1 de wa.me");
check(telefonoRD("+1 (829) 555-1234") === "18295551234", "teléfono con +1 se respeta");
check(telefonoRD("300 555 1234") === null, "un celular colombiano NO es de RD");
check(telefonoRD("1 212 555 1234") === null, "un +1 de Nueva York NO es de RD");

console.log("\n2) NCF");
check(revisarNcf("B0100000001").ncf === "B0100000001" && !revisarNcf("B0100000001").aviso, "B01 crédito fiscal pasa limpio");
check(revisarNcf("e310000000001").ncf === "E310000000001", "e-CF E31 pasa (y se pasa a mayúscula)");
check(!!revisarNcf("B0200000001").aviso, "B02 de consumo pasa CON aviso");
check(!!revisarNcf("B1100000001").error, "un B11 no lo emite el proveedor: error");
check(!!revisarNcf("B01000001").error, "NCF corto: error");

console.log("\n3) La plata");
check(montoRD("RD$1,250.00") === 1250, "RD$1,250.00 = 1.250", String(montoRD("RD$1,250.00")));
check(montoRD("US$350") === 350, "US$350 = 350");
check(montoRD("1.250") === 1250, "1.250 (a la colombiana) = 1.250, no 1,25");
check(montoRD("1500.50") === 1500.5, "1500.50 = 1.500,50");
check(centavos(1.005) === 1.01, "centavos redondea 1.005 a 1.01");
check(letrasRD(1250, "DOP") === "MIL DOSCIENTOS CINCUENTA PESOS DOMINICANOS", "letras en pesos dominicanos", letrasRD(1250, "DOP"));
check(letrasRD(1000000, "USD") === "UN MILLÓN DE DÓLARES", "letras en dólares, con el DE del millón", letrasRD(1000000, "USD"));
check(mesesElegibles(new Date("2026-01-01T03:00:00Z"))[0] === "2025-12", "el 31-dic a las 11 pm de Santo Domingo sigue siendo diciembre");

console.log("\n4) Retenciones");
const pf = propuesta("fisica", 10000, 0, "2026-11-12");
check(pf.isrMonto === 1000 && pf.itbisMonto === 0 && pf.neto === 9000, "persona física sin NCF: 10 % ISR, neto 9.000", JSON.stringify(pf));
const pf2 = propuesta("fisica", 10000, 1800, "2026-11-12");
check(pf2.itbisMonto === 1800 && pf2.neto === 9000, "persona física con ITBIS: se retiene el 100 % del ITBIS");
const pj = propuesta("juridica", 10000, 1800, "2026-11-12");
check(pj.isrMonto === 0 && pj.itbisMonto === 0 && !!pj.aviso && pj.neto === 11800, "jurídica: 0/0 CON aviso (no inventa la regla)");
let lanzo = false; try { reglaEn("2025-06-01"); } catch { lanzo = true; }
check(lanzo, "sin regla vigente para la fecha = ERROR, nunca 0 % (Regla 6)");
check(netoAPagar(1234.56, 0, 123.46, 0) === 1111.1, "el neto cuadra al centavo");
check(problemaRetencion(1000, 0, 0, 0) === null, "confirmar CERO es válido");
check(problemaRetencion(1000, 0, 1001, 0) !== null, "ISR mayor que el valor se rechaza");
check(problemaRetencion(1000, 100, 0, 101) !== null, "ITBIS retenido mayor que el facturado se rechaza");
check(problemaRetencion(1000, 0, -1, 0) !== null, "retención negativa se rechaza");

console.log("\n5) Candado de aprobación");
const ok = (clase) => ({ clase, estado: "subido", path: "https://drive/x" });
const base = { tipo_persona: "fisica", nombre: "Ana María Pérez", banco: "Banco BHD", num_cuenta: "0012345678",
               titular_cuenta: "ANA PEREZ", documentos: [ok("identificacion"), ok("comprobante_cuenta"), ok("soporte")],
               retencion_ok: true, ncf_proveedor: null };
const sinH = { pagadas: [] };
const sinConf = { cambioCuenta: false, titularAjeno: false, motivo: null };
check(bloqueoAprobacionRD(base, sinH, sinConf) === null, "completa, primera vez, titular = quien cobra: se aprueba");
check(!titularAjeno(base), "'ANA PEREZ' es titular de 'Ana María Pérez' (sin tildes, sin el segundo nombre)");
check(titularAjeno({ ...base, titular_cuenta: "Juan Rodríguez" }), "otra persona: titular ajeno");
check(/nombre de otra persona/.test(bloqueoAprobacionRD({ ...base, titular_cuenta: "Juan Rodríguez" }, sinH, sinConf) || ""), "titular ajeno bloquea sin confirmación");
check(/Escribe qué confirmaste/.test(bloqueoAprobacionRD({ ...base, titular_cuenta: "Juan Rodríguez" }, sinH, { ...sinConf, titularAjeno: true }) || ""),
      "confirmar el titular sin decir qué se confirmó tampoco pasa");
const otraCuenta = { pagadas: [{ banco: "Banco Popular Dominicano", num_cuenta: "999" }] };
check(cambioDeCuenta(base, otraCuenta), "ya cobró a otra cuenta = cambio de cuenta");
check(/OTRA cuenta/.test(bloqueoAprobacionRD(base, otraCuenta, sinConf) || ""), "el cambio de cuenta bloquea sin confirmación");
check(bloqueoAprobacionRD(base, otraCuenta, { cambioCuenta: true, titularAjeno: false, motivo: "Llamé al 809…, confirmó" }) === null,
      "con confirmación y motivo, pasa");
const misma = { pagadas: [{ banco: "Banco BHD", num_cuenta: "0012345678" }] };
const soloSoporte = { ...base, documentos: [ok("soporte")] };
check(docsFaltanRD(soloSoporte, misma).length === 0, "misma cuenta ya pagada: hereda cédula y comprobante");
check(docsFaltanRD(soloSoporte, sinH).length === 2, "primera vez sin cédula ni comprobante: faltan los dos");
check(docsFaltanRD(soloSoporte, otraCuenta).length === 2, "cuenta NUEVA: los documentos viejos no la cubren");
check(docsFaltanRD({ ...base, documentos: [ok("identificacion"), ok("comprobante_cuenta"), { clase: "soporte", estado: "pendiente", path: "" }] }, sinH).length === 1,
      "un soporte que no llegó a Drive cuenta como faltante");
check(/NCF/.test(bloqueoAprobacionRD({ ...base, tipo_persona: "juridica" }, sinH, sinConf) || ""), "empresa sin NCF no pasa");
check(/retenciones/.test(bloqueoAprobacionRD({ ...base, retencion_ok: false }, sinH, sinConf) || ""), "sin retención confirmada no pasa");

console.log("\n6) El esquema");
const sql = fs.readFileSync(path.join(RAIZ, "db/schema.sql"), "utf8");
const sec = sql.slice(sql.indexOf("31) REPÚBLICA DOMINICANA"));
check(/CREATE TABLE IF NOT EXISTS rd_cuentas_cobro/.test(sec), "la tabla está en schema.sql (sección 31)");
check(/rd_cc_pagada_con_rastro/.test(sec), "la base impide 'pagada' sin fecha ni referencia");
check(/ux_rd_cc_mismo_cobro/.test(sec), "la base impide el mismo cobro dos veces");
check(!/rd_cuentas_cobro/.test(fs.readFileSync(path.join(RAIZ, "app/(portal)/contabilidad/pagos/export/route.ts"), "utf8")),
      "el archivo del banco colombiano NO lee la tabla de RD");

console.log("\n7) Una sola pantalla por país, dos tablas (19-nov-2026)");
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), "utf8");
const lee = (r) => /(FROM|JOIN|INTO|UPDATE)\s+rd_cuentas_cobro/i.test(leer(r));
const pub = leer("app/cuentas-de-cobro/page.tsx");
check(/FormCuentaCobroRD/.test(pub) && /FormCuentaCobro\b/.test(pub) && /SelectorPais/.test(pub),
      "el formulario público trae los dos países con el selector");
check(/paisDe\(/.test(pub), "el país sale de la URL (?pais=rd), Colombia por defecto");
check(/redirect\("\/cuentas-de-cobro\?pais=rd"\)/.test(leer("app/cuentas-de-cobro/rd/page.tsx")),
      "el enlace viejo /cuentas-de-cobro/rd redirige al selector");
check(/redirect\("\/contabilidad\/cuentas-de-cobro\?pais=rd"\)/.test(leer("app/(portal)/contabilidad/rd/cuentas-de-cobro/page.tsx")),
      "la bandeja vieja de RD redirige a Cuentas de cobro › RD");
for (const r of ["app/(portal)/contabilidad/cuentas-de-cobro/page.tsx", "app/(portal)/contabilidad/pagos/page.tsx"]) {
  const t = leer(r);
  check(/puede\(rol, "rd"\)/.test(t) && /SelectorPais/.test(t), `${r.split("/").slice(-2, -1)[0]}: selector solo con la capacidad rd`);
  check(!lee(r), `${r.split("/").slice(-2, -1)[0]}: su SQL no toca la tabla de RD (va por cargar.ts)`);
}
check(!lee("app/(portal)/contabilidad/pagos/PagosView.tsx") && !lee("app/(portal)/contabilidad/pagos/actions.ts"),
      "el tablero y las acciones de Pagos de Colombia no tocan la tabla de RD");
check(!/rd\/cuentas-de-cobro"/.test(leer("app/(portal)/areas.ts")), "el menú ya no tiene una entrada aparte para RD");
const acc = leer("app/(portal)/contabilidad/rd/cuentas-de-cobro/actions.ts");
check(/\/contabilidad\/cuentas-de-cobro/.test(acc) && /\/contabilidad\/pagos/.test(acc) && !/revalidatePath\(RUTA\)/.test(acc),
      "las acciones de RD refrescan Cuentas de cobro y Pagos (la tarjeta se mueve entre las dos)");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s)` : "\n✅ todo bien");
process.exit(fallos.length ? 1 : 0);
