"use client";

// LA PANTALLA CUANDO ALGO SE ROMPE EN EL NAVEGADOR.
//
// Sin esto, Next muestra su texto crudo: "Application error: a client-side
// exception has occurred while loading www.manelfoods.co (see the browser
// console for more information)". Un proveedor que acaba de darle ENVIAR ve eso
// y no tiene forma de saber si su cotización llegó o no — y lo que hace
// entonces es mandarla otra vez. Una cotización duplicada es un anticipo que se
// puede pagar dos veces (Regla 18: un loop humano que no cierra).
//
// La causa más común no es un bug del formulario: es que la aplicación se
// ACTUALIZÓ mientras la pestaña estaba abierta. El navegador se queda pidiendo
// pedazos de una versión que ya no existe y falla al cargarlos. Recargar lo
// arregla, y por eso el botón es lo primero.
//
// El mensaje NO promete que el envío llegó ni que se perdió: no lo sabemos desde
// acá. Dice qué hacer para averiguarlo sin arriesgar un duplicado.

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Al log del servidor, con el digest: es lo único que permite encontrarlo
    // después. Que el humano vea un mensaje amable no significa que el error se
    // pierda.
    console.error("[error de pantalla]", error?.digest ?? "", error);
  }, [error]);

  const esPublica = typeof window !== "undefined"
    && /^\/(cuentas-de-cobro|cotizaciones|completar)/.test(window.location.pathname);

  return (
    <div className="pub">
      <div className="pub-card">
        <img className="pub-logo" src="/oakberry-logo.png" alt="Oakberry" />
        <h1 className="pub-title">Se nos cayó la página</h1>
        <p className="pub-sub">
          Casi siempre pasa porque actualizamos la aplicación mientras la tenías abierta.
          <b> Recarga y sigue</b>.
        </p>

        <button className="pub-btn" type="button" onClick={() => { reset(); location.reload(); }}>
          Recargar
        </button>

        {esPublica && (
          <div className="pub-aviso" style={{ marginTop: 16, textAlign: "left" }}>
            <b>¿Ya le habías dado enviar?</b> Puede que sí haya quedado registrado.
            <b> No lo mandes otra vez</b> sin confirmar: escríbenos a{" "}
            <a href="mailto:compras@manelfoods.com">compras@manelfoods.com</a> con tu NIT y te
            decimos si nos llegó.
          </div>
        )}

        {error?.digest && (
          <p className="pub-foot">
            Si nos escribes, pásanos este código: <span className="mono">{error.digest}</span>
          </p>
        )}
        <p className="pub-foot">Oakberry Colombia · ManelFoods S.A.S.</p>
      </div>
    </div>
  );
}
