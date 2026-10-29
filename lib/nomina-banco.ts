// QUÉ SALE EN EL ARCHIVO DEL BANCO DE UN LOTE DE NÓMINA, y qué hay que mirar
// antes de subirlo. Lo usan el export (que arma el Excel) y el tablero (que
// pinta las revisiones al lado del botón «⬇ Excel»): si cada uno calculara lo
// suyo, la pantalla diría «todo bien» y el archivo traería otra cosa.
//
// Las revisiones NO viajan dentro del archivo: Davivienda exige una sola hoja,
// y una hoja de más es un archivo rechazado el día de pago.

import { getPool } from "./db";
import { codigoBancoDavivienda, CODIGOS_DAVIVIENDA } from "./bancos";
import { revisarFila, type Aviso } from "./davivienda";

export type FilaBancoNomina = {
  num_doc: string; tipo_doc: string; nombre_completo: string; nombre: string; apellido: string;
  banco: string | null; tipo_cuenta: string | null; num_cuenta: string | null; correo: string | null;
  codigo: string; neto: number; cuenta_nueva: boolean;
};

export async function filasBancoLote(loteId: number): Promise<{ filas: FilaBancoNomina[]; avisos: Aviso[]; sinCuenta: string[] }> {
  const { rows } = await getPool().query<Omit<FilaBancoNomina, "nombre" | "apellido" | "codigo"> & { nombres: string | null; apellidos: string | null }>(
    `SELECT b.num_doc, b.tipo_doc, b.nombre_completo, b.nombres, b.apellidos, b.banco, b.tipo_cuenta,
            b.num_cuenta, b.correo, round(sum(p.neto))::float AS neto,
            coalesce(b.cuenta_cambio_en > now() - interval '30 days', false) AS cuenta_nueva
       FROM nomina_pagos p JOIN nomina_beneficiarios b USING (num_doc)
      WHERE p.lote_id = $1
      GROUP BY b.num_doc
      ORDER BY b.nombre_completo`, [loteId]);
  const validos = new Set(CODIGOS_DAVIVIENDA);
  const avisos: Aviso[] = [];
  const sinCuenta: string[] = [];
  const filas: FilaBancoNomina[] = [];
  for (const r of rows) {
    if (!(r.num_cuenta ?? "").trim() || !r.banco || !r.tipo_cuenta) { sinCuenta.push(r.nombre_completo); continue; }
    const i = filas.length + 2;                      // fila real del Excel (1 = encabezado)
    const separados = !!(r.nombres && r.apellidos);
    // Sin nombres y apellidos separados va el nombre completo en «Nombre»: el
    // banco valida documento + cuenta, pero la fila queda señalada, y se
    // arregla con un Excel de empleados que los traiga aparte.
    const nombre = separados ? r.nombres! : r.nombre_completo;
    const apellido = separados ? r.apellidos! : "";
    const codigo = codigoBancoDavivienda(r.banco);
    // `revisarFila` nombra la fila por el titular («LUIS»); acá se busca a la
    // persona por su nombre completo, que es como aparece en el tablero.
    avisos.push(...revisarFila(i, {
      nit: r.num_doc, nombre: r.nombre_completo, titular_nombre: nombre, titular_apellido: apellido,
      tipo_doc: r.tipo_doc, num_doc: r.num_doc, banco: r.banco, tipo_cuenta: r.tipo_cuenta,
      num_cuenta: r.num_cuenta, correo: r.correo, referencia: null, monto: r.neto,
    }, codigo, validos).map((a) => ({ ...a, quien: r.nombre_completo })));
    if (!separados) avisos.push({ fila: i, quien: r.nombre_completo, regla: "6 · nombre y apellido",
      detalle: "Nombre y apellido no vienen separados en el maestro: va el nombre completo en «Nombre»." });
    if (r.cuenta_nueva) avisos.push({ fila: i, quien: r.nombre_completo, regla: "cuenta nueva",
      detalle: "La cuenta de esta persona cambió en los últimos 30 días. Confírmala con ella antes de pagar." });
    filas.push({ ...r, nombre, apellido, codigo });
  }
  return { filas, avisos, sinCuenta };
}
