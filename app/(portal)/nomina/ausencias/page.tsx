import { redirect } from "next/navigation";
import { empleados, solicitudes, tiendas } from "@/lib/rrhh/db";
import { saldosDetalle } from "@/lib/rrhh/saldos";
import { guardarSaldoInicial } from "@/lib/rrhh/actions";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { TIPOS_AUSENCIA } from "@/lib/rrhh/catalogos";
import { hoyBogota } from "@/lib/rrhh/fechas";
import { Head, Kpi, Pill, Nota, Aviso, Filtros, Vacio, A } from "../_lib/ui";

// GESTIÓN DE AUSENCIAS: saldos de vacaciones desde una FECHA DE CORTE (lo que
// RRHH cargó al arrancar) + 15 días por 360 desde ahí − lo usado. Nunca desde
// el ingreso: eso es lo que infla los saldos a 40-60 días. Catálogo con
// remunerada / % / soporte para que nada se registre como «Otro / aprobado».
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  if (p.tipo === "colaborador") redirect("/nomina/perfil");
  const edita = p.tipo === "rrhh";
  const tiendaId = p.tipo === "admin_punto" ? p.tiendaId : sp.t || "";
  const hoy = hoyBogota();
  const [E, TIENDAS, pendientes] = await Promise.all([
    empleados(tiendaId ? { tiendaId } : {}), tiendas(), solicitudes({ estado: "pendiente", ...(tiendaId ? { tiendaId } : {}) }),
  ]);
  // un cálculo por empleado (cada uno consulta su saldo inicial y sus solicitudes aprobadas)
  const saldos = await Promise.all(E.map((e) => saldosDetalle(e.activo_id)));
  const filas = E.map((e, i) => ({ e, s: saldos[i], pend: pendientes.filter((x) => x.empleado_id === e.activo_id).length }));
  const tiendaDe = (id: string) => TIENDAS.find((t) => t.id === id);
  const con = filas.filter((f) => f.s);
  const sinSaldo = filas.length - con.length;
  const disponibles = con.reduce((a, f) => a + (f.s?.disponible ?? 0), 0);
  const usadas = con.reduce((a, f) => a + (f.s?.usadas ?? 0), 0);
  const cortes = [...new Set(con.map((f) => f.s!.corte))].sort();
  return (
    <>
      <Head titulo="Gestión de ausencias" sub={<>Saldos de vacaciones y permisos · corte de implementación <b>{cortes.length ? cortes.join(", ") : "sin cargar"}</b></>}
        acts={<A href="/nomina/solicitudes" className="btn ghost">Ver solicitudes</A>} />
      <Aviso sp={sp} />
      <div className="nm-kpis">
        <Kpi label="Empleados" valor={E.length} sub={tiendaId ? tiendaDe(tiendaId)?.nombre : "todas las tiendas"} />
        <Kpi label="Vacaciones disponibles (total)" valor={disponibles.toFixed(1) + " d"} sub="días hábiles" />
        <Kpi label="Solicitudes pendientes" valor={pendientes.length} tono={pendientes.length ? "warn" : "ok"} />
        <Kpi label="Días usados desde el corte" valor={usadas} />
        <Kpi label="Sin saldo cargado" valor={sinSaldo} sub={sinSaldo ? "RRHH debe cargar el corte" : "todos con corte"} tono={sinSaldo ? "bad" : "ok"} />
      </div>
      {p.tipo === "rrhh" && (
        <Filtros>
          <select name="t" defaultValue={tiendaId}><option value="">Todas las tiendas</option>{TIENDAS.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select>
        </Filtros>
      )}
      <div className="nm-grid2">
        <div className="nm-card nm-scroll">
          <h3>Saldos por empleado <small>vacaciones en días hábiles</small></h3>
          {filas.length === 0 ? <Vacio>Sin empleados para mostrar.</Vacio> : (
            <table className="nm-tabla">
              <thead><tr><th>Empleado</th><th>Tienda</th><th className="num">Saldo al corte</th><th className="num">Acumuladas</th><th className="num">Usadas</th><th className="num">Luto</th><th className="num">Otros</th><th className="num">Disponible</th><th>Pend.</th>{edita && <th>Corte / saldo</th>}</tr></thead>
              <tbody>{filas.map(({ e, s, pend }) => (
                <tr key={e.activo_id}>
                  <td className="nm-nombre">{e.nombre_completo}</td>
                  <td className="nm-sub">{tiendaDe(e.punto)?.nombre ?? e.punto}</td>
                  {s ? (
                    <><td className="num">{s.inicial}</td><td className="num">{s.acum}</td><td className="num">{s.usadas}</td><td className="num">{s.luto}</td><td className="num">{s.otros}</td>
                      <td className="num"><b>{s.disponible}</b>{s.disponible < 0 && <Pill tono="bad"> negativo</Pill>}</td></>
                  ) : (
                    <><td className="num">—</td><td className="num">—</td><td className="num">—</td><td className="num">—</td><td className="num">—</td><td><Pill tono="bad">sin corte</Pill></td></>
                  )}
                  <td>{pend ? <Pill tono="warn">{pend}</Pill> : "—"}</td>
                  {edita && (
                    <td>
                      {/* el corte es la fecha a la que RRHH conoce el saldo; desde ahí el sistema acumula solo */}
                      <form action={guardarSaldoInicial} className="nm-inline">
                        <input type="hidden" name="empleado_id" value={e.activo_id} />
                        <input type="hidden" name="volver" value={`/nomina/ausencias${tiendaId ? `?t=${encodeURIComponent(tiendaId)}` : ""}`} />
                        <input type="date" name="corte" defaultValue={s?.corte ?? hoy} required />
                        <input type="number" name="dias" step="0.5" min={0} max={90} defaultValue={s?.inicial ?? 0} style={{ width: 64 }} required title="Días de vacaciones al corte" />
                        <button type="submit" className="ghost">{s ? "Corregir" : "Cargar"}</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <div>
          <div className="nm-card nm-scroll">
            <h3>Catálogo de ausencias <small>lo que Oak-Crew no tiene</small></h3>
            <table className="nm-tabla">
              <thead><tr><th>Tipo</th><th>Remunerada</th><th className="num">% pago</th><th>Descuenta vac.</th><th>Soporte</th></tr></thead>
              <tbody>{TIPOS_AUSENCIA.map((t) => (
                <tr key={t.tipo}><td className="nm-nombre">{t.tipo}</td><td>{t.remunerada ? <Pill tono="ok">sí</Pill> : <Pill tono="bad">no</Pill>}</td><td className="num">{t.pct}%</td><td>{t.descuentaVac ? "sí" : "—"}</td><td>{t.soporte ? "obligatorio" : "—"}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <Nota><b>Días hábiles</b>, no calendario (Oak-Crew cuenta 26-sep→3-oct como 8 días). La <b>incapacidad</b> se paga al 66,67 % con soporte de la EPS. Suspensión y ausencia injustificada existen como tipo para que no se registren como «Otro / aprobado» y se paguen. El saldo disponible = saldo al corte + acumuladas (15 d / 360) − usadas después del corte.</Nota>
        </div>
      </div>
    </>
  );
}
