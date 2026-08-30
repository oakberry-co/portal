// LA FRANJA QUE DICE DÓNDE ESTÁS.
//
// Dos ambientes idénticos en el mismo dominio es la receta para que alguien
// confirme un pago en el equivocado. La franja va arriba de TODO —también de las
// landings públicas— y no se puede cerrar: un aviso que se cierra no avisa.
//
// Se enciende con AMBIENTE=pruebas, la MISMA variable que le cambia el nombre a
// la cookie de sesión: no hay un interruptor aparte que se pueda quedar mal puesto.
export function FranjaPruebas() {
  if (process.env.AMBIENTE !== "pruebas") return null;
  return (
    <div className="franja-pruebas">
      🧪 AMBIENTE DE PRUEBAS · los datos son falsos y se borran · nada de esto le llega a un proveedor
    </div>
  );
}
