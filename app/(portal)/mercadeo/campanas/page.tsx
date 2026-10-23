import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { ruta } from "@/lib/ruta";
import { cargarCampanas, cargarPalancas, cargarSnapshot } from "@/lib/crm-campanas";
import { filasDeSnapshot, avanceDe, usadoTope, recompra, fmt, pesos, pp, p1, ESTADO_TXT, TIER_TXT, type FilaAvance } from "@/lib/crm-proyeccion";
import { VistaMercadeo } from "../VistaMercadeo";

export const dynamic = "force-dynamic";

// LAS CAMPAÑAS DEL CRM: las que están al aire arriba, después las pausadas, los
// borradores y las terminadas. El avance (cupones, canjes, recompra contra control) sale
// de la foto de la mañana; el estado sale de la base en vivo. Debajo, el histórico de
// tandas por semana (lo que se mandaba antes de que existieran las campañas).
export default async function CampanasPage() {
  const u = await getCurrentUser();
  const [campanas, palancas, { datos, generado }] = await Promise.all([cargarCampanas(), cargarPalancas(), cargarSnapshot()]);
  const puedeLanzar = puede(u.rol, "lanzar_campanas");
  const nombre = Object.fromEntries(palancas.map((p) => [p.id, p.nombre]));
  const avance = filasDeSnapshot(datos, "avance") as unknown as FilaAvance[];
  const pausado = filasDeSnapshot(datos, "envios").some((e) => e.estado === "pausado");
  const sello = generado?.toLocaleString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  const quien = (c: (typeof campanas)[number]) => [
    c.ciudades.length ? c.ciudades.join(", ") : "Todo el país",
    c.tiendas.length ? `${c.tiendas.length} tienda${c.tiendas.length > 1 ? "s" : ""}` : null,
    c.tiers.length === 5 ? "todos los grupos" : c.tiers.join(" "),
    c.canales.map((k) => (k === "wa" ? "WhatsApp" : k === "email" ? "correo" : k)).join(" + "),
  ].filter(Boolean).join(" · ");

  return (
    <div className="container container-wide mk-pagina">
      {sello && <p className="mk-sello">Avance al {sello}</p>}
      <div className="mk">
        <div className="titulo cf-cabeza">
          <div>
            <h1>Campañas</h1>
            <p>Escoges a quién, con qué palancas, cuánto tiempo y hasta cuántos canjes; el CRM escribe solo cada mañana a quien le toca, con su grupo de control.</p>
          </div>
          {puedeLanzar && <a className="boton" href={ruta("/mercadeo/campanas/nueva")}>+ Nueva campaña</a>}
        </div>
        {pausado && (
          <div className="aviso"><div><b>Los envíos a clientes están en pausa.</b>Una campaña al aire no le escribe a nadie hasta que se reanuden.</div></div>
        )}
        <div className="tarjeta">
          <header><h2>Campañas</h2><p>Al aire primero · el tope cuenta lo canjeado y lo que se espera canjear de los cupones vivos</p></header>
          <div className="cuerpo">
            {campanas.length === 0 ? <div className="vacio">Todavía no hay campañas.</div> : (
              <div className="tabla"><table>
                <thead><tr>
                  <th>Campaña</th><th className="izq">Estado</th><th className="izq">A quién</th><th className="izq">Palancas</th>
                  <th className="izq">Vigencia</th><th>Cupones · canjes</th><th className="izq">Tope</th><th>Volvieron vs. control</th>
                </tr></thead>
                <tbody>
                  {campanas.map((c) => {
                    const a = avanceDe(avance, c.codigo, palancas);
                    const usado = usadoTope(a, c.tope_tipo), frac = Math.min(1, usado / c.tope_valor);
                    const r = recompra(a), e = ESTADO_TXT[c.estado];
                    return (
                      <tr key={c.codigo}>
                        <td className="cf-celda-nombre">
                          <a href={ruta(`/mercadeo/campanas/${c.codigo}`)}><b>{c.codigo}</b> · {c.nombre}</a>
                          <span>{c.creada_por.split("@")[0]} · paga {c.paga}</span>
                        </td>
                        <td className="izq"><span className={`chip ${e.cls}`}>{e.txt}</span></td>
                        <td className="izq cf-envolver">{quien(c)}</td>
                        <td className="izq cf-envolver">{c.palancas.map((p) => nombre[p] ?? p).join(", ")}</td>
                        <td className="izq">{c.desde.slice(5).split("-").reverse().join("/")} → {c.hasta.slice(5).split("-").reverse().join("/")}</td>
                        <td>{fmt(a.cupones)}<span className="cf-sub">{fmt(a.canjes)} canjes</span></td>
                        <td className="izq">
                          <div className="cf-barra" title={`${fmt(usado)} de ${fmt(c.tope_valor)}`}><i style={{ width: `${frac * 100}%` }} /></div>
                          <span className="cf-sub">{c.tope_tipo === "canjes" ? `${fmt(usado)} / ${fmt(c.tope_valor)} canjes` : `${pesos(usado)} / ${pesos(c.tope_valor)}`}</span>
                        </td>
                        <td className={r.dif == null ? "" : r.dif > 0 ? "pos" : "neg"} title={`Recibieron: ${p1(r.lt)} · control: ${p1(r.lc)}`}>
                          {a.cupones ? pp(r.dif) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
        <p className="cf-pie">Grupos: {Object.entries(TIER_TXT).map(([k, v]) => `${k} ${v.toLowerCase()}`).join(" · ")}. Si una persona cabe en dos campañas al aire, la toma la más antigua.</p>
      </div>
      {datos ? <VistaMercadeo seccion="campanas" datos={datos} base={ruta("/mercadeo")} /> : null}
    </div>
  );
}
