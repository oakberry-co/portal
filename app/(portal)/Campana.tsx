import { ruta } from "@/lib/ruta";

/** La campana de la barra: cuántos avisos tiene esta persona y el enlace a la
 *  lista. Es un enlace y no un desplegable a propósito: en el celular un
 *  desplegable más en la barra no cabe, y la página de avisos sí. */
export function Campana({ n }: { n: number }) {
  return (
    <a href={ruta("/contabilidad/avisos")} className={"nav-campana" + (n > 0 ? " con" : "")}
       title={n > 0 ? `${n} aviso${n === 1 ? "" : "s"} por mirar` : "Sin avisos"} aria-label="Avisos">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {n > 0 && <b>{n > 99 ? "99+" : n}</b>}
    </a>
  );
}
