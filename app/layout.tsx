import "./globals.css";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Portal Oakberry",
  description: "Portal oakberry-core — cáscara multi-módulo",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="es">
      <body>
        <div className="topbar">
          <a href="/" className="brand">Oakberry · Portal</a>
          <span className="who">{user.email} · {user.rol}</span>
        </div>
        {children}
      </body>
    </html>
  );
}
