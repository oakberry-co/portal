import { REGLAS, CARGA, TIPOS, cop, FESTIVOS } from "../_lib/motor";
import { Head, Btn, Pill, Nota } from "../_lib/ui";

// REGLAS Y VIGENCIAS: la tabla de parámetros legales con fecha. Cuando cambia
// la norma se agrega una fila, no se edita un número.
export default function Reglas() {
  return (
    <>
      <Head titulo="Reglas y vigencias" sub="Parámetros legales con fecha de vigencia. Cada regla tiene un test contra un desprendible real." acts={<Btn ghost>+ Nueva vigencia</Btn>} />
      <div className="nm-card nm-scroll">
        <h3>Vigencias</h3>
        <table className="nm-tabla"><thead><tr><th>Desde</th><th className="num">SMLMV</th><th className="num">Auxilio</th><th className="num">Divisor</th><th className="num">Jornada</th><th>Nocturno</th>{TIPOS.filter((t) => t.id !== "descanso" && t.id !== "ausencia").map((t) => <th key={t.id} className="num">{t.label}</th>)}<th>Fuente</th></tr></thead>
          <tbody>{REGLAS.map((r, i) => (<tr key={r.desde}><td className="mono">{r.desde} {i === REGLAS.length - 1 && <Pill tono="ok">vigente</Pill>}</td><td className="num">{cop(r.smlmv)}</td><td className="num">{cop(r.auxilio)}</td><td className="num">{r.divisor} h</td><td className="num">{r.jornadaSemanal} h</td><td>{r.nocturnoDesde}:00–0{r.nocturnoHasta}:00</td>{TIPOS.filter((t) => t.id !== "descanso" && t.id !== "ausencia").map((t) => <td key={t.id} className="num">+{r.recargo[t.id as keyof typeof r.recargo]}%</td>)}<td className="nm-sub">Ley 789/2002 · 2101/2021 · 2466/2025</td></tr>))}</tbody></table>
      </div>
      <div className="nm-grid2">
        <div className="nm-card"><h3>Carga del empleador</h3>
          <table className="nm-tabla"><tbody>{Object.entries(CARGA).map(([k, v]) => <tr key={k}><td className="nm-nombre">{k}</td><td className="num">{v}%</td><td className="nm-sub">{["salud", "sena", "icbf"].includes(k) ? "exonerado < 10 SMLMV (Ley 1607)" : ["cesantias", "intCesantias", "prima"].includes(k) ? "base con auxilio" : "base sin auxilio"}</td></tr>)}</tbody></table>
        </div>
        <div className="nm-card"><h3>Festivos 2026 <small>Ley 51/1983</small></h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{[...FESTIVOS].map((f) => <Pill key={f} tono="gris">{f}</Pill>)}</div>
        </div>
      </div>
      <Nota><b>Hallazgo que fija el motor:</b> la ventana nocturna corrió de 21:00 a 19:00 el 25-dic-2025 (Ley 2466) y el divisor bajó 230 → 220 → 210. La nómina pagada desde entonces usa la ventana vieja y el 230: el turno 13:00–21:00 pasó de 0 a 2 h nocturnas por día. El backtest de la fase 0 cuantifica la diferencia por persona.</Nota>
    </>
  );
}
