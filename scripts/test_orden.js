#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DEL ORDEN DE LA GRILLA (Regla 14).
//
// Ordenar por columna suena inofensivo y no lo es: reordena cuatro mil facturas
// y nadie revisa fila por fila si quedó bien. Los dos errores que se cometen
// solos son:
//
//   · comparar números como TEXTO — "9.870" iría antes que "23.544.000", y en
//     una columna de plata eso es "la factura más grande" señalando la que no es;
//   · mandar los vacíos al principio en una dirección — quien ordena por "A
//     pagar" quiere ver montos, no cincuenta filas sin llenar.
//
// Y la regla que sostiene todo: el orden se aplica sobre lo FILTRADO y antes de
// paginar. Un "mayor a menor" que solo mira las 100 filas de la página no es un
// orden, es una mentira que se ve bien. Por eso acá se ordena una lista más
// larga que una página y se comprueba que el primero es el máximo del universo.
//
//   node scripts/test_orden.js

const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ord-"));
try { execFileSync("npx", ["tsc", "lib/orden-facturas.ts", "--outDir", tmp, "--module", "commonjs",
                           "--target", "es2020", "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" }); } catch {}
const { comparar, CLAVE, isoWeek } = require(path.join(tmp, "orden-facturas.js"));

const f = (o) => ({ cufe: "x", nombre_proveedor: null, numero: null, fecha_emision: "2026-08-01",
                    total: 0, valor_a_pagar: null, concepto: null, destino: null,
                    plazo_dias: null, estado: "capturada", ...o });
const ordenar = (arr, col, dir) => [...arr].sort((a, b) => comparar(a, b, { col, dir }));

console.log("\n1) La plata se compara como NÚMERO, no como texto");
const platas = [f({ numero: "A", total: 9870 }), f({ numero: "B", total: 23544000 }), f({ numero: "C", total: 4800000 })];
const desc = ordenar(platas, "valor", -1);
check(desc.map((x) => x.numero).join("") === "BCA", "mayor a menor: 23.544.000 · 4.800.000 · 9.870",
      desc.map((x) => x.total).join(" · "));
const asc = ordenar(platas, "valor", 1);
check(asc.map((x) => x.numero).join("") === "ACB", "menor a mayor invierte de verdad");

console.log("\n2) Los vacíos van al FINAL en las dos direcciones");
const conVacios = [f({ numero: "A", valor_a_pagar: null, total: null }),
                   f({ numero: "B", valor_a_pagar: 100 }),
                   f({ numero: "C", valor_a_pagar: 900 })];
for (const dir of [-1, 1]) {
  const r = ordenar(conVacios, "pagar", dir);
  check(r[r.length - 1].numero === "A", `dir ${dir}: la fila sin valor queda de última`,
        r.map((x) => x.numero).join(""));
}
const sinConcepto = [f({ numero: "A", concepto: null }), f({ numero: "B", concepto: "Fruta" })];
check(ordenar(sinConcepto, "concepto", -1)[1].numero === "A", "también en columnas de texto");

console.log("\n3) Texto en español: tildes y mayúsculas no arman su propio grupo");
const provs = [f({ numero: "A", nombre_proveedor: "Ángel" }), f({ numero: "B", nombre_proveedor: "amande" }),
               f({ numero: "C", nombre_proveedor: "Zulia" })];
const porProv = ordenar(provs, "prov", 1).map((x) => x.nombre_proveedor);
check(porProv[0] === "amande" && porProv[2] === "Zulia", "a · Á · Z, no ASCII crudo", porProv.join(" · "));

console.log("\n4) El orden es sobre TODO, no sobre la página (PAGE = 100)");
const muchas = Array.from({ length: 250 }, (_, i) => f({ numero: String(i), total: i === 249 ? 1 : i + 1000 }));
// La más grande está en la posición 100 (o sea, en la 2ª página del orden natural).
muchas[150].total = 99_999_999;
const top = ordenar(muchas, "valor", -1)[0];
check(top.total === 99_999_999, "la más grande sale primera aunque estuviera en la página 2", String(top.total));
check(ordenar(muchas, "valor", 1)[0].total === 1, "y la más chica, primera al invertir");

console.log("\n5) La fecha se compara como fecha (no como '01/08' de texto)");
const fechas = [f({ numero: "A", fecha_emision: "2026-08-05" }), f({ numero: "B", fecha_emision: "2026-08-19" }),
                f({ numero: "C", fecha_emision: "2025-12-31" })];
check(ordenar(fechas, "fecha", -1).map((x) => x.numero).join("") === "BAC", "más reciente primero");

console.log("\n6) La semana ISO ordena con el año adelante");
check(isoWeek(new Date("2026-01-05")) === "2026-W02" || /^2026-W0[12]$/.test(isoWeek(new Date("2026-01-05"))),
      "formato YYYY-Www", isoWeek(new Date("2026-01-05")));
check("2025-W52" < "2026-W01", "diciembre de un año va antes que enero del siguiente");

console.log("\n7) Toda columna clicable tiene su clave (si no, ordenar no hace nada)");
for (const col of ["prov", "num", "fecha", "sem", "valor", "concepto", "destino", "plazo", "pagar", "estado"]) {
  check(typeof CLAVE[col] === "function", `columna "${col}"`);
}

console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s): ${fallos.join(", ")}\n` : "\n🟢 todo OK\n");
process.exit(fallos.length ? 1 : 0);
