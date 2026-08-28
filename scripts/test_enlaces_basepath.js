#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DEL PREFIJO DEL AMBIENTE (Regla 14).
//
// El portal de pruebas vive bajo `/pruebas` del mismo dominio. Next agrega ese
// prefijo en `<Link>` y en `redirect()`, pero **NO en un `<a href="/...">`
// pelado** — y este portal usa `<a>` en todas partes. Un enlace sin prefijo, en
// pruebas, te saca a PRODUCCIÓN sin avisar: la pantalla se ve igual, la franja
// roja desaparece y ya estás editando los datos de verdad.
//
// Regla que fija: todo enlace interno pasa por `ruta()` (lib/ruta.ts).
//
//   node scripts/test_enlaces_basepath.js

const fs = require("fs"), path = require("path");
const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

function tsx(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tsx(p, out); else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

console.log("\n1) Ningún enlace interno se salta el prefijo del ambiente");
const sueltos = [];
for (const f of tsx(path.join(RAIZ, "app"))) {
  const src = fs.readFileSync(f, "utf8");
  src.split("\n").forEach((linea, i) => {
    // href="/..." o href={`/...`} SIN pasar por ruta()/enlace()
    const m = linea.match(/href=(?:"(\/[^"]*)"|\{`(\/[^`]*)`\})/);
    if (!m) return;
    if (/href=\{(ruta|enlace)\(/.test(linea)) return;
    if (m[1] === "//") return;
    sueltos.push(`${path.relative(RAIZ, f)}:${i + 1} → ${m[1] ?? m[2]}`);
  });
}
check(sueltos.length === 0, "todos pasan por ruta()", sueltos.join(" · ") || "revisados " + tsx(path.join(RAIZ, "app")).length + " archivos");

console.log("\n2) El prefijo sale de UNA sola variable");
const cfg = fs.readFileSync(path.join(RAIZ, "next.config.mjs"), "utf8");
check(/const BASE_PATH = process\.env\.BASE_PATH/.test(cfg), "next.config lee BASE_PATH");
check(/NEXT_PUBLIC_BASE_PATH: BASE_PATH/.test(cfg), "y de ahí sale la que ve el navegador (no se escribe dos veces)");
const rutaTs = fs.readFileSync(path.join(RAIZ, "lib/ruta.ts"), "utf8");
check(/NEXT_PUBLIC_BASE_PATH/.test(rutaTs), "lib/ruta.ts usa esa misma variable");

console.log("\n3) El ambiente de pruebas se anuncia solo");
const franja = fs.readFileSync(path.join(RAIZ, "app/FranjaPruebas.tsx"), "utf8");
check(/process\.env\.BASE_PATH/.test(franja), "la franja se enciende con BASE_PATH (no con un interruptor aparte)");
const layout = fs.readFileSync(path.join(RAIZ, "app/layout.tsx"), "utf8");
check(/<FranjaPruebas \/>/.test(layout), "y está en el layout raíz (también sobre las landings públicas)");

console.log("\n4) La sesión de pruebas no pisa la de producción");
const auth = fs.readFileSync(path.join(RAIZ, "auth.config.ts"), "utf8");
check(/session-token\.pruebas/.test(auth), "la cookie de pruebas tiene otro nombre");
check(/path: EN_PRUEBAS \? "\/pruebas"/.test(auth), "y vive bajo /pruebas");

console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s): ${fallos.join(", ")}\n` : "\n🟢 todo OK\n");
process.exit(fallos.length ? 1 : 0);
