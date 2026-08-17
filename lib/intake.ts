// Subida de documentos del intake → relay en la VM → Google Drive (carpeta
// CONTABILIDAD, ya compartida con el equipo). El portal NO tiene credenciales de
// Google; le manda el archivo a la VM (que sí las tiene) con un secreto compartido.
//   env: INTAKE_UPLOAD_URL (https://api.oakberry-cupones.com/intake/upload)
//        INTAKE_UPLOAD_SECRET (secreto compartido con la VM)

/** Un documento del intake tal como queda en `documentos` (JSONB).
 *  `clase` = qué documento es (rut, cedula, certificacion_bancaria, soporte), para
 *  que la bandeja pueda decir "falta el RUT" en vez de listar archivos sueltos.
 *  `path` vacío + estado 'pendiente' = el archivo NO llegó a Drive (el proveedor
 *  sí quedó registrado; el equipo le pide el adjunto por correo). */
export type DocIntake = {
  nombre: string;
  path: string;
  tipo: string;
  clase: string;
  estado: "subido" | "pendiente";
  error?: string;
};

export type ArchivoClasificado = { file: File; clase: string };
export type ResultadoSubida = { docs: DocIntake[]; fallidos: number };

function config() {
  return { url: process.env.INTAKE_UPLOAD_URL, secret: process.env.INTAKE_UPLOAD_SECRET };
}

/** Sube UN archivo. Lanza si falla — el llamador decide si eso tumba el envío.
 *
 *  OJO con `tipo`: el relay de la VM lo mapea contra una lista CERRADA
 *  ('cuentas-de-cobro' | 'cotizaciones') para elegir la subcarpeta de Drive, y
 *  cualquier otra cosa cae en `Intake/Otros`. No meterle la clase de documento
 *  acá — para eso está `nombre`, que la pone al frente del archivo. */
export async function subirAintake(file: File, tipo: string, nombre?: string): Promise<{ url: string; nombre: string }> {
  const { url, secret } = config();
  if (!url || !secret) throw new Error("Falta configurar la subida a Drive (INTAKE_UPLOAD_URL / INTAKE_UPLOAD_SECRET en Vercel).");

  const fd = new FormData();
  fd.set("tipo", tipo);
  fd.set("file", file, nombre ?? file.name);
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
export async function subirDocumentos(archivos: ArchivoClasificado[], tipo: string): Promise<ResultadoSubida> {
  const docs: DocIntake[] = [];
  let fallidos = 0;
  for (const { file: f, clase } of archivos) {
    try {
      // La clase va al FRENTE del nombre ('rut__cedula-juan.pdf') para que quien
      // abra la carpeta en Drive sepa qué es sin abrir el archivo. La carpeta la
      // decide `tipo`, que debe quedar tal cual (ver subirAintake).
      const up = await subirAintake(f, tipo, clase === "otro" ? f.name : `${clase}__${f.name}`);
      docs.push({ nombre: f.name, path: up.url, tipo: f.type, clase, estado: "subido" });
    } catch (e) {
      fallidos++;
      docs.push({ nombre: f.name, path: "", tipo: f.type, clase, estado: "pendiente",
                  error: (e as Error).message.slice(0, 200) });
      console.error("[intake] no se pudo subir '" + f.name + "':", e);
    }
  }
  return { docs, fallidos };
}

/** Saca del formulario los archivos de cada casilla tipada (certificación, RUT,
 *  cédula, soporte) más los sueltos de `documentos`, ya clasificados y con tope. */
export function archivosDelForm(formData: FormData, clases: readonly { name: string; clase: string }[],
                                max = 12): ArchivoClasificado[] {
  const salida: ArchivoClasificado[] = [];
  const tomar = (campo: string, clase: string) => {
    for (const v of formData.getAll(campo)) {
      if (v instanceof File && v.size > 0) salida.push({ file: v, clase });
    }
  };
  for (const c of clases) tomar(c.name, c.clase);
  tomar("documentos", "otro");
  return salida.slice(0, max);
}

/** Encola la certificación bancaria para que el lector la procese en la VM.
 *
 *  Se guarda la fila apenas llega el documento; NO se lee acá porque el OCR vive
 *  en la VM (tesseract, poppler) y no en el runtime de Vercel. El lector corre
 *  por cron, extrae banco/cuenta/titular y decide si la cuenta sirve. Hasta ese
 *  momento el proveedor queda en 'pendiente' y no se puede aprobar. */
export async function registrarCertificacion(
  pool: { query: (q: string, v?: unknown[]) => Promise<unknown> },
  origenTipo: "cuenta_cobro" | "cotizacion", origenId: number,
  nit: string | null, docs: DocIntake[],
): Promise<void> {
  const cert = docs.find((d) => d.clase === "certificacion_bancaria" && d.estado === "subido");
  if (!cert?.path) return;
  const fileId = /\/d\/([A-Za-z0-9_-]{20,})/.exec(cert.path)?.[1] ?? null;
  try {
    await pool.query(
      `INSERT INTO certificacion_bancaria (origen_tipo, origen_id, nit, drive_url, drive_file_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [origenTipo, origenId, nit, cert.path, fileId]);
  } catch (e) {
    // Que no tumbe el envío del proveedor: la fila se puede recrear después.
    console.error("[intake] no se pudo encolar la certificación:", e);
  }
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
