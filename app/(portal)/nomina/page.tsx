import { cargarEmpleados, TIENDAS, HOY, lunesDe, mas, DIAS, fechaCorta, fechaLarga, turnosEntre, tienda } from "./_lib/datos";
import { esDominical, hora, horasDe } from "./_lib/motor";
import { Head, Kpi, Btn, Sel } from "./_lib/ui";

// DASHBOARD: la semana de todas las tiendas, de un vistazo (como Oak-Crew),
// más lo que a Oak-Crew le falta: avisar cuando una tienda está sin planear.
export default async function Dashboard() {
  const EMPLEADOS = await cargarEmpleados();
  const lun = lunesDe(HOY), dom = mas(lun, 6);
  const dias = Array.from({ length: 7 }, (_, i) => mas(lun, i));
  const turnos = turnosEntre(EMPLEADOS, lun, dom);
  const activos = EMPLEADOS.filter((e) => tienda(e.punto)?.activa);
  const tiendasActivas = TIENDAS.filter((t) => t.activa);
  const prog = turnos.filter((t) => t.tipo === "programado");
  const sinPlan = tiendasActivas.filter((t) => prog.filter((x) => x.tiendaId === t.id).length < 3);
  const chip = (t: ReturnType<typeof turnosEntre>[number]) => {
    if (t.tipo === "descanso") return <span className="nm-chip desc">😴 Descanso</span>;
    if (t.tipo === "ausencia") return <span className="nm-chip aus">Permiso</span>;
    const h = horasDe(t); const cls = esDominical(t.fecha) ? "f" : h.nocturna > 0 ? "n" : "d";
    return <span className={"nm-chip " + cls}>{hora(t.inicio)} – {hora(t.fin)}</span>;
  };
  return (
    <>
      <Head titulo="Dashboard" sub="Gestión de turnos y empleados · semana en curso"
        acts={<><Btn ghost>‹</Btn><Btn ghost>Hoy</Btn><Btn ghost>›</Btn></>} />
      <div className="nm-kpis">
        <Kpi label="Empleados activos" valor={activos.length} sub={`${EMPLEADOS.length - activos.length} en tienda cerrada`} />
        <Kpi label="Ubicaciones" valor={tiendasActivas.length} sub={`${TIENDAS.length - tiendasActivas.length} cerrada`} />
        <Kpi label="Turnos esta semana" valor={prog.length} sub={`${turnos.length - prog.length} descansos/permisos`} />
        <Kpi label="Turnos extra abiertos" valor={0} />
        <Kpi label="Tiendas sin planear" valor={sinPlan.length} sub={sinPlan.map((t) => t.nombre).join(", ") || "todas planeadas"} tono={sinPlan.length ? "bad" : "ok"} />
      </div>
      <div className="nm-filtros">
        <b style={{ fontSize: 13 }}>{fechaLarga(lun)} — {fechaLarga(dom)}</b>
        <span className="sep" />
        <Sel opts={["Todas las ubicaciones", ...tiendasActivas.map((t) => t.nombre)]} />
        <Sel opts={["Todos los empleados"]} />
      </div>
      <div className="nm-leyenda">
        <span><i style={{ background: "#e9f2ff" }} />Diurna</span><span><i style={{ background: "#ece6fa" }} />Nocturna</span>
        <span><i style={{ background: "#fde7e1" }} />Dominical/festivo</span><span><i style={{ background: "#fff6d6" }} />Descanso</span><span><i style={{ background: "#f6f1e4" }} />Permiso</span>
        <span style={{ marginLeft: "auto" }}>* Las horas efectivas descuentan el almuerzo configurado por tienda.</span>
      </div>
      {tiendasActivas.map((t) => {
        const emps = activos.filter((e) => e.punto === t.id);
        return (
          <div className="nm-card" key={t.id}>
            <h3>{t.nombre}<small>{t.direccion}, {t.ciudad}</small>{sinPlan.includes(t) && <small style={{ color: "var(--danger)", fontWeight: 700 }}>⚠ semana sin planear</small>}</h3>
            <div className="nm-sem">
              <div className="h" style={{ alignItems: "flex-start" }}>Empleado</div>
              {dias.map((d, i) => <div key={d} className={"h" + (esDominical(d) ? " dom" : "")}>{DIAS[i]}<small>{fechaCorta(d)}</small></div>)}
              {emps.map((e) => (
                <Row key={e.activo_id} nombre={e.nombre_completo} cargo={e.cargo}>
                  {dias.map((d) => { const t2 = turnos.find((x) => x.empleadoId === e.activo_id && x.fecha === d); return <div key={d} className={esDominical(d) ? "dom" : ""}>{t2 ? chip(t2) : <span className="nm-chip add">—</span>}</div>; })}
                </Row>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function Row({ nombre, cargo, children }: { nombre: string; cargo: string; children: React.ReactNode }) {
  return <><div className="e"><b>{nombre}</b><small>{cargo}</small></div>{children}</>;
}
