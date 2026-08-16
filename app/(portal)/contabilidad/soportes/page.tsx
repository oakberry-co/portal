import { getPool } from "@/lib/db";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";

export const dynamic = "force-dynamic";

// El archivo de compras en Drive (COMPRAS/AÑO/MES/DESTINO) traído al portal por
// `scripts/ingest_soportes_drive.py`. Esta página responde 3 preguntas:
//   1. ¿qué tan cubierto está cada mes? (soporte enlazado vs factura sin PDF)
//   2. ¿qué PDFs quedaron huérfanos? (los que hay que revisar a mano)
//   3. ¿dónde la carpeta y el portal se contradicen en el destino?
// No escribe nada: es el tablero de control de la ingesta.

type Mes = {
  anio: number; mes: number;
  archivos: number; enlazados: number; media: number; huerfanos: number;
  facturas_mes: number; facturas_con_soporte: number;
};
type Huerfano = {
  drive_nombre: string; drive_url: string; drive_path: string;
  anio: number; mes: number; doc_tipo: string | null; match_nota: string | null;
};
type Discrepancia = {
  cufe: string; numero: string; nombre_proveedor: string | null;
  destino_portal: string | null; destino_drive: string | null;
  drive_url: string | null;
};
type SinRuta = { nombre: string; short_code: string | null; facturas: number };

const MESES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
               "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const pct = (x: number, n: number) => (n ? Math.round((100 * x) / n) : 0);
const heat = (p: number) => (p >= 85 ? "hi" : p >= 60 ? "mid" : "lo");

async function cargar() {
  const pool = getPool();
  const meses = await pool.query<Mes>(`
    WITH s AS (
      SELECT anio, mes,
             count(*)::int                                             AS archivos,
             count(*) FILTER (WHERE match_confianza = 'alta')::int      AS enlazados,
             count(*) FILTER (WHERE match_confianza = 'media')::int     AS media,
             count(*) FILTER (WHERE match_confianza = 'huerfano')::int  AS huerfanos
        FROM factura_soportes GROUP BY anio, mes
    ),
    -- La otra cara (Regla 2: mirar los DOS lados del cruce): facturas emitidas en
    -- el mes que ningún PDF del archivo de compras respalda.
    f AS (
      SELECT EXTRACT(YEAR FROM fecha_emision)::int AS anio,
             EXTRACT(MONTH FROM fecha_emision)::int AS mes,
             count(*)::int AS facturas_mes,
             count(*) FILTER (
               WHERE EXISTS (SELECT 1 FROM factura_soportes x WHERE x.cufe = facturas.cufe)
             )::int AS facturas_con_soporte
        FROM facturas GROUP BY 1, 2
    )
    SELECT s.anio, s.mes, s.archivos, s.enlazados, s.media, s.huerfanos,
           COALESCE(f.facturas_mes, 0) AS facturas_mes,
           COALESCE(f.facturas_con_soporte, 0) AS facturas_con_soporte
      FROM s LEFT JOIN f USING (anio, mes)
     ORDER BY s.anio DESC, s.mes DESC`);

  const huerfanos = await pool.query<Huerfano>(`
    SELECT drive_nombre, drive_url, drive_path, anio, mes, doc_tipo, match_nota
      FROM factura_soportes
     WHERE match_confianza = 'huerfano'
     ORDER BY anio DESC, mes DESC, drive_path, drive_nombre
     LIMIT 400`);

  const discrepancias = await pool.query<Discrepancia>(`
    SELECT f.cufe, f.numero, f.nombre_proveedor,
           v.destino_portal, v.destino_drive, v.soporte_url AS drive_url
      FROM v_factura_soportes v
      JOIN facturas f USING (cufe)
     WHERE v.destino_discrepa
     ORDER BY f.fecha_emision DESC
     LIMIT 200`);

  // La tarea humana pendiente: un destino sin `drive_carpeta` no se puede
  // archivar solo. Se lista con cuántas facturas cuelgan de él, para priorizar.
  const sinRuta = await pool.query<SinRuta>(`
    SELECT d.nombre, d.short_code, count(e.cufe)::int AS facturas
      FROM maestro_destinos d
      LEFT JOIN factura_estado e ON upper(e.destino) = upper(d.nombre)
     WHERE d.activo AND d.drive_carpeta IS NULL
     GROUP BY d.nombre, d.short_code
    HAVING count(e.cufe) > 0
     ORDER BY count(e.cufe) DESC`);

  return { meses: meses.rows, huerfanos: huerfanos.rows,
           discrepancias: discrepancias.rows, sinRuta: sinRuta.rows };
}

