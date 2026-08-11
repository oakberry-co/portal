"use client";

import { useActionState } from "react";
import { enviarCuentaCobro, type Resultado } from "./actions";

export function FormCuentaCobro({ areas }: { areas: string[] }) {
  const [estado, action, pending] = useActionState<Resultado | null, FormData>(enviarCuentaCobro, null);

  if (estado?.ok) {
    return (
      <div className="pub-ok">
        <div className="pub-ok-ico">✓</div>
        <h2>¡Recibido!</h2>
        <p>Tu cuenta de cobro llegó a Oakberry. El equipo de contabilidad la revisa y te contacta. Gracias 💜</p>
        <a className="pub-btn ghost" href="/cuentas-de-cobro">Enviar otra</a>
      </div>
    );
  }

  return (
    <form action={action} className="pub-form">
      <div className="pub-sec">Tus datos</div>
      <label className="pub-full">Razón social / Nombre completo *
        <input name="razon_social" required placeholder="Ej. Servicios XYZ S.A.S." />
      </label>
      <div className="pub-row">
        <label>Tipo de documento
          <select name="tipo_doc" defaultValue="NIT">
            <option value="NIT">NIT</option><option value="CC">Cédula (CC)</option>
            <option value="CE">Cédula extranjería (CE)</option><option value="PPT">PPT</option>
          </select>
        </label>
        <label>Número de documento *
          <input name="num_doc" required inputMode="numeric" placeholder="900123456" />
        </label>
      </div>
      <div className="pub-row">
        <label>Nombre de contacto<input name="contacto" placeholder="Quién responde" /></label>
        <label>Teléfono / WhatsApp<input name="telefono" inputMode="tel" placeholder="300 000 0000" /></label>
      </div>
      <label className="pub-full">Correo electrónico
        <input name="correo" type="email" placeholder="correo@dominio.com" />
      </label>

      <div className="pub-sec">El cobro</div>
      <div className="pub-row">
        <label>Área donde se cobra
          <select name="area" defaultValue="">
            <option value="">Selecciona…</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>Valor a cobrar (COP)<input name="valor" inputMode="numeric" placeholder="$ 0" /></label>
      </div>
      <label className="pub-full">Concepto<input name="concepto" placeholder="¿Por qué es el cobro?" /></label>
      <label className="pub-full">Descripción / detalle
        <textarea name="descripcion" rows={2} placeholder="Detalle del servicio o producto" />
      </label>

      <div className="pub-sec">¿A dónde te pagamos?</div>
      <div className="pub-row3">
        <label>Banco<input name="banco" placeholder="Ej. Bancolombia" /></label>
        <label>Tipo de cuenta
          <select name="tipo_cuenta" defaultValue="">
            <option value="">—</option><option value="ahorros">Ahorros</option>
            <option value="corriente">Corriente</option><option value="deposito">Depósito</option>
          </select>
        </label>
        <label>N° de cuenta<input name="num_cuenta" inputMode="numeric" placeholder="Número" /></label>
      </div>

      <div className="pub-sec">Documentos</div>
      <label className="pub-full pub-file">Sube tu cuenta de cobro, RUT, cédula, certificación bancaria… (PDF o imágenes)
        <input name="documentos" type="file" multiple accept=".pdf,image/*" />
      </label>

      {estado?.error && <div className="pub-err">{estado.error}</div>}
      <button className="pub-btn" type="submit" disabled={pending}>{pending ? "Enviando…" : "Enviar cuenta de cobro"}</button>
    </form>
  );
}
