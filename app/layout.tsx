import "./globals.css";
import type { Metadata } from "next";
import { Bebas_Neue, Montserrat, DM_Mono } from "next/font/google";
import { getCurrentUserOrNull } from "@/lib/auth";
import { signOut } from "@/auth";
import { AsistenteFloating } from "./AsistenteFloating";

const display = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--font-display", display: "swap" });
const sans = Montserrat({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"], variable: "--font-sans", display: "swap" });
const mono = DM_Mono({ weight: ["400", "500"], subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Portal Oakberry",
  description: "Portal oakberry-core — cáscara multi-módulo. Contabilidad.",
};

// La cáscara: cada entrada es un módulo. Sin href = aún no disponible ("pronto").
const MENU: { label: string; href?: string }[] = [
  { label: "Conciliación", href: "/contabilidad/conciliacion" },
  { label: "Pagos", href: "/contabilidad/pagos" },
  { label: "Causación" },
  { label: "Bancos" },
  { label: "Maestros", href: "/contabilidad/maestros" },
  { label: "Dashboard", href: "/contabilidad/dashboard" },
  { label: "Cuentas de cobro", href: "/contabilidad/cuentas-de-cobro" },
  { label: "Cotizaciones", href: "/contabilidad/cotizaciones" },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserOrNull();
  return (
    <html lang="es" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        {user && (
          <header className="nav">
            <a href="/" className="nav-brand">
              <span className="nav-dot" />Oakberry<span className="nav-thin">· Portal</span>
            </a>
            <nav className="nav-menu">
              {MENU.map((m) =>
                m.href ? (
                  <a key={m.label} href={m.href} className="nav-link">{m.label}</a>
                ) : (
                  <span key={m.label} className="nav-link soon">{m.label}<i>pronto</i></span>
                )
              )}
            </nav>
            <div className="nav-user">
              <span className="nav-who"><b>{user.email}</b><i>{user.rol}</i></span>
              <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
                <button className="nav-out" type="submit">Salir</button>
              </form>
            </div>
          </header>
        )}
        {children}
        {user && <AsistenteFloating />}
      </body>
    </html>
  );
}
