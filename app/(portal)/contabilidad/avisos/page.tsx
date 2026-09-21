import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { cargarAvisos } from "@/lib/avisos-cache";
import { ruta } from "@/lib/ruta";
import { MarcarResuelto } from "./MarcarResuelto";

export const dynamic = "force-dynamic";

const fecha = (s: string | null) => (s ? new Date(s).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export default async function AvisosPage() {
  const user = await getCurrentUser();
  const { avisos, ultimaCorrida } = await cargarAvisos(user.rol);
  const operacion = avisos.filter((a) => a.origen === "operacion");
  const casos = avisos.filter((a) => a.origen === "centinela");
  const puedeMarcar = puede(user.rol, "clasificar");

  return (
    <div className="container">
      <h1>🔔 Avisos</h1>
      <p className="sub">Lo que hoy necesita que alguien lo mire, en un solo lugar. Lo <b>operativo</b> se cuenta en vivo con las mismas reglas de cada pantalla; los <b>centinelas</b> corren cada madrugada en la VM (última corrida: <b>{fecha(ultimaCorrida)}</b>). Marcar «ya lo resolví» no lo cierra: lo confirma el centinela en su próxima corrida.</p>

      {avisos.length === 0 && <div className="av-vacio">✅ Nada pendiente para tu rol. Si algo aparece, va a estar acá y en el correo de la mañana.</div>}

      {operacion.length > 0 && (
        <section className="av-sec">
          <h2>Por hacer en el portal <span className="av-cnt">{operacion.length}</span></h2>
          <ul className="av-list">
            {operacion.map((a) => (
              <li key={a.clave} className={"av-item " + a.severidad}>
                <div className="av-n">{a.n}</div>
                <div className="av-cuerpo">
                  <div className="av-tit">{a.titulo}</div>
                  {a.detalle && <div className="av-det">{a.detalle}</div>}
                  {a.queHacer && <div className="av-que">→ {a.queHacer}</div>}
                </div>
                {a.href && <a className="av-ir" href={ruta(a.href)}>Ir</a>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {casos.length > 0 && (
        <section className="av-sec">
          <h2>Centinelas <span className="av-cnt">{casos.length}</span></h2>
          <ul className="av-list">
            {casos.map((a) => (
              <li key={a.clave} className={"av-item " + a.severidad + (a.estado === "en_verificacion" ? " verif" : "")}>
                <div className="av-n">{a.n ?? "•"}</div>
                <div className="av-cuerpo">
                  <div className="av-tit">{a.titulo}
                    {a.dueno && <span className="av-tag">{a.dueno === "compras" ? "equipo" : "Daniel"}</span>}
                    {a.estado === "en_verificacion" && <span className="av-tag verif">marcado por {a.marcadoPor?.split("@")[0]} · lo confirma el centinela</span>}
                  </div>
                  {a.detalle && <div className="av-det">{a.detalle}</div>}
                  {a.queHacer && <div className="av-que">→ {a.queHacer}</div>}
                  <div className="av-desde">desde {fecha(a.desde)}</div>
                </div>
                <div className="av-acc">
                  {a.href && <a className="av-ir" href={ruta(a.href)}>Ir</a>}
                  {puedeMarcar && a.estado === "abierto" && a.casoId && <MarcarResuelto casoId={a.casoId} />}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
