"use client";

import { useActionState } from "react";
import { enviarCotizacion, type Resultado } from "./actions";

export function FormCotizacion({ areas }: { areas: string[] }) {
  const [estado, action, pending] = useActionState<Resultado | null, FormData>(enviarCotizacion, null);

  if (estado?.ok) {
    return (
      <div className="pub-ok">
        <div className="pub-ok-ico">✓</div>
        <h2>¡Cotización recibida!</h2>
        <p>Guárdala con este código y ponlo en tu factura final cuando la emitas:</p>
        <div className="pub-cot">{estado.codigo}</div>
        <p>El equipo de Oakberry la revisa y te contacta. Gracias 💜</p>
        <a className="pub-btn ghost" href="/cotizaciones">Enviar otra</a>
      </div>
    );
  }

  return (
    <form action={action} className="pub-form">
      <div className="pub-sec">Tus datos</div>
      <label className="pub-full">Razón social / Nombre *
        <input name="razon_social" required placeholder="Ej. Servicios XYZ S.A.S." />
      </label>
      <div className="pub-row">
        <label>NIT *<input name="nit" required inputMode="numeric" placeholder="900123456" /></label>
        <label>Teléfono / WhatsApp<input name="telefono" inputMode="tel" placeholder="300 000 0000" /></label>
      </div>
      <div className="pub-row">
        <label>Nombre de contacto<input name="contacto" placeholder="Quién responde" /></label>
        <label>Correo electrónico<input name="correo" type="email" placeholder="correo@dominio.com" /></label>
      </div>

      <div className="pub-sec">La cotización</div>
      <div className="pub-row">
        <label>Área
          <select name="area" defaultValue="">
            <option value="">Selecciona…</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>Valor cotizado (COP)<input name="valor" inputMode="numeric" placeholder="$ 0" /></label>
      </div>
      <label className="pub-full">Concepto<input name="concepto" placeholder="¿Qué cotizas?" /></label>
      <label className="pub-full">Descripción / detalle
        <textarea name="descripcion" rows={2} placeholder="Detalle de la propuesta" />
      </label>

      <div className="pub-sec">Documentos</div>
      <label className="pub-full pub-file">Sube tu cotización, portafolio, RUT… (PDF o imágenes)
        <input name="documentos" type="file" multiple accept=".pdf,image/*" />
      </label>

      {estado?.error && <div className="pub-err">{estado.error}</div>}
      <button className="pub-btn" type="submit" disabled={pending}>{pending ? "Enviando…" : "Enviar cotización"}</button>
    </form>
  );
}
