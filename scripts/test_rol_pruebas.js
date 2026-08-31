#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DEL SELECTOR DE ROL DEL AMBIENTE (Regla 14).
//
// El selector deja mirar el portal como admin, causador, conciliador o pagador.
// Es una escalada de privilegios a propósito, y por eso el candado no puede ser
// que el botón no se pinte: una cookie se falsifica desde la consola y una
// server action es un endpoint que se llama sin pasar por la pantalla.
//
// Lo que fija:
//   1. fuera del ambiente NO se lee siquiera la cookie (el `if` va primero);
//   2. la cookie no se cree lo que dice: solo pasan los cuatro roles conocidos;
//   3. la acción rechaza en el SERVIDOR si el despliegue no es el de pruebas,
//      y exige sesión;
//   4. nadie más lee esa cookie por su cuenta;
//   5. si mañana nace un quinto rol, el selector no lo puede ignorar en silencio.
//
//   node scripts/test_rol_pruebas.js

const fs = require("fs"), path = require("path");
const RAIZ = path.dirname(__dirname);
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), "utf8");
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

console.log("\n1) Fuera del ambiente, la cookie ni se lee");
const rp = leer("lib/rol_pruebas.ts");
const cuerpo = rp.slice(rp.indexOf("export async function rolElegidoEnPruebas"));
check(/if \(!EN_PRUEBAS\) return null;/.test(cuerpo), "arranca rechazando si no es pruebas");
check(cuerpo.indexOf("if (!EN_PRUEBAS)") < cuerpo.indexOf("cookies()"),
      "y ese rechazo va ANTES de tocar la cookie",
      "leerla primero y decidir después es como se cuela un bug de orden");
check(/EN_PRUEBAS/.test(rp) && !/process\.env\.AMBIENTE/.test(rp),
      "usa el interruptor único de lib/ambiente.ts", "un segundo `process.env.AMBIENTE` es un segundo interruptor");

console.log("\n2) La cookie no se cree lo que dice");
check(/return esRol\(v\) \? v : null;/.test(rp), "solo pasa si es uno de los roles conocidos");
check(!/as Rol/.test(cuerpo), "no hay casteo del valor crudo a Rol", "`as Rol` es creerle al navegador");

console.log("\n3) La acción se defiende sola (es un endpoint)");
const acc = leer("app/(portal)/acciones_pruebas.ts");
const cuerpoAcc = acc.slice(acc.indexOf("export async function mirarComoRol"));
check(/^[^]{0,220}if \(!EN_PRUEBAS\) \{/.test(cuerpoAcc),
      "lo PRIMERO que hace es rechazar fuera del ambiente",
      "esconder el botón no es una defensa");
check(cuerpoAcc.indexOf("if (!EN_PRUEBAS)") < cuerpoAcc.indexOf("cookies()"),
      "y rechaza antes de escribir nada");
check(/await getCurrentUser\(\)/.test(cuerpoAcc), "exige sesión");
check(/esRol\(rol\)/.test(cuerpoAcc), "valida el rol que llega del formulario");
check(/httpOnly: true/.test(cuerpoAcc), "la cookie es httpOnly: un solo camino para cambiarla");

console.log("\n4) Nadie más lee esa cookie por su cuenta");
const otros = [];
for (const dir of ["lib", "app"]) {
  const stack = [path.join(RAIZ, dir)];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (![".next", "node_modules"].includes(e.name)) stack.push(p); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      const rel = path.relative(RAIZ, p);
      if (rel === "lib/rol_pruebas.ts") continue;
      if (/["']rol_pruebas["']/.test(fs.readFileSync(p, "utf8"))) otros.push(rel);
    }
  }
}
check(otros.length === 0, "el nombre de la cookie vive en un solo archivo", otros.join(", ") || "solo lib/rol_pruebas.ts");
const auth = leer("lib/auth.ts");
check(/rolElegidoEnPruebas\(\)/.test(auth) && !/cookies\(\)/.test(auth),
      "lib/auth.ts pasa por la función y no lee cookies por su cuenta");
check(/elegido \?\? \(await rolDe\(email\)\)/.test(auth),
      "sin elección válida, manda el rol REAL de la persona");

console.log("\n5) Un quinto rol no puede quedar por fuera en silencio");
const union = (auth.match(/export type Rol =\s*([^;]+);/) || [])[1] || "";
const rolesReales = (union.match(/"[a-z_]+"/g) || []).map((s) => s.slice(1, -1)).sort();
const rolesSelector = ((rp.match(/export const ROLES[^=]*=\s*\[([^\]]+)\]/) || [])[1] || "")
  .match(/"[a-z_]+"/g) || [];
const enSelector = rolesSelector.map((s) => s.slice(1, -1)).sort();
check(rolesReales.length > 0 && JSON.stringify(rolesReales) === JSON.stringify(enSelector),
      "el selector lista EXACTAMENTE los roles que existen",
      `tipo: ${rolesReales.join(", ")} · selector: ${enSelector.join(", ")}`);

console.log("\n6) La interfaz también se apaga (comodidad, no seguridad)");
const ui = leer("app/(portal)/SelectorRolPruebas.tsx");
check(/if \(!EN_PRUEBAS\) return null;/.test(ui), "el componente no se pinta fuera del ambiente");
const lay = leer("app/(portal)/layout.tsx");
check(/<SelectorRolPruebas rol=\{user\.rol\} \/>/.test(lay), "y está colgado del layout del portal");
check(!/SelectorRolPruebas/.test(leer("app/layout.tsx")),
      "NO cuelga del layout raíz", "ahí corona también las landings públicas, donde no hay sesión");

console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s): ${fallos.join(", ")}\n` : "\n🟢 todo OK\n");
process.exit(fallos.length ? 1 : 0);
