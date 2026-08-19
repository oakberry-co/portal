// El "no se pudo, y por esto" al lado del botón.
//
// Existe porque un Server Action que lanza excepción muestra, en producción,
// una pantalla en blanco con un digest: el revisor ve el portal roto en vez de
// leer "falta confirmar las retenciones". El mensaje está escrito para él.

export function ErrorAccion({ msg }: { msg: string }) {
  return (
    <p className="cc-error" role="alert">
      ⚠️ <b>No se pudo:</b> {msg}
    </p>
  );
}
