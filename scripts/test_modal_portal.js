#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DEL MODAL QUE SE PUEDE LEER (Regla 14 + Regla 20).
//
// Un modal de este portal se abre desde el botón de una fila, así que su JSX
// queda escrito DENTRO de esa fila. Y `.fila:focus-within` le pone
// `position: relative; z-index: 20`: al abrirse, la fila se vuelve un contexto
// de apilamiento y el modal queda atrapado adentro. En pantalla el panel blanco
// deja de tapar la página — el formulario se lee encima del contenido de atrás,
// el fondo oscuro no aparece y no se entiende qué se está por confirmar. Nada
// falla: el navegador reporta `background: white` y el clic llega bien.
// Pasó con "Pagar esta factura a otra cuenta" (MLK234, ago-2026).
//
// Las tres reglas que quedan fijadas acá:
//   1. TODO modal se cuelga del <body> (ModalPortal), no de la fila.
//   2. El panel nunca es más alto que la pantalla, y su cuerpo se desplaza:
//      si no, los botones quedan fuera y el formulario no se puede terminar.
//   3. La columna del fondo no crece con el contenido: el <select> de 72 bancos
//      mide más que un celular y sacaba el panel por la derecha.
//
//   node scripts/test_modal_portal.js

const fs = require("fs"), path = require("path");
const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

/** Todos los .tsx del portal (sin node_modules ni .next). */
function tsx(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tsx(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

console.log("\n1) Todo modal se cuelga del <body>, no de la fila que lo abrió");
const conModal = tsx(path.join(RAIZ, "app")).filter((f) => fs.readFileSync(f, "utf8").includes('className="modal-backdrop"'));
check(conModal.length > 0, "hay modales que revisar", `${conModal.length} archivo(s)`);
for (const f of conModal) {
  const src = fs.readFileSync(f, "utf8");
  const rel = path.relative(RAIZ, f);
  const aperturas = (src.match(/<div className="modal-backdrop"/g) || []).length;
  // Cada fondo tiene que venir precedido por <ModalPortal> (el JSX de por medio
  // es solo espacios y saltos de línea).
  const envueltos = (src.match(/<ModalPortal>\s*<div className="modal-backdrop"/g) || []).length;
  check(src.includes('from "../_ui/ModalPortal"'), `${rel}: importa ModalPortal`);
  check(aperturas === envueltos, `${rel}: sus ${aperturas} modal(es) van por portal`, `${envueltos}/${aperturas}`);
}

console.log("\n2) El panel cabe en la pantalla y su cuerpo se desplaza");
const css = fs.readFileSync(path.join(RAIZ, "app/globals.css"), "utf8");
const bloqueModal = (css.match(/\n\.modal \{[^}]*\}/) || [""])[0];
check(/max-height:/.test(bloqueModal), ".modal tiene max-height");
check(/overflow-y:\s*auto/.test(bloqueModal), ".modal desplaza su cuerpo (overflow-y: auto)");
check(/position:\s*sticky/.test((css.match(/\.modal-pie,\s*\.modal-foot \{[^}]*\}/) || [""])[0]),
      "el pie queda pegado abajo (los botones no se pierden al desplazar)");

console.log("\n3) El fondo no deja que el contenido ensanche el panel");
const bloqueFondo = (css.match(/\.modal-backdrop \{[^}]*\}/) || [""])[0];
check(/grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(bloqueFondo),
      "la columna del fondo es minmax(0, 1fr)", "sin esto el <select> de bancos saca el panel del celular");

console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s): ${fallos.join(", ")}\n` : "\n🟢 todo OK\n");
process.exit(fallos.length ? 1 : 0);
