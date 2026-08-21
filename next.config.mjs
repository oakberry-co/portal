/** @type {import('next').NextConfig} */
const nextConfig = {
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
  // Es un tope POR PETICIÓN, y desde que cada documento sube en la suya
  // (lib/intake-subida.ts) eso equivale a un tope POR DOCUMENTO: un envío con
  // cuatro documentos de 3 MB pasa sin problema. Queda alineado con
  // `TOPE_ARCHIVO_BYTES` (lib/documentos.ts), que es lo que el navegador le
  // promete al proveedor; el centinela `scripts/test_peso_documentos.js`
  // comprueba que las dos cifras digan lo mismo.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
