// Índice del portal — la cáscara. Cada tarjeta es un módulo.
// Fase 0: solo Contabilidad > Conciliación de pagos está vivo.

export default function Home() {
  return (
    <div className="container">
      <section className="hero">
        <span className="eyebrow">Oakberry · Core</span>
        <h1 className="hero-title">
          Portal de<br />
          <span className="accent">Contabilidad</span>
        </h1>
        <p className="hero-sub">
          Una cáscara, muchos módulos. Empezamos por Contabilidad — factura por
          factura, con bitácora incorruptible.
        </p>
      </section>

      <div className="cards">
        <a className="card" href="/contabilidad/conciliacion">
          <div className="card-ico">🧾</div>
          <h3>Conciliación de pagos</h3>
          <p>Factura por factura: concepto, destino, plazo y retenciones. Con bitácora incorruptible.</p>
          <span className="card-go">Entrar →</span>
        </a>

        <div className="card disabled">
          <span className="card-fase">Fase 2</span>
          <div className="card-ico">💸</div>
          <h3>Pagos</h3>
          <p>Aprobación y ejecución de pagos de la semana.</p>
        </div>

        <div className="card disabled">
          <span className="card-fase">Fase 3</span>
          <div className="card-ico">📚</div>
          <h3>Causación</h3>
          <p>Autorizar y causar en Siigo, factura por factura.</p>
        </div>

        <div className="card disabled">
          <span className="card-fase">Fase 4</span>
          <div className="card-ico">🏦</div>
          <h3>Conciliación de bancos</h3>
          <p>Cruce con el pago real por canal.</p>
        </div>

        <div className="card disabled">
          <div className="card-ico">🗂️</div>
          <h3>Maestros</h3>
          <p>Cuentas, tiendas, conceptos, centros de costo, retenciones.</p>
        </div>

        <div className="card disabled">
          <div className="card-ico">📊</div>
          <h3>Dashboard</h3>
          <p>Evolución semanal de todo el flujo. (reemplaza el del Sheet)</p>
        </div>
      </div>
    </div>
  );
}
