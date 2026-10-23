import { ruta } from "@/lib/ruta";
import { getCurrentUserOrNull } from "@/lib/auth";
import { redirect } from "next/navigation";
import { areasPortada } from "./areas";

// LA PUERTA DE ENTRADA (23-oct-2026): las 5 áreas de Manel Foods como tarjetas, y un
// espacio reservado para las cifras clave de cada área (pedido de Daniel: "donde
// mostremos en el futuro algunas métricas puntuales"). Cada tarjeta abre la primera
// pantalla que ESTA persona puede ver; si no puede ver ninguna, sale como sin acceso.
export const dynamic = "force-dynamic";

const TEXTO: Record<string, { ico: string; txt: string }> = {
  contabilidad: { ico: "🧾", txt: "Facturas, pagos, cuentas de cobro y causaciones, factura por factura y con bitácora incorruptible." },
  finanzas: { ico: "📈", txt: "El P&L al día de cada tienda propia: venta, costo y EBITDA del mes en curso." },
  rrhh: { ico: "👥", txt: "Nómina, turnos, marcaciones, ausencias y solicitudes del equipo de tiendas." },
  operaciones: { ico: "🏪", txt: "Tiendas, compras e inventario." },
  mercadeo: { ico: "📣", txt: "CRM, cohortes, LTV y retención de Loopy, y el resultado de cada campaña contra su control." },
};

export default async function Home() {
  const user = await getCurrentUserOrNull();
  if (!user) redirect("/login");
  const areas = areasPortada(user.rol);
  return (
    <div className="container">
      <section className="hero">
        <span className="eyebrow">Oakberry · Core</span>
        <h1 className="hero-title">
          Portal<br />
          <span className="accent">Manel Foods</span>
        </h1>
        <p className="hero-sub">
          Contabilidad, finanzas, recursos humanos, operaciones y mercadeo en un solo lugar.
          Escoge un área, o usa el menú de la izquierda.
        </p>
      </section>

      <div className="cards">
        {areas.map((a) => {
          const t = TEXTO[a.id];
          const estado = !a.conAcceso ? "Sin acceso" : !a.href ? "Pronto" : null;
          if (estado) {
            return (
              <div key={a.id} className="card disabled">
                <span className="card-fase">{estado}</span>
                <div className="card-ico">{t.ico}</div>
                <h3>{a.label}</h3>
                <p>{t.txt}</p>
              </div>
            );
          }
          return (
            <a key={a.id} className="card" href={ruta(a.href)}>
              <div className="card-ico">{t.ico}</div>
              <h3>{a.label}</h3>
              <p>{t.txt}</p>
              <span className="card-go">Entrar →</span>
            </a>
          );
        })}
        <div className="card disabled" style={{ borderStyle: "dashed" }}>
          <span className="card-fase">Pronto</span>
          <div className="card-ico">✨</div>
          <h3>Cifras clave</h3>
          <p>Aquí van a vivir las cifras que importan de cada área: venta de la semana, pagos por aprobar, clientes que volvieron.</p>
        </div>
      </div>
    </div>
  );
}
