import { redirect } from "next/navigation";
import { empleados, incentivoMes, tiendas, ventasPorTienda } from "@/lib/rrhh/db";
import { guardarIncentivo, guardarIncentivoAbierto, cerrarIncentivo } from "@/lib/rrhh/actions";
import { perspectiva, puedePlanificar } from "@/lib/rrhh/perspectiva";
import { cop, mm } from "@/lib/rrhh/motor";
import { hoyBogota, mesDe, MESES, diasEntre } from "@/lib/rrhh/fechas";
import { Head, Aviso, Pill, Nota, Filtros } from "../_lib/ui";

// INCENTIVOS: bono mensual NO salarial por tienda. Un solo formulario guarda
// venta, metas e indicadores en rrhh_incentivo_mes; al cerrar el mes el bono
// de cada persona entra como novedad de la 1ª quincena del mes siguiente.
// Las cifras de la tabla salen de lo GUARDADO (no de lo que se está tecleando):
// se guarda primero, se mira después, y se cierra cuando cuadra.

const RAPPI = [
  { clave: "rappi_recompra", label: "Recompra" }, { clave: "rappi_espera", label: "Tiempo de espera" },
  { clave: "rappi_reclamos", label: "Reclamos" }, { clave: "rappi_online", label: "Tiempo en línea" },
  { clave: "rappi_cancel", label: "Cancelaciones" },
];
const OPER = [
  { clave: "op_inventario", label: "Inventario" }, { clave: "op_caja", label: "Caja" }, { clave: "op_mermas", label: "Mermas" },
];
const BONO_INDICADOR = 25_000, BONO_SERVICIO = 100_000, TOPE = 550_000;

