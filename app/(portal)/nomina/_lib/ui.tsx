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

/** Un botón de maqueta: se ve, no hace nada (y lo dice al pasar el mouse). */
export function Btn({ children, ghost, danger }: { children: React.ReactNode; ghost?: boolean; danger?: boolean }) {
  return <button type="button" className={danger ? "danger" : ghost ? "ghost" : ""} title="Maqueta: todavía no hace nada">{children}</button>;
}

export const Sel = ({ opts, def }: { opts: string[]; def?: string }) => (
  <select defaultValue={def ?? opts[0]}>{opts.map((o) => <option key={o}>{o}</option>)}</select>
);
