// Pantalla de login — única ruta pública. "Entrar con Google" dispara el flujo
// de Auth.js; la compuerta de dominio/allowlist está en auth.ts (signIn callback).
import { redirect } from "next/navigation";
import { signIn, auth } from "@/auth";

export const metadata = { title: "Entrar · Portal Oakberry" };

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="login">
      <div className="login-card">
        <div className="login-brand">
          <span className="nav-dot" />Oakberry <span className="nav-thin">· Portal</span>
        </div>
        <h1 className="login-title">Portal de Contabilidad</h1>
        <p className="login-sub">
          Acceso solo para el equipo Oakberry. Entra con tu correo corporativo de Google.
        </p>

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button type="submit" className="btn-google">
            <GoogleG />
            Entrar con Google
          </button>
        </form>

        <p className="login-foot">
          Dominio autorizado: <strong>@manelfoods.com</strong>
        </p>
      </div>
    </main>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}