/** Mes anterior al de la fecha dada (el incentivo se liquida vencido). */
function mesAnterior(f: string): string {
  const [y, m] = f.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  if (p.tipo === "colaborador") redirect("/nomina/perfil");

  const hoy = hoyBogota();
  const mParam = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : mesAnterior(hoy);
  const [anio, mes] = mParam.split("-").map(Number);
  const rangoMes = mesDe(`${mParam}-01`);
  const diasMes = diasEntre(rangoMes.desde, rangoMes.hasta) + 1;

  const TS = await tiendas();
  const activas = TS.filter((t) => t.activa);
  // el admin de punto solo ve su tienda; RRHH elige
  const tiendaId = p.tipo === "admin_punto" ? p.tiendaId : (sp.t && TS.some((t) => t.id === sp.t) ? sp.t : activas[0]?.id ?? "");
  const tienda = TS.find((t) => t.id === tiendaId);
  if (!tienda) return (<><Head titulo="Incentivos" /><Aviso sp={sp} /><div className="nm-card"><div className="nm-vacio">No hay tiendas activas.</div></div></>);

  const [inc, emps, ventasDw] = await Promise.all([incentivoMes(tiendaId, anio, mes), empleados({ tiendaId }), ventasPorTienda(rangoMes.desde, rangoMes.hasta)]);
  const metas = (inc.metas ?? {}) as Record<string, number | undefined>;
  const ind = (inc.indicadores ?? {}) as Record<string, unknown>;
  const servicio = (ind.servicio ?? {}) as Record<string, boolean>;
  const cerrado = inc.estado === "cerrado";
  const puedeEditar = puedePlanificar(p, tiendaId) && !cerrado;

  // venta: lo guardado manda; si no hay nada, lo que dejó el sync del DW
  const ventaDw = ventasDw[tiendaId] ?? 0;
  const venta = Number(metas.ventaMes) || ventaDw;
  const METAS = [
    { n: 1, min: Number(metas.n1) || 60_000_000, bono: Number(metas.b1) || 100_000 },
    { n: 2, min: Number(metas.n2) || 80_000_000, bono: Number(metas.b2) || 175_000 },
    { n: 3, min: Number(metas.n3) || 100_000_000, bono: Number(metas.b3) || 250_000 },
  ];
  // nivel NO acumulativo: se paga solo el más alto alcanzado
  const nivel = [...METAS].reverse().find((x) => venta > 0 && venta >= x.min);
  const nRappi = RAPPI.filter((x) => ind[x.clave] === true).length;
  const nOper = OPER.filter((x) => ind[x.clave] === true).length;

  const filas = emps.map((e) => {
    const v = nivel?.bono ?? 0, rp = nRappi * BONO_INDICADOR, op = nOper * BONO_INDICADOR, sv = servicio[String(e.activo_id)] ? BONO_SERVICIO : 0;
    // prorrateo: si ingresó dentro del mes, solo los días que estuvo
    let pr = 1;
    if (e.fecha_ingreso > rangoMes.hasta) pr = 0;
    else if (e.fecha_ingreso > rangoMes.desde) pr = (diasEntre(e.fecha_ingreso, rangoMes.hasta) + 1) / diasMes;
    const tot = Math.min(TOPE, Math.round((v + rp + op + sv) * pr));
    return { e, v, rp, op, sv, pr, tot };
  });
  const totalTienda = filas.reduce((a, f) => a + f.tot, 0);
  const volver = `/nomina/incentivos?t=${encodeURIComponent(tiendaId)}&m=${mParam}`;

  // opciones de mes: los últimos 12 vencidos
  const meses: string[] = []; { let cur = mesAnterior(hoy); for (let i = 0; i < 12; i++) { meses.push(cur); cur = mesAnterior(cur + "-01"); } }
  if (!meses.includes(mParam)) meses.unshift(mParam);
  const ro = !puedeEditar;

  return (
    <>
      <Head titulo="Incentivos" sub={<>Bono mensual no salarial · {MESES[mes - 1]} {anio} · <b>{tienda.nombre}</b> · {cerrado ? <Pill tono="ok">cerrado por {inc.cerrado_por ?? "—"}</Pill> : <Pill tono="warn">abierto</Pill>}</>} />
      <Aviso sp={sp} />
      <Filtros>
        <select name="m" defaultValue={mParam}>{meses.map((x) => { const [y, m2] = x.split("-").map(Number); return <option key={x} value={x}>{MESES[m2 - 1]} {y}</option>; })}</select>
        {p.tipo === "rrhh" && <select name="t" defaultValue={tiendaId}>{activas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select>}
      </Filtros>

      <form action={guardarIncentivo}>
        <input type="hidden" name="tienda_id" value={tiendaId} /><input type="hidden" name="anio" value={anio} /><input type="hidden" name="mes" value={mes} /><input type="hidden" name="volver" value={volver} />
        <div className="nm-grid3">
          <div className="nm-card"><h3>Cumplimiento de ventas <small>hasta {cop(METAS[2].bono)}</small></h3>
            <div className="nm-form">
              <label className="full">Venta del mes (sin IVA){ventaDw ? <span style={{ textTransform: "none", fontWeight: 400 }}>DW: {mm(ventaDw)}</span> : null}
                <input type="number" name="venta_mes" min={0} step={1} defaultValue={venta || ""} readOnly={ro} placeholder={ventaDw ? "" : "sin sync del DW: digítala"} /></label>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--purple-deep)", margin: "8px 0" }}>{venta ? mm(venta) : "—"}</div>
            <table className="nm-tabla"><thead><tr><th>Nivel</th><th className="num">Meta</th><th className="num">Bono</th><th></th></tr></thead><tbody>
              {METAS.map((x) => <tr key={x.n}><td>Nivel {x.n}</td>
                <td className="num"><input type="number" name={`meta_n${x.n}`} defaultValue={x.min} min={0} step={1_000_000} readOnly={ro} style={{ width: 120, textAlign: "right" }} /></td>
                <td className="num"><input type="number" name={`bono_n${x.n}`} defaultValue={x.bono} min={0} step={5_000} readOnly={ro} style={{ width: 100, textAlign: "right" }} /></td>
                <td>{nivel?.n === x.n ? <Pill tono="ok">alcanzado</Pill> : venta > 0 && venta >= x.min ? <Pill tono="gris">superado</Pill> : "—"}</td></tr>)}
            </tbody></table>
            <div className="nm-sub" style={{ marginTop: 6 }}>Se paga solo el nivel más alto alcanzado (no acumula).</div>
          </div>
          <div className="nm-card"><h3>Indicadores Oro Rappi <small>5 × {cop(BONO_INDICADOR)}</small></h3>
            {RAPPI.map((x) => <label key={x.clave} className="nm-hbar" style={{ gridTemplateColumns: "1fr 60px", cursor: ro ? "default" : "pointer" }}><span>{x.label}</span><span className="v"><input type="checkbox" name={`ind_${x.clave}`} defaultChecked={ind[x.clave] === true} disabled={ro} /></span></label>)}
            <div className="nm-sub">{nRappi} de 5 · {cop(nRappi * BONO_INDICADOR)}. Fuente: métricas del portal Rappi; por ahora se marcan a mano.</div>
          </div>
          <div className="nm-card"><h3>Excelencia operativa <small>3 × {cop(BONO_INDICADOR)} · servicio {cop(BONO_SERVICIO)}</small></h3>
            {OPER.map((x) => <label key={x.clave} className="nm-hbar" style={{ gridTemplateColumns: "1fr 60px", cursor: ro ? "default" : "pointer" }}><span>{x.label}</span><span className="v"><input type="checkbox" name={`ind_${x.clave}`} defaultChecked={ind[x.clave] === true} disabled={ro} /></span></label>)}
            <div className="nm-sub">{nOper} de 3 · {cop(nOper * BONO_INDICADOR)}. El servicio individual se marca por persona en la tabla.</div>
          </div>
        </div>

        <div className="nm-card nm-scroll">
          <h3>Por colaborador <small>tope {cop(TOPE)} · se paga en la 1ª quincena del mes siguiente</small></h3>
          {emps.length === 0 ? <div className="nm-vacio">Esta tienda no tiene colaboradores activos.</div> : (
            <table className="nm-tabla"><thead><tr><th>Colaborador</th><th>Cargo</th><th>Servicio</th><th className="num">Ventas</th><th className="num">Rappi</th><th className="num">Operativa</th><th className="num">Servicio</th><th className="num">Prorrateo</th><th className="num">Total</th></tr></thead>
              <tbody>{filas.map(({ e, v, rp, op, sv, pr, tot }) => (
                <tr key={e.activo_id}><td className="nm-nombre">{e.nombre_completo}{pr < 1 && <div className="nm-sub">ingresó {e.fecha_ingreso}</div>}</td><td className="nm-sub">{e.cargo.toLowerCase()}</td>
                  <td><input type="checkbox" name={`srv_${e.activo_id}`} defaultChecked={servicio[String(e.activo_id)] === true} disabled={ro} title="Servicio individual (B-PIN)" /></td>
                  <td className="num">{cop(v)}</td><td className="num">{cop(rp)}</td><td className="num">{cop(op)}</td><td className="num">{cop(sv)}</td><td className="num">{Math.round(pr * 100)}%</td><td className="num"><b>{cop(tot)}</b></td></tr>))}
                <tr className="tot"><td colSpan={8}>Total tienda</td><td className="num">{cop(totalTienda)}</td></tr>
              </tbody></table>)}
          <div className="nm-sub" style={{ marginTop: 6 }}>La tabla refleja lo guardado. Marca, guarda y revisa; cierra cuando cuadre.</div>
        </div>

        {puedeEditar ? (
          <div className="nm-acts" style={{ margin: "0 0 14px", alignItems: "center" }}>
            <button type="submit" formAction={guardarIncentivoAbierto}>Guardar</button>
            <button type="submit" formAction={cerrarIncentivo} className="ghost" title="Al cerrar, el bono de cada persona entra como novedad de la 1ª quincena del mes siguiente">Cerrar mes</button>
            <span className="nm-sub">Al cerrar el mes, los bonos entran como novedad y ya no se pueden editar.</span>
          </div>
        ) : cerrado ? (
          <div className="nm-sub" style={{ margin: "0 0 14px" }}>Mes cerrado{inc.cerrado_por ? ` por ${inc.cerrado_por}` : ""}: los bonos ya entraron como novedad.</div>
        ) : (
          <div className="nm-sub" style={{ margin: "0 0 14px" }}>Solo lectura: no puedes editar esta tienda.</div>
        )}
      </form>
      <Nota>Pago no salarial: si supera el 40 % de la remuneración total, el exceso entra al IBC (Ley 1393/2010). El motor lo verifica al liquidar la quincena en la que entra la novedad.</Nota>
    </>
  );
}
