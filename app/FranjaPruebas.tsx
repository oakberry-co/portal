// LA FRANJA QUE DICE DÓNDE ESTÁS.
//
// Dos ambientes idénticos en el mismo dominio es la receta para que alguien
// confirme un pago en el equivocado. La franja va arriba de TODO —también de las
// landings públicas— y no se puede cerrar: un aviso que se cierra no avisa.
//
// Se enciende sola con BASE_PATH (la variable que ya define que este despliegue
// es el de pruebas): no hay un interruptor aparte que se pueda quedar mal puesto.
export function FranjaPruebas() {
  if (!process.env.BASE_PATH) return null;
  return (
    <div className="franja-pruebas">
      🧪 AMBIENTE DE PRUEBAS · los datos son falsos y se borran · nada de esto le llega a un proveedor
    </div>
  );
}
