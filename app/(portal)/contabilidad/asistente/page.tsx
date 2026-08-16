import { AsistenteChat } from "./AsistenteChat";

export const dynamic = "force-dynamic";

export default function AsistentePage() {
  const activo = !!process.env.ANTHROPIC_API_KEY;
  return (
    <div className="container">
      <h1>💬 Asistente</h1>
      <p className="sub">Copiloto de conciliación: pregúntale y responde leyendo tus <b>datos en vivo</b> (facturas, proveedores, retenciones, dashboard).</p>
      {!activo && (
        <div className="card" style={{ maxWidth: 620, marginBottom: 16 }}>
          <h3>Falta encender la IA</h3>
          <p>Pega <code>ANTHROPIC_API_KEY</code> en Vercel (Settings → Environment Variables) y redeploy. El chat ya está listo debajo.</p>
        </div>
      )}
      <AsistenteChat />
    </div>
  );
}
