"use client";

import { useActionState, useMemo, useState } from "react";
import type { Resultado } from "@/lib/resultado";
import type { Palanca, Campana } from "@/lib/crm-campanas";
import {
  proyectar, fmt, pesos, millones, pp, TIERS, TIER_TXT, CANALES, TOPE_DIARIO, TICKET,
  type FilaAudiencia,
} from "@/lib/crm-proyeccion";
import { crearCampana } from "./acciones";
import { MensajePrevio, type VistaMensaje } from "./MensajePrevio";

export type { VistaMensaje };

const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const sumarDias = (d: string, n: number) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const corta = (sc: string) => sc.split("_").slice(2).join(" ").replace(/([a-z])([A-Z0-9])/g, "$1 $2");

// Un grupo de botones con "Todas" adelante. Vacío = todas (así lo lee el generador).
function Chips({ opciones, sel, set, todas, deshabilitadas = [] }: {
  opciones: { id: string; label: React.ReactNode; title?: string }[]; sel: string[]; set: (v: string[]) => void;
  todas: string; deshabilitadas?: string[];
}) {
  const marcar = (id: string) => {
    const s = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    const posibles = opciones.filter((o) => !deshabilitadas.includes(o.id));
    set(s.length === posibles.length ? [] : s);   // marcar todas una por una = "Todas"
  };
  return (
    <div className="cf-chips">
      <button type="button" className={`cf-chip cf-todas ${sel.length === 0 ? "on" : ""}`} onClick={() => set([])}>{todas}</button>
      {opciones.map((o) => (
        <button key={o.id} type="button" title={o.title} disabled={deshabilitadas.includes(o.id)}
          className={`cf-chip ${sel.includes(o.id) ? "on" : ""}`} onClick={() => marcar(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

export function FormCampana({ usuario, esAdmin, hoy, pausado, palancas, audiencia, mensajes, aprobadas, alAire }: {
  usuario: string; esAdmin: boolean; hoy: string; pausado: boolean; palancas: Palanca[]; audiencia: FilaAudiencia[];
  mensajes: VistaMensaje[]; aprobadas: string[]; alAire: Campana[];
}) {
  const [res, accion, enviando] = useActionState<Resultado | null, FormData>(crearCampana, null);
  const [nombre, setNombre] = useState("");
  const [ciudades, setCiudades] = useState<string[]>([]);
  const [tiendas, setTiendas] = useState<string[]>([]);
  const [tiers, setTiers] = useState<string[]>([]);
  const [canales, setCanales] = useState<string[]>([]);
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [control, setControl] = useState(20);
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(sumarDias(hoy, 30));
  const [topeTipo, setTopeTipo] = useState<"canjes" | "pesos">("canjes");
  const [tope, setTope] = useState("300");
  const [paga, setPaga] = useState<"marca" | "franquiciado">(esAdmin ? "marca" : "franquiciado");
  const [notas, setNotas] = useState("");
  const [viendo, setViendo] = useState<string | null>(null);

  // Ciudades y tiendas salen de la audiencia (solo donde hay clientes con tienda habitual).
  const mapa = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const r of audiencia) if (r.tienda !== "Sin tienda" && r.tienda !== "Tienda cerrada" && r.ciudad && !["Sin ciudad", "Otros"].includes(r.ciudad)) (m[r.ciudad] ??= new Set()).add(r.tienda);
    return m;
  }, [audiencia]);
  const listaCiudades = Object.keys(mapa).sort((a, b) => mapa[b].size - mapa[a].size || a.localeCompare(b, "es"));
  const tiendasVisibles = (ciudades.length ? ciudades : listaCiudades).flatMap((c) => [...(mapa[c] ?? [])].sort().map((t) => ({ t, c })));
  const cambiarCiudades = (v: string[]) => {
    setCiudades(v);
    if (v.length) setTiendas((ts) => ts.filter((t) => v.some((c) => mapa[c]?.has(t))));
  };

  const disponibles = palancas.filter((p) => p.estado === "disponible");
  const otras = palancas.filter((p) => p.estado !== "disponible");
  const canalesEf = canales.length ? canales : CANALES.filter((c) => c.listo).map((c) => c.id);
  const tiersEf = tiers.length ? tiers : TIERS;
  const sel = disponibles.filter((p) => elegidas.includes(p.id));
  const topeNum = Number(tope.replace(/\./g, "").replace(",", ".")) || 0;

  const proy = proyectar(audiencia, { ciudades, tiendas, tiers: tiersEf, canales: canalesEf }, sel, control, { tipo: topeTipo, valor: topeNum });
  const porTier = proy.porTier;

  // Lo que conviene saber antes de lanzar.
  const avisos: { cls: string; txt: React.ReactNode }[] = [];
  const negativas = proy.lineas.filter((l) => l.pp != null && l.pp < 0 && l.tratados >= 1);
  for (const l of negativas) avisos.push({ cls: "bad", txt: <>{l.palanca.nombre} en {l.tier} midió <b>{pp(l.pp)}</b>: a ese grupo le fue peor que al control.</> });
  if (sel.length && proy.tratados > 0 && proy.sinMedir / proy.tratados > 0.5)
    avisos.push({ cls: "warn", txt: <>{Math.round(100 * proy.sinMedir / proy.tratados)} % de los mensajes llevan una palanca que nunca se midió en ese grupo: cuenta cero en el esperado. Esta campaña la mide.</> });
  for (const p of sel) {
    if (p.dia_envio != null) avisos.push({ cls: "", txt: <>{p.nombre} sale solo los {DIAS[p.dia_envio]} (vale {p.vigencia_dias} días): el resto de la semana esas personas esperan.</> });
    if (canalesEf.includes("wa") && p.wa_plantilla && !aprobadas.includes(p.wa_plantilla))
      avisos.push({ cls: "warn", txt: <>{p.nombre}: la plantilla de WhatsApp no está aprobada; a esas personas les llega solo por correo.</> });
  }
  const cruces = alAire.filter((c) =>
    c.canales.some((k) => canalesEf.includes(k)) && c.tiers.some((t) => tiersEf.includes(t)) &&
    (!c.ciudades.length || !ciudades.length || c.ciudades.some((x) => ciudades.includes(x))) &&
    (!c.tiendas.length || !tiendas.length || c.tiendas.some((x) => tiendas.includes(x))) && c.desde <= hasta && c.hasta >= desde);
  for (const c of cruces) avisos.push({ cls: "warn", txt: <>Se cruza con <b>{c.codigo}</b> ({c.nombre}), que ya está al aire: quien quepa en las dos recibe la de {c.codigo}.</> });
  if (pausado) avisos.push({ cls: "bad", txt: <>Los envíos a clientes están en pausa: si la lanzas queda al aire, pero no le escribe a nadie hasta que se reanuden.</> });

  const lanzar = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!window.confirm(`¿Lanzar "${nombre || "la campaña"}"? Desde la próxima corrida de la mañana el CRM le escribe a quien le toque (hoy: ~${fmt(proy.tratados)} personas; ${fmt(proy.control)} quedan de control).`)) e.preventDefault();
  };
  const diario = (canalesEf.includes("wa") ? TOPE_DIARIO.wa : 0) + (canalesEf.includes("email") ? TOPE_DIARIO.email : 0);

  return (
    <form action={accion} className="cf">
      {ciudades.map((x) => <input key={x} type="hidden" name="ciudades" value={x} />)}
      {tiendas.map((x) => <input key={x} type="hidden" name="tiendas" value={x} />)}
      {tiersEf.map((x) => <input key={x} type="hidden" name="tiers" value={x} />)}
      {canalesEf.map((x) => <input key={x} type="hidden" name="canales" value={x} />)}
      {elegidas.map((x) => <input key={x} type="hidden" name="palancas" value={x} />)}

      <div className="cf-izq">
        <div className="titulo"><h1>Nueva campaña</h1><p>Escoge a quién, con qué y hasta dónde. El CRM la programa y escribe cada mañana con las reglas de siempre: un cupón por persona, atado a su tienda, con enfriamiento entre mensajes y grupo de control.</p></div>

        <section className="tarjeta"><header><h2>1 · Nombre</h2><p>Lo crea {usuario} · el código (CAM-…) se asigna al guardar</p></header>
          <div className="cuerpo">
            <input className="cf-input" name="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Medellín · dormidos · bowl gratis" maxLength={80} required />
          </div>
        </section>

        <section className="tarjeta"><header><h2>2 · A quién</h2><p>Contactables hoy: ya descuenta a quien recibió algo hace poco o pidió no recibir más</p></header>
          <div className="cuerpo cf-campos">
            <label className="cf-etq">Ciudades</label>
            <Chips todas="Todas" sel={ciudades} set={cambiarCiudades} opciones={listaCiudades.map((c) => ({ id: c, label: c }))} />
            <label className="cf-etq">Tiendas {ciudades.length ? <em>de {ciudades.join(", ")}</em> : null}</label>
            <Chips todas="Todas" sel={tiendas} set={setTiendas} opciones={tiendasVisibles.map(({ t, c }) => ({ id: t, label: corta(t), title: `${t} · ${c}` }))} />
            <label className="cf-etq">Grupos</label>
            <Chips todas="Todos" sel={tiers} set={setTiers} opciones={TIERS.map((t) => ({ id: t, label: <><b>{t}</b> {TIER_TXT[t]} <span className="cf-n">{fmt(porTier[t]?.total ?? 0)}</span></> }))} />
            <label className="cf-etq">Canales</label>
            <Chips todas="Todos" sel={canales} set={setCanales} deshabilitadas={CANALES.filter((c) => !c.listo).map((c) => c.id)}
              opciones={CANALES.map((c) => ({ id: c.id, label: c.listo ? c.label : <>{c.label} <span className="cf-n">pronto</span></> }))} />
          </div>
        </section>

        <section className="tarjeta"><header><h2>3 · Con qué palancas</h2><p>Si escoges varias, a cada persona le toca una al azar · el efecto es lo medido contra control en cada grupo</p></header>
          <div className="cuerpo">
            <div className="cf-chips" style={{ marginBottom: 12 }}>
              <button type="button" className={`cf-chip cf-todas ${elegidas.length === disponibles.length ? "on" : ""}`} onClick={() => setElegidas(elegidas.length === disponibles.length ? [] : disponibles.map((p) => p.id))}>Todas las disponibles</button>
            </div>
            <div className="cf-palancas">
              {disponibles.map((p) => {
                const on = elegidas.includes(p.id);
                return (
                  <div key={p.id} className={`cf-pal ${on ? "on" : ""}`}>
                    <button type="button" className="cf-pal-sel" onClick={() => setElegidas(on ? elegidas.filter((x) => x !== p.id) : [...elegidas, p.id])} aria-pressed={on}>
                      <span className="cf-check" aria-hidden="true">{on ? "✓" : ""}</span>
                      <b>{p.nombre}</b>
                      <span className="cf-pal-desc">{p.descripcion}</span>
                      <span className="cf-pal-meta">{p.costo_canje ? `${pesos(p.costo_canje)} por canje` : "Sin costo"} · vale {p.vigencia_dias} días{p.dia_envio != null ? ` · sale los ${DIAS[p.dia_envio]}` : ""}</span>
                      <span className="cf-efectos">{tiersEf.map((t) => {
                        const e = p.efecto?.[t];
                        const cls = !e ? "nulo" : e.pp > 0 ? "pos" : e.pp < 0 ? "neg" : "nulo";
                        return <span key={t} className={`cf-ef ${cls}`} title={e ? `${e.fuente ?? ""}${e.n ? ` · ${fmt(e.n)} recibieron` : ""}${e.ctrl ? ` · control ${fmt(e.ctrl)}` : ""}` : "Nunca se midió en este grupo"}>{t} {e ? pp(e.pp) : "sin medir"}</span>;
                      })}</span>
                    </button>
                    <button type="button" className="cf-ver" onClick={() => setViendo(viendo === p.id ? null : p.id)}>{viendo === p.id ? "Ocultar mensaje" : "Ver mensaje"}</button>
                    {viendo === p.id && <MensajePrevio m={mensajes.find((m) => m.palanca === p.id)} waAprobada={!!p.wa_plantilla && aprobadas.includes(p.wa_plantilla)} />}
                  </div>
                );
              })}
            </div>
            {otras.length > 0 && (
              <details className="cf-otras"><summary>{otras.length} palancas más todavía no se pueden usar</summary>
                <ul>{otras.map((p) => <li key={p.id}><b>{p.nombre}</b> — {p.estado === "pausada" ? "pausada" : `falta: ${p.falta ?? "terminarla"}`}</li>)}</ul>
              </details>
            )}
            <div className="cf-control">
              <label className="cf-etq" htmlFor="control">Grupo de control: <b>{control} %</b></label>
              <input id="control" name="control_pct" type="range" min={0} max={50} step={5} value={control} onChange={(e) => setControl(Number(e.target.value))} />
              <p className="cf-sub">{control === 0 ? "Sin control no se puede saber si la campaña trajo a alguien." : `${control} de cada 100 no reciben nada: contra ellos se mide si la campaña funcionó.`}</p>
            </div>
          </div>
        </section>

        <section className="tarjeta"><header><h2>4 · Cuándo y hasta dónde</h2><p>Vigencia = los días que la campaña está al aire; cada cupón vale los días de su palanca</p></header>
          <div className="cuerpo cf-grid2">
            <div><label className="cf-etq" htmlFor="desde">Al aire desde</label><input id="desde" className="cf-input" type="date" name="desde" value={desde} min={hoy} onChange={(e) => setDesde(e.target.value)} required /></div>
            <div><label className="cf-etq" htmlFor="hasta">Hasta</label><input id="hasta" className="cf-input" type="date" name="hasta" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} required /></div>
            <div>
              <label className="cf-etq">Tope</label>
              <span className="seg">
                <button type="button" className={topeTipo === "canjes" ? "on" : ""} onClick={() => setTopeTipo("canjes")}>En canjes</button>
                <button type="button" className={topeTipo === "pesos" ? "on" : ""} onClick={() => setTopeTipo("pesos")}>En pesos</button>
              </span>
              <input type="hidden" name="tope_tipo" value={topeTipo} />
              <input className="cf-input" name="tope_valor" inputMode="numeric" value={tope} onChange={(e) => setTope(e.target.value.replace(/[^\d.]/g, ""))} style={{ marginTop: 8 }} required />
              <p className="cf-sub">Al llegar, deja de emitir cupones; los que ya salieron se pueden seguir canjeando hasta que venzan.</p>
            </div>
            <div>
              <label className="cf-etq">Lo paga</label>
              <span className="seg">
                <button type="button" disabled={!esAdmin} className={paga === "marca" ? "on" : ""} onClick={() => setPaga("marca")}>La marca</button>
                <button type="button" className={paga === "franquiciado" ? "on" : ""} onClick={() => setPaga("franquiciado")}>El franquiciado</button>
              </span>
              <input type="hidden" name="paga" value={paga} />
              <p className="cf-sub">{esAdmin ? "Solo el administrador escoge entre los dos." : "Las campañas que arma un franquiciado las paga el franquiciado."}</p>
            </div>
            <div className="cf-ancho"><label className="cf-etq" htmlFor="notas">Notas <em>opcional</em></label><textarea id="notas" className="cf-input" name="notas" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Para qué es, qué queremos aprender…" /></div>
          </div>
        </section>
      </div>

      <aside className="cf-der">
        <div className="tarjeta cf-resultado">
          <header><h2>Resultado esperado</h2><p>Con lo medido hasta hoy</p></header>
          <div className="cuerpo">
            <div className="cf-cifra"><b>{fmt(proy.contactables)}</b><span>contactables hoy</span></div>
            <p className="cf-sub">{fmt(proy.tratados)} reciben mensaje · {fmt(proy.control)} de control · por día salen hasta {fmt(diario)} entre todas las campañas</p>
            <table className="cf-tabla"><tbody>
              <tr><td>Clientes que vuelven por la campaña</td><td className={proy.extra < 0 ? "neg" : ""}>{sel.length ? fmt(proy.extra) : "—"}</td></tr>
              <tr><td>Venta extra <span className="cf-sub">(× {pesos(TICKET)})</span></td><td>{sel.length ? millones(proy.venta) : "—"}</td></tr>
              <tr><td>Contribución (56 %)</td><td>{sel.length ? millones(proy.contribucion) : "—"}</td></tr>
              <tr><td>Canjes esperados</td><td>{sel.length ? fmt(proy.canjes) : "—"}</td></tr>
              <tr><td>Costo de los canjes</td><td>{sel.length ? millones(-proy.costo) : "—"}</td></tr>
              <tr className="total"><td>Queda</td><td className={proy.neto < 0 ? "neg" : "pos"}>{sel.length ? millones(proy.neto) : "—"}</td></tr>
            </tbody></table>
            <p className="cf-sub">
              {!sel.length ? "Escoge al menos una palanca." : proy.cuponesParaTope == null ? "Con estas palancas no hay canjes que cuenten contra el tope." :
                proy.cuponesParaTope > proy.tratados ? `El tope (${topeTipo === "canjes" ? fmt(topeNum) + " canjes" : pesos(topeNum)}) da para ~${fmt(proy.cuponesParaTope)} cupones: más que la gente contactable hoy; el resto aparece a medida que se cumplen los enfriamientos.`
                : `El tope se alcanza con ~${fmt(proy.cuponesParaTope)} cupones (de ${fmt(proy.tratados)} posibles hoy).`}
            </p>
            <p className="cf-sub">Sin contar el costo de los mensajes. Cada mañana el número se corrige con lo que van midiendo las campañas.</p>
          </div>
        </div>
        {avisos.length > 0 && <div className="cf-avisos">{avisos.map((a, i) => <p key={i} className={`cf-aviso ${a.cls}`}>{a.txt}</p>)}</div>}
        {res && !res.ok && <p className="cf-aviso bad" role="alert">{res.error}</p>}
        <div className="cf-botones">
          <button className="boton cf-sec" type="submit" name="lanzar" value="0" disabled={enviando}>Guardar borrador</button>
          <button className="boton" type="submit" name="lanzar" value="1" disabled={enviando || !sel.length || !nombre.trim()} onClick={lanzar}>{enviando ? "Guardando…" : "Lanzar campaña"}</button>
        </div>
      </aside>
    </form>
  );
}
