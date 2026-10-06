import { redirect } from "next/navigation";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { quincena as qQuincena, quincenas as qQuincenas } from "@/lib/rrhh/db";
import { guardarNovedad, borrarNovedad, aprobarQuincena, reabrirQuincena } from "@/lib/rrhh/actions";
import { cop, mm, hh, totalTrabajadas } from "@/lib/rrhh/motor";
import { TIPOS_NOVEDAD } from "@/lib/rrhh/catalogos";
import { fechaCorta, fechaLarga, hoyBogota, quincenaAnterior, quincenaDe, quincenaSiguiente, esFecha } from "@/lib/rrhh/fechas";
import { Head, Kpi, Pill, Nota, Aviso, Filtros, A } from "../_lib/ui";
import { conParams, ultimaQuincenaCerrada } from "../reportes/_periodo";
import { cargarNomina, snapshotDe } from "./_nomina";

export const dynamic = "force-dynamic";

/** Fecha (YYYY-MM-DD) de un timestamp de la base. */
const diaDe = (d: Date | string) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);

// NÓMINA QUINCENAL: salario FIJO del contrato (no horas × tarifa, que es lo que
// en Oak-Crew dejaba a la gente bajo medio mínimo) + recargos por las horas
// MARCADAS y aprobadas − descuentos − deducciones del empleado + novedades.
// Solo RRHH. Aprueba el decisor (admin); una quincena aprobada queda congelada.
export default async function Quincena({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  if (p.tipo === "colaborador") redirect("/nomina/mi-horario");
  if (p.tipo === "admin_punto") redirect("/nomina/reportes");
  const hoy = hoyBogota();
  const q = esFecha(sp.q) ? quincenaDe(sp.q) : ultimaQuincenaCerrada(hoy);
  const qa = quincenaAnterior(q), qs = quincenaSiguiente(q);
  const tiendaId = sp.t || undefined;
  const [N, estado, historial] = await Promise.all([cargarNomina(q, { tiendaId }), qQuincena(q.desde), qQuincenas()]);
  const { lineas, tot, novs, E, TS, nombreTienda, P } = N;
  const aprobada = estado?.estado === "aprobada";
  const terminada = q.hasta < hoy;
  const esAdmin = p.usuario.rol === "admin";
  const volver = conParams("/nomina/quincena", { q: q.desde, t: tiendaId });
  const nav = (desde: string) => conParams("/nomina/quincena", { q: desde, t: tiendaId });
  const nombreDe = (id: number) => E.find((e) => e.activo_id === id)?.nombre_completo ?? `#${id}`;
  const sinMarcar = lineas.filter((x) => x.l.alertas.length).length;
  return (
    <>
      <Head titulo="Nómina" sub={<>Quincena {fechaLarga(q.desde)} — {fechaLarga(q.hasta)} · {aprobada ? <Pill tono="ok">Aprobada {estado?.aprobada_en ? "· " + diaDe(estado.aprobada_en) : ""}</Pill> : <Pill tono="warn">Borrador</Pill>}{tiendaId && <> · {nombreTienda(tiendaId)}</>}</>}
        acts={<>
          <A className="btn ghost" href={nav(qa.desde)}>‹ Anterior</A>
          <A className="btn ghost" href={conParams("/nomina/quincena", { t: tiendaId })}>Última cerrada</A>
          <A className="btn ghost" href={nav(qs.desde)}>Siguiente ›</A>
          <A className="btn ghost" href={conParams("/nomina/quincena/export", { q: q.desde, t: tiendaId })}>Excel novedades (Siigo Nómina)</A>
          {aprobada ? null : (
            <form action={aprobarQuincena} style={{ display: "inline" }}>
              <input type="hidden" name="desde" value={q.desde} />
              <input type="hidden" name="snapshot" value={JSON.stringify(snapshotDe(lineas))} />
              <input type="hidden" name="total_neto" value={tot.neto} />
              <input type="hidden" name="total_costo" value={tot.costoEmpleador} />
              <input type="hidden" name="volver" value={volver} />
              <button type="submit" disabled={!terminada || !esAdmin || !!tiendaId}
                title={!terminada ? `Se aprueba cuando termine la quincena (${fechaCorta(q.hasta)}).` : tiendaId ? "Quita el filtro de tienda: la quincena se aprueba completa." : !esAdmin ? "La aprueba el decisor (admin)." : "Congela estas cifras y deja bitácora."}>
                {terminada ? "Aprobar quincena" : "Se aprueba al cierre"}
              </button>
            </form>
          )}
        </>} />
      <Aviso sp={sp} />
      {!aprobada && !terminada && <div className="nm-sub" style={{ marginBottom: 10 }}>La quincena termina el {fechaLarga(q.hasta)}: hasta entonces las cifras cambian con cada marcación aprobada.</div>}
      <Filtros>
        <input type="hidden" name="q" value={q.desde} />
        <select name="t" defaultValue={tiendaId ?? ""}><option value="">Todas las tiendas</option>{TS.filter((t) => t.activa || t.id === tiendaId).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select>
        <span className="sep" /><Pill tono="info">Origen: marcación aprobada</Pill>
      </Filtros>
      <div className="nm-kpis">
        <Kpi label="Total devengado" valor={mm(tot.devengado)} sub="básico + recargos − descuentos + transporte" />
        <Kpi label="Deducciones" valor={mm(tot.deducciones)} sub="salud 4 % + pensión 4 % + FSP" />
        <Kpi label="Novedades" valor={(tot.novedades >= 0 ? "+" : "−") + mm(Math.abs(tot.novedades))} sub={`${novs.length} registradas`} />
        <Kpi label="Neto a pagar" valor={mm(tot.neto)} tono="hl" />
        <Kpi label="Costo empleador" valor={mm(tot.costoEmpleador)} sub={`+ carga ${mm(P.tot.carga)}`} />
        <Kpi label="Sin marcación" valor={sinMarcar} tono={sinMarcar ? "warn" : "ok"} sub="personas con turnos sin marcar" />
      </div>
      <div className="nm-card nm-scroll">
        {lineas.length === 0 ? <div className="nm-vacio">Sin empleados en la quincena.</div> : (
        <table className="nm-tabla"><thead><tr><th>Empleado</th><th>Tienda</th><th className="num">Horas</th><th className="num">Básico</th><th className="num">Recargos</th><th className="num">Desc./aus.</th><th className="num">IBC</th><th className="num">Salud 4%</th><th className="num">Pensión 4%</th><th className="num">FSP</th><th className="num">Aux. transp.</th><th className="num">Novedades</th><th className="num">Neto</th><th>Alertas</th></tr></thead>
          <tbody>{lineas.map((x) => (<tr key={x.e.activo_id}>
            <td className="nm-nombre">{x.e.nombre_completo}{x.activos < P.fechas.length && <div className="nm-sub">{x.activos} de {P.fechas.length} días (prorrateado)</div>}</td>
            <td className="nm-sub">{nombreTienda(x.e.punto)}</td><td className="num">{hh(totalTrabajadas(x.l.horas))}</td><td className="num">{cop(x.basico)}</td><td className="num">{cop(x.recargos)}</td>
            <td className="num" title={[x.diasNoRem ? `${x.diasNoRem} día(s) no remunerados` : "", x.diasInc ? `${x.diasInc} día(s) de incapacidad (33,33 %)` : ""].filter(Boolean).join(" · ")}>{x.descuentos ? "−" + cop(x.descuentos) : "—"}</td>
            <td className="num">{cop(x.ibc)}</td><td className="num">{cop(x.salud)}</td><td className="num">{cop(x.pension)}</td><td className="num">{x.fsp ? cop(x.fsp) : "—"}</td><td className="num">{cop(x.auxilio)}</td>
            <td className="num">{x.novedades ? (x.novedades > 0 ? "+" : "−") + cop(Math.abs(x.novedades)) : "—"}</td><td className="num"><b>{cop(x.neto)}</b></td>
            <td>{x.l.alertas.length ? <Pill tono="warn">{x.l.alertas.length} sin marcar</Pill> : <Pill tono="ok">ok</Pill>}</td></tr>))}
            <tr className="tot"><td colSpan={3}>Total</td><td className="num">{cop(tot.basico)}</td><td className="num">{cop(tot.recargos)}</td><td className="num">{tot.descuentos ? "−" + cop(tot.descuentos) : "—"}</td><td className="num">{cop(tot.ibc)}</td><td className="num">{cop(tot.salud)}</td><td className="num">{cop(tot.pension)}</td><td className="num">{cop(tot.fsp)}</td><td className="num">{cop(tot.auxilio)}</td><td className="num">{cop(tot.novedades)}</td><td className="num">{cop(tot.neto)}</td><td /></tr></tbody></table>)}
      </div>
      <div className="nm-grid2">
        <div className="nm-card">
          <h3>Novedades de la quincena <small>{novs.length}</small></h3>
          {novs.length === 0 ? <div className="nm-vacio">Sin novedades registradas.</div> : (
          <table className="nm-tabla"><thead><tr><th>Tipo</th><th>Empleado</th><th>Descripción</th><th className="num">Valor</th><th /></tr></thead>
            <tbody>{novs.map((n) => (<tr key={n.id}><td className="nm-nombre">{n.tipo}</td><td className="nm-sub">{nombreDe(n.empleado_id)}</td><td className="nm-sub">{n.descripcion ?? "—"}</td><td className="num">{(n.valor > 0 ? "+" : "−") + cop(Math.abs(n.valor))}</td>
              <td>{!aprobada && (<form action={borrarNovedad}><input type="hidden" name="id" value={n.id} /><input type="hidden" name="volver" value={volver} /><button type="submit" className="danger" title="Borrar novedad">✕</button></form>)}</td></tr>))}</tbody></table>)}
          {!aprobada && (
            <form action={guardarNovedad} className="nm-form" style={{ marginTop: 12 }}>
              <input type="hidden" name="quincena" value={q.desde} />
              <input type="hidden" name="volver" value={volver} />
              <label>Empleado<select name="empleado_id" required><option value="">—</option>{E.map((e) => <option key={e.activo_id} value={e.activo_id}>{e.nombre_completo}</option>)}</select></label>
              <label>Tipo<select name="tipo" required>{TIPOS_NOVEDAD.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
              <label>Valor (+ suma, − descuenta)<input name="valor" type="number" step="1" required placeholder="-100000" /></label>
              <label className="full">Descripción<input name="descripcion" placeholder="Préstamo cuota 2/6" /></label>
              <div className="full"><button type="submit">+ Novedad</button></div>
            </form>
          )}
        </div>
        <div className="nm-card">
          <h3>Condiciones para aprobar</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.9 }}>
            <li>{terminada ? "✅" : "⏳"} La quincena terminó ({q.hasta}).</li>
            <li>{sinMarcar ? "⚠️" : "✅"} {sinMarcar ? `${sinMarcar} persona(s) con turnos sin marcación: esas jornadas no se pagan.` : "Todas las jornadas programadas tienen marcación."}</li>
            <li>✅ Las marcaciones fuera de radio deben estar revisadas (lo verifica la acción al aprobar).</li>
            <li>✅ Diferencia contra el motor de costos = $0 (misma fuente).</li>
            <li>{aprobada ? "✅" : "⏳"} Aprueba el decisor (admin). Queda en bitácora.</li>
          </ul>
          {aprobada && (
            <div style={{ marginTop: 12 }}>
              <div className="nm-sub">Aprobada por {estado?.aprobada_por ?? "—"} · neto {estado?.total_neto != null ? cop(estado.total_neto) : "—"} · costo {estado?.total_costo != null ? cop(estado.total_costo) : "—"}</div>
              {esAdmin && (
                <form action={reabrirQuincena} className="nm-inline" style={{ marginTop: 8 }}>
                  <input type="hidden" name="desde" value={q.desde} />
                  <input type="hidden" name="volver" value={volver} />
                  <input name="motivo" placeholder="Motivo de la reapertura" required minLength={5} />
                  <button type="submit" className="danger">Reabrir</button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="nm-card">
        <h3>Historial de quincenas</h3>
        {historial.length === 0 ? <div className="nm-vacio">Ninguna quincena aprobada todavía.</div> : (
        <table className="nm-tabla"><thead><tr><th>Quincena</th><th>Estado</th><th>Aprobó</th><th className="num">Neto</th><th className="num">Costo empleador</th></tr></thead>
          <tbody>{historial.map((h) => (<tr key={h.desde}><td className="nm-nombre"><A href={nav(h.desde)}>{fechaCorta(h.desde)} – {fechaCorta(h.hasta)} {h.desde.slice(0, 4)}</A></td><td>{h.estado === "aprobada" ? <Pill tono="ok">aprobada</Pill> : <Pill tono="warn">borrador</Pill>}</td><td className="nm-sub">{h.aprobada_por ?? "—"}{h.aprobada_en ? " · " + diaDe(h.aprobada_en) : ""}</td><td className="num">{h.total_neto != null ? cop(h.total_neto) : "—"}</td><td className="num">{h.total_costo != null ? cop(h.total_costo) : "—"}</td></tr>))}</tbody></table>)}
      </div>
      <Nota><b>Diferencia clave con Oak-Crew:</b> el básico es el salario del contrato ÷ 2, no horas planeadas × tarifa. Las horas solo suman recargos y extras. IBC sin auxilio; FSP sobre 4 SMLMV; incapacidad al 66,67 %; descansos y ausencias remuneradas dentro del básico; las no remuneradas descuentan salario/30 por día hábil. La salida es el <b>Excel de novedades</b> que Siigo Nómina importa (no tiene API).</Nota>
    </>
  );
}
