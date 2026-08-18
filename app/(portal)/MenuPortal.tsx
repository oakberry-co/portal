"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

// EL MENÚ, AGRUPADO. Antes eran 10 enlaces sueltos en una fila que se partía en
// dos renglones y ya no cabía nada más. Agrupados por lo que la persona VIENE A
// HACER —contabilidad, causaciones, configuración— la barra vuelve a una línea
// y deja espacio para lo que falta (bancos, órdenes de compra, internacionales).
//
// Lo que se pierde al esconder enlaces en un desplegable es saber DÓNDE ESTÁS,
// así que el grupo que contiene la página actual queda marcado y su ítem
// resaltado. Sin eso, agrupar es un retroceso.

export type ItemMenu = { label: string; href?: string };
export type GrupoMenu = { label: string; href?: string; items?: ItemMenu[] };

export function MenuPortal({ grupos }: { grupos: GrupoMenu[] }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const ruta = usePathname();

  // Cerrar al tocar fuera o con Escape: un desplegable que se queda abierto
  // tapando la página es peor que no tenerlo.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(null); };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", esc); };
  }, [abierto]);

  useEffect(() => { setAbierto(null); }, [ruta]);   // navegar cierra el menú

  return (
    <nav className="nav-menu" ref={ref}>
      {grupos.map((g) => {
        if (g.href) {
          return (
            <a key={g.label} href={g.href} className={"nav-link" + (ruta === g.href ? " activo" : "")}>
              {g.label}
            </a>
          );
        }
        const items = g.items ?? [];
        const aqui = items.some((i) => i.href && ruta.startsWith(i.href));
        const on = abierto === g.label;
        return (
          <div key={g.label} className="nav-grupo">
            <button type="button" className={"nav-link nav-btn" + (aqui ? " activo" : "") + (on ? " on" : "")}
                    aria-expanded={on} onClick={() => setAbierto(on ? null : g.label)}>
              {g.label}<span className="nav-caret" aria-hidden="true">▾</span>
            </button>
            {on && (
              <div className="nav-drop">
                {items.map((i) =>
                  i.href ? (
                    <a key={i.label} href={i.href}
                       className={"nav-drop-item" + (ruta.startsWith(i.href) ? " activo" : "")}>
                      {i.label}
                    </a>
                  ) : (
                    <span key={i.label} className="nav-drop-item soon">{i.label}<i>pronto</i></span>
                  )
                )}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
