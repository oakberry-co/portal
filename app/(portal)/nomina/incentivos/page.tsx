import { cargarEmpleados, TIENDAS, VENTAS_Q_SEP } from "../_lib/datos";
import { cop, mm } from "../_lib/motor";
import { Head, Btn, Sel, Pill, Nota } from "../_lib/ui";

// INCENTIVOS: bono mensual no salarial por tienda. Ventas del DW (automáticas).
// Fase 5: la pantalla existe para que se vea; se construye con caso real.
const METAS = [{ n: 1, min: 60_000_000, bono: 100_000 }, { n: 2, min: 80_000_000, bono: 175_000 }, { n: 3, min: 100_000_000, bono: 250_000 }];
const RAPPI = ["Recompra", "Tiempo de espera", "Reclamos", "Tiempo en línea", "Cancelaciones"];
const OPER = ["Inventario", "Caja", "Mermas"];
export default async function Incentivos() {
  const EMPLEADOS = await cargarEmpleados();
  const t = TIENDAS.find((x) => x.id === "ZONA G")!;
  const venta = (VENTAS_Q_SEP[t.id] ?? 0) * 2;
  const nivel = [...METAS].reverse().find((m) => venta >= m.min);
  const emps = EMPLEADOS.filter((e) => e.punto === t.id);
  return (
    <>
      <Head titulo="Incentivos" sub={<>Bono mensual no salarial · septiembre 2026 · <b>{t.nombre}</b> · <Pill tono="warn">abierto</Pill></>} acts={<><Btn ghost>Metas de venta</Btn><Btn ghost>Reporte del mes</Btn><Btn>Cerrar mes</Btn></>} />
      <div className="nm-filtros"><Sel opts={["Septiembre 2026", "Agosto 2026"]} /><Sel opts={TIENDAS.filter((x) => x.activa).map((x) => x.nombre)} def={t.nombre} /></div>
      <div className="nm-grid3">
        <div className="nm-card"><h3>Cumplimiento de ventas <small>hasta $250k</small></h3>
          <div className="nm-sub">Venta del mes (DW, sin IVA)</div><div style={{ fontSize: 22, fontWeight: 800, color: "var(--purple-deep)" }}>{mm(venta)}</div>
          <table className="nm-tabla" style={{ marginTop: 8 }}><tbody>{METAS.map((m) => <tr key={m.n}><td>Nivel {m.n} · ≥ {mm(m.min)}</td><td className="num">{cop(m.bono)}</td><td>{nivel?.n === m.n ? <Pill tono="ok">alcanzado</Pill> : venta >= m.min ? <Pill tono="gris">superado</Pill> : "—"}</td></tr>)}</tbody></table>
        </div>
        <div className="nm-card"><h3>Indicadores Oro Rappi <small>5 × $25k</small></h3>
          {RAPPI.map((x, i) => <div key={x} className="nm-hbar" style={{ gridTemplateColumns: "1fr 60px" }}><span>{x}</span><span className="v">{i < 3 ? <Pill tono="ok">✓</Pill> : <Pill tono="gris">—</Pill>}</span></div>)}
          <div className="nm-sub">Fuente: rappi_ads / métricas del portal Rappi (automático).</div>
        </div>
        <div className="nm-card"><h3>Excelencia operativa <small>3 × $25k · servicio $100k</small></h3>
          {OPER.map((x, i) => <div key={x} className="nm-hbar" style={{ gridTemplateColumns: "1fr 60px" }}><span>{x}</span><span className="v">{i !== 2 ? <Pill tono="ok">✓</Pill> : <Pill tono="bad">✗</Pill>}</span></div>)}
          <div className="nm-hbar" style={{ gridTemplateColumns: "1fr 60px" }}><span>Servicio individual (B-PIN)</span><span className="v"><Pill tono="ok">✓</Pill></span></div>
        </div>
      </div>
      <div className="nm-card nm-scroll">
        <h3>Por colaborador <small>tope $550.000 · se paga en la 1ª quincena del mes siguiente</small></h3>
        <table className="nm-tabla"><thead><tr><th>Colaborador</th><th>Tipo</th><th className="num">Ventas</th><th className="num">Rappi</th><th className="num">Operativa</th><th className="num">Servicio</th><th className="num">Prorrateo</th><th className="num">Total</th></tr></thead>
          <tbody>{emps.map((e, i) => { const v = nivel?.bono ?? 0, rp = 75_000, op = 50_000, sv = i % 3 === 2 ? 0 : 100_000; const pr = i === emps.length - 1 ? 0.5 : 1; const tot = Math.min(550_000, Math.round((v + rp + op + sv) * pr)); return (
            <tr key={e.activo_id}><td className="nm-nombre">{e.nombre_completo}</td><td className="nm-sub">{e.cargo.toLowerCase()}</td><td className="num">{cop(v)}</td><td className="num">{cop(rp)}</td><td className="num">{cop(op)}</td><td className="num">{cop(sv)}</td><td className="num">{pr * 100}%</td><td className="num"><b>{cop(tot)}</b></td></tr>); })}</tbody></table>
      </div>
      <Nota>Pago no salarial: si supera el 40 % de la remuneración total, el exceso entra al IBC (Ley 1393/2010). El motor lo verifica antes de cerrar el mes. <b>Fase 5.</b></Nota>
    </>
  );
}
