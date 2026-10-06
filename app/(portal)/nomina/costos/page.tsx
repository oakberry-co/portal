import { redirect } from "next/navigation";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { TIPOS, CARGA, reglasEn, cop, mm, hh, totalTrabajadas, EXONERA_1607 } from "@/lib/rrhh/motor";
import { fechaLarga, fechaCorta, hoyBogota, quincenaAnterior, quincenaSiguiente } from "@/lib/rrhh/fechas";
import { Head, Kpi, Nota, Aviso, Filtros, Pill, A } from "../_lib/ui";
import { cargarPeriodo, origenDe, quincenaDeUrl, conParams } from "../reportes/_periodo";

export const dynamic = "force-dynamic";

// COSTOS LABORALES: costo empleador completo, por quincena, por tipo y por
// persona. Solo RRHH: el administrador de punto ve horas (Reportes), no plata.
export default async function Costos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  if (p.tipo === "colaborador") redirect("/nomina/mi-horario");
  if (p.tipo === "admin_punto") redirect("/nomina/reportes");
  const hoy = hoyBogota();
  const q = quincenaDeUrl(sp.q, hoy);
  const qa = quincenaAnterior(q), qs = quincenaSiguiente(q);
  const tiendaId = sp.t || undefined;
  const origen = origenDe(sp.o);
  // El comparativo se calcula con el MISMO origen: real contra real, plan contra plan.
  const [{ P, TS, nombreTienda }, { P: A_ }] = await Promise.all([
    cargarPeriodo(q.desde, q.hasta, { tiendaId }, origen),
    cargarPeriodo(qa.desde, qa.hasta, { tiendaId }, origen),
  ]);
  const r = reglasEn(q.hasta);
  const d = (a: number, b: number) => (b ? ((a - b) / b * 100).toFixed(1) + "%" : "—");
  const filas: [string, number, number][] = [
    ["Salario", P.tot.salarial + P.tot.recargos, A_.tot.salarial + A_.tot.recargos], ["Transporte", P.tot.auxilio, A_.tot.auxilio],
    ["Seguridad social", P.tot.salud + P.tot.pension + P.tot.arl, A_.tot.salud + A_.tot.pension + A_.tot.arl],
    ["Parafiscales", P.tot.caja + P.tot.sena + P.tot.icbf, A_.tot.caja + A_.tot.sena + A_.tot.icbf],
    ["Prestaciones", P.tot.cesantias + P.tot.intCesantias + P.tot.prima + P.tot.vacaciones, A_.tot.cesantias + A_.tot.intCesantias + A_.tot.prima + A_.tot.vacaciones],
  ];
  const max = Math.max(1, ...Object.values(P.porTienda).map((v) => v.total));
  const nav = (desde: string) => conParams("/nomina/costos", { q: desde, t: tiendaId, o: origen });
  const lineas = [...P.lineas].sort((a, b) => b.costo.total - a.costo.total);
  return (
    <>
      <Head titulo="Costos laborales" sub={<>Desglose de nómina, recargos y carga prestacional · {fechaLarga(q.desde)} — {fechaLarga(q.hasta)} · <Pill tono={origen === "real" ? "info" : "gris"}>{origen === "real" ? "marcación aprobada" : "planeado"}</Pill></>}
        acts={<>
          <A className="btn ghost" href={nav(qa.desde)}>‹ Anterior</A>
          <A className="btn ghost" href={conParams("/nomina/costos", { t: tiendaId, o: origen })}>En curso</A>
          <A className="btn ghost" href={nav(qs.desde)}>Siguiente ›</A>
          <A className="btn ghost" href={conParams("/nomina/costos/export", { q: q.desde, t: tiendaId, o: origen })}>Descargar</A>
        </>} />
      <Aviso sp={sp} />
      <Filtros>
        <input type="hidden" name="q" value={q.desde} />
        <select name="t" defaultValue={tiendaId ?? ""}><option value="">Todas las ubicaciones</option>{TS.filter((t) => t.activa || t.id === tiendaId).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select>
        <select name="o" defaultValue={origen}><option value="real">Solo marcados (real)</option><option value="plan">Solo planeados</option></select>
      </Filtros>
      <div className="nm-kpis">
        <Kpi label="Costo total nómina" valor={mm(P.tot.total)} sub="salarios + transporte + carga" tono="hl" />
        <Kpi label="Costo salarial" valor={mm(P.tot.salarial)} sub={`${hh(totalTrabajadas(P.horas))} trabajadas`} />
        <Kpi label="Total recargos" valor={mm(P.tot.recargos)} sub={P.tot.salarial ? `${Math.round(P.tot.recargos / P.tot.salarial * 100)}% del salarial` : "—"} />
        <Kpi label="Auxilio transporte" valor={mm(P.tot.auxilio)} sub={`tope ${cop(r.auxilio / 2)}/quincena`} />
        <Kpi label="Carga prestacional" valor={mm(P.tot.carga)} sub="SS + parafiscales + prestaciones" />
        <Kpi label="Descansos" valor={mm(P.lineas.reduce((a, l) => a + l.costo.porTipo.descanso, 0))} sub={`${hh(P.horas.descanso)} · tarifa base`} />
        {origen === "real" && <Kpi label="Días sin marcación" valor={P.tot.alertas} tono={P.tot.alertas ? "warn" : "ok"} sub="turnos programados que no se pagan" />}
      </div>
      <div className="nm-grid2">
        <div className="nm-card">
          <h3>Costos de empleador (carga prestacional)</h3>
          <table className="nm-tabla"><tbody>
            <tr><td className="nm-nombre">Seguridad social</td><td className="nm-sub">Salud {CARGA.salud}% {EXONERA_1607 && "(exonerada <10 SMLMV)"} · Pensión {CARGA.pension}% · ARL {CARGA.arl}%</td><td className="num"><b>{cop(P.tot.salud + P.tot.pension + P.tot.arl)}</b></td></tr>
            <tr><td className="nm-nombre">Parafiscales</td><td className="nm-sub">Caja {CARGA.caja}% · SENA {CARGA.sena}% y ICBF {CARGA.icbf}% {EXONERA_1607 && "(exonerados)"}</td><td className="num"><b>{cop(P.tot.caja + P.tot.sena + P.tot.icbf)}</b></td></tr>
            <tr><td className="nm-nombre">Prestaciones</td><td className="nm-sub">Cesantías {CARGA.cesantias}% + int. {CARGA.intCesantias}% + prima {CARGA.prima}% (con aux.) · vacaciones {CARGA.vacaciones}%</td><td className="num"><b>{cop(P.tot.cesantias + P.tot.intCesantias + P.tot.prima + P.tot.vacaciones)}</b></td></tr>
            <tr className="tot"><td colSpan={2}>Carga total</td><td className="num">{cop(P.tot.carga)}</td></tr>
          </tbody></table>
          <div className="nm-sub" style={{ marginTop: 8 }}>Ley 1607/2012: salarios bajo 10 SMLMV exoneran salud (8,5 %), SENA e ICBF. Oak-Crew los cobra a todos y sobrestima ~13,5 % del salarial.</div>
        </div>
        <div className="nm-card">
          <h3>Comparativo <small>quincena anterior ({fechaCorta(qa.desde)} – {fechaCorta(qa.hasta)}, mismo origen)</small></h3>
          <table className="nm-tabla"><thead><tr><th>Categoría</th><th className="num">Anterior</th><th className="num">Actual</th><th className="num">Δ</th></tr></thead>
            <tbody>{filas.map(([n, a, b]) => <tr key={n}><td className="nm-nombre">{n}</td><td className="num">{cop(b)}</td><td className="num">{cop(a)}</td><td className="num" style={{ color: a >= b ? "var(--danger)" : "var(--ok)" }}>{d(a, b)}</td></tr>)}
              <tr className="tot"><td>Total</td><td className="num">{cop(A_.tot.total)}</td><td className="num">{cop(P.tot.total)}</td><td className="num">{d(P.tot.total, A_.tot.total)}</td></tr></tbody></table>
        </div>
      </div>
      <div className="nm-grid2">
        <div className="nm-card">
          <h3>Detalle por tipo de hora</h3>
          <table className="nm-tabla"><thead><tr><th>Tipo</th><th className="num">Horas</th><th className="num">Recargo</th><th className="num">Costo</th></tr></thead>
            <tbody>{TIPOS.map((t) => { const v = P.lineas.reduce((a, l) => a + l.costo.porTipo[t.id], 0); return <tr key={t.id}><td className="nm-nombre">{t.label}</td><td className="num">{hh(P.horas[t.id])}</td><td className="num">{t.id === "descanso" || t.id === "ausencia" ? "base" : `+${r.recargo[t.id]}%`}</td><td className="num"><b>{cop(v)}</b></td></tr>; })}</tbody></table>
        </div>
        <div className="nm-card">
          <h3>Costo por tienda</h3>
          {Object.keys(P.porTienda).length === 0 ? <div className="nm-vacio">Sin empleados en la quincena.</div> :
          Object.entries(P.porTienda).sort((a, b) => b[1].total - a[1].total).map(([id, v]) => (
            <div className="nm-hbar" key={id}><span>{nombreTienda(id)}<div className="nm-sub">{v.n} pers · {hh(totalTrabajadas(v.horas))}</div></span><div className="b"><span style={{ width: `${v.total / max * 100}%`, background: "var(--purple)" }} /></div><span className="v">{mm(v.total)}</span></div>
          ))}
        </div>
      </div>
      <div className="nm-card nm-scroll">
        <h3>Costo por empleado</h3>
        {lineas.length === 0 ? <div className="nm-vacio">Sin empleados en la quincena.</div> : (
        <table className="nm-tabla"><thead><tr><th>Empleado</th><th>Tienda</th><th className="num">Horas</th><th className="num">$/hora</th><th className="num">Salarial</th><th className="num">Recargos</th><th className="num">Transporte</th><th className="num">Seg. social</th><th className="num">Parafisc.</th><th className="num">Prestac.</th><th className="num">Total</th><th>Alertas</th></tr></thead>
          <tbody>{lineas.map((l) => (<tr key={l.e.activo_id}><td className="nm-nombre">{l.e.nombre_completo}</td><td className="nm-sub">{nombreTienda(l.e.punto)}</td><td className="num">{hh(totalTrabajadas(l.horas))}</td><td className="num">{cop(l.costo.valorHora)}</td><td className="num">{cop(l.costo.salarial)}</td><td className="num">{cop(l.costo.recargos)}</td><td className="num">{cop(l.costo.auxilio)}</td><td className="num">{cop(l.costo.salud + l.costo.pension + l.costo.arl)}</td><td className="num">{cop(l.costo.caja + l.costo.sena + l.costo.icbf)}</td><td className="num">{cop(l.costo.cesantias + l.costo.intCesantias + l.costo.prima + l.costo.vacaciones)}</td><td className="num"><b>{cop(l.costo.total)}</b></td><td>{l.alertas.length ? <Pill tono="warn" >{l.alertas.length} sin marcación</Pill> : "—"}</td></tr>))}
            <tr className="tot"><td colSpan={4}>Total</td><td className="num">{cop(P.tot.salarial)}</td><td className="num">{cop(P.tot.recargos)}</td><td className="num">{cop(P.tot.auxilio)}</td><td className="num">{cop(P.tot.salud + P.tot.pension + P.tot.arl)}</td><td className="num">{cop(P.tot.caja + P.tot.sena + P.tot.icbf)}</td><td className="num">{cop(P.tot.cesantias + P.tot.intCesantias + P.tot.prima + P.tot.vacaciones)}</td><td className="num">{cop(P.tot.total)}</td><td /></tr></tbody></table>)}
      </div>
      <Nota>Hora = salario real del contrato ÷ <b>{r.divisor} h</b> (vigente desde {r.desde}) → {cop(Math.round(r.smlmv / r.divisor))}/h con el SMLMV. Auxilio {cop(r.auxilio)}/mes hasta 2 SMLMV, tope {cop(r.auxilio / 2)}/quincena, prorrateado para tiempo parcial. El costo de esta quincena es, por construcción, lo que suma en Reportes y en Nómina.</Nota>
    </>
  );
}
