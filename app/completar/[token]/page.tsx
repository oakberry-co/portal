import { getPool } from "@/lib/db";
import { notFound } from "next/navigation";
import { CLASES_DOC, DOCS_CUENTA_COBRO, DOCS_COTIZACION, DOCS_RECURRENTE,
         docsFaltantes, type DocGuardado } from "@/lib/areas";
import { FormCompletar } from "./FormCompletar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Completa tu solicitud · Oakberry", robots: { index: false, follow: false } };

// PÁGINA PARA COMPLETAR — sin login, con un token que va en el correo.
//
// Existe para matar un reproceso: antes, si la certificación no servía o le
// rechazábamos la solicitud, el proveedor tenía que llenar los 10 campos y subir
// los 4 documentos otra vez. Por un archivo.
//
// Deliberadamente NO deja cambiar el valor, la cuenta ni el NIT: eso lo volvería
// el formulario público con los candados quitados. Solo muestra en qué quedó su
// solicitud y le deja reemplazar documentos.

type Solicitud = {
  id: number; tipo: "cuenta_cobro" | "cotizacion"; ref: string; razon_social: string;
  valor: number | null; concepto: string | null; estado: string; nota_revision: string | null;
  documentos: DocGuardado[]; cert_estado: string | null; cert_motivo: string | null;
  recurrente: boolean;
};

async function buscar(token: string): Promise<Solicitud | null> {
  const t = (token ?? "").trim();
  if (t.length < 20) return null;   // un token corto no es un token
  const r = await getPool().query<Solicitud>(
    `SELECT * FROM (
       SELECT 'cuenta_cobro'::text AS tipo, cc.id, 'CC-' || cc.id AS ref, cc.razon_social,
              cc.valor::float AS valor, cc.concepto, cc.estado, cc.nota_revision, cc.documentos,
              cert.estado AS cert_estado, cert.motivo AS cert_motivo, cc.token, cc.recurrente
         FROM cuentas_cobro cc
         LEFT JOIN LATERAL (SELECT x.estado, x.motivo FROM certificacion_bancaria x
                             WHERE x.origen_tipo='cuenta_cobro' AND x.origen_id=cc.id
                             ORDER BY x.id DESC LIMIT 1) cert ON TRUE
       UNION ALL
       SELECT 'cotizacion', cot.id, coalesce(cot.codigo,'COT-'||cot.id), cot.razon_social,
              cot.valor::float, cot.concepto, cot.estado, cot.nota_revision, cot.documentos,
              cert.estado, cert.motivo, cot.token, cot.recurrente
         FROM cotizaciones cot
         LEFT JOIN LATERAL (SELECT x.estado, x.motivo FROM certificacion_bancaria x
                             WHERE x.origen_tipo='cotizacion' AND x.origen_id=cot.id
                             ORDER BY x.id DESC LIMIT 1) cert ON TRUE
     ) s WHERE s.token = $1`, [t]);
  return r.rows[0] ?? null;
}

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

export default async function CompletarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await buscar(token);
  if (!s) notFound();

  // Qué documentos exige ESTE carril: a una cotización no se le pide cédula, y
  // a un recurrente solo el soporte. Con un set único, esta página le pediría a
  // alguien un papel que su formulario nunca le pidió — y se quedaría atascado
  // sin manera de salir (Regla 18).
  const faltan = docsFaltantes(s.documentos, s.recurrente ? DOCS_RECURRENTE
    : s.tipo === "cotizacion" ? DOCS_COTIZACION : DOCS_CUENTA_COBRO);
  const certMala = s.cert_estado && !["valida", "pendiente"].includes(s.cert_estado);
  const yaPagada = s.estado === "pagada";

  // Qué documentos pedirle: los que faltan + la certificación si fue rechazada.
  const pedir = CLASES_DOC.filter((c) =>
    faltan.includes(c.label) || (certMala && c.clase === "certificacion_bancaria"));

  return (
    <div className="pub">
      <div className="pub-card">
        <img className="pub-logo" src="/oakberry-logo.png" alt="Oakberry" />
        <h1 className="pub-title">Completa tu solicitud</h1>
        <p className="pub-sub">
          <b>{s.ref}</b> · {s.razon_social}
          {s.valor != null && <> · {cop.format(Math.round(s.valor))}</>}
          {s.concepto && <> · {s.concepto}</>}
        </p>

        {yaPagada ? (
          <div className="pub-ok"><div className="pub-ok-ico">✓</div><h2>Ya te pagamos</h2>
            <p>Esta solicitud está saldada. Si tienes dudas, responde el correo que te enviamos.</p></div>
        ) : (
          <>
            {/* Por qué está acá: se dice explícito, no lo tiene que adivinar. */}
            {s.estado === "rechazada" && (
              <div className="pub-err" style={{ textAlign: "left" }}>
                Tu solicitud fue devuelta.{s.nota_revision ? <> <b>Motivo:</b> {s.nota_revision}</> : null}
              </div>
            )}
            {certMala && (
              <div className="pub-aviso">
                <b>Tu certificación bancaria no se pudo validar.</b>{" "}
                {s.cert_motivo ?? "Necesitamos el documento que emite tu banco."}
              </div>
            )}
            {!pedir.length && s.estado !== "rechazada" && (
              <div className="pub-aviso">
                No nos falta ningún documento tuyo. Si quieres reemplazar alguno, escríbenos
                respondiendo el correo.
              </div>
            )}

            <FormCompletar token={token} clases={pedir.length ? pedir.map((c) => ({ ...c })) : CLASES_DOC.map((c) => ({ ...c }))} />
          </>
        )}

        <p className="pub-foot">
          No te pedimos de nuevo tus datos: ya los tenemos. Solo el documento que falta.
        </p>
      </div>
    </div>
  );
}
