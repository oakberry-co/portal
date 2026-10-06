import { redirect } from "next/navigation";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { ventasPorTienda } from "@/lib/rrhh/db";
import { mm, cop, hh, totalTrabajadas } from "@/lib/rrhh/motor";
import { fechaCorta, fechaLarga, hoyBogota, mas, mesDe, MESES, quincenaAnterior, quincenaDe, quincenaSiguiente, esFecha } from "@/lib/rrhh/fechas";
import { Head, Kpi, Pill, Nota, Tabs, Aviso, Filtros, A } from "../_lib/ui";
import { cargarPeriodo, conParams, ultimaQuincenaCerrada } from "../reportes/_periodo";

export const dynamic = "force-dynamic";

// Ventas de referencia (16–30 sep 2026, sin IVA) para cuando el sync del DW
// todavía no ha dejado nada en rrhh_ventas_dia. Se avisa en pantalla.
const VENTAS_REFERENCIA: Record<string, number> = {
  "CALLE 109": 53_300_000, "UNICENTRO": 51_300_000, "COLINA": 49_200_000, "ZONA T": 45_100_000, "ZONA G": 33_700_000, "CALLE 76": 23_300_000,
  "ANDINO": 22_800_000, "MALOKA": 11_900_000, "TITAN PLAZA": 9_400_000, "PLAZA CLARO": 8_700_000, "VIVA": 5_700_000, "CALLE 140": 0,
};

