// LOS MAESTROS APRENDEN DE LO QUE EL EQUIPO PONE.
//
// Cada vez que alguien clasifica algo con un concepto o un destino que no
// estaba, se crea en el maestro y queda en la bitácora. Es la regla de la casa:
// el maestro no se llena aparte, se llena trabajando.
//
// Vive acá y no dentro de una pantalla porque ya son TRES los caminos que
// clasifican —facturas DIAN, cuentas de cobro y cotizaciones— y si cada uno
// tuviera su copia, el maestro aprendería por un lado y las listas de las
// pantallas se irían separando.

import { registrarEvento } from "@/lib/eventos";
import type { PoolClient } from "pg";

export async function asegurarConcepto(c: PoolClient, nombre: string, actor: string) {
  const r = await c.query("SELECT 1 FROM maestro_conceptos WHERE lower(btrim(nombre)) = lower(btrim($1))", [nombre]);
  if (r.rowCount === 0) {
    await c.query("INSERT INTO maestro_conceptos (nombre, creado_por) VALUES ($1,$2)", [nombre, actor]);
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "concepto", valorNuevo: nombre, actor });
  }
}

export async function asegurarDestino(c: PoolClient, nombre: string, actor: string) {
  const r = await c.query("SELECT 1 FROM maestro_destinos WHERE lower(btrim(nombre)) = lower(btrim($1))", [nombre]);
  if (r.rowCount === 0) {
    await c.query("INSERT INTO maestro_destinos (nombre, creado_por) VALUES ($1,$2)", [nombre, actor]);
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "destino", valorNuevo: nombre, actor });
  }
}
