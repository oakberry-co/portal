/** @type {import('next').NextConfig} */
const nextConfig = {
  // El cliente `pg` es solo de servidor; que no intente empacarlo al bundle del navegador.
  serverExternalPackages: ["pg", "exceljs", "@anthropic-ai/sdk"],
};

export default nextConfig;
