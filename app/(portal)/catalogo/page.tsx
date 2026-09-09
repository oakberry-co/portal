import { redirect } from "next/navigation";
import { EN_PRUEBAS } from "@/lib/ambiente";

// EL CATÁLOGO DE PIEZAS — SOLO EN EL AMBIENTE DE PRUEBAS.
//
// Existe porque el sistema visual del portal no se puede ver: son 785 clases en
// un solo `globals.css` repartidas por 52 componentes, y para ver un botón hay
// que adivinar qué pantalla lo usa. Quien vaya a rediseñar entra acá y ve TODO
// lo que existe hoy, junto, con su nombre de clase — incluidas las
// inconsistencias, que también son parte del inventario.
//
// Dos reglas de este archivo:
//  1. NO inventa piezas. Todo lo que se pinta acá usa clases que ya existen en
//     `app/globals.css`. Si algo se ve feo, así se ve en producción.
//  2. NO es una librería. No hay componentes nuevos ni props: es una página
//     estática de referencia. El día que el rediseño entre, esta página se
//     actualiza o se borra.
//
// El candado es el ambiente, no la ruta: en producción esto no existe.
export const dynamic = "force-dynamic";

const COLORES: [string, string, string][] = [
  ["--cream", "#faf6ef", "fondo de la app"],
  ["--cream-2", "#f6f1e4", "encabezados y zonas frías"],
  ["--card", "#ffffff", "superficie de contenido"],
  ["--border", "#ece3d4", "borde por defecto"],
  ["--border-lav", "#e7e0f2", "borde de campos y botones fantasma"],
  ["--ink", "#2c1838", "texto principal"],
  ["--purple", "#5f4b8b", "acento de marca"],
  ["--purple-deep", "#3d2b5e", "títulos y énfasis"],
  ["--lav", "#8a7fa3", "texto secundario"],
  ["--lav-soft", "#f5f0ff", "fondo de estado activo"],
  ["--yellow", "#f5c842", "atención / confianza baja"],
  ["--coral", "#e8593c", "lo que urge y el ambiente de pruebas"],
  ["--ok", "#27ae60", "confirmado"],
  ["--warn", "#b7791f", "pendiente"],
  ["--danger", "#c0392b", "error y faltante"],
];

const ESTADOS: [string, string][] = [
  ["capturada", "llegó, nadie la miró"],
  ["clasificada", "concepto y destino confirmados"],
  ["retenciones_ok", "hay valor a pagar en firme"],
  ["aprobada_pago", "está en el archivo del banco"],
  ["pagada", "la plata salió"],
  ["causada", "quedó en los libros"],
];

