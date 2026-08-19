// EL RESULTADO DE UNA ACCIÓN DE LA BANDEJA, para que el error LLEGUE AL HUMANO.
//
// Un Server Action que lanza una excepción, en producción, no muestra el
// mensaje: Next lo reemplaza por "Application error: a server-side exception
// has occurred" y un digest. Es lo correcto para un stack trace, pero acá los
// mensajes están ESCRITOS PARA EL REVISOR ("falta confirmar las retenciones",
// "abre la certificación y escribe la cuenta") — decirle a alguien que no puede
// aprobar, sin decirle por qué, es peor que no decirle nada: cree que el portal
// se rompió y deja de usarlo (Regla 18: un loop humano que no cierra).
//
// Por eso las acciones devuelven `Resultado` en vez de lanzar, y la tarjeta
// pinta el mensaje al lado del botón. La excepción igual queda en los logs.

export type Resultado = { ok: boolean; error?: string };

export const SIN_RESULTADO: Resultado = { ok: true };

/** Corre el cuerpo de una acción y convierte la excepción en mensaje visible.
 *
 *  Lo que se traga son los NO-PUEDE del negocio (candados de aprobación), que
 *  son mensajes redactados para leerse. Un error inesperado —base caída, bug—
 *  también se muestra, porque callarlo deja al revisor peor: sin saber si
 *  aprobó o no. En ambos casos se registra en el log del servidor. */
export async function intentar(fn: () => Promise<void>): Promise<Resultado> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[accion bandeja]", error, e);
    return { ok: false, error };
  }
}