export default async function SoportesPage() {
  const { rol } = await getCurrentUser();
  if (!puede(rol, "ver_conciliacion")) redirect("/contabilidad/conciliacion");

  let datos: Awaited<ReturnType<typeof cargar>>;
  try {
    datos = await cargar();
  } catch (e) {
    return (
      <div className="container">
        <h1>📎 Soportes</h1>
        <p className="hint">No se pudo leer la base: {(e as Error).message}</p>
      </div>
    );
  }
  const { meses, huerfanos, discrepancias, sinRuta } = datos;

  if (!meses.length) {
    return (
      <div className="container">
        <h1>📎 Soportes</h1>
        <p className="sub">Todavía no se ha ingerido ningún mes del Drive de compras.</p>
        <pre className="sop-cmd">python3 scripts/ingest_soportes_drive.py --mes 2026-08 --commit --sembrar-destino</pre>
      </div>
    );
  }

  const T = meses.reduce((a, m) => ({
    archivos: a.archivos + m.archivos, enlazados: a.enlazados + m.enlazados,
    huerfanos: a.huerfanos + m.huerfanos,
    facturas: a.facturas + m.facturas_mes, conSoporte: a.conSoporte + m.facturas_con_soporte,
  }), { archivos: 0, enlazados: 0, huerfanos: 0, facturas: 0, conSoporte: 0 });

  return (
    <div className="container">
      <h1>📎 Soportes</h1>
      <p className="sub">
        El árbol de Drive (<code>COMPRAS / AÑO / MES / DESTINO</code>) y el portal, en los dos sentidos.
        Lo que compras archiva a mano <b>entra</b> y aparece como 📎 en Conciliación; y lo que el equipo
        <b> clasifica</b> en el portal <b>se archiva solo</b> en la carpeta de su destino, con el nombre de
        siempre. Clasificar es archivar: ya no hay que guardar el PDF aparte.
        Lo <b>huérfano</b> no es un error — casi siempre son cuentas de cobro, importaciones o documentos
        que nunca pasaron por la DIAN.
      </p>

      {sinRuta.length > 0 && (
        <div className="sop-tarea">
          <b>⚠️ {sinRuta.length} destinos no tienen carpeta asignada</b> — sus facturas se clasifican
          pero <b>no se archivan solas</b>, porque nadie ha dicho a qué carpeta van. Se arregla en{" "}
          <a href="/contabilidad/maestros">Maestros</a>, poniéndoles la carpeta (o unificándolos con el
          destino que ya la tiene).
          <div className="sop-tarea-lista">
            {sinRuta.map((d) => (
              <span key={d.nombre} className="tag-sr">
                {d.nombre}{d.short_code ? ` (${d.short_code})` : ""} · <b>{d.facturas}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="dsh-cards">
        <div className="dsh-card"><i>PDFs en Drive</i><b>{T.archivos.toLocaleString("es-CO")}</b><span>{meses.length} meses ingeridos</span></div>
        <div className="dsh-card hl"><i>Enlazados</i><b>{pct(T.enlazados, T.archivos)}%</b><span>{T.enlazados.toLocaleString("es-CO")} con su factura</span></div>
        <div className="dsh-card"><i>Huérfanos</i><b>{T.huerfanos.toLocaleString("es-CO")}</b><span>PDF sin factura DIAN</span></div>
        <div className="dsh-card"><i>Facturas con soporte</i><b>{pct(T.conSoporte, T.facturas)}%</b><span>de {T.facturas.toLocaleString("es-CO")} facturas</span></div>
      </div>

      <h2 className="sop-h2">Cobertura por mes</h2>
      <div className="dsh-wrap">
        <table className="dsh-tabla">
          <thead><tr>
            <th>Mes</th><th className="num">PDFs</th><th className="num">Enlazados</th>
            <th className="num">Huérfanos</th><th className="num">Facturas del mes</th>
            <th className="num">Con soporte</th>
          </tr></thead>
          <tbody>
            {meses.map((m) => {
              const pEnl = pct(m.enlazados + m.media, m.archivos);
              const pSop = pct(m.facturas_con_soporte, m.facturas_mes);
              return (
                <tr key={`${m.anio}-${m.mes}`}>
                  <td>{MESES[m.mes]} {m.anio}</td>
                  <td className="num">{m.archivos}</td>
                  <td className={"num heat " + heat(pEnl)} title={m.media ? `${m.media} por número único (sin confirmar)` : ""}>{pEnl}%</td>
                  <td className="num">{m.huerfanos}</td>
                  <td className="num">{m.facturas_mes}</td>
                  <td className={"num heat " + heat(pSop)} title={`${m.facturas_mes - m.facturas_con_soporte} facturas sin PDF de compras`}>{pSop}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {discrepancias.length > 0 && (
        <>
          <h2 className="sop-h2">⚠️ Destino en disputa <span className="sop-n">{discrepancias.length}</span></h2>
          <p className="mst-hint">
            La carpeta de Drive y el portal dicen cosas distintas. <b>Nada se tocó</b>: lo que un humano
            confirmó manda. Suele ser legítimo — un gasto transversal (Toteat, arriendo) que compras
            archiva copiando el PDF en la carpeta de cada tienda.
          </p>
          <div className="dsh-wrap">
            <table className="dsh-tabla">
              <thead><tr><th>Factura</th><th>Proveedor</th><th>Dice el portal</th><th>Dice la carpeta</th><th /></tr></thead>
              <tbody>
                {discrepancias.map((d) => (
                  <tr key={d.cufe}>
                    <td className="mono">{d.numero}</td>
                    <td>{d.nombre_proveedor ?? "—"}</td>
                    <td>{d.destino_portal ?? "—"}</td>
                    <td className="mono">{d.destino_drive ?? "—"}</td>
                    <td>{d.drive_url && <a className="ic sop" href={d.drive_url} target="_blank" rel="noopener noreferrer">📎</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {huerfanos.length > 0 && (
        <>
          <h2 className="sop-h2">PDFs sin factura <span className="sop-n">{huerfanos.length}</span></h2>
          <p className="mst-hint">
            Revísalos: si alguno SÍ debería estar en el portal, es una <b>fuga de captura</b> (llegó a
            compras pero no al buzón DIAN).
          </p>
          <div className="dsh-wrap">
            <table className="dsh-tabla">
              <thead><tr><th>Mes</th><th>Carpeta</th><th>Tipo</th><th>Archivo</th><th>Por qué</th></tr></thead>
              <tbody>
                {huerfanos.map((h) => (
                  <tr key={h.drive_url}>
                    <td className="muted">{MESES[h.mes]?.slice(0, 3)} {h.anio}</td>
                    <td className="mono">{h.drive_path || "—"}</td>
                    <td className="mono">{h.doc_tipo ?? "—"}</td>
                    <td><a href={h.drive_url} target="_blank" rel="noopener noreferrer">{h.drive_nombre}</a></td>
                    <td className="muted">{h.match_nota ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="chain-note">
        Se actualiza corriendo <code>scripts/ingest_soportes_drive.py --mes AAAA-MM --commit --sembrar-destino</code>
        {" "}en la VM (cron mensual). Es idempotente: re-correrlo no duplica ni pisa lo humano — solo escribe
        destino donde estaba vacío, marcándolo <code>fuente=drive</code>.
      </p>
    </div>
  );
}
