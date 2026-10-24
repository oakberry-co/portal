import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { ruta } from "@/lib/ruta";
import { cargarCampana, cargarPalancas, cargarSnapshot } from "@/lib/crm-campanas";
import {
  filasDeSnapshot, avanceDe, usadoTope, recompra, palancaDeTipo, fmt, pesos as pesosCO, pp, p1, ESTADO_TXT, TIER_TXT, PAISES, type FilaAvance,
} from "@/lib/crm-proyeccion";
import { BotonesEstado } from "../BotonesEstado";
import { MensajePrevio, type VistaMensaje } from "../MensajePrevio";

export const dynamic = "force-dynamic";

const ACCION: Record<string, string> = {
  creada: "La creó (borrador)", creada_y_lanzada: "La creó y la lanzó", lanzar: "La lanzó", pausar: "La pausó",
  reanudar: "La reanudó", terminar: "La terminó",
};

// LA FICHA DE UNA CAMPAÑA: cómo va contra su tope, qué trajo contra el control (por
// palanca y grupo), cómo está armada, cómo le llega al cliente y quién hizo qué.
export default async function CampanaPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const [u, x, palancas, { datos, generado }] = await Promise.all([getCurrentUser(), cargarCampana(codigo), cargarPalancas(), cargarSnapshot()]);
  if (!x) notFound();
  const { campana: c, log } = x;
  const P = PAISES[c.pais ?? "CO"];
  const pesos = (v: number | null | undefined) => pesosCO(v, P.moneda);
  const nombre = Object.fromEntries(palancas.map((p) => [p.id, p.nombre]));
  nombre.bowl_gratis = "Bowl gratis";
  // En RD el tipo de cupón es el mismo de Colombia; el nombre sale de la palanca de RD.
  const deTipo = (t: string) => { const id = palancaDeTipo(t); return c.pais === "DO" ? (palancas.find((p) => p.pais === "DO" && (p.tipo_cupon === t || p.id === "rd_" + id))?.id ?? id) : id; };
  const a = avanceDe(filasDeSnapshot(datos, "avance") as unknown as FilaAvance[], c.codigo, palancas);
  const usado = usadoTope(a, c.tope_tipo), r = recompra(a), e = ESTADO_TXT[c.estado];
  const mensajes = filasDeSnapshot(datos, "vista_mensajes") as unknown as VistaMensaje[];
  const aprobadas = filasDeSnapshot(datos, "plantillas").filter((p) => p.estado === "APPROVED").map((p) => String(p.nombre));
  const sello = generado?.toLocaleString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const topeTxt = (v: number) => (c.tope_tipo === "canjes" ? `${fmt(v)} canjes` : pesos(v));

  // Resultado por grupo × palanca (la palanca se lee del tipo de cupón que quedó en BigQuery).
  const g: Record<string, { tier: string; pal: string; cupones: number; control: number; vt: number; vc: number; canjes: number; costo: number; vivos: number }> = {};
  for (const f of a.filas) {
    const k = f.tier + "|" + deTipo(f.palanca);
    const o = (g[k] ??= { tier: f.tier, pal: deTipo(f.palanca), cupones: 0, control: 0, vt: 0, vc: 0, canjes: 0, costo: 0, vivos: 0 });
    o.cupones += f.cupones; o.control += f.control; o.vt += f.volvio_t; o.vc += f.volvio_c; o.canjes += f.canjes; o.costo += f.costo; o.vivos += f.vivos;
  }
  const lineas = Object.values(g).sort((p, q) => p.tier.localeCompare(q.tier) || q.cupones - p.cupones);

  return (
    <div className="container container-wide mk-pagina">
      {sello && <p className="mk-sello">Avance al {sello}</p>}
      <div className="mk">
        <p className="cf-migas"><a href={ruta("/mercadeo/campanas")}>Campañas</a> › {c.codigo}</p>
        <div className="titulo cf-cabeza">
          <div>
            <h1>{c.codigo} · {c.nombre} <span className={`chip ${e.cls}`} style={{ verticalAlign: "middle" }}>{e.txt}</span></h1>
            <p>La creó {c.creada_por} el {new Date(c.creada_en).toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long" })} · la paga {c.paga === "marca" ? "la marca" : "el franquiciado"}</p>
          </div>
          {puede(u.rol, "lanzar_campanas") && <BotonesEstado codigo={c.codigo} estado={c.estado} />}
        </div>

        <div className="kpis">
          <div className="kpi"><div><b>{fmt(a.cupones)}</b><span>Cupones enviados</span><em>{fmt(a.control)} de control{a.primer ? ` · desde el ${a.primer.slice(8)}/${a.primer.slice(5, 7)}` : ""}</em></div></div>
          <div className="kpi"><div><b>{fmt(a.canjes)}</b><span>Canjes · {pesos(a.costo)}</span><em>{fmt(a.vivos)} cupones siguen vivos</em></div></div>
          <div className="kpi"><div><b>{Math.round((100 * usado) / c.tope_valor)} %</b><span>del tope ({topeTxt(c.tope_valor)})</span><em>cuenta {topeTxt(usado)}: lo canjeado + lo que se espera de lo vivo</em></div></div>
          <div className="kpi"><div><b className={r.dif == null ? "" : r.dif > 0 ? "pos" : "neg"}>{a.cupones ? pp(r.dif) : "—"}</b><span>Volvieron vs. control</span><em>{p1(r.lt)} contra {p1(r.lc)} · 21 días</em></div></div>
        </div>

        <div className="dos">
          <div className="tarjeta"><header><h2>Cómo está armada</h2></header>
            <div className="cuerpo"><table className="cf-ficha"><tbody>
              <tr><td>País</td><td>{P.nombre}</td></tr>
              <tr><td>Ciudades</td><td>{c.ciudades.length ? c.ciudades.join(", ") : "Todas"}</td></tr>
              <tr><td>Tiendas</td><td>{c.tiendas.length ? c.tiendas.join(", ") : "Todas"}</td></tr>
              <tr><td>Grupos</td><td>{c.tiers.map((t) => `${t} ${TIER_TXT[t] ?? ""}`).join(" · ")}</td></tr>
              <tr><td>Canales</td><td>{c.canales.map((k) => (k === "wa" ? "WhatsApp" : k === "email" ? "Correo" : k)).join(" + ")}</td></tr>
              <tr><td>Palancas</td><td>{c.palancas.map((p) => nombre[p] ?? p).join(" · ")}</td></tr>
              <tr><td>Control</td><td>{c.control_pct} %</td></tr>
              <tr><td>Al aire</td><td>{c.desde} → {c.hasta}</td></tr>
              <tr><td>Tope</td><td>{topeTxt(c.tope_valor)}</td></tr>
              {c.notas && <tr><td>Notas</td><td>{c.notas}</td></tr>}
            </tbody></table></div>
          </div>
          <div className="tarjeta"><header><h2>Historial</h2></header>
            <div className="cuerpo">{log.length ? <table className="cf-ficha cf-log"><tbody>
              {log.map((l, i) => {
                const d = l.detalle as { motivo?: string } | null;
                return <tr key={i}><td>{new Date(l.en).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</td>
                  <td>{ACCION[l.accion] ?? l.accion} · {l.por.split("@")[0]}{d?.motivo ? ` — ${d.motivo}` : ""}</td></tr>;
              })}
            </tbody></table> : <div className="vacio">Sin movimientos.</div>}</div>
          </div>
        </div>

        <div className="tarjeta"><header><h2>Resultado por grupo y palanca</h2><p>Volvieron = compraron (sello en la tarjeta) en los 21 días siguientes al cupón · con controles chicos, una o dos personas mueven el porcentaje</p></header>
          <div className="cuerpo">{lineas.length ? <div className="tabla"><table>
            <thead><tr><th>Grupo</th><th className="izq">Palanca</th><th>Recibieron</th><th>Volvieron</th><th>Control</th><th>Control volvió</th><th>Diferencia</th><th>Canjes</th><th>Costo</th><th>Vivos</th></tr></thead>
            <tbody>{lineas.map((l) => {
              const rr = recompra({ volvioT: l.vt, volvioC: l.vc, cupones: l.cupones, control: l.control });
              return <tr key={l.tier + l.pal}><td>{l.tier} · {TIER_TXT[l.tier] ?? ""}</td><td className="izq">{nombre[l.pal] ?? l.pal}</td><td>{fmt(l.cupones)}</td><td>{p1(rr.lt)}</td><td>{fmt(l.control)}</td><td>{p1(rr.lc)}</td>
                <td className={rr.dif == null ? "" : rr.dif > 0 ? "pos" : "neg"}>{pp(rr.dif)}</td><td>{fmt(l.canjes)}</td><td>{pesos(l.costo)}</td><td>{fmt(l.vivos)}</td></tr>;
            })}</tbody>
          </table></div> : <div className="vacio">{c.estado === "borrador" ? "Todavía no ha salido: es un borrador." : "Todavía no ha salido ningún cupón. El avance aparece al día siguiente de la primera corrida."}</div>}</div>
        </div>

        <div className="tarjeta"><header><h2>Cómo le llega al cliente</h2><p>Plantillas fijas por palanca · cambiar un texto pasa por la aprobación de Meta</p></header>
          <div className="cuerpo cf-previas">
            {c.palancas.map((p) => {
              const pal = palancas.find((x) => x.id === p);
              return <div key={p}><h3>{nombre[p] ?? p}</h3><MensajePrevio m={mensajes.find((m) => m.palanca === p)} waAprobada={!!pal?.wa_plantilla && aprobadas.includes(pal.wa_plantilla)} /></div>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
