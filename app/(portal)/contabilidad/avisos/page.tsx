import { getCurrentUser } from "@/lib/auth";
import { cargarAvisos } from "@/lib/avisos-cache";
import { ruta } from "@/lib/ruta";

export const dynamic = "force-dynamic";

// La campana muestra SOLO lo que se puede hacer en el portal: cada aviso lleva
// a la pantalla donde está el botón que lo cierra, y desaparece solo cuando se
// hace. Lo que vigilan los centinelas de la VM llega por el correo de la mañana
// (decisión de Daniel, 23-sep-2026).
export default async function AvisosPage() {
  const user = await getCurrentUser();
  const { avisos } = await cargarAvisos(user.rol);

  return (
    <div className="container">
      <h1>🔔 Por hacer</h1>
      <p className="sub">Lo que hoy se puede hacer en el portal y nadie ha hecho, contado en vivo con las mismas reglas de cada pantalla. Cada aviso lleva a donde se resuelve y desaparece solo cuando queda hecho.</p>

      {avisos.length === 0 && <div className="av-vacio">✅ Nada pendiente para tu rol.</div>}

      {avisos.length > 0 && (
        <section className="av-sec">
          <h2>Por hacer en el portal <span className="av-cnt">{avisos.length}</span></h2>
          <ul className="av-list">
            {avisos.map((a) => (
              <li key={a.clave} className={"av-item " + a.severidad}>
                <div className="av-n">{a.n}</div>
                <div className="av-cuerpo">
                  <div className="av-tit">{a.titulo}</div>
                  {a.detalle && <div className="av-det">{a.detalle}</div>}
                  <div className="av-que">→ {a.queHacer}</div>
                </div>
                <a className="av-ir" href={ruta(a.href)}>Ir</a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
