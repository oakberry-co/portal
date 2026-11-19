import { getPool } from "@/lib/db";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { sqlCertificacion } from "@/lib/certificaciones";
import { sqlLecturaValor } from "@/lib/valor-documento";
import { empresaRD } from "@/lib/rd/empresa";
import { mesRD } from "@/lib/rd/catalogo";
import { SelectorPais, paisDe } from "../../../SelectorPais";
import { BandejaRD } from "../rd/cuentas-de-cobro/BandejaRD";
import { AYUDA_SIN_TABLA, cargarCobrosRD, contarRD, origenPeticion } from "../rd/cuentas-de-cobro/cargar";
import { CuentasCobroView, type CuentaCobro } from "./CuentasCobroView";

export const dynamic = "force-dynamic";

// COLOMBIA Y REPÚBLICA DOMINICANA EN LA MISMA PANTALLA (19-nov-2026), con el
// selector de país arriba — solo para quien tiene la capacidad `rd` (el
// decisor); los demás ven Colombia como siempre, sin selector. Cada país lee
// SU tabla: Colombia `cuentas_cobro` (abajo), RD la suya (en
// ../rd/cuentas-de-cobro/cargar.ts). Nada de RD pasa por este SQL.

// La bandeja trae, por envío, TODO lo que decide si se puede aprobar: los
// documentos, el veredicto del lector de certificaciones y la cuenta que hoy
// tiene el proveedor en el maestro. Se cargan acá para que la tarjeta explique
// el bloqueo en vez de mostrar un botón que falla al hacer clic.
async function cargar(): Promise<{ items: CuentaCobro[]; conceptos: string[]; destinos: string[] }> {
  const pool = getPool();
  const r = await pool.query<CuentaCobro>(
    `SELECT cc.id, cc.razon_social, cc.tipo_doc, cc.num_doc, cc.contacto, cc.correo,
            -- El tipo de gasto (servicio público, arriendo…): de él sale el
            -- prefijo de la referencia, y esta bandeja muestra TODO
            -- cuentas_cobro, no solo lo que llegó por el portal público.
            cc.tipo,
            cc.telefono, cc.area, cc.concepto, cc.destino, cc.descripcion, cc.valor::float AS valor,
            cc.documentos, cc.estado, cc.nota_revision, cc.revisado_por,
            cc.creado_en::text AS creado_en, cc.fecha_pago_prog::text AS fecha_pago_prog,
            cc.cuenta_pago, cc.pago_id, cc.recurrente,
            cc.iva_incluido::float AS iva_incluido, cc.retefuente::float AS retefuente,
            cc.reteiva::float AS reteiva, cc.reteica::float AS reteica,
            cc.reten_total::float AS reten_total, cc.otros_valor::float AS otros_valor,
            cc.otros_concepto, cc.observaciones, cc.retencion_ok,
            coalesce(cc.valor_a_pagar, cc.valor)::float AS valor_a_pagar,
            mr.ret_rf, mr.ret_iva, mr.ret_ica, to_jsonb(rc) AS regla,
            to_jsonb(cert) AS cert, to_jsonb(val) AS val, to_jsonb(cb) AS cuenta,
            coalesce(cor.lista, '[]') AS correos
       FROM cuentas_cobro cc
       ${sqlCertificacion("cuenta_cobro", "cc.id")}
       ${sqlLecturaValor("cuenta_cobro", "cc.id")}
       LEFT JOIN LATERAL (
         SELECT y.banco, y.tipo_cuenta, y.num_cuenta, y.certificada
           FROM cuentas_bancarias_proveedor y WHERE y.nit = cc.num_doc) cb ON TRUE
       -- Las MISMAS tarifas que usa la grilla de facturas: un proveedor no puede
       -- tener una retención distinta según por dónde entre su cobro.
       LEFT JOIN LATERAL (
         SELECT max(CASE WHEN tipo='ReteFuente' THEN tarifa END)::float::text AS ret_rf,
                max(CASE WHEN tipo='ReteIVA'    THEN tarifa END)::float::text AS ret_iva,
                max(CASE WHEN tipo='ReteICA'    THEN tarifa END)::float::text AS ret_ica
           FROM maestro_retenciones WHERE nit_proveedor = cc.num_doc) mr ON TRUE
       -- Lo que el equipo ya viene practicando para ESTE concepto. No lo aplica
       -- solo: lo SUGIERE en el modal, diciendo en cuántos casos se basa.
       LEFT JOIN LATERAL (
         SELECT r.retefuente::text, r.reteica::text, r.aplica, r.n_casos,
                r.concordancia::text, r.fuente
           FROM regla_retencion_concepto r WHERE r.concepto = cc.concepto) rc ON TRUE
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('tipo', tipo, 'estado', estado,
                            'enviado_en', enviado_en::text, 'error', left(error, 120))
                            ORDER BY id) AS lista
           FROM correo_saliente WHERE origen_tipo = 'cuenta_cobro' AND origen_id = cc.id) cor ON TRUE
      ORDER BY cc.creado_en DESC LIMIT 500`);
  // LOS MISMOS maestros que Conciliación y cotizaciones: un gasto no puede
  // tener concepto o destino distinto según por dónde entró al portal.
  const co = await pool.query<{ nombre: string }>("SELECT nombre FROM maestro_conceptos WHERE activo ORDER BY nombre");
  const de = await pool.query<{ nombre: string }>("SELECT nombre FROM maestro_destinos WHERE activo ORDER BY nombre");
  return { items: r.rows, conceptos: co.rows.map((x: { nombre: string }) => x.nombre), destinos: de.rows.map((x: { nombre: string }) => x.nombre) };
}

