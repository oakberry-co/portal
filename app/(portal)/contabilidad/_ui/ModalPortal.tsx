"use client";

// UN MODAL NO VIVE DENTRO DE UNA FILA DE LA TABLA.
//
// Los modales de conciliación se abren desde el botón de una factura, así que
// el JSX quedaba colgando dentro de esa fila. Y `.fila:focus-within` le pone
// `position: relative; z-index: 20` — al abrirse el modal el foco entra en la
// fila, la fila se vuelve un contexto de apilamiento, y el modal queda ATRAPADO
// ahí adentro: el `z-index: 100` del fondo ya no compite con la página, compite
// dentro de la fila. Resultado en pantalla: el panel blanco NO tapa nada, la
// página se ve a través del formulario y el fondo oscuro desaparece. Los datos
// están bien y el CSS también —el navegador reporta `background: white`— pero
// se pinta debajo. Con el modal ilegible, quien paga no puede validar a qué
// cuenta va la plata (MLK234, ago-2026).
//
// La cura es sacarlo del árbol de la fila y colgarlo del <body>, donde ya no
// hay nada que lo atrape.

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function ModalPortal({ children }: { children: ReactNode }) {
  // En el servidor no hay `document`: se monta en el primer render del cliente.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  if (!montado) return null;
  return createPortal(children, document.body);
}
