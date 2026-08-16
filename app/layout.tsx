import "./globals.css";
import type { Metadata } from "next";
import { Bebas_Neue, Montserrat, DM_Mono } from "next/font/google";

// Cáscara mínima: fuentes y estilos, nada más.
//
// El menú del portal NO vive acá sino en `(portal)/layout.tsx`, porque las dos
// rutas públicas (/cuentas-de-cobro y /cotizaciones) son landings aparte: un
// proveedor externo no debe ver —ni de reojo— Conciliación, Pagos o Maestros.
// Antes el menú salía igual si quien abría el link estaba logueado.
const display = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--font-display", display: "swap" });
const sans = Montserrat({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"], variable: "--font-sans", display: "swap" });
const mono = DM_Mono({ weight: ["400", "500"], subsets: ["latin"], variable: "--font-mono", display: "swap" });

// `metadataBase` es obligatorio para que Next resuelva a URL ABSOLUTA las rutas
// relativas de `openGraph.images`. Sin él, WhatsApp/Meta reciben una ruta
// relativa, no cargan nada, y el link sale pelado — que es como estuvo hasta el
// 2026-08-16. Se puede pisar con NEXT_PUBLIC_SITE_URL para previews de Vercel.
//
// `robots: noindex` acá es el cinturón sobre los tirantes de `app/robots.ts`:
// robots.txt es una petición que el crawler puede ignorar; la meta se aplica ya
// teniendo la página. Las dos landings públicas lo heredan y está bien: que
// WhatsApp muestre la tarjeta no exige que Google indexe el formulario.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.manelfoods.co"),
  title: "Portal Oakberry",
  description: "Portal oakberry-core — cáscara multi-módulo. Contabilidad.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
