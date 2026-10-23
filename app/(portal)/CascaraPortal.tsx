"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { ruta } from "@/lib/ruta";
import { ICONOS } from "./iconos";

// LA CÁSCARA DEL PORTAL: menú lateral por ÁREAS (Contabilidad · Finanzas · Recursos
// humanos · Operaciones · Mercadeo) que se abren y se cierran, barra superior con la
// vista, la campana y la sesión, y en celular el menú se vuelve un cajón.
// Pedido de Daniel (23-oct-2026): el menú desplegable de Mercadeo para todo
// manelfoods.co; las funciones de cada pantalla siguen igual, cambia el UX/UI.
//
// La barra superior mide 60 px A PROPÓSITO: los encabezados de tabla de Contabilidad
// son sticky con top:60px (globals.css) y quedarían descuadrados con otra altura.
//
// Las áreas llegan YA filtradas por permiso desde el servidor (layout.tsx): esto
// solo pinta. Un ítem sin href es "pronto": se ve, no se abre.

export type ItemMenu = { label: string; href?: string; ico: string; sub?: string };
export type AreaMenu = { id: string; label: string; ico: string; items: ItemMenu[] };

const activo = (p: string, href?: string) =>
  !!href && (href === "/" ? p === "/" : p === href || p.startsWith(href + "/"));

export function CascaraPortal({ areas, email, rol, iniciales, derecha, salir, children }: {
  areas: AreaMenu[]; email: string; rol: string; iniciales: string;
  derecha: React.ReactNode; salir: () => Promise<void>; children: React.ReactNode;
}) {
  const p = usePathname();
  // El ítem activo es el de href más largo que calce (/mercadeo vs /mercadeo/ltv).
  const actual = useMemo(() => {
    let mejor: { area: AreaMenu; item: ItemMenu } | null = null;
    for (const a of areas) for (const i of a.items)
      if (activo(p, i.href) && (!mejor || (i.href!.length > (mejor.item.href ?? "").length))) mejor = { area: a, item: i };
    return mejor;
  }, [areas, p]);

  const [abiertas, setAbiertas] = useState<string[]>(actual ? [actual.area.id] : []);
  const [cajon, setCajon] = useState(false);

  useEffect(() => {
    let guardadas: string[] = [];
    try { guardadas = JSON.parse(localStorage.getItem("pc_abiertas") || "[]"); } catch { /* sin almacenamiento */ }
    setAbiertas((a) => [...new Set([...guardadas, ...a, ...(actual ? [actual.area.id] : [])])]);
  }, [actual]);
  useEffect(() => { setCajon(false); }, [p]);            // navegar cierra el cajón en celular

  const alternar = (id: string) => {
    const nuevo = abiertas.includes(id) ? abiertas.filter((x) => x !== id) : [...abiertas, id];
    setAbiertas(nuevo);
    try { localStorage.setItem("pc_abiertas", JSON.stringify(nuevo)); } catch { /* opcional */ }
  };
  const svg = (k: string) => <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONOS[k] ?? ICONOS.pronto }} />;

  return (
    <div className={"pc" + (cajon ? " abierto" : "")}>
      <aside className="pc-side">
        <a className="pc-brand" href={ruta("/")}>
          <span className="pc-logo" aria-hidden="true">🫐</span>
          <span><b>OAKBERRY</b><small>Portal Manel Foods</small></span>
        </a>
        <nav className="pc-nav" aria-label="Áreas del portal">
          <div className="pc-items pc-solo">
            <a href={ruta("/")} className={p === "/" ? "on" : ""}>{svg("inicio")}<span>Inicio</span></a>
          </div>
          {areas.map((a) => {
            const abierta = abiertas.includes(a.id);
            let ultimoSub: string | undefined;
            return (
              <div key={a.id} className={"pc-area" + (abierta ? "" : " cerrada") + (actual?.area.id === a.id ? " aqui" : "")}>
                <button type="button" aria-expanded={abierta} onClick={() => alternar(a.id)}>
                  {svg(a.ico)}<span>{a.label}</span><i aria-hidden="true">▾</i>
                </button>
                <div className="pc-items">
                  {a.items.map((i) => {
                    const titulo = i.sub && i.sub !== ultimoSub ? <h5 key={"h" + i.sub}>{i.sub}</h5> : null;
                    ultimoSub = i.sub;
                    const cuerpo = i.href
                      ? <a key={i.label} href={ruta(i.href)} className={actual?.item === i ? "on" : ""}>{svg(i.ico)}<span>{i.label}</span></a>
                      : <span key={i.label} className="pronto">{svg(i.ico)}<span>{i.label}</span><em>pronto</em></span>;
                    return titulo ? [titulo, cuerpo] : cuerpo;
                  })}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="pc-user">
          <span className="pc-avatar">{iniciales}</span>
          <div><b>{email}</b><i>{rol}</i></div>
          <form action={salir}><button type="submit" title="Cerrar sesión" aria-label="Cerrar sesión">⎋</button></form>
        </div>
      </aside>
      <div className="pc-velo" onClick={() => setCajon(false)} />
      <div className="pc-body">
        <header className="pc-top">
          <button type="button" className="pc-hamb" aria-label="Abrir menú" onClick={() => setCajon(true)}>☰</button>
          <span className="pc-vista">
            {actual ? <>{actual.area.label}<span className="sep">›</span><b>{actual.item.label}</b></> : <b>Inicio</b>}
          </span>
          <div className="pc-der">
            {derecha}
            <form action={salir}><button type="submit" className="pc-salir">Salir</button></form>
          </div>
        </header>
        <div className="pc-main">{children}</div>
      </div>
    </div>
  );
}
