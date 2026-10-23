"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ruta } from "@/lib/ruta";

// LA CÁSCARA DE MERCADEO: barra lateral con grupos que se abren y se cierran
// (pedido de Daniel 23-oct-2026: "un menú lateral desplegable donde vayamos
// metiendo todo lo que haga falta"), cabecera con "Vista" y "Cerrar sesión", y en
// celular la barra se vuelve un cajón. Para sumar una sección: agregarla a GRUPOS
// y su vista en VistaMercadeo.tsx (misma clave).

type Item = { sec: string; label: string; ico: string; tag?: string };
export const GRUPOS: { titulo: string; items: Item[] }[] = [
  { titulo: "General", items: [{ sec: "", label: "Inicio", ico: "inicio" }] },
  { titulo: "CRM", items: [
    { sec: "campanas", label: "Campañas", ico: "campanas" },
    { sec: "audiencias", label: "Audiencias", ico: "audiencia" },
    { sec: "plantillas", label: "Plantillas WhatsApp", ico: "plantillas" },
    { sec: "envios", label: "Estado de envíos", ico: "envios" },
  ] },
  { titulo: "Análisis Loopy", items: [
    { sec: "cohortes", label: "Cohortes", ico: "cohortes" },
    { sec: "ltv", label: "LTV", ico: "ltv" },
    { sec: "adquisicion", label: "Adquisición", ico: "adq" },
    { sec: "retencion", label: "Retención", ico: "ret" },
    { sec: "reactivacion", label: "Reactivación", ico: "react" },
  ] },
  { titulo: "Resultados del CRM", items: [
    { sec: "palancas", label: "Por palanca", ico: "palanca" },
    { sec: "mensajes", label: "Mensajes", ico: "mensajes" },
    { sec: "canjes", label: "Canjes y costos", ico: "canjes" },
  ] },
];

// Íconos de trazo (24×24), los mismos de las tarjetas de las vistas.
export const ICONOS: Record<string, string> = {
  inicio: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  campanas: '<path d="M3 11l15-6v14L3 13z"/><path d="M7 13v5a2 2 0 004 0v-3"/>',
  audiencia: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.6c2.6.2 4.6 2 5.4 5.4"/>',
  plantillas: '<path d="M4 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H9l-5 4z"/><path d="M8 8h8M8 12h5"/>',
  envios: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  cohortes: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h12M9 3v18M15 3v12"/>',
  ltv: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>',
  adq: '<circle cx="10" cy="8" r="4"/><path d="M2 21c1-4 4-6 8-6"/><path d="M18 14v7M14.5 17.5h7"/>',
  ret: '<path d="M3 12a9 9 0 0115.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 01-15.5 6.3L3 16"/><path d="M3 21v-5h5"/>',
  react: '<path d="M12 21s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 11c0 5.6-7 10-7 10z"/>',
  palanca: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  mensajes: '<path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  canjes: '<path d="M3 7h18v4a2 2 0 000 4v4H3v-4a2 2 0 000-4z"/><path d="M14 7v12" stroke-dasharray="2 2.5"/>',
  personas: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.2-4.4 4.2-6.5 8-6.5s6.8 2.1 8 6.5"/>',
};

export function CascaraMercadeo({ email, iniciales, enPausa, sello, salir, children }: {
  email: string; iniciales: string; enPausa: boolean; sello: string;
  salir: () => Promise<void>; children: React.ReactNode;
}) {
  const p = usePathname();
  const actual = p.replace(/^.*\/mercadeo\/?/, "").split("/")[0] ?? "";
  const [abierto, setAbierto] = useState(false);
  const [cerrados, setCerrados] = useState<string[]>([]);

  useEffect(() => { try { setCerrados(JSON.parse(localStorage.getItem("mk_cerrados") || "[]")); } catch { /* sin almacenamiento: todo abierto */ } }, []);
  useEffect(() => { setAbierto(false); }, [p]);          // navegar cierra el cajón en celular

  const alternar = (g: string) => {
    const nuevo = cerrados.includes(g) ? cerrados.filter((x) => x !== g) : [...cerrados, g];
    setCerrados(nuevo);
    try { localStorage.setItem("mk_cerrados", JSON.stringify(nuevo)); } catch { /* opcional */ }
  };

  return (
    <div className={"mk" + (abierto ? " abierto" : "")}>
      <aside className="mk-side">
        <div className="mk-brand">
          <span className="mk-logo" aria-hidden="true">🫐</span>
          <div><b>OAKBERRY</b><small>Mercadeo · CRM</small></div>
        </div>
        <nav className="mk-nav" aria-label="Secciones de mercadeo">
          {GRUPOS.map((g) => {
            const cerrado = cerrados.includes(g.titulo);
            return (
              <div key={g.titulo} className={"mk-grupo" + (cerrado ? " cerrado" : "")}>
                <button type="button" aria-expanded={!cerrado} onClick={() => alternar(g.titulo)}>
                  {g.titulo}<span className="c" aria-hidden="true">▾</span>
                </button>
                <div className="mk-items">
                  {g.items.map((i) => (
                    <a key={i.sec} href={ruta(i.sec ? `/mercadeo/${i.sec}` : "/mercadeo")} className={actual === i.sec ? "on" : ""}>
                      <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONOS[i.ico] }} />
                      <span>{i.label}</span>
                      {i.sec === "campanas" && enPausa && <span className="tag">en pausa</span>}
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="mk-user">
          <span className="mk-avatar">{iniciales}</span>
          <div><b>{email}</b><i>Equipo Manel Foods</i></div>
          <form action={salir}><button type="submit" title="Cerrar sesión" aria-label="Cerrar sesión">⎋</button></form>
        </div>
      </aside>
      <div className="mk-velo" onClick={() => setAbierto(false)} />
      <div className="mk-body">
        <header className="mk-top">
          <button type="button" className="hamb" aria-label="Abrir menú" onClick={() => setAbierto(true)}>☰</button>
          <span className="vista">Vista: <b>Mercadeo · Centro de mando CRM</b></span>
          <div className="der">
            <span className="sello">{sello}</span>
            <a className="portal" href={ruta("/")}>Portal</a>
            <form action={salir}><button type="submit" className="salir">Cerrar sesión</button></form>
          </div>
        </header>
        <main className="mk-main">{children}</main>
      </div>
    </div>
  );
}
