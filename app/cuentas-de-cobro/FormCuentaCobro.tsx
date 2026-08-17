"use client";

import { useActionState } from "react";
import { enviarCuentaCobro, type Resultado } from "./actions";
import { CasillasDocumentos } from "../CasillasDocumentos";
import { AREAS } from "@/lib/areas";

export function FormCuentaCobro() {
  const [estado, action, pending] = useActionState<Resultado | null, FormData>(enviarCuentaCobro, null);

  if (estado?.ok) {
    return (
      <div className="pub-ok">
        <div className="pub-ok-ico">✓</div>
        <h2>¡Recibido!</h2>
        <p>Tu cuenta de cobro llegó a Oakberry. El equipo de contabilidad la revisa y te contacta. Gracias 💜</p>
        {estado.aviso && <p className="pub-aviso">⚠️ {estado.aviso}</p>}
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
        <label>Área con la que trataste
          <select name="area" defaultValue="">
            <option value="">Selecciona…</option>
            {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>Valor a cobrar (COP)<input name="valor" inputMode="numeric" placeholder="$ 0" /></label>
      </div>
      <label className="pub-full">Concepto<input name="concepto" placeholder="¿Por qué es el cobro?" /></label>
      <label className="pub-full">Descripción / detalle
        <textarea name="descripcion" rows={2} placeholder="Detalle del servicio o producto" />
      </label>

      {/* Los campos de banco/cuenta se quitaron a propósito (2026-08-17): la cuenta
          la lee el sistema de la CERTIFICACIÓN del banco. Teclearla era el punto
          por donde entraban los errores de dígito y el fraude. */}
      <div className="pub-sec">Documentos</div>
      <p className="pub-hint">
        Toca cada uno para adjuntarlo. PDF o foto. <b>Tu cuenta la tomamos de la
        certificación bancaria</b>, así que no tienes que escribirla.
      </p>
      <CasillasDocumentos />

      {estado?.error && <div className="pub-err">{estado.error}</div>}
      <button className="pub-btn" type="submit" disabled={pending}>{pending ? "Enviando…" : "Enviar cuenta de cobro"}</button>
    </form>
  );
}
