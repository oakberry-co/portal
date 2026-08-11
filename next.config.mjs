/** @type {import('next').NextConfig} */
const nextConfig = {
  // El cliente `pg` es solo de servidor; que no intente empacarlo al bundle del navegador.
  serverExternalPackages: ["pg", "exceljs", "@anthropic-ai/sdk"],
  // Los formularios públicos de intake suben documentos (PDF/imágenes) por Server Action.
  experimental: { serverActions: { bodySizeLimit: "15mb" } },
};

export default nextConfig;
