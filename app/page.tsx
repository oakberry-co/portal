// Índice del portal — la cáscara. Cada tarjeta es un módulo.
// Fase 0: solo Contabilidad > Conciliación de pagos está vivo.

export default function Home() {
  return (
    <div className="container">
      <h1>Portal Oakberry</h1>
      <p className="sub">Una cáscara, muchos módulos. Empezamos por Contabilidad.</p>

      <div className="cards">
        <a className="card" href="/contabilidad/conciliacion">
          <h3>🧾 Conciliación de pagos</h3>
          <p>Factura por factura: concepto, destino, plazo y retenciones. Con bitácora incorruptible.</p>
        </a>
        <div className="card disabled">
          <h3>💸 Pagos</h3>
          <p>Aprobación y ejecución de pagos de la semana. (Fase 2)</p>
        </div>
        <div className="card disabled">
          <h3>📚 Causación</h3>
          <p>Autorizar y causar en Siigo, factura por factura. (Fase 3)</p>
        </div>
        <div className="card disabled">
          <h3>🏦 Conciliación de bancos</h3>
          <p>Cruce con el pago real por canal. (Fase 4)</p>
        </div>
        <div className="card disabled">
          <h3>🗂️ Maestros</h3>
          <p>Cuentas, tiendas, conceptos, centros de costo, retenciones.</p>
        </div>
        <div className="card disabled">
          <h3>📊 Dashboard</h3>
          <p>Evolución semanal de todo el flujo. (reemplaza el del Sheet)</p>
        </div>
      </div>
    </div>
  );
}
