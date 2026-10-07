import { redirect } from "next/navigation";
import { BANCOS } from "@/lib/bancos";
import { documentosDeTodos, type Documento, empleados, tiendas, type EmpleadoDb } from "@/lib/rrhh/db";
import { guardarEmpleado, crearEmpleado } from "@/lib/rrhh/actions";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { cop } from "@/lib/rrhh/motor";
import { Head, Pill, Nota, Aviso, Filtros, Vacio, A } from "../_lib/ui";

// EMPLEADOS: el maestro de nómina es la biblia. A diferencia de Oak-Crew, la
// ficha trae CONTRATO (salario, tipo, entidades) — sin eso no hay nómina. La
// ficha se edita acá (solo RRHH); el administrador de punto mira a su gente y
// el colaborador tiene su propio perfil.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  if (p.tipo === "colaborador") redirect("/nomina/perfil");
  const soloVer = p.tipo !== "rrhh";
  // el admin de punto no elige tienda: siempre es la suya
  const tiendaId = p.tipo === "admin_punto" ? p.tiendaId : sp.t || "";
  const incluirInactivos = sp.inactivos === "1";
  const [TODOS, TIENDAS, DOCS] = await Promise.all([empleados({ incluirInactivos }), tiendas(), documentosDeTodos()]);
  const tiendaDe = (id: string) => TIENDAS.find((t) => t.id === id);
  const cargos = [...new Set(TODOS.map((e) => e.cargo).filter(Boolean))].sort();
  const buscar = (sp.buscar ?? "").trim().toLowerCase();
  // los filtros corren en memoria: el maestro son ~100 filas, no vale una consulta por filtro
  const lista = TODOS.filter((e) => (!tiendaId || e.punto === tiendaId) && (!sp.cargo || e.cargo === sp.cargo)
    && (!buscar || e.nombre_completo.toLowerCase().includes(buscar) || String(e.activo_id).includes(buscar) || (e.email ?? "").toLowerCase().includes(buscar)));
  const activos = TODOS.filter((e) => e.activo).length;
  const sinConsent = lista.filter((e) => e.activo && !e.consentimiento_firmado_en).length;
  const qs = (cambios: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ t: sp.t, cargo: sp.cargo, buscar: sp.buscar, inactivos: sp.inactivos, ...cambios })) if (v) u.set(k, v);
    const s = u.toString(); return "/nomina/empleados" + (s ? "?" + s : "");
  };
  return (
    <>
      <Head titulo="Empleados" sub={<>{activos} activos en el maestro de nómina{incluirInactivos && <> · {TODOS.length - activos} retirados</>} · fuente: <b>maestro de nómina (RRHH)</b></>}
        acts={<A href={qs({ inactivos: incluirInactivos ? undefined : "1" })} className="btn ghost">{incluirInactivos ? "Ocultar ex-empleados" : "Ver ex-empleados"}</A>} />
      <Aviso sp={sp} />
      <Filtros>
        <input name="buscar" placeholder="Buscar por nombre, id o correo" defaultValue={sp.buscar ?? ""} style={{ minWidth: 240 }} />
        {p.tipo === "rrhh" ? (
          <select name="t" defaultValue={tiendaId}><option value="">Todas las tiendas</option>{TIENDAS.map((t) => <option key={t.id} value={t.id}>{t.nombre}{!t.activa ? " (cerrada)" : ""}</option>)}</select>
        ) : <Pill tono="info">{tiendaDe(tiendaId)?.nombre ?? tiendaId}</Pill>}
        <select name="cargo" defaultValue={sp.cargo ?? ""}><option value="">Todos los cargos</option>{cargos.map((c) => <option key={c} value={c}>{cap(c)}</option>)}</select>
        {incluirInactivos && <input type="hidden" name="inactivos" value="1" />}
        <span className="sep" />
        {sinConsent > 0 && <Pill tono="bad">{sinConsent} sin consentimiento</Pill>}
        <Pill tono="info">{lista.length} en la lista</Pill>
      </Filtros>

      {!soloVer && (
        <details className="nm-det nm-card">
          <summary>+ Nuevo empleado</summary>
          <form action={crearEmpleado} style={{ marginTop: 12 }}>
            <input type="hidden" name="volver" value="/nomina/empleados" />
            <div className="nm-form">
              <label>Nombre completo<input name="nombre_completo" required minLength={5} placeholder="APELLIDOS NOMBRES" /></label>
              <label>Tienda<select name="punto" required>{TIENDAS.filter((t) => t.activa).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></label>
              <label>Salario mensual<input name="salario" type="number" min={1000000} step={1} required placeholder="1750905" /></label>
              <label>Fecha de ingreso<input name="fecha_ingreso" type="date" required /></label>
              <label>Cargo<input name="cargo" defaultValue="AUXILIAR PUNTO DE VENTA" /></label>
              <label>Tipo de contrato<select name="tipo_contrato" defaultValue="INDEFINIDO"><option>INDEFINIDO</option><option>FIJO</option><option>OBRA O LABOR</option><option>APRENDIZ</option></select></label>
              <label>Correo (con el que entra al portal)<input name="email" type="email" /></label>
              <label>Rol en la app<select name="rol_app" defaultValue="colaborador"><option value="colaborador">Colaborador</option><option value="admin_punto">Administrador de punto</option><option value="rrhh">RRHH</option></select></label>
              <label>Auxilio de transporte<select name="auxilio_transporte" defaultValue="si"><option value="si">Sí (≤ 2 SMLMV)</option><option value="no">No</option></select></label>
            </div>
            <div className="nm-acts" style={{ marginTop: 12 }}><button type="submit">Crear empleado</button></div>
            <p className="nm-sub" style={{ marginTop: 8 }}>En producción los empleados nacen en el maestro de nómina (Excel de RRHH) y entran por el sync; este formulario sirve en el ambiente de pruebas.</p>
          </form>
        </details>
      )}

      {lista.length === 0 ? <Vacio>Nadie coincide con el filtro.</Vacio> : (
        <div className="nm-emp">
          {lista.map((e) => {
            const t = tiendaDe(e.punto);
            return (
              <div className="c" key={e.activo_id} id={`e${e.activo_id}`}>
                <b>{e.nombre_completo} {!e.activo && <Pill tono="gris">retirado{e.fecha_retiro ? ` ${e.fecha_retiro}` : ""}</Pill>}</b>
                <div className="r"><span>Cargo</span><span>{cap(e.cargo)}</span></div>
                <div className="r"><span>Tienda</span><span>{t?.nombre ?? e.punto}{t && !t.activa && <Pill tono="bad"> cerrada</Pill>}</span></div>
                <div className="r"><span>Salario</span><span>{cop(e.salario)} {e.auxilio_transporte && <Pill tono="gris">+ aux</Pill>}</span></div>
                <div className="r"><span>Cuenta de pago</span><span>{e.banco && e.cuenta ? <>{e.banco} · {e.tipo_cuenta ?? "?"} · …{e.cuenta.slice(-4)} {(DOCS[e.activo_id] ?? []).some((d) => d.tipo === "certificacion_bancaria") ? <Pill tono="ok">certificada</Pill> : <Pill tono="warn">sin certificación</Pill>}</> : <Pill tono="bad">sin cuenta: no se le puede pagar</Pill>}</span></div>
                <div className="r"><span>Contrato</span><span>{cap(e.tipo_contrato)} · desde {e.fecha_ingreso} · {e.jornada_semanal} h/sem</span></div>
                <div className="r"><span>EPS / AFP / ARL</span><span>{[e.eps, e.afp, e.arl].filter(Boolean).map(cap).join(" · ") || "—"}</span></div>
                <div className="r"><span>Acceso</span><span>{e.email ?? <Pill tono="warn">sin correo</Pill>} · {rolLabel(e.rol_app)}</span></div>
                <div className="r"><span>Consentimiento datos/imagen</span><span>{e.consentimiento_firmado_en ? <Pill tono="ok">firmado {e.consentimiento_firmado_en}</Pill> : <Pill tono="bad">consentimiento pendiente</Pill>}</span></div>
                {!soloVer && (
                  <details className="nm-det" style={{ marginTop: 9 }}>
                    <summary>Editar ficha</summary>
                    <FormFicha e={e} tiendasOpts={TIENDAS} docs={DOCS[e.activo_id] ?? []} />
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Nota><b>Regla:</b> sin consentimiento de datos e imagen firmado la persona <b>no puede marcar</b>. Una persona con turnos y sin contrato vigente, o con fecha de inicio futura, dispara un centinela y no entra a nómina como «Desconocido»: se corrige la ficha, no el cálculo.</Nota>
    </>
  );
}

/** Ficha completa: todos los campos que recibe guardarEmpleado, con el archivo
 *  del consentimiento (por eso el formulario va en multipart). */
function FormFicha({ e, tiendasOpts, docs }: { e: EmpleadoDb; tiendasOpts: { id: string; nombre: string; activa: boolean }[]; docs: Documento[] }) {
  return (
    <form action={guardarEmpleado} encType="multipart/form-data" style={{ marginTop: 10 }}>
      <input type="hidden" name="activo_id" value={e.activo_id} />
      <input type="hidden" name="volver" value={`/nomina/empleados#e${e.activo_id}`} />
      <div className="nm-form" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <label>Correo<input name="email" type="email" defaultValue={e.email ?? ""} /></label>
        <label>Rol en la app<select name="rol_app" defaultValue={e.rol_app}><option value="colaborador">Colaborador</option><option value="admin_punto">Administrador de punto</option><option value="rrhh">RRHH</option></select></label>
        <label>Tienda<select name="punto" defaultValue={e.punto}>{tiendasOpts.map((t) => <option key={t.id} value={t.id}>{t.nombre}{!t.activa ? " (cerrada)" : ""}</option>)}</select></label>
        <label>Jornada semanal (h)<input name="jornada_semanal" type="number" min={1} max={48} defaultValue={e.jornada_semanal} /></label>
        <label>Cargo<input name="cargo" defaultValue={e.cargo} required /></label>
        <label>Tipo de contrato<input name="tipo_contrato" defaultValue={e.tipo_contrato} required /></label>
        <label>Salario mensual<input name="salario" type="number" min={1000000} step={1} defaultValue={e.salario} required /></label>
        <label>Auxilio de transporte<select name="auxilio_transporte" defaultValue={e.auxilio_transporte ? "si" : "no"}><option value="si">Sí</option><option value="no">No</option></select></label>
        <label>Fecha de ingreso<input name="fecha_ingreso" type="date" defaultValue={e.fecha_ingreso} required /></label>
        <label>Fecha de retiro<input name="fecha_retiro" type="date" defaultValue={e.fecha_retiro ?? ""} /></label>
        <label>Activo<select name="activo" defaultValue={e.activo ? "si" : "no"}><option value="si">Sí</option><option value="no">No (retirado)</option></select></label>
        <label className="full" style={{ marginTop: 6, color: "var(--oc-purple)" }}>Cuenta para el pago de nómina</label>
        <label>Banco<select name="banco" defaultValue={e.banco ?? ""}><option value="">— elige —</option>{BANCOS.map((b) => <option key={b.codigo} value={b.nombre}>{b.nombre}</option>)}</select></label>
        <label>Tipo de cuenta<select name="tipo_cuenta" defaultValue={e.tipo_cuenta ?? ""}><option value="">— elige —</option><option value="ahorros">Ahorros</option><option value="corriente">Corriente</option></select></label>
        <label>Número de cuenta (solo dígitos)<input name="cuenta" inputMode="numeric" pattern="[0-9]{6,20}" title="Solo dígitos, 6 a 20" defaultValue={e.cuenta ?? ""} placeholder="sin puntos ni guiones" /></label>
        <label>Certificación bancaria (PDF sin clave o imagen){docs.find((d) => d.tipo === "certificacion_bancaria") && <A href={`/nomina/empleados/doc/${docs.find((d) => d.tipo === "certificacion_bancaria")!.id}`} className="nm-sub" title="Abrir">📎 {docs.find((d) => d.tipo === "certificacion_bancaria")!.nombre}</A>}<input name="certificacion" type="file" accept=".pdf,image/*" /></label>
        <label className="full" style={{ marginTop: 6, color: "var(--oc-purple)" }}>Consentimiento de datos e imagen (Ley 1581)</label>
        <label>Consentimiento firmado el<input name="consentimiento_firmado_en" type="date" defaultValue={e.consentimiento_firmado_en ?? ""} /></label>
        <label>Archivo del consentimiento (PDF/imagen){docs.find((d) => d.tipo === "consentimiento") ? <A href={`/nomina/empleados/doc/${docs.find((d) => d.tipo === "consentimiento")!.id}`} className="nm-sub" title="Abrir">📎 {docs.find((d) => d.tipo === "consentimiento")!.nombre}</A> : e.consentimiento_archivo && <span className="nm-sub" style={{ textTransform: "none" }}>registrado: {e.consentimiento_archivo}</span>}<input name="consentimiento" type="file" accept=".pdf,image/*" /></label>
      </div>
      <div className="nm-acts" style={{ marginTop: 10 }}><button type="submit">Guardar ficha</button></div>
    </form>
  );
}

const rolLabel = (r: string) => (r === "admin_punto" ? "admin de punto" : r === "rrhh" ? "RRHH" : "colaborador");
const cap = (s: string) => (s || "").toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()).replace(/\bEps\b/, "EPS").replace(/\bAfp\b/, "AFP").replace(/\bArl\b/, "ARL");
