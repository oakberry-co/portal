// Subida de documentos del intake → relay en la VM → Google Drive (carpeta
// CONTABILIDAD, ya compartida con el equipo). El portal NO tiene credenciales de
// Google; le manda el archivo a la VM (que sí las tiene) con un secreto compartido.
//   env: INTAKE_UPLOAD_URL (https://api.oakberry-cupones.com/intake/upload)
//        INTAKE_UPLOAD_SECRET (secreto compartido con la VM)

export async function subirAintake(file: File, tipo: string): Promise<{ url: string; nombre: string }> {
  const url = process.env.INTAKE_UPLOAD_URL;
  const secret = process.env.INTAKE_UPLOAD_SECRET;
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
