#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DEL AISLAMIENTO DEL AMBIENTE DE PRUEBAS (Regla 14).
//
// La pregunta de Daniel: "¿estamos 100% seguros de que nada de pruebas pasa a un
// flujo de pago real?". La base sí está separada (otro host), pero el software no
// puede impedir que un HUMANO baje el archivo del banco desde pruebas y lo suba
// al banco: adentro se ve idéntico. Lo que sí puede es que el archivo se delate.
//
// Lo que fija:
//   1. el Excel del banco nacido en pruebas lleva PRUEBAS-NO-SUBIR-AL-BANCO en el
//      nombre;
//   2. el emisor de correos se niega a enviar contra una base que no sea
//      producción si no hay destino forzado (la copia trae los correos REALES);
//   3. la app se conecta por UNA sola variable (no hay una segunda puerta a otra
//      base).
//
//   node scripts/test_aislamiento_pruebas.js

const fs = require("fs"), path = require("path");
const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

console.log("\n1) El archivo del banco nacido en pruebas se delata");
const exp = fs.readFileSync(path.join(RAIZ, "app/(portal)/contabilidad/pagos/export/route.ts"), "utf8");
check(/PRUEBAS-NO-SUBIR-AL-BANCO/.test(exp), "el nombre lleva el aviso");
check(/AMBIENTE === "pruebas" \? "PRUEBAS-NO-SUBIR-AL-BANCO_"/.test(exp),
      "y se enciende con la MISMA variable del ambiente");
check(exp.indexOf("PRUEBAS-NO-SUBIR-AL-BANCO") < exp.indexOf("pagos_${slugDe(cuenta)}"),
      "va de PRIMERO en el nombre (se lee en la lista de descargas sin abrirlo)");

console.log("\n2) El emisor no le escribe a un proveedor desde pruebas");
const cor = fs.readFileSync(path.join(RAIZ, "scripts/enviar_correos.py"), "utf8");
check(/def base_de_produccion/.test(cor), "sabe distinguir la base de producción");
check(/if args\.commit and not base_de_produccion\(dsn\) and not/.test(cor),
      "y se niega a enviar desde otra base sin destino forzado");
check(/CORREO_DESTINO_FORZADO/.test(cor), "el destino forzado existe como escape");

console.log("\n3) Una sola puerta a la base");
const db = fs.readFileSync(path.join(RAIZ, "lib/db.ts"), "utf8");
check((db.match(/process\.env\.[A-Z_]*(URL|POSTGRES)[A-Z_]*/g) || []).every((v) => v === "process.env.DATABASE_URL"),
      "lib/db.ts solo lee DATABASE_URL", "una segunda variable sería una segunda base");
const otros = [];
for (const dir of ["lib", "app"]) {
  const stack = [path.join(RAIZ, dir)];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!["node_modules", ".next"].includes(e.name)) stack.push(p); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      const src = fs.readFileSync(p, "utf8");
      if (/new Pool\(/.test(src) && !p.endsWith("lib/db.ts")) otros.push(path.relative(RAIZ, p));
    }
  }
}
check(otros.length === 0, "nadie más abre su propio pool", otros.join(", ") || "solo lib/db.ts");

console.log("\n4) El sembrador no puede tocar producción");
const sem = fs.readFileSync(path.join(RAIZ, "scripts/sembrar_demo.py"), "utf8");
check(/Esa es la base de PRODUCCIÓN/.test(sem), "se niega contra la base del .env.local");
check(!/os\.environ\.get\("DATABASE_URL"\) or url_del_env_local\(\)/.test(sem),
      "y NO cae al .env.local si falta la variable");

console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s): ${fallos.join(", ")}\n` : "\n🟢 todo OK\n");
process.exit(fallos.length ? 1 : 0);
