// ¿ESTE DESPLIEGUE ES EL DE PRUEBAS?
//
// Una sola variable decide todo lo que distingue al ambiente: la franja roja, el
// nombre de la cookie de sesión, la carpeta de Drive, el aviso en el archivo del
// banco y el botón de devolverse. Un interruptor por cosa terminaría con alguno
// mal puesto — y el que quede mal puesto va a ser el que importaba.
export const EN_PRUEBAS = process.env.AMBIENTE === "pruebas";

/** Para componentes de cliente (el navegador no ve `AMBIENTE`; `next.config.mjs`
 *  publica esta copia desde la MISMA variable). */
export const EN_PRUEBAS_CLIENTE = process.env.NEXT_PUBLIC_AMBIENTE === "pruebas";
