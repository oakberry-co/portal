// Piezas visuales compartidas por las pantallas de Nómina.
import { ruta } from "@/lib/ruta";

export function Head({ titulo, sub, acts }: { titulo: string; sub?: React.ReactNode; acts?: React.ReactNode }) {
  return (
    <div className="nm-head">
      <div><h1>{titulo}</h1>{sub && <p className="sub">{sub}</p>}</div>
      {acts && <div className="nm-acts">{acts}</div>}
    </div>
  );
}
export function Kpi({ label, valor, sub, tono }: { label: string; valor: React.ReactNode; sub?: React.ReactNode; tono?: "ok" | "warn" | "bad" | "hl" }) {
  return <div className={"nm-kpi" + (tono ? " " + tono : "")}><i>{label}</i><b>{valor}</b>{sub && <span>{sub}</span>}</div>;
}
export function Pill({ children, tono }: { children: React.ReactNode; tono?: "ok" | "warn" | "bad" | "info" | "gris" }) {
  return <span className={"nm-pill" + (tono ? " " + tono : "")}>{children}</span>;
}
export function Bar({ pct, tono }: { pct: number; tono?: "ok" | "warn" | "bad" }) {
  return <div className={"nm-bar" + (tono ? " " + tono : "")}><span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>;
}
export function Tabs({ items, actual }: { items: { href: string; label: string }[]; actual: string }) {
  return <div className="nm-tabs">{items.map((i) => <a key={i.href} href={ruta(i.href)} className={i.href === actual ? "on" : ""}>{i.label}</a>)}</div>;
}
export function Nota({ children }: { children: React.ReactNode }) { return <div className="nm-nota">{children}</div>; }
export function Vacio({ children }: { children: React.ReactNode }) { return <div className="nm-vacio">{children}</div>; }

/** Lo que una acción dejó dicho al volver: ?aviso= (verde) o ?error= (rojo). */
export function Aviso({ sp }: { sp: { aviso?: string; error?: string } | undefined }) {
  if (!sp?.aviso && !sp?.error) return null;
  return <div className={"nm-aviso " + (sp.error ? "err" : "ok")}>{sp.error ?? sp.aviso}</div>;
}

/** Enlace que conserva el prefijo del ambiente. */
export function A({ href, children, className, title }: { href: string; children: React.ReactNode; className?: string; title?: string }) {
  return <a href={ruta(href)} className={className} title={title}>{children}</a>;
}
export const Sel = ({ name, opts, def, onChangeSubmit }: { name?: string; opts: { v: string; l: string }[] | string[]; def?: string; onChangeSubmit?: boolean }) => (
  <select name={name} defaultValue={def} {...(onChangeSubmit ? { onChange: undefined } : {})}>
    {opts.map((o) => (typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.v} value={o.v}>{o.l}</option>))}
  </select>
);
/** Formulario de filtros GET: cada select envía al cambiar (sin JS queda el botón). */
export function Filtros({ children, action = "" }: { children: React.ReactNode; action?: string }) {
  return (
    <form method="get" action={action} className="nm-filtros nm-filtros-form">
      {children}
      <button type="submit" className="ghost nm-aplicar">Aplicar</button>
    </form>
  );
}