/** Por revisar en Colombia: el número del selector cuando se está mirando RD. */
async function contarCO(): Promise<number | undefined> {
  try {
    const { rows } = await getPool().query<{ n: number }>(
      "SELECT count(*)::int AS n FROM cuentas_cobro WHERE estado = 'recibida'");
    return rows[0]?.n;
  } catch {
    return undefined;
  }
}

export default async function CuentasCobroInboxPage({ searchParams }: { searchParams: Promise<{ pais?: string }> }) {
  const { rol } = await getCurrentUser();
  if (!puede(rol, "ver_intake")) redirect("/contabilidad/conciliacion");
  const verRD = puede(rol, "rd");
  const pais = verRD ? paisDe((await searchParams).pais) : "co";
  const rdPorRevisar = verRD ? await contarRD("recibida") : undefined;

  if (pais === "rd") {
    const selector = <SelectorPais base="/contabilidad/cuentas-de-cobro" pais="rd" conteo={{ co: await contarCO(), rd: rdPorRevisar }} />;
    try {
      const [items, origen] = await Promise.all([cargarCobrosRD(), origenPeticion()]);
      return (
        <div className="container">
          <h1>🧾 Cuentas de cobro</h1>
          {selector}
          <p className="sub">
            Envíos del formulario público <b>manelfoods.co/cuentas-de-cobro</b> con «República Dominicana». Los paga
            la <b>empresa de RD</b> ({empresaRD().nombre}), no ManelFoods: van por su propio carril y nunca entran al
            archivo de Davivienda ni a Siigo. Confirma retenciones y aprueba: al aprobar pasa a <b>Pagos › República Dominicana</b>.
          </p>
          <BandejaRD items={items} mesActual={mesRD()} origen={origen} modo="revision" />
        </div>
      );
    } catch (e) {
      return (
        <div className="container">
          <h1>🧾 Cuentas de cobro</h1>
          {selector}
          <p className="hint">No se pudo leer la base: {(e as Error).message}</p>
          <p className="hint">{AYUDA_SIN_TABLA}</p>
        </div>
      );
    }
  }

  // VER no es OPERAR: el contador entra a revisar y a poner retenciones,
  // pero aprobar —que es lo que manda la plata al banco— no es suyo.
  const operar = puede(rol, "intake");
  let data: { items: CuentaCobro[]; conceptos: string[]; destinos: string[] };
  try {
    data = await cargar();
  } catch (e) {
    return <div className="container"><h1>🧾 Cuentas de cobro</h1><p className="hint">No se pudo leer la base: {(e as Error).message}</p></div>;
  }
  const coPorRevisar = data.items.filter((i) => i.estado === "recibida").length;
  return (
    <div className="container">
      <h1>🧾 Cuentas de cobro</h1>
      {verRD && <SelectorPais base="/contabilidad/cuentas-de-cobro" pais="co" conteo={{ co: coPorRevisar, rd: rdPorRevisar }} />}
      <p className="sub">
        Envíos del formulario público <b>manelfoods.co/cuentas-de-cobro</b>. Revisa los documentos y aprueba:
        al aprobar pasa a <b>Pagos › Validación semana en curso</b> (bloque <i>sin factura DIAN</i>), a 30 días de su llegada.
      </p>
      <CuentasCobroView items={data.items} operar={operar}
                        conceptos={data.conceptos} destinos={data.destinos} />
    </div>
  );
}
