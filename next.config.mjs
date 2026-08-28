// AMBIENTE DE PRUEBAS — el MISMO repo sirve los dos despliegues.
//
//   producción  →  www.manelfoods.co            (sin BASE_PATH)
//   pruebas     →  www.manelfoods.co/pruebas    (BASE_PATH=/pruebas, otra base)
//
// Son DOS despliegues con DOS bases. La separación NO es un `if` dentro de la
// app: si /pruebas fuera una ruta más del mismo deploy compartiría el pool de
// conexiones, y un solo camino que se olvide escribe la factura de mentiras en
// los libros de verdad. Acá lo único compartido es el código.
//
// El deploy de producción REESCRIBE /pruebas/* hacia el otro origen; el de
// pruebas no reescribe nada (si lo hiciera, se llamaría a sí mismo en bucle).
const BASE_PATH = process.env.BASE_PATH || "";
const PRUEBAS_ORIGIN = process.env.PRUEBAS_ORIGIN || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(BASE_PATH ? { basePath: BASE_PATH } : {}),

  // El navegador también necesita el prefijo (los `<a href>` pelados lo llevan a
  // mano, ver lib/ruta.ts). Sale de la MISMA variable a propósito: dos variables
  // que hay que mantener iguales terminan distintas justo el día que importa.
  env: { NEXT_PUBLIC_BASE_PATH: BASE_PATH },

  async rewrites() {
    if (BASE_PATH || !PRUEBAS_ORIGIN) return [];   // solo el deploy de producción reescribe
    return [
      { source: "/pruebas", destination: `${PRUEBAS_ORIGIN}/pruebas` },
      { source: "/pruebas/:path*", destination: `${PRUEBAS_ORIGIN}/pruebas/:path*` },
    ];
  },

  // El cliente `pg` es solo de servidor; que no intente empacarlo al bundle del navegador.
  serverExternalPackages: ["pg", "exceljs", "@anthropic-ai/sdk"],

  // OJO: ESTE NÚMERO NO SUBE EL TOPE, SOLO PUEDE BAJARLO.
  //
  // Los formularios públicos de intake suben documentos por Server Action, y el
  // tope de verdad lo pone VERCEL: 4,5 MB por request, con un 413
  // `FUNCTION_PAYLOAD_TOO_LARGE` devuelto EN EL BORDE, antes de que la función
  // exista. Comprobado contra producción el 21-ago-2026 (4,0 MB → 405; 5,5 MB →
  // 413). Acá decía "15mb" y eso fue justamente lo que nos hizo creer que 15 MB
  // pasaban: el proveedor adjuntaba, daba enviar, y la página se caía sin código
  // de error, porque no hubo error del servidor — no hubo servidor.
  //
  // Queda alineado con `TOPE_ENVIO_BYTES` (lib/documentos.ts), que es lo que el
  // navegador le promete al proveedor. Las dos cifras tienen que decir lo mismo;
  // el centinela `scripts/test_peso_documentos.js` lo comprueba.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