// DASHBOARD FINANCIERO: costo laboral vs VENTAS (del DW, no de llaves Toteat
// en la app). Es la pieza del P&L diario que Oak-Crew nunca llenó.
// La quincena cerrada se mira con origen REAL (lo marcado); la proyección del
// mes en curso con PLAN (los turnos publicados).
export default async function Financiero({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  if (p.tipo === "colaborador") redirect("/nomina/mi-horario");
  if (p.tipo === "admin_punto") redirect("/nomina/reportes");
  const hoy = hoyBogota();
  const q = esFecha(sp.q) ? quincenaDe(sp.q) : ultimaQuincenaCerrada(hoy);
  const qa = quincenaAnterior(q), qs = quincenaSiguiente(q);
  const tiendaId = sp.t || undefined;
  const m = mesDe(hoy);
  const [{ P, TS, nombreTienda }, { P: M }, { P: EJ }, ventasDw] = await Promise.all([
    cargarPeriodo(q.desde, q.hasta, { tiendaId }, "real"),
    cargarPeriodo(m.desde, m.hasta, { tiendaId }, "plan"),
    cargarPeriodo(m.desde, mas(hoy, -1) < m.desde ? m.desde : mas(hoy, -1), { tiendaId }, "real"),
    ventasPorTienda(q.desde, q.hasta),
  ]);
  const sinSync = Object.keys(ventasDw).length === 0;
  const ventasTodas = sinSync ? VENTAS_REFERENCIA : ventasDw;
  const ventasMap = tiendaId ? { [tiendaId]: ventasTodas[tiendaId] ?? 0 } : ventasTodas;
  const ventas = Object.values(ventasMap).reduce((a, b) => a + b, 0);
  const trab = totalTrabajadas(P.horas);
  const pct = ventas ? P.tot.total / ventas * 100 : null;
  // Tiendas con costo o con venta: una tienda con venta y sin gente también debe verse.
  const ids = [...new Set([...Object.keys(P.porTienda), ...Object.keys(ventasMap).filter((k) => ventasMap[k] > 0)])];
  const filas = ids.map((id) => { const v = P.porTienda[id]; return { id, costo: v?.total ?? 0, venta: ventasMap[id] ?? 0, horas: v ? totalTrabajadas(v.horas) : 0, n: v?.n ?? 0 }; }).sort((a, b) => b.venta - a.venta);
  const tono = (x: number) => (x <= 18 ? "ok" : x <= 25 ? "warn" : "bad");
  // Forecast de venta del mes: no hay sync del forecast del DW en esta app, así
  // que se toma la quincena de referencia × 2 (dos quincenas al mismo ritmo).
  const ventaMesProy = ventas * 2;
  // Provisiones: la prima del semestre y las prestaciones del año se aproximan
  // como la provisión de ESTA quincena × quincenas transcurridas (del semestre
  // o del año) hasta la quincena mirada, ambas incluidas.
  const anio = q.desde.slice(0, 4), semIni = q.desde.slice(5, 7) <= "06" ? `${anio}-01-01` : `${anio}-07-01`;
  const nQ = (desde: string) => { let n = 0; for (let x = quincenaDe(desde); x.desde <= q.desde; x = quincenaSiguiente(x)) n++; return n; };
  const qSem = nQ(semIni), qAnio = nQ(`${anio}-01-01`), mesesAnio = Number(q.hasta.slice(5, 7));
  const prima = P.tot.prima * qSem, cesantias = P.tot.cesantias * qAnio, intCes = cesantias * 0.12 * mesesAnio / 12, vacaciones = P.tot.vacaciones * qAnio;
  const nav = (desde: string) => conParams("/nomina/financiero", { q: desde, t: tiendaId });
  return (
    <>
      <Head titulo="Dashboard financiero" sub={<>Costo laboral contra ventas sin IVA · quincena <b>{fechaCorta(q.desde)} – {fechaCorta(q.hasta)} {q.desde.slice(0, 4)}</b>{q.hasta >= hoy ? <> · <Pill tono="warn">quincena en curso</Pill></> : " (cerrada)"}</>}
        acts={<>
          <A className="btn ghost" href={nav(qa.desde)}>‹ Anterior</A>
          <A className="btn ghost" href={conParams("/nomina/financiero", { t: tiendaId })}>Última cerrada</A>
          <A className="btn ghost" href={nav(qs.desde)}>Siguiente ›</A>
        </>} />
      <Aviso sp={sp} />
      {sinSync && <div className="nm-aviso err">Ventas de referencia 16–30 sep 2026, sin sync del DW (rrhh_ventas_dia vacía para esta quincena).</div>}
      <Tabs items={[{ href: "/nomina/financiero", label: "Resumen" }, { href: "/nomina/financiero#tienda", label: "Por tienda" }, { href: "/nomina/financiero#proy", label: "Proyección" }, { href: "/nomina/financiero#prov", label: "Provisiones" }]} actual="/nomina/financiero" />
      <Filtros>
        <input type="hidden" name="q" value={q.desde} />
        <select name="t" defaultValue={tiendaId ?? ""}><option value="">Todas las tiendas</option>{TS.filter((t) => t.activa || t.id === tiendaId).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select>
      </Filtros>
      <div className="nm-kpis">
        <Kpi label="Ventas sin IVA" valor={mm(ventas)} sub={sinSync ? "referencia sep-2026" : "analytics.ventas_diarias (DW)"} />
        <Kpi label="Costo laboral" valor={mm(P.tot.total)} sub="salarios + transporte + carga · marcación aprobada" />
        <Kpi label="% costo / venta" valor={pct == null ? "—" : pct.toFixed(1) + "%"} sub="meta ≤ 18 %" tono={pct == null ? undefined : tono(pct)} />
        <Kpi label="Venta por hora-persona" valor={trab ? cop(Math.round(ventas / trab)) : "—"} sub={`${hh(trab)} trabajadas`} />
        <Kpi label="Costo mes en curso" valor={mm(M.tot.total)} sub={`planeado · ${MESES[Number(hoy.slice(5, 7)) - 1]} · ejecutado ${mm(EJ.tot.total)}`} />
      </div>
      <div className="nm-card nm-scroll" id="tienda">
        <h3>Por tienda <small>costo laboral vs venta</small></h3>
        {filas.length === 0 ? <div className="nm-vacio">Sin costo ni ventas en la quincena.</div> : (
        <table className="nm-tabla"><thead><tr><th>Tienda</th><th className="num">Personas</th><th className="num">Horas</th><th className="num">Venta</th><th className="num">Costo laboral</th><th className="num">% costo/venta</th><th className="num">Venta / h-persona</th><th>Semáforo</th></tr></thead>
          <tbody>{filas.map((f) => { const x = f.venta ? f.costo / f.venta * 100 : null; return (
            <tr key={f.id}><td className="nm-nombre">{nombreTienda(f.id)}</td><td className="num">{f.n}</td><td className="num">{hh(f.horas)}</td><td className="num">{mm(f.venta)}</td><td className="num">{mm(f.costo)}</td><td className="num"><b>{x == null ? "—" : x.toFixed(1) + "%"}</b></td><td className="num">{f.venta && f.horas ? cop(Math.round(f.venta / f.horas)) : "—"}</td><td>{x == null ? <Pill tono="gris">sin venta</Pill> : <Pill tono={tono(x)}>{tono(x) === "ok" ? "sano" : tono(x) === "warn" ? "vigilar" : "pierde"}</Pill>}</td></tr>); })}
            <tr className="tot"><td>Total</td><td className="num">{P.lineas.length}</td><td className="num">{hh(trab)}</td><td className="num">{mm(ventas)}</td><td className="num">{mm(P.tot.total)}</td><td className="num">{pct == null ? "—" : pct.toFixed(1) + "%"}</td><td className="num">{trab ? cop(Math.round(ventas / trab)) : "—"}</td><td /></tr></tbody></table>)}
        <div className="nm-sub" style={{ marginTop: 8 }}>Regla de la casa: bajo ~35 MM/mes de venta la tienda pierde plata; el % de personal es el primer dial.</div>
      </div>
      <div className="nm-grid2">
        <div className="nm-card" id="proy">
          <h3>Proyección {MESES[Number(hoy.slice(5, 7)) - 1]} <small>desde los turnos (plan)</small></h3>
          <table className="nm-tabla"><tbody>
            <tr><td className="nm-nombre">Costo planeado del mes</td><td className="num"><b>{mm(M.tot.total)}</b></td></tr>
            <tr><td className="nm-nombre">Ejecutado (marcado y aprobado, al {Number(hoy.slice(8))} del mes)</td><td className="num">{mm(EJ.tot.total)}</td></tr>
            <tr><td className="nm-nombre">Venta del mes estimada <span className="nm-sub">(2 × la quincena mirada)</span></td><td className="num">{mm(ventaMesProy)}</td></tr>
            <tr className="tot"><td>% costo / venta proyectado</td><td className="num">{ventaMesProy ? (M.tot.total / ventaMesProy * 100).toFixed(1) + "%" : "—"}</td></tr>
          </tbody></table>
        </div>
        <div className="nm-card" id="prov">
          <h3>Provisiones <small>acumulado al {fechaLarga(q.hasta)}</small></h3>
          <table className="nm-tabla"><tbody>
            <tr><td className="nm-nombre">Prima (semestre, {qSem} quincenas)</td><td className="num">{mm(prima)}</td></tr>
            <tr><td className="nm-nombre">Cesantías (año, {qAnio} quincenas)</td><td className="num">{mm(cesantias)}</td></tr>
            <tr><td className="nm-nombre">Intereses de cesantías (12 % anual, {mesesAnio}/12)</td><td className="num">{mm(intCes)}</td></tr>
            <tr><td className="nm-nombre">Vacaciones (año)</td><td className="num">{mm(vacaciones)}</td></tr>
          </tbody></table>
          <div className="nm-sub" style={{ marginTop: 8 }}>Aproximación: provisión de esta quincena × quincenas transcurridas. Oak-Crew calculaba los intereses como 1 % de las cesantías (≈10× bajo) y no reiniciaba las cesantías por año.</div>
        </div>
      </div>
      <Nota>Las ventas entran del DW (vista <b>analytics.ventas_diarias</b>, sin IVA, por tienda y día, tabla <b>rrhh_ventas_dia</b>). No se guardan llaves de Toteat en esta app. El P&L diario se arma en BigQuery: este costo laboral + ventas + COGS + resto.</Nota>
    </>
  );
}
