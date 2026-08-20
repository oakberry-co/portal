#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DEL TEXTO QUE VIAJA AL BANCO (Regla 14).
//
// De acá salió `PEÃA`: el apellido de un proveedor guardado con los dos bytes
// UTF-8 de la "Ñ" leídos como Latin-1. En el archivo del banco salía `PEAA`
// más un carácter de control INVISIBLE — un titular que no corresponde a la
// cuenta, sin un solo error en pantalla.
//
// Lo que este test fija, y que es fácil romper "simplificando":
//   1. la reparación NO se aplica a un texto sano (una Ñ de verdad se queda);
//   2. NO se fuerza: si los bytes no descifran a UTF-8 válido, se deja igual;
//   3. `textoSucio` no usa un regex con /g (con /g, `.test()` alterna true y
//      false entre llamadas y el centinela dejaría pasar una de cada dos);
//   4. `mailto:` se cae del correo;
//   5. el número de identificación con dígito de verificación se corrige SOLO
//      cuando es el NIT de esa misma fila (una cédula nunca se toca).
//
//   node scripts/test_texto.js

const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tx-"));
try { execFileSync("npx", ["tsc", "lib/texto.ts", "lib/nit.ts", "lib/davivienda.ts", "--outDir", tmp,
                           "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
                   { cwd: RAIZ, stdio: "pipe" }); } catch {}
const { limpiarTextoHumano, limpiarCorreo, textoSucio, reparaMojibake } = require(path.join(tmp, "texto.js"));
const { mismoNit } = require(path.join(tmp, "nit.js"));

// El caso REAL, escrito por sus códigos para que no se "arregle" solo al
// guardar este archivo: P E Ã <control 0x91> A
const PEAA = "PE" + String.fromCharCode(0xC3) + String.fromCharCode(0x91) + "A";

console.log("\n1) El mojibake real se repara");
check(reparaMojibake(PEAA) === "PEÑA", "PEÃA → PEÑA", JSON.stringify(reparaMojibake(PEAA)));
check(limpiarTextoHumano(PEAA) === "PEÑA", "y limpiarTextoHumano lo deja limpio");

console.log("\n2) Un texto SANO no se toca (lo que rompería un arreglo agresivo)");
for (const sano of ["PEÑA", "GÓMEZ", "MUÑOZ SAS", "AGUIRRE", "D&A ASESORES"]) {
  check(reparaMojibake(sano) === sano, `${sano} se queda igual`, JSON.stringify(reparaMojibake(sano)));
}

console.log("\n3) Si no descifra, se deja como está (nunca se fuerza)");
// "Â" seguido de una letra normal: tiene la huella pero NO es UTF-8 válido.
const noDescifra = "Â" + "Z";
check(reparaMojibake(noDescifra) === noDescifra, "texto con huella que no descifra se respeta");
check(reparaMojibake("Ñ" + "\u{1F600}") === "Ñ" + "\u{1F600}", "con caracteres > 255 ni se intenta");

console.log("\n4) textoSucio es estable entre llamadas (el bug del regex con /g)");
const t = [textoSucio(PEAA), textoSucio(PEAA), textoSucio(PEAA)];
check(t.every(Boolean), "tres llamadas seguidas dan true", JSON.stringify(t));
const l = [textoSucio("PENA"), textoSucio("PENA")];
check(l.every((x) => x === false), "y sobre texto limpio, siempre false", JSON.stringify(l));

console.log("\n5) Caracteres invisibles y correos pegados como enlace");
check(limpiarTextoHumano("AB" + String.fromCharCode(0x7F) + "C") === "ABC", "se borra el carácter de control");
check(limpiarCorreo("mailto:oficial.steelmaster@gmail.com") === "oficial.steelmaster@gmail.com", "se quita mailto:");
check(limpiarCorreo("<juan@x.com>") === "juan@x.com", "se quitan los <> del pegado desde un cliente de correo");
check(limpiarCorreo("  ") === null, "un correo en blanco es null, no cadena vacía");

console.log("\n6) El documento del titular: solo se corrige si ES el NIT de la fila");
check(mismoNit("8600073861", "860007386"), "Uniandes: 8600073861 es su NIT con DV");
check(!mismoNit("1013668091", "700127394"), "la cédula de un titular NO se confunde con el NIT");

console.log("\n7) Nada invisible llega al archivo del banco");
const { textoBanco } = require(path.join(tmp, "davivienda.js"));
const salida = textoBanco(PEAA);
check(salida === "PENA", "textoBanco(PEÃA) = PENA", JSON.stringify(salida));
check(![...salida].some((ch) => ch.codePointAt(0) < 32 || (ch.codePointAt(0) >= 127 && ch.codePointAt(0) <= 159)),
      "sin ningún carácter de control");

console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s): ${fallos.join(", ")}\n` : "\n🟢 todo OK\n");
process.exit(fallos.length ? 1 : 0);
