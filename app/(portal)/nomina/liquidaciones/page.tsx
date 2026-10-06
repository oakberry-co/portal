import { redirect } from "next/navigation";
import { empleados, liquidaciones, tiendas } from "@/lib/rrhh/db";
import { guardarLiquidacion } from "@/lib/rrhh/actions";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { saldoVacacionesDe } from "@/lib/rrhh/saldos";
import { CAUSAS_RETIRO } from "@/lib/rrhh/catalogos";
import { cop, reglasEn } from "@/lib/rrhh/motor";
import { hoyBogota, esFecha, diasEntre, fechaLarga, horaBogota } from "@/lib/rrhh/fechas";
import { Head, Aviso, Pill, Nota, Filtros } from "../_lib/ui";

// LIQUIDACIONES: art. 64 CST. Se simula por GET (empleado, fecha, causa en la
// URL) y se guarda con un POST que lleva las partidas ya calculadas: lo que
// queda en rrhh_liquidaciones es exactamente lo que se vio en pantalla.
// Cesantías e intereses SOLO del año en curso (las anteriores ya están en el
// fondo); prima del semestre en curso; el contrato y el salario salen de la
// ficha, no se preguntan al liquidar.

type Causa = (typeof CAUSAS_RETIRO)[number];

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  if (p.tipo !== "rrhh") redirect("/nomina/perfil");

  const hoy = hoyBogota();
  // incluye inactivos: la persona que se liquida suele estar ya retirada en la ficha
  const [E, TS, hist] = await Promise.all([empleados({ incluirInactivos: true }), tiendas(), liquidaciones()]);
  const e = (sp.e && E.find((x) => String(x.activo_id) === sp.e)) || E[0] || null;
  const f = esFecha(sp.f) ? sp.f : hoy;
  const causa: Causa = (CAUSAS_RETIRO as readonly string[]).includes(sp.c ?? "") ? (sp.c as Causa) : CAUSAS_RETIRO[0];
  const nombreTienda = (id: string) => TS.find((t) => t.id === id)?.nombre ?? id;

  let partidas: { clave: string; concepto: string; base: string; valor: number }[] = [];
  let total = 0, diasTrab = 0, indemAplica = false;
  if (e) {
    const r = reglasEn(f);
    const [y, m, d] = f.split("-").map(Number);
    const base = e.salario + (e.auxilio_transporte ? r.auxilio : 0);     // cesantías y prima SÍ llevan auxilio
    diasTrab = Math.max(0, diasEntre(e.fecha_ingreso, f) + 1);

    // cesantías e intereses: del 1 de enero (o del ingreso, si fue este año) al retiro
    const iniAnio = e.fecha_ingreso > `${y}-01-01` ? e.fecha_ingreso : `${y}-01-01`;
    const diasAnio = Math.max(0, diasEntre(iniAnio, f) + 1);
    const ces = Math.round(base * diasAnio / 360);
    const intCes = Math.round(ces * 0.12 * diasAnio / 360);

    // prima: semestre en curso
    const iniSem0 = m <= 6 ? `${y}-01-01` : `${y}-07-01`;
    const iniSem = e.fecha_ingreso > iniSem0 ? e.fecha_ingreso : iniSem0;
    const diasSem = Math.max(0, diasEntre(iniSem, f) + 1);
    const prima = Math.round(base * diasSem / 360);

    // vacaciones: el saldo real (corte + acumulado − usadas) si existe; si no, la proporción legal
    const saldo = await saldoVacacionesDe(e.activo_id);
    const vacValor = saldo != null ? Math.round(Math.max(0, saldo) * e.salario / 30) : Math.round(diasTrab / 720 * e.salario);

    // salario pendiente: los días del mes hasta el retiro
    const salPend = Math.round(e.salario * d / 30);

    // indemnización: solo despido sin justa causa con contrato indefinido (art. 64 CST)
    const indefinido = /INDEFINID/i.test(e.tipo_contrato ?? "");
    indemAplica = causa === "Despido sin justa causa" && indefinido;
    let indem = 0, indemDias = 0;
    if (indemAplica) {
      const anios = diasTrab / 365;
      const adicional = Math.max(0, anios - 1);
      // < 10 SMLMV: 30 días el primer año + 20 por cada año adicional (prorrateado);
      // ≥ 10 SMLMV: 20 días + 15 por cada año adicional
      indemDias = e.salario < 10 * r.smlmv ? 30 + 20 * adicional : 20 + 15 * adicional;
      indem = Math.round(e.salario / 30 * indemDias);
    }

    partidas = [
      { clave: "cesantias", concepto: "Cesantías (año en curso)", base: `${diasAnio} días × ${cop(base)} / 360`, valor: ces },
      { clave: "int_cesantias", concepto: "Intereses de cesantías (12 % prorrateado)", base: `12 % × ${diasAnio} / 360`, valor: intCes },
      { clave: "prima", concepto: "Prima (semestre en curso)", base: `${diasSem} días × ${cop(base)} / 360`, valor: prima },
      { clave: "vacaciones", concepto: "Vacaciones pendientes", base: saldo != null ? `${saldo} días de saldo × ${cop(e.salario)} / 30` : `sin saldo cargado: ${diasTrab} días / 720 × salario`, valor: vacValor },
      { clave: "salario", concepto: "Salario pendiente (días del mes)", base: `${d} días × ${cop(e.salario)} / 30`, valor: salPend },
    ];
    if (indemAplica) partidas.push({ clave: "indemnizacion", concepto: "Indemnización (despido sin justa causa, indefinido)", base: `${indemDias.toFixed(1)} días × ${cop(e.salario)} / 30`, valor: indem });
    total = partidas.reduce((a, x) => a + x.valor, 0);
  }
  const detalle = e ? { empleado: e.nombre_completo, salario: e.salario, auxilio: e.auxilio_transporte, contrato: e.tipo_contrato, ingreso: e.fecha_ingreso, retiro: f, causa, dias_trabajados: diasTrab, partidas: Object.fromEntries(partidas.map((x) => [x.clave, x.valor])) } : {};

  return (
    <>
      <Head titulo="Liquidaciones" sub="Liquidación final de contrato (art. 64 CST). Simula por GET y guarda lo que ves." />
      <Aviso sp={sp} />
      <div className="nm-grid2">
        <div className="nm-card">
          <h3>Simular</h3>
          <Filtros>
            <select name="e" defaultValue={e ? String(e.activo_id) : ""}>{E.map((x) => <option key={x.activo_id} value={x.activo_id}>{x.nombre_completo}{x.activo ? "" : " (retirado)"}</option>)}</select>
            <input type="date" name="f" defaultValue={f} />
            <select name="c" defaultValue={causa}>{CAUSAS_RETIRO.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </Filtros>
          {e ? (
            <div className="nm-form">
              <label>Tienda<input readOnly value={nombreTienda(e.punto)} /></label>
              <label>Tipo de contrato (ficha)<input readOnly value={e.tipo_contrato ?? "—"} /></label>
              <label>Salario (ficha)<input readOnly value={cop(e.salario)} /></label>
              <label>Auxilio de transporte<input readOnly value={e.auxilio_transporte ? "sí" : "no"} /></label>
              <label>Fecha de ingreso (ficha)<input readOnly value={e.fecha_ingreso} /></label>
              <label>Retiro en la ficha<input readOnly value={e.fecha_retiro ?? "—"} /></label>
            </div>
          ) : <div className="nm-vacio">No hay empleados en el maestro.</div>}
        </div>
        <div className="nm-card">
          <h3>Resultado {e && <small>{e.nombre_completo} · {diasTrab} días trabajados · retiro {fechaLarga(f)}</small>}</h3>
          {e && (
            <>
              <table className="nm-tabla"><tbody>
                {partidas.map((x) => <tr key={x.clave}><td className="nm-nombre">{x.concepto}<div className="nm-sub">{x.base}</div></td><td className="num">{cop(x.valor)}</td></tr>)}
                {!indemAplica && <tr><td className="nm-nombre nm-sub">Indemnización: no aplica ({causa === "Despido sin justa causa" ? "el contrato no es indefinido" : "la causa no es despido sin justa causa"})</td><td className="num nm-sub">—</td></tr>}
                <tr className="tot"><td>Total ({causa})</td><td className="num">{cop(total)}</td></tr>
              </tbody></table>
              <form action={guardarLiquidacion} className="nm-acts" style={{ marginTop: 12 }}>
                <input type="hidden" name="empleado_id" value={e.activo_id} /><input type="hidden" name="fecha_retiro" value={f} /><input type="hidden" name="causa" value={causa} />
                <input type="hidden" name="detalle" value={JSON.stringify(detalle)} /><input type="hidden" name="total" value={total} />
                <input type="hidden" name="volver" value={`/nomina/liquidaciones?e=${e.activo_id}&f=${f}&c=${encodeURIComponent(causa)}`} />
                <button type="submit">Guardar liquidación</button>
                <button type="button" className="ghost" title="Todavía no hace nada">PDF</button>
              </form>
            </>
          )}
        </div>
      </div>
      <div className="nm-card nm-scroll">
        <h3>Historial de liquidaciones <small>{hist.length} guardadas</small></h3>
        {hist.length === 0 ? <div className="nm-vacio">Ninguna todavía.</div> : (
          <table className="nm-tabla"><thead><tr><th>#</th><th>Empleado</th><th>Retiro</th><th>Causa</th><th className="num">Total</th><th>Guardó</th></tr></thead>
            <tbody>{hist.map((l) => <tr key={l.id}><td className="mono">{l.id}</td><td className="nm-nombre">{l.nombre_completo}</td><td className="mono">{l.fecha_retiro}</td><td>{l.causa}</td><td className="num"><b>{cop(l.total)}</b></td><td className="nm-sub">{l.creado_por ?? "—"}{l.creado_en ? ` · ${horaBogota(new Date(l.creado_en)).fecha}` : ""}</td></tr>)}</tbody></table>)}
      </div>
      <Nota>Oak-Crew calculaba las cesantías sobre toda la relación laboral (incluyendo años ya consignados al fondo) y los intereses al 12 % plano. Acá: solo el año en curso e intereses por días. Vacaciones: si la persona tiene saldo cargado en <b>Ausencias y saldos</b>, se liquida ese saldo; si no, la proporción legal (días/720). Si el resultado no cuadra, <Pill tono="warn">revisar la ficha</Pill> antes de guardar.</Nota>
    </>
  );
}