export default function CatalogoPage() {
  // El candado va primero: esta página no existe fuera del ambiente.
  if (!EN_PRUEBAS) redirect("/contabilidad/conciliacion");

  return (
    <main className="container cat">
      <header className="cat-hero">
        <h1>Catálogo de piezas</h1>
        <p className="muted">
          Todo lo que existe hoy en el portal, junto y con su nombre de clase. No hay nada
          inventado acá: si algo se ve raro, así se ve en producción.
        </p>
        <div className="cat-inv">
          <span><b>785</b> clases CSS</span>
          <span><b>15</b> tokens de color</span>
          <span><b>3</b> tipografías</span>
          <span><b>7</b> anchos de quiebre distintos</span>
          <span><b>52</b> componentes</span>
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      <section className="cat-sec">
        <h2>1 · Color</h2>
        <p className="muted">Los quince tokens. Cualquier otro color en el portal es un valor suelto.</p>
        <div className="cat-swatches">
          {COLORES.map(([tok, hex, uso]) => (
            <div className="cat-sw" key={tok}>
              <div className="cat-sw-box" style={{ background: hex }} />
              <b>{tok}</b>
              <code>{hex}</code>
              <span className="muted">{uso}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="cat-sec">
        <h2>2 · Tipografía</h2>
        <p className="muted">Tres familias. Bebas para títulos, Montserrat para todo, DM Mono para datos.</p>
        <div className="cat-tipo">
          <div><span className="muted">--display · Bebas Neue</span>
            <p style={{ fontFamily: "var(--display)", fontSize: 40, margin: "4px 0 0", color: "var(--purple-deep)" }}>Conciliación de pagos</p></div>
          <div><span className="muted">--sans · Montserrat 400 / 600 / 700 / 800</span>
            <p style={{ margin: "4px 0 0", fontSize: 15 }}>La máquina propone, la persona confirma.</p></div>
          <div><span className="muted">--mono · DM Mono</span>
            <p style={{ fontFamily: "var(--mono)", margin: "4px 0 0", fontSize: 13 }}>NIT 830053669 · $ 4.998.000 · 14-ago</p></div>
        </div>
        <div className="cat-escala">
          {[["40", "título de página"], ["17", "subtítulo"], ["15", "texto base"], ["13", "texto de tabla"],
            ["12.5", "dato en fila"], ["11", "semáforo"], ["10.5", "número de factura"], ["9.5", "encabezado de tabla"]]
            .map(([px, uso]) => (
              <div key={px}><b style={{ fontSize: Number(px) }}>{px}px</b><span className="muted">{uso}</span></div>
            ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="cat-sec cat-clave">
        <h2>3 · Los estados del dato <span className="cat-tag">el problema</span></h2>
        <p className="muted">
          Un dato de este portal puede estar sugerido por la máquina, confirmado por una persona,
          vacío, bloqueado o en error. Hoy toda esa diferencia la carga <b>un punto de 7 píxeles</b>
          {" "}(<code>.dot</code>), y solo aparece cuando la máquina reportó confianza — que está
          vacía en las 3.586 facturas de la cola. Esta es la pieza a resolver.
        </p>
        <div className="cat-fila-demo">
          <div className="cat-est">
            <span className="cat-est-lbl">sugerido por la máquina</span>
            <div className="c-field" style={{ position: "relative" }}>
              <span className="dot ok" title="Máquina: Toppings · 92%" />
              <input className="cbx-input" defaultValue="Toppings" readOnly />
            </div>
            <span className="muted">punto verde = confianza alta</span>
          </div>
          <div className="cat-est">
            <span className="cat-est-lbl">sugerido, confianza baja</span>
            <div className="c-field" style={{ position: "relative" }}>
              <span className="dot warn" title="Máquina: Servicios · 41%" />
              <input className="cbx-input" defaultValue="Servicios" readOnly />
            </div>
            <span className="muted">punto amarillo</span>
          </div>
          <div className="cat-est">
            <span className="cat-est-lbl">confirmado por una persona</span>
            <div className="c-field">
              <input className="cbx-input" defaultValue="Arriendo" readOnly />
            </div>
            <span className="muted">sin punto — indistinguible de lo vacío</span>
          </div>
          <div className="cat-est">
            <span className="cat-est-lbl">vacío</span>
            <div className="c-field">
              <input className="cbx-input" placeholder="Concepto" readOnly />
            </div>
            <span className="muted">placeholder gris</span>
          </div>
          <div className="cat-est">
            <span className="cat-est-lbl">falta y bloquea</span>
            <div className="c-field falta">
              <input className="cbx-input" placeholder="Destino" readOnly />
            </div>
            <span className="muted"><code>.c-field.falta</code></span>
          </div>
          <div className="cat-est">
            <span className="cat-est-lbl">bloqueado (rol sin permiso)</span>
            <div className="c-field">
              <input className="cbx-input" defaultValue="Toppings" disabled />
            </div>
            <span className="muted">solo lectura</span>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="cat-sec">
        <h2>4 · La fila de Conciliación</h2>
        <p className="muted">
          Catorce columnas. Es la pieza más usada del portal: se recorren hasta 213 en un día.
        </p>
        <div className="tabla">
          <div className="fila-head">
            <div className="c-prov">Proveedor</div>
            <div className="c-num">Factura</div>
            <div className="c-fecha">Fecha</div>
            <div className="c-sem">Sem</div>
            <div className="c-valor">Valor</div>
            <div>Concepto</div>
            <div>Destino</div>
            <div className="c-plazo">Plazo</div>
            <div className="c-btn" />
            <div className="c-pagar">A pagar</div>
            <div className="c-btn" />
            <div className="c-btn" />
            <div className="c-docs">Docs</div>
            <div className="c-sems">Estado</div>
          </div>

          <FilaDemo />
          <FilaDemo pend />
          <FilaDemo falta />
          <FilaDemo locked />
        </div>
        <p className="muted cat-pie">
          <code>.fila</code> normal · <code>.fila.pend</code> (barra coral: le falta algo) ·
          {" "}<code>.c-field.falta</code> (sin destino, no deja clasificar) ·
          {" "}<code>.fila.locked</code> (ya pagada, opacidad .6)
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="cat-sec">
        <h2>5 · Estado y semáforos</h2>
        <div className="cat-row">
          {ESTADOS.map(([e, desc]) => (
            <div className="cat-item" key={e}>
              <span className={"badge " + e}>{e}</span>
              <span className="muted">{desc}</span>
            </div>
          ))}
        </div>
        <div className="cat-row" style={{ marginTop: 14 }}>
          <div className="cat-item"><span className="sem"><i className="luz ok" />Clasif</span><span className="muted">.luz.ok</span></div>
          <div className="cat-item"><span className="sem"><i className="luz mid" />Reten</span><span className="muted">.luz.mid</span></div>
          <div className="cat-item"><span className="sem"><i className="luz no" />Pago</span><span className="muted">.luz.no</span></div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="cat-sec">
        <h2>6 · Botones</h2>
        <p className="muted">Seis variantes conviviendo. Parte del trabajo es decidir cuántas sobran.</p>
        <div className="cat-row">
          <div className="cat-item"><button className="c-btn">Clasif.</button><span className="muted">.c-btn</span></div>
          <div className="cat-item"><button className="c-btn ghost">Reten.</button><span className="muted">.c-btn.ghost</span></div>
          <div className="cat-item"><button className="c-btn ghost c-desvio">Cuenta</button><span className="muted">.c-desvio</span></div>
          <div className="cat-item"><button className="c-btn" disabled>Clasif.</button><span className="muted">deshabilitado</span></div>
          <div className="cat-item"><button className="nav-out">Salir</button><span className="muted">.nav-out</span></div>
          <div className="cat-item"><button className="c-btn c-devolver">↩ Atrás</button><span className="muted">.c-devolver (solo pruebas)</span></div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="cat-sec">
        <h2>7 · Documentos</h2>
        <div className="cat-row">
          <div className="cat-item"><span className="ic dian">DIAN</span><span className="muted">.ic.dian</span></div>
          <div className="cat-item"><span className="ic pdf">PDF</span><span className="muted">.ic.pdf</span></div>
          <div className="cat-item"><span className="ic sop">📎</span><span className="muted">.ic.sop</span></div>
          <div className="cat-item"><span className="ic off">PDF</span><span className="muted">.ic.off (no hay)</span></div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="cat-sec">
        <h2>8 · El modal</h2>
        <p className="muted">Se usa para retenciones y para desviar una cuenta. Acá va abierto, sin fondo.</p>
        <div className="modal" style={{ position: "static", maxWidth: 460 }}>
          <div className="modal-head">
            <div>
              <h3>Retenciones</h3>
              <p className="modal-sub">NUTRELLE SAS · NTR14520 · $ 4.998.000</p>
            </div>
            <button className="modal-x" aria-label="Cerrar">×</button>
          </div>
          <div className="modal-tot">
            <span>Retenido <b>$ 588.600</b></span>
            <span>Se le paga <b className="accent">$ 4.409.400</b></span>
          </div>
          <div className="modal-foot">
            <button className="ghost">Cancelar</button>
            <button>Confirmar</button>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="cat-sec cat-huecos">
        <h2>9 · Lo que NO existe</h2>
        <p className="muted">
          Estas piezas no están en el CSS. No es que se vean mal: es que no hay nada. Diseñarlas
          es parte del encargo.
        </p>
        <ul>
          <li><b>Estado vacío.</b> Bandeja al día, sin pendientes de la semana, mes cerrado.</li>
          <li><b>Estado de error.</b> Falló guardar, se cayó la conexión, la sincronización murió.</li>
          <li><b>Estado de carga.</b> Hay guardado optimista, pero nada que muestre &quot;guardando&quot; ni &quot;guardado&quot;.</li>
          <li><b>Confirmación de acción peligrosa.</b> El archivo del banco se descarga como cualquier otro botón.</li>
          <li><b>Cola del día.</b> Nada dice &quot;esto es lo tuyo y son 40&quot;: se abre una lista de 3.586.</li>
        </ul>
      </section>
    </main>
  );
}

/** Una fila de ejemplo, con las mismas 14 columnas de Conciliación. */
function FilaDemo({ pend, falta, locked }: { pend?: boolean; falta?: boolean; locked?: boolean }) {
  const clase = "fila" + (pend ? " pend" : "") + (locked ? " locked" : "");
  return (
    <div className={clase}>
      <div className="c-prov">
        <div className="prov">NUTRELLE SAS</div>
        <div className="muted" style={{ fontSize: 10.5 }}>830053669</div>
      </div>
      <div className="c-num">NTR14520</div>
      <div className="c-fecha"><span>14-ago</span><span className="lleg">llegó 15-ago</span></div>
      <div className="c-sem">33</div>
      <div className="c-valor num">4.998.000</div>
      <div className="c-field" style={{ position: "relative" }}>
        {!locked && <span className="dot ok" />}
        <input className="cbx-input" defaultValue="Toppings" readOnly />
      </div>
      <div className={"c-field" + (falta ? " falta" : "")}>
        <input className="cbx-input" defaultValue={falta ? "" : "OAKBERRY ANDINO"} placeholder="Destino" readOnly />
      </div>
      <div className="c-plazo">
        <input defaultValue="30" readOnly />
        <span className={"venc" + (pend ? " due" : "")}>{pend ? "⏰ 13-sep" : "→ 14-sep"}</span>
      </div>
      <button className="c-btn" disabled={locked}>{locked ? "Reclas." : "Clasif."}</button>
      <div className="c-pagar">
        <div className="num accent">4.409.400</div>
        <span className="muted mini">ret 588.600 {locked ? "✓" : ""}</span>
      </div>
      <button className="c-btn ghost" disabled={locked}>Reten.</button>
      <button className="c-btn ghost">Cuenta</button>
      <div className="c-docs"><span className="ic dian">DIAN</span><span className="ic pdf">PDF</span></div>
      <div className="c-sems">
        <span className="sem"><i className={"luz " + (falta ? "no" : "ok")} />Clasif</span>
        <span className="sem"><i className={"luz " + (locked ? "ok" : "mid")} />Reten</span>
        <span className="sem"><i className={"luz " + (locked ? "ok" : "no")} />Pago</span>
      </div>
    </div>
  );
}
