// Subida de documentos del intake → relay en la VM → Google Drive (carpeta
// CONTABILIDAD, ya compartida con el equipo). El portal NO tiene credenciales de
// Google; le manda el archivo a la VM (que sí las tiene) con un secreto compartido.
//   env: INTAKE_UPLOAD_URL (https://api.oakberry-cupones.com/intake/upload)
//        INTAKE_UPLOAD_SECRET (secreto compartido con la VM)

/** Un documento del intake tal como queda en `documentos` (JSONB).
 *  `path` vacío + estado 'pendiente' = el archivo NO llegó a Drive (el proveedor
 *  sí quedó registrado; el equipo le pide el adjunto por correo). */
export type DocIntake = {
  nombre: string;
  path: string;
  tipo: string;
  estado: "subido" | "pendiente";
  error?: string;
};

export type ResultadoSubida = { docs: DocIntake[]; fallidos: number };

function config() {
  return { url: process.env.INTAKE_UPLOAD_URL, secret: process.env.INTAKE_UPLOAD_SECRET };
}

/** Sube UN archivo. Lanza si falla — el llamador decide si eso tumba el envío. */
export async function subirAintake(file: File, tipo: string): Promise<{ url: string; nombre: string }> {
  const { url, secret } = config();
  if (!url || !secret) throw new Error("Falta configurar la subida a Drive (INTAKE_UPLOAD_URL / INTAKE_UPLOAD_SECRET en Vercel).");

  const fd = new FormData();
  fd.set("tipo", tipo);
  fd.set("file", file, file.name);
  const r = await fetch(url, { method: "POST", headers: { "X-Intake-Secret": secret }, body: fd });
  if (!r.ok) throw new Error("La subida falló (" + r.status + "): " + (await r.text()).slice(0, 200));
  const j = (await r.json()) as { url?: string; name?: string };
  if (!j.url) throw new Error("La subida no devolvió link de Drive.");
  return { url: j.url, nombre: j.name ?? file.name };
}

/** Sube todos los documentos de un envío SIN poder tumbarlo (Regla 18: un loop
 *  humano no se rompe por una falla de infraestructura). Un proveedor externo
 *  llenó 2 minutos de formulario: si Drive falla, se guarda igual y el documento
 *  queda marcado `pendiente` para que el equipo lo pida. La alternativa —lo que
 *  hacía antes— era perder el envío completo. */
export async function subirDocumentos(files: File[], tipo: string): Promise<ResultadoSubida> {
  const docs: DocIntake[] = [];
  let fallidos = 0;
  for (const f of files) {
    try {
      const up = await subirAintake(f, tipo);
      docs.push({ nombre: f.name, path: up.url, tipo: f.type, estado: "subido" });
    } catch (e) {
      fallidos++;
      docs.push({ nombre: f.name, path: "", tipo: f.type, estado: "pendiente",
                  error: (e as Error).message.slice(0, 200) });
      console.error("[intake] no se pudo subir '" + f.name + "':", e);
    }
  }
  return { docs, fallidos };
}

/** Mensaje para el proveedor cuando algún adjunto no llegó a Drive. Se le dice
 *  la verdad (su envío SÍ quedó) en vez de fallar en silencio o botarlo. */
export function avisoDocs(fallidos: number): string | undefined {
  if (!fallidos) return undefined;
  return fallidos === 1
    ? "Tu envío quedó registrado, pero 1 documento no se pudo adjuntar. Contabilidad te lo pedirá por correo."
    : `Tu envío quedó registrado, pero ${fallidos} documentos no se pudieron adjuntar. Contabilidad te los pedirá por correo.`;
}

/** Estado del carril de subida, para el sentinela /api/salud/intake.
 *  NUNCA devuelve el secreto: solo si está puesto. */
export async function estadoIntake(): Promise<{
  ok: boolean; url_configurada: boolean; secreto_configurado: boolean;
  relay: string; detalle?: string;
}> {
  const { url, secret } = config();
  const base = { url_configurada: Boolean(url), secreto_configurado: Boolean(secret) };
  if (!url || !secret) {
    return { ...base, ok: false, relay: "no_probado",
             detalle: "Faltan INTAKE_UPLOAD_URL / INTAKE_UPLOAD_SECRET en Vercel; " +
                      "los documentos del intake NO llegan a Drive." };
  }
  // Ping sin archivo: el relay debe responder algo distinto de 401 (el secreto
  // sirve) y distinto de un error de red (la VM está viva).
  try {
    const r = await fetch(url, { method: "POST", headers: { "X-Intake-Secret": secret },
                                 body: new FormData(), signal: AbortSignal.timeout(8000) });
    if (r.status === 401 || r.status === 403) {
      return { ...base, ok: false, relay: "secreto_rechazado",
               detalle: "El relay rechazó el secreto (revisa INTAKE_UPLOAD_SECRET vs /home/daniel/.intake_env)." };
    }
    return { ...base, ok: true, relay: "responde (HTTP " + r.status + ")" };
  } catch (e) {
    return { ...base, ok: false, relay: "sin_respuesta",
             detalle: "El relay no respondió: " + (e as Error).message.slice(0, 150) +
                      " (revisa `systemctl status oakberry-intake` en la VM)." };
  }
}
