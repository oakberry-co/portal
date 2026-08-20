#!/usr/bin/env node
/* eslint-disable */
// EL BOTÓN QUE EXISTE Y NO SE VE (Regla 14).
//
// Pasó dos veces, y la segunda le costó a Daniel no encontrar una función
// entera: "no veo ningún botón para cargar el archivo". El botón estaba ahí,
// era clicable, y salía BLANCO SOBRE BLANCO.
//
// El patrón: una clase fuerza `color: #fff !important` y la variante `.ghost`
// —definida aparte— le pone fondo blanco. El `!important` gana en el color, el
// fondo blanco gana en el fondo, y queda texto blanco sobre blanco. Ningún
// error, ninguna advertencia: simplemente no se ve.
//
// Este test recorre el CSS: por cada clase que fuerce el color con !important y
// que se use en algún `className="... ghost"`, exige que exista su regla
// `.clase.ghost` redefiniendo el color. Si alguien agrega otro botón fantasma y
// olvida la regla, se pone rojo acá en vez de desaparecer en producción.
//
//   node scripts/test_css_botones.js

const fs = require("fs"), path = require("path");
const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

const css = fs.readFileSync(path.join(RAIZ, "app", "globals.css"), "utf8");

// 1) ¿Qué clases fuerzan el color del texto?
const forzadas = new Set();
for (const m of css.matchAll(/\.([a-z][\w-]*)\s*(?:,[^{]*)?\{([^}]*)\}/gi)) {
  // Ojo: en un selector compuesto (`.pub-btn.ghost`) la regex captura la ÚLTIMA
  // clase. "ghost" no es una clase base, es la variante: se descarta o el test
  // se acusa a sí mismo (`.ghost.ghost`).
  if (/color\s*:[^;]*!important/.test(m[2]) && m[1] !== "ghost") forzadas.add(m[1]);
}
console.log(`\n1) Clases que fuerzan el color con !important: ${[...forzadas].join(", ") || "ninguna"}`);
check(forzadas.size > 0, "el test tiene algo que revisar");

// 2) ¿Cuáles de esas se usan como variante fantasma en el código?
const usadas = new Map();
const recorrer = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { recorrer(p); continue; }
    if (!/\.(tsx|ts)$/.test(e.name)) continue;
    const txt = fs.readFileSync(p, "utf8");
    for (const m of txt.matchAll(/className=\{?["'`]([^"'`]*\bghost\b[^"'`]*)["'`]/g)) {
      for (const cls of m[1].split(/\s+/)) {
        if (forzadas.has(cls)) {
          if (!usadas.has(cls)) usadas.set(cls, []);
          usadas.get(cls).push(path.relative(RAIZ, p));
        }
      }
    }
    // también la forma `"clase" + (ghost ? " ghost" : "")`
    for (const m of txt.matchAll(/["'`]([\w-]+)\s*["'`]\s*\+\s*\([^)]*\?\s*["'`]\s*ghost/g)) {
      const cls = m[1].trim();
      if (forzadas.has(cls)) {
        if (!usadas.has(cls)) usadas.set(cls, []);
        usadas.get(cls).push(path.relative(RAIZ, p));
      }
    }
  }
};
recorrer(path.join(RAIZ, "app"));

console.log("\n2) Cada botón fantasma redefine su color (o sale invisible)");
if (!usadas.size) console.log("   (ninguna clase con color forzado se usa como .ghost)");
for (const [cls, archivos] of usadas) {
  const re = new RegExp(`\\.${cls}\\.ghost[^{]*\\{([^}]*)\\}`);
  const regla = css.match(re);
  const ok = !!regla && /color\s*:[^;]*!important/.test(regla[1]);
  check(ok, `.${cls}.ghost define su propio color`,
        ok ? "" : `usada en ${archivos[0]} — saldría BLANCO SOBRE BLANCO`);
}

// 3) La regla concreta que ya nos mordió, fijada por si alguien la borra.
console.log("\n3) Las dos que ya nos mordieron");
check(/\.export-btn\.ghost[^{]*\{[^}]*color\s*:[^;]*!important/.test(css),
      '.export-btn.ghost — el botón de "Subir Excel con retenciones"');
check(!/var\(--acc\)|var\(--line\)/.test(css),
      "no se usan --acc ni --line (no existen: la paleta pública es --purple/--border-lav)");

console.log(`\n${fallos.length ? "🔴 " + fallos.length + " fallo(s): " + fallos.join(", ") : "🟢 todo OK"}`);
process.exit(fallos.length ? 1 : 0);
