#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DE "A QUIÉN SE LE PAGÓ" (Regla 14).
//
// El caso que lo pidió (28-ago-2026): en la columna CONFIRMADOS del tablero, un
// pago aparecía como «CC-160» y nadie sabía a quién se le había pagado. La
// consulta sacaba el nombre de `facturas`, y un pago sin factura DIAN detrás
// —cuenta de cobro, servicio público, adelanto de cotización— no tiene ahí a
// quién preguntarle: caía a la referencia del documento, que es una llave, no
// un nombre. Eran 14 pagos.
//
// Lo que este test fija:
//   1. TODO pago del tablero muestra un nombre, y ese nombre no es su código;
//   2. traer el nombre desde el documento de origen no multiplica las filas de
//      `pago_facturas` (el conteo de facturas que va al lado del pago);
//   3. lo que no tiene factura DIAN se dice por su clase —servicio público,
//      arriendo, cuenta de cobro, adelanto—, no todo como "cuenta de cobro":
//      llamarlos igual esconde el gasto que más se repite.
//
// La consulta NO se copia: se LEE del archivo que se despliega. Un centinela
// con su propia copia del SQL protege a una consulta que ya no existe.
//
//   node scripts/test_nombre_pago.js

const fs = require("fs"), path = require("path"), os = require("os");
const { Client } = require("pg");
const { execFileSync } = require("child_process");

const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };

function urlBase() {
  const m = fs.readFileSync(path.join(RAIZ, ".env.local"), "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  return m ? m[1].trim() : process.env.DATABASE_URL;
}

// Las etiquetas salen del módulo real, igual que en la pantalla.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "np-"));
try { execFileSync("npx", ["tsc", "lib/origen-pago.ts", "--outDir", tmp, "--module", "commonjs",
                           "--target", "es2020", "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe" }); } catch {}
const { etiquetaOrigen } = require(path.join(tmp, "origen-pago.js"));

const PAGE = path.join(RAIZ, "app/(portal)/contabilidad/pagos/page.tsx");
function sqlDelTablero() {
  const s = fs.readFileSync(PAGE, "utf8");
  const q = s.split("const historial = await pool.query<PagoHecho>(`")[1]?.split("`);")[0];
  if (!q) throw new Error("No encontré la consulta del historial en pagos/page.tsx");
  return q;
}

// Un nombre que en realidad es una referencia: CC-160, SP-51, COT-0066.
const ES_CODIGO = /^(CC|SP|AR|AD|SG|IM|OT|COT)-\d+$/i;

(async () => {
  console.log("CENTINELA · nombre del proveedor en los pagos\n");
  const c = new Client({ connectionString: urlBase(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const { rows } = await c.query(sqlDelTablero());
    const sinDian = rows.filter((r) => r.origen && r.origen !== "factura");
    console.log(`  (${rows.length} pagos en el tablero · ${sinDian.length} sin factura DIAN)`);

    const anonimos = rows.filter((r) => !r.proveedor);
    check(!anonimos.length, "todo pago dice a quién se le pagó",
      anonimos.length ? `${anonimos.length} sin nombre` : "");

    const codigos = rows.filter((r) => ES_CODIGO.test(String(r.proveedor ?? "")));
    check(!codigos.length, "ningún pago muestra su código en vez del nombre",
      codigos.length ? codigos.map((r) => r.origen_ref).join(", ") : "");

    // El nombre nuevo no puede haber costado filas de más: si el JOIN al
    // documento de origen multiplicara, el pago diría que pagó más facturas de
    // las que pagó.
    const suma = rows.reduce((s, r) => s + Number(r.n_facturas), 0);
    const real = (await c.query(
      `SELECT count(*)::int c FROM pago_facturas pf
         JOIN (SELECT id FROM pagos ORDER BY fecha_pago DESC, id DESC LIMIT 300) t ON t.id = pf.pago_id`)).rows[0].c;
    check(suma === real, "traer el nombre no multiplica las facturas del pago", `${suma} vs ${real}`);

    // Cada clase de documento se llama por su nombre.
    const mal = sinDian.filter((r) =>
      r.origen === "cuenta_cobro" && r.origen_tipo && r.origen_tipo !== "cuenta_cobro"
      && etiquetaOrigen(r.origen, r.origen_tipo) === "Cuenta de cobro");
    check(!mal.length, "un servicio público no se reporta como cuenta de cobro",
      mal.length ? mal.map((r) => r.origen_ref).join(", ") : "");

    const sinTipo = sinDian.filter((r) => !r.origen_tipo);
    check(!sinTipo.length, "todo pago sin factura DIAN sabe qué documento fue",
      sinTipo.length ? sinTipo.map((r) => r.origen_ref).join(", ") : "");
  } finally { await c.end(); }

  console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s)` : "\n✅ Todo bien");
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
