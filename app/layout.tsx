import "./globals.css";
import type { Metadata } from "next";
import { Bebas_Neue, Montserrat, DM_Mono } from "next/font/google";
import { getCurrentUserOrNull } from "@/lib/auth";
import { puede, type Cap } from "@/lib/permisos";
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
// `cap` = capacidad que se necesita para VERLO (el contador solo ve lo suyo).
const MENU: { label: string; href?: string; cap: Cap }[] = [
  { label: "Conciliación", href: "/contabilidad/conciliacion", cap: "ver_conciliacion" },
  { label: "Pagos", href: "/contabilidad/pagos", cap: "ver_pagos" },
  { label: "Causación", cap: "clasificar" },
  { label: "Bancos", cap: "pagos" },
  { label: "Maestros", href: "/contabilidad/maestros", cap: "maestros" },
  { label: "Dashboard", href: "/contabilidad/dashboard", cap: "dashboard" },
  { label: "Cuentas de cobro", href: "/contabilidad/cuentas-de-cobro", cap: "intake" },
  { label: "Cotizaciones", href: "/contabilidad/cotizaciones", cap: "intake" },
  { label: "Configuración", href: "/contabilidad/configuracion", cap: "usuarios" },
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
              {MENU.filter((m) => puede(user.rol, m.cap)).map((m) =>
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
        {user && puede(user.rol, "asistente") && <AsistenteFloating />}
      </body>
    </html>
  );
}
