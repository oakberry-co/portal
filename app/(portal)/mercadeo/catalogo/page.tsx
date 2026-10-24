import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { ruta } from "@/lib/ruta";
import { cargarCampanas, cargarPalancas, cargarSnapshot } from "@/lib/crm-campanas";
import { filasDeSnapshot, fmt, pesos, pp, PAISES, type Pais } from "@/lib/crm-proyeccion";
import { BotonPalanca } from "./BotonPalanca";

export const dynamic = "force-dynamic";

const ESTADO: Record<string, { txt: string; cls: string }> = {
  disponible: { txt: "Disponible", cls: "ok" }, borrador: { txt: "En construcción", cls: "warn" },
  pausada: { txt: "Pausada", cls: "bad" }, retirada: { txt: "Retirada", cls: "bad" },
};

// EL CATÁLOGO DE PALANCAS: qué se le puede ofrecer a un cliente, qué cuesta, qué ha
// medido contra control en cada grupo y qué le falta a las que todavía no están listas.
// Una palanca "disponible" tiene todo: descuento en Toteat, regla en el validador y
// plantilla aprobada. Solo esas aparecen al armar una campaña.
export default async function CatalogoPage() {
  const u = await getCurrentUser();
  const [palancas, campanas, { datos }] = await Promise.all([cargarPalancas(), cargarCampanas(), cargarSnapshot()]);
  const plantillas = Object.fromEntries(filasDeSnapshot(datos, "plantillas").map((p) => [String(p.nombre), String(p.estado)]));
  const admin = puede(u.rol, "lanzar_campanas");
  const usando = (id: string) => campanas.filter((c) => c.palancas.includes(id) && (c.estado === "al_aire" || c.estado === "pausada"));
  const wa = (t: string | null) => {
    if (!t) return <span className="cf-sub">—</span>;
    const e = plantillas[t];
    return <><code>{t}</code> <span className={`chip ${e === "APPROVED" ? "ok" : e === "PENDING" ? "warn" : "bad"}`}>{e === "APPROVED" ? "aprobada" : e === "PENDING" ? "en revisión" : e ? e.toLowerCase() : "no enviada a Meta"}</span></>;
  };
  return (
    <div className="container container-wide mk-pagina">
      <div className="mk">
        <div className="titulo cf-cabeza">
          <div>
            <h1>Catálogo de palancas</h1>
            <p>Lo que el CRM le puede ofrecer a un cliente. El efecto es lo que midió cada palanca contra su grupo de control (puntos de recompra a 21 días) y se corrige cada mañana con las campañas al aire.</p>
          </div>
          {admin && <a className="boton" href={ruta("/mercadeo/campanas/nueva")}>+ Nueva campaña</a>}
        </div>
        {(Object.keys(PAISES) as Pais[]).map((pais) => (
        <section key={pais}>
        <h2 className="cf-pais">{PAISES[pais].nombre}</h2>
        <div className="cf-catalogo">
          {palancas.filter((p) => (p.pais ?? "CO") === pais).map((p) => {
            const e = ESTADO[p.estado], c = usando(p.id);
            return (
              <div key={p.id} className="tarjeta">
                <header><h2>{p.nombre} <span className={`chip ${e.cls}`}>{e.txt}</span></h2>
                  {admin && (p.estado === "disponible" || p.estado === "pausada") && <BotonPalanca id={p.id} estado={p.estado} />}
                </header>
                <div className="cuerpo">
                  <p style={{ margin: "0 0 10px" }}>{p.descripcion}</p>
                  <table className="cf-ficha"><tbody>
                    <tr><td>Costo por canje</td><td>{p.costo_canje ? pesos(p.costo_canje, PAISES[p.pais ?? "CO"].moneda) : "Sin costo"}{p.tasa_canje ? ` · se canjea ~${(p.tasa_canje * 100).toFixed(0)} %` : ""}</td></tr>
                    <tr><td>Cupón</td><td>vale {p.vigencia_dias} días{p.dia_envio != null ? ` · sale solo los ${["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"][p.dia_envio]}` : ""}{p.toteat ? ` · Toteat: ${p.toteat}` : ""}</td></tr>
                    <tr><td>WhatsApp</td><td>{wa(p.wa_plantilla)}</td></tr>
                    <tr><td>Correo</td><td>{p.email_plantilla ? <code>{p.email_plantilla}</code> : "—"}</td></tr>
                    <tr><td>Efecto medido</td><td><span className="cf-efectos">{PAISES[p.pais ?? "CO"].tiers.map((t) => {
                      const x = p.efecto?.[t];
                      return <span key={t} className={`cf-ef ${!x ? "nulo" : x.pp > 0 ? "pos" : x.pp < 0 ? "neg" : "nulo"}`} title={x ? `${x.fuente ?? ""}${x.n ? ` · ${fmt(x.n)} recibieron` : ""}` : "Nunca se midió en este grupo"}>{t} {x ? pp(x.pp) : "sin medir"}</span>;
                    })}</span></td></tr>
                    {p.falta && <tr><td>Le falta</td><td>{p.falta}</td></tr>}
                    {c.length > 0 && <tr><td>En campañas</td><td>{c.map((k) => <a key={k.codigo} href={ruta(`/mercadeo/campanas/${k.codigo}`)} style={{ marginRight: 8 }}>{k.codigo}</a>)}</td></tr>}
                  </tbody></table>
                </div>
              </div>
            );
          })}
        </div>
        </section>
        ))}
      </div>
    </div>
  );
}
