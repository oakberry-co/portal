import { redirect } from "next/navigation";
import { REGLAS, CARGA, TIPOS, cop, FESTIVOS, EXONERA_1607 } from "@/lib/rrhh/motor";
import { TIPOS_AUSENCIA, TIPOS_NOVEDAD } from "@/lib/rrhh/catalogos";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { Head, Aviso, Pill, Nota } from "../_lib/ui";

// REGLAS Y VIGENCIAS: la tabla de parámetros legales con fecha. Cuando cambia
// la norma se agrega una fila en lib/rrhh/motor.ts, no se edita un número.
// Esta pantalla solo MUESTRA lo que el motor usa: si una cifra no está acá,
// no la usa ninguna otra pantalla.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  if (p.tipo !== "rrhh") redirect("/nomina/perfil");

  const tiposPago = TIPOS.filter((t) => t.id !== "descanso" && t.id !== "ausencia");
  const anios = [...new Set([...FESTIVOS].map((f) => f.slice(0, 4)))].sort();
  return (
    <>
      <Head titulo="Reglas y vigencias" sub="Parámetros legales con fecha de vigencia. Cada regla tiene un test contra un desprendible real."
        acts={<button type="button" className="ghost" title="Todavía no hace nada: las vigencias se agregan en lib/rrhh/motor.ts">+ Nueva vigencia</button>} />
      <Aviso sp={sp} />
      <div className="nm-card nm-scroll">
        <h3>Vigencias <small>{REGLAS.length} filas</small></h3>
        <table className="nm-tabla"><thead><tr><th>Desde</th><th className="num">SMLMV</th><th className="num">Auxilio</th><th className="num">Divisor</th><th className="num">Jornada</th><th>Nocturno</th>{tiposPago.map((t) => <th key={t.id} className="num">{t.label}</th>)}<th>Fuente</th></tr></thead>
          <tbody>{REGLAS.map((r, i) => (<tr key={r.desde}><td className="mono">{r.desde} {i === REGLAS.length - 1 && <Pill tono="ok">vigente</Pill>}</td><td className="num">{cop(r.smlmv)}</td><td className="num">{cop(r.auxilio)}</td><td className="num">{r.divisor} h</td><td className="num">{r.jornadaSemanal} h</td><td>{r.nocturnoDesde}:00–{String(r.nocturnoHasta).padStart(2, "0")}:00</td>{tiposPago.map((t) => <td key={t.id} className="num">+{r.recargo[t.id as keyof typeof r.recargo]}%</td>)}<td className="nm-sub">Ley 789/2002 · 2101/2021 · 2466/2025</td></tr>))}</tbody></table>
      </div>
      <div className="nm-grid2">
        <div className="nm-card"><h3>Carga del empleador</h3>
          <table className="nm-tabla"><tbody>{Object.entries(CARGA).map(([k, v]) => <tr key={k}><td className="nm-nombre">{k}</td><td className="num">{v}%</td><td className="nm-sub">{["salud", "sena", "icbf"].includes(k) ? (EXONERA_1607 ? "exonerado < 10 SMLMV (Ley 1607)" : "se cobra a todos") : ["cesantias", "intCesantias", "prima"].includes(k) ? "base con auxilio" : "base sin auxilio"}</td></tr>)}</tbody></table>
        </div>
        <div className="nm-card"><h3>Festivos {anios.join(" · ")} <small>Ley 51/1983 · {FESTIVOS.size} días</small></h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{[...FESTIVOS].sort().map((f) => <Pill key={f} tono="gris">{f}</Pill>)}</div>
        </div>
      </div>
      <div className="nm-grid2">
        <div className="nm-card nm-scroll"><h3>Catálogo de ausencias <small>{TIPOS_AUSENCIA.length} tipos</small></h3>
          <table className="nm-tabla"><thead><tr><th>Tipo</th><th>Remunerada</th><th className="num">% pago</th><th>Descuenta vacaciones</th><th>Soporte</th></tr></thead>
            <tbody>{TIPOS_AUSENCIA.map((t) => <tr key={t.tipo}><td className="nm-nombre">{t.tipo}</td><td>{t.remunerada ? <Pill tono="ok">sí</Pill> : <Pill tono="bad">no</Pill>}</td><td className="num">{t.pct}%</td><td>{t.descuentaVac ? <Pill tono="warn">sí</Pill> : <span className="nm-sub">no</span>}</td><td>{t.soporte ? <Pill tono="info">obligatorio</Pill> : <span className="nm-sub">no</span>}</td></tr>)}</tbody></table>
        </div>
        <div className="nm-card"><h3>Tipos de novedad <small>entran al neto de la quincena</small></h3>
          <table className="nm-tabla"><thead><tr><th>Tipo</th><th>Signo</th><th>Uso</th></tr></thead>
            <tbody>{TIPOS_NOVEDAD.map((t) => <tr key={t}><td className="nm-nombre">{t}</td><td>{["incentivo", "bonificacion"].includes(t) ? <Pill tono="ok">+</Pill> : t === "otro" ? <Pill tono="gris">±</Pill> : <Pill tono="bad">−</Pill>}</td><td className="nm-sub">{{ prestamo: "cuota de préstamo descontada al colaborador", embargo: "orden judicial, se descuenta antes del neto", incentivo: "bono mensual no salarial (cierre de Incentivos)", bonificacion: "pago extra puntual, no salarial", descuento: "faltante de caja u otro descuento autorizado", otro: "cualquier ajuste con descripción" }[t]}</td></tr>)}</tbody></table>
        </div>
      </div>
      <Nota><b>Hallazgo que fija el motor:</b> la ventana nocturna corrió de 21:00 a 19:00 el 25-dic-2025 (Ley 2466) y el divisor bajó 230 → 220 → 210. La nómina pagada desde entonces usa la ventana vieja y el 230: el turno 13:00–21:00 pasó de 0 a 2 h nocturnas por día. El backtest de la fase 0 cuantifica la diferencia por persona.</Nota>
    </>
  );
}
