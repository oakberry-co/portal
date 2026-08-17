"use client";

import { useActionState } from "react";
import { enviarCotizacion, type Resultado } from "./actions";
import { CasillasDocumentos } from "../CasillasDocumentos";
import { AREAS, PLAZOS_NEGOCIADOS } from "@/lib/areas";

export function FormCotizacion() {
  const [estado, action, pending] = useActionState<Resultado | null, FormData>(enviarCotizacion, null);

  if (estado?.ok) {
    return (
      <div className="pub-ok">
        <div className="pub-ok-ico">✓</div>
        <h2>¡Cotización recibida!</h2>
        <p>Guárdala con este código y ponlo en tu factura final cuando la emitas:</p>
        <div className="pub-cot">{estado.codigo}</div>
        <p>El equipo de Oakberry la revisa y te contacta. Gracias 💜</p>
        {estado.aviso && <p className="pub-aviso">⚠️ {estado.aviso}</p>}
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
        <label>Número de tu cotización
          <input name="numero_cotizacion" placeholder="El consecutivo que tú le pusiste" />
        </label>
        <label>Área con la que trataste
          <select name="area" defaultValue="">
            <option value="">Selecciona…</option>
            {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <label className="pub-full">Valor cotizado (COP)<input name="valor" inputMode="numeric" placeholder="$ 0" /></label>
      <label className="pub-full">Concepto<input name="concepto" placeholder="¿Qué cotizas?" /></label>
      <label className="pub-full">Descripción / detalle
        <textarea name="descripcion" rows={2} placeholder="Detalle de la propuesta" />
      </label>

      {/* El adelanto es OBLIGATORIO: este formulario existe solo para cotizaciones
          con anticipo. Sin anticipo no hay nada que pagar por adelantado y el
          trámite es la factura, que ya tiene su propio carril. */}
      <div className="pub-row">
        <label>% de adelanto *
          <input name="adelanto_pct" required inputMode="decimal" min={1} max={100}
                 type="number" step="1" placeholder="50" />
        </label>
        <label>Plazo del saldo
          <select name="plazo_dias" defaultValue="30">
            {PLAZOS_NEGOCIADOS.map((p) => (
              <option key={p.valor} value={p.valor}>{p.label}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="pub-hint">
        ¿No hay anticipo? Entonces no necesitas registrar la cotización: mándanos
        directamente la factura a <b>compras@manelfoods.com</b>.
      </p>

      <div className="pub-sec">Documentos</div>
      <p className="pub-hint">Toca cada uno para adjuntarlo. PDF o foto.</p>
      <CasillasDocumentos />

      {estado?.error && <div className="pub-err">{estado.error}</div>}
      <button className="pub-btn" type="submit" disabled={pending}>{pending ? "Enviando…" : "Enviar cotización"}</button>
    </form>
  );
}
