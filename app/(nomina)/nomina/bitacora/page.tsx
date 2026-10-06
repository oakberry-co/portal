import { redirect } from "next/navigation";
import { eventos } from "@/lib/rrhh/db";
import { perspectiva } from "@/lib/rrhh/perspectiva";
import { horaBogota } from "@/lib/rrhh/fechas";
import { Head, Aviso, Pill, Nota, Filtros } from "../_lib/ui";

// BITÁCORA: todo lo que escribió una acción del módulo queda en rrhh_eventos
// (append-only). Acá se lee tal cual, sin interpretar: quién, qué, cuándo y el
// detalle crudo. Es la primera parada cuando "la nómina salió distinta".
const LIMITE = 200;

/** Resumen corto del detalle JSON para la tabla (el completo va en el title). */
function resumen(detalle: unknown): { corto: string; largo: string } {
  const largo = detalle == null ? "" : typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  return { corto: largo.length > 140 ? largo.slice(0, 137) + "…" : largo, largo };
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = await perspectiva();
  if (p.tipo !== "rrhh") redirect("/nomina/perfil");

  const todos = await eventos(LIMITE);
  const entidades = [...new Set(todos.map((x) => String(x.entidad)))].sort();
  const ent = sp.ent && entidades.includes(sp.ent) ? sp.ent : "";
  const filas = ent ? todos.filter((x) => x.entidad === ent) : todos;

  return (
    <>
      <Head titulo="Bitácora" sub={<>Últimos {LIMITE} eventos del módulo (rrhh_eventos). Solo lectura. · <Pill tono="info">{filas.length} filas</Pill></>} />
      <Aviso sp={sp} />
      <Filtros>
        <select name="ent" defaultValue={ent}><option value="">Todas las entidades</option>{entidades.map((x) => <option key={x} value={x}>{x}</option>)}</select>
      </Filtros>
      <div className="nm-card nm-scroll">
        {filas.length === 0 ? <div className="nm-vacio">Sin eventos{ent ? ` de "${ent}"` : ""}.</div> : (
          <table className="nm-tabla"><thead><tr><th>#</th><th>Cuándo (Bogotá)</th><th>Entidad</th><th>Id</th><th>Acción</th><th>Actor</th><th>Detalle</th></tr></thead>
            <tbody>{filas.map((x) => { const h = horaBogota(new Date(x.creado_en)); const d = resumen(x.detalle); return (
              <tr key={String(x.id)}><td className="mono">{String(x.id)}</td><td className="mono">{h.fecha} {h.hhmm}</td><td><Pill tono="gris">{x.entidad}</Pill></td><td className="mono nm-sub">{x.entidad_id ?? "—"}</td><td><b>{x.accion}</b></td><td className="nm-sub">{x.actor}</td>
                <td><code title={d.largo} style={{ fontSize: 11, wordBreak: "break-all" }}>{d.corto || "—"}</code></td></tr>); })}</tbody></table>)}
      </div>
      <Nota>Cada acción del módulo (turno, marcación revisada, solicitud decidida, quincena aprobada, incentivo cerrado, liquidación) deja una fila acá con el actor que la firmó. En pruebas, el actor lleva “como Fulano” cuando se actuó con otra perspectiva.</Nota>
    </>
  );
}
