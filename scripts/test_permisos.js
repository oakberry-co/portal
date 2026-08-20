#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE PERMISOS (Regla 14).
//
// El contador es EXTERNO y desde el 19-ago entra a las bandejas del intake para
// poner retenciones. Eso abre una puerta que antes no existía: si mañana alguien
// agrega una acción a esas pantallas y la deja sin candado —o con el candado de
// retenciones, que el contador SÍ tiene— el contador podría aprobar un pago.
// Aprobar es lo que mete plata en el archivo del banco.
//
// Este test fija por escrito quién puede qué, y revisa que cada acción del
// intake siga teniendo su candado. Corre sin base ni servidor.
//
//   node scripts/test_permisos.js

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, titulo, detalle = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${titulo}${detalle ? " — " + detalle : ""}`);
  if (!ok) fallos.push(titulo);
};

// ── 1) La matriz: se compila el módulo REAL y se le pregunta ────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "perm-"));
try {
  execFileSync("npx", ["tsc", "lib/permisos.ts", "--outDir", tmp,
                       "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
               { cwd: RAIZ, stdio: "pipe" });
} catch { /* el único error es el alias @/lib/auth (un `import type`); igual emite */ }
const { puede } = require(path.join(tmp, "permisos.js"));

console.log("\n1) Qué puede el CONTADOR (causador) — es externo");
const SI = ["ver_conciliacion", "retenciones", "ver_pagos", "export_historial",
            "ver_intake", "maestro_retenciones"];
const NO = ["intake", "pagos", "maestros", "clasificar", "tipo_pago", "usuarios", "dashboard"];
for (const c of SI) check(puede("causador", c), `SÍ puede: ${c}`);
for (const c of NO) check(!puede("causador", c), `NO puede: ${c}`);

console.log("\n2) Lo que NO puede pasar nunca");
check(!puede("causador", "intake"),
      "el contador NO aprueba: aprobar es lo que manda la plata al banco");
check(!puede("causador", "maestros"),
      "el contador NO entra al maestro de CUENTAS BANCARIAS (de ahí sale a quién se le paga)");
check(puede("causador", "maestro_retenciones"),
      "...pero SÍ rectifica las tarifas de retención, que es su trabajo");
for (const rol of ["causador", "conciliador", "pagador"]) {
  check(!puede(rol, "usuarios"), `${rol} no administra usuarios`);
}

console.log("\n2b) El trámite del Excel de retenciones se puede hacer COMPLETO");
// Bajar → escribir a mano → subir es UN trámite. Si el rol puede confirmar
// retenciones pero no puede bajar el archivo, el camino no tiene salida: pasó
// con el contador externo, que podía subir el Excel y no obtenerlo.
for (const rol of ["admin", "causador"]) {
  const confirma = puede(rol, "retenciones");
  check(!confirma || puede(rol, "ver_conciliacion"),
        `${rol}: si confirma retenciones, puede bajar el Excel de Conciliación`);
}

console.log("\n3) Las implicaciones (ver vs operar)");
for (const rol of ["admin", "causador", "conciliador", "pagador"]) {
  check(!puede(rol, "intake") || puede(rol, "ver_intake"),
        `${rol}: si opera la bandeja, la ve`);
  check(!puede(rol, "maestros") || puede(rol, "maestro_retenciones"),
        `${rol}: si administra maestros, administra tarifas`);
}

// ── 2) Cada acción del intake sigue con candado ────────────────────────────
console.log("\n4) Ninguna acción del intake quedó sin candado");
// Acciones que a propósito NO exigen `intake` porque son de retenciones.
const PERMITIDAS_SIN_INTAKE = new Set(["confirmarRetencionesCuentaCobro"]);
const ARCHIVOS = [
  "app/(portal)/contabilidad/cuentas-de-cobro/actions.ts",
  "app/(portal)/contabilidad/cotizaciones/actions.ts",
  "lib/certificacion-actions.ts",
];
for (const rel of ARCHIVOS) {
  const txt = fs.readFileSync(path.join(RAIZ, rel), "utf8");
  // El cuerpo de cada acción exportada, hasta la siguiente exportada.
  const partes = txt.split(/\nexport async function /).slice(1);
  for (const parte of partes) {
    const nombre = parte.slice(0, parte.indexOf("("));
    const cuerpo = parte;
    const caps = [...cuerpo.matchAll(/exigirCap\("(\w+)"\)/g)].map((m) => m[1]);
    const viaGuard = /await guard\(\)/.test(cuerpo);   // guard() = exigirCap("intake")
    const ok = viaGuard || caps.includes("intake") || PERMITIDAS_SIN_INTAKE.has(nombre);
    check(ok, `${nombre} exige permiso de operación`,
          ok ? "" : `${rel} — sin exigirCap("intake")`);
  }
}

console.log(`\n${fallos.length ? "🔴 " + fallos.length + " fallo(s): " + fallos.join(", ") : "🟢 todo OK"}`);
process.exit(fallos.length ? 1 : 0);
