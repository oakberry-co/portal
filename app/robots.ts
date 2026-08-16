import type { MetadataRoute } from "next";

// El portal NO se indexa. Ni los módulos internos (que ya exigen sesión) ni los
// dos intakes públicos (`/cuentas-de-cobro`, `/cotizaciones`).
//
// Por qué también se bloquean los públicos: son formularios OPERATIVOS a los que
// el proveedor llega por un link que le mandamos, no buscando en Google. Salir en
// resultados no suma un solo proveedor real y sí invita bots a una Server Action
// que escribe en Neon y sube hasta 15 MB a Drive. Indexar es superficie de abuso
// sin contraparte.
//
// PERO ojo con el matiz que hace toda la diferencia: los bots que arman el PREVIEW
// de un link (WhatsApp, Meta, Slack) piden la página igual que un buscador. Un
// `Disallow: /` a secas los bloquea y el link vuelve a salir pelado — que es justo
// lo que las `openGraph` de esas dos páginas vienen a arreglar. Por eso van
// permitidos explícitamente, y SOLO sobre las dos rutas públicas.
//
// OJO 2: esto solo funciona si `middleware.ts` deja pasar /robots.txt. Si algún
// día vuelve a caer dentro del matcher, el crawler recibe un 307 a /login y da por
// hecho que no hay directivas. Ese fue el bug del 2026-08-16.
const PREVIEW_BOTS = [
  "facebookexternalhit",
  "WhatsApp",
  "Twitterbot",
  "Slackbot-LinkExpanding",
];

const PUBLICAS = ["/cuentas-de-cobro", "/cotizaciones", "/og/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Buscadores: nada, en ninguna ruta.
      { userAgent: "*", disallow: "/" },
      // Previews de link: solo las dos públicas (y sus tarjetas).
      ...PREVIEW_BOTS.map((userAgent) => ({
        userAgent,
        allow: PUBLICAS,
        disallow: "/",
      })),
    ],
  };
}
