// Endpoints de Auth.js (login, callback de Google, logout, sesión).
// Ruta: /api/auth/* — el redirect_uri de Google es /api/auth/callback/google
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
