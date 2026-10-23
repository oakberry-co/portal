// @ts-nocheck — las vistas están en JS plano (plantillas de texto + SVG a mano), sin
// librería de gráficos. Recibe la foto ya verificada por el servidor; no toca la red.
"use client";

import { useEffect, useRef } from "react";
import { ICONOS } from "../iconos";

// LAS VISTAS DE MERCADEO. Una función por sección (misma clave que la URL y que
// secciones.ts). Gráficos: una sola escala por gráfico (nunca doble eje), colores
// por función y validados para daltonismo (violeta/ámbar/verde), tooltip al pasar y
// tabla debajo cuando el color no alcanza. Tema claro fijo.

const estado = { ciudad: "todas", audModo: "personas", cohModo: "pct", prog: "Piloto Bogotá" };

export function VistaMercadeo({ seccion, datos, base }) {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const tip = document.createElement("div");
    tip.className = "mk-tip"; tip.hidden = true;
    document.body.appendChild(tip);
    try { pintar(root, seccion, datos, base, tip); }
    catch (e) { root.innerHTML = `<div class="vacio">No se pudo pintar esta sección: ${String(e?.message || e)}</div>`; console.error(e); }
    return () => tip.remove();
  }, [seccion, datos, base]);
  return <div className="mk" ref={ref} />;
}

function pintar(root, SEC, D, BASE, TIP) {
  const q = (s) => root.querySelector(s);
  const fmt = (x) => (x == null || isNaN(x)) ? "—" : Math.round(x).toLocaleString("es-CO");
  const pct = (a, b, d = 1) => b ? (100 * a / b).toFixed(d).replace(".", ",") + " %" : "—";
  const pesos = (x) => "$" + fmt(x);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  const link = (sec) => BASE + (sec ? "/" + sec : "");
  const ico = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONOS[k]}</svg>`;
  const filas = (t) => D[t].filas.map((f) => Object.fromEntries(D[t].cols.map((c, i) => [c, f[i]])));
  const ciudades = (t) => [...new Set(D[t].filas.map((f) => f[D[t].cols.indexOf("ciudad")]))]
    .filter((c) => c && !["Sin tienda", "Sin ciudad", "Otros"].includes(c)).sort((a, b) => a.localeCompare(b, "es"));
  const grupoTier = (t) => t === "T1" ? "T1 · Recién caído" : t === "T2" ? "T2 · Enfriándose" : (t === "T3" || t === "T4") ? "T3–T4 · Dormido" : t === "T5" ? "T5 · Perdido" : "T0 · Activo";
  const PALANCA = { doble_sello: "Doble sello", topping_gratis: "Topping premium", marca: "Saludo $0", martes_12oz: "Martes 12 oz", producto_gratis: "Bowl gratis", uet_pending: "Bowl gratis + encuesta" };
  const palanca = (p) => PALANCA[p] || (String(p).startsWith("descuento_") ? `${String(p).split("_")[1]} % OFF` : p);
  const mesTxt = (m) => { const [y, mo] = m.split("-"); return ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][+mo - 1] + " " + y.slice(2); };
  const dif = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
  const restarDias = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
  const enCiudad = (f) => estado.ciudad === "todas" || f.ciudad === estado.ciudad;
  const selCiudad = (t) => `<select id="fCiudad" aria-label="Ciudad"><option value="todas">Todas las ciudades</option>${ciudades(t).map((c) => `<option ${estado.ciudad === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>`;
  const atarCiudad = () => { const s = q("#fCiudad"); if (s) s.onchange = () => { estado.ciudad = s.value; pintar(root, SEC, D, BASE, TIP); }; };
  const rehacer = () => pintar(root, SEC, D, BASE, TIP);
  const kpi = (ic, valor, txt, sub) => `<div class="kpi"><span class="ico">${ico(ic)}</span><div><b>${valor}</b><span>${txt}</span>${sub ? `<em>${sub}</em>` : ""}</div></div>`;
  const tabla = (cols, rows, izq = []) => `<div class="tabla"><table><thead><tr>${cols.map((c, i) => `<th class="${i === 0 || izq.includes(i) ? "izq" : ""}">${c}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  const dpp = (d) => d == null ? "—" : (d > 0 ? "+" : "") + d.toFixed(1).replace(".", ",") + " pp";
  const p1 = (x) => x == null ? "—" : x.toFixed(1).replace(".", ",") + " %";

  function verTip(el, html) {
    el.addEventListener("pointermove", (e) => {
      TIP.innerHTML = html; TIP.hidden = false;
      const x = Math.min(e.clientX + 14, innerWidth - TIP.offsetWidth - 8), y = Math.max(8, e.clientY - TIP.offsetHeight - 12);
      TIP.style.left = x + "px"; TIP.style.top = y + "px";
    });
    el.addEventListener("pointerleave", () => { TIP.hidden = true; });
  }

  // Barras en SVG — apiladas (partes de un total) o lado a lado (comparar dos series).
  function barras(cont, etiquetas, series, opt = {}) {
    const W = 900, H = opt.alto || 260, ml = 54, mb = 30, mt = 10, n = etiquetas.length;
    if (!n) { cont.innerHTML = `<div class="vacio">Sin datos.</div>`; return; }
    const lado = opt.apilado === false;
    const tot = etiquetas.map((_, i) => series.reduce((s, se) => s + (se.v[i] || 0), 0));
    const max = Math.max(1, ...(lado ? series.flatMap((s) => s.v) : tot));
    const paso = (W - ml) / n, ancho = Math.max(4, Math.min(36, paso * (lado ? 0.36 : 0.62)));
    const y = (v) => mt + (H - mt - mb) * (1 - v / max);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.titulo || "")}">`;
    for (let k = 0; k <= 4; k++) { const g = max * k / 4;
      s += `<line x1="${ml}" x2="${W}" y1="${y(g)}" y2="${y(g)}" stroke="#ECE7F2"/><text x="${ml - 8}" y="${y(g) + 4}" text-anchor="end" font-size="12" fill="#8D8499">${opt.fmtEje ? opt.fmtEje(g) : fmt(g)}</text>`; }
    const cada = Math.ceil(n / 14);
    etiquetas.forEach((et, i) => {
      const cx = ml + paso * i + paso / 2;
      if (i % cada === 0 || i === n - 1) s += `<text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="12" fill="#8D8499">${esc(et)}</text>`;
      if (lado) {
        series.forEach((se, j) => { const v = se.v[i] || 0, x = cx - ancho - 1 + j * (ancho + 2);
          s += `<rect x="${x}" y="${y(v)}" width="${ancho}" height="${Math.max(0, y(0) - y(v))}" rx="4" fill="${se.c}"/>`; });
      } else {
        let b = 0;
        series.forEach((se, j) => { const v = se.v[i] || 0; if (!v) return;
          const y0 = y(b), y1 = y(b + v), arriba = series.slice(j + 1).every((z) => !(z.v[i]));
          s += `<rect x="${cx - ancho / 2}" y="${y1}" width="${ancho}" height="${Math.max(0, y0 - y1 - (b ? 2 : 0))}" rx="${arriba ? 4 : 0}" fill="${se.c}"/>`;
          b += v; });
      }
      s += `<rect class="hit" data-i="${i}" x="${ml + paso * i}" y="${mt}" width="${paso}" height="${H - mt - mb}" fill="transparent"/>`;
    });
    s += `<line x1="${ml}" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#CFC6DA"/></svg>`;
    cont.innerHTML = (series.length > 1 ? `<div class="leyenda">${series.map((se) => `<span style="--c:${se.c}"><i></i>${esc(se.n)}</span>`).join("")}</div>` : "") + `<div class="grafico">${s}</div>`;
    cont.querySelectorAll("rect.hit").forEach((r) => { const i = +r.dataset.i;
      verTip(r, `<b>${esc(etiquetas[i])}</b>` + series.map((se) => `${esc(se.n)}: ${opt.fmtTip ? opt.fmtTip(se.v[i] || 0) : fmt(se.v[i] || 0)}`).join("<br>") + (series.length > 1 && !lado ? `<br>Total: ${fmt(tot[i])}` : "")); });
  }

  // Barras horizontales para comparar categorías de nombre largo (palancas): la
  // etiqueta a la izquierda, una barra por serie y su valor al final de la barra.
  function barrasH(cont, etiquetas, series, opt = {}) {
    const n = etiquetas.length;
    if (!n) { cont.innerHTML = `<div class="vacio">Sin datos.</div>`; return; }
    const W = 900, ml = 250, mr = 70, alto = 13, hueco = 2, fila = series.length * (alto + hueco) + 16, H = n * fila + 8;
    const max = Math.max(1, ...series.flatMap((se) => se.v));
    const x = (v) => ml + (W - ml - mr) * (v / max);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.titulo || "")}">`;
    etiquetas.forEach((et, i) => {
      const y0 = i * fila + 8;
      s += `<text x="0" y="${y0 + (series.length * (alto + hueco)) / 2 + 4}" font-size="13" fill="#5D5468">${esc(et)}</text>`;
      series.forEach((se, j) => { const v = se.v[i] || 0, y = y0 + j * (alto + hueco);
        s += `<rect x="${ml}" y="${y}" width="${Math.max(0, x(v) - ml)}" height="${alto}" rx="4" fill="${se.c}"/>`;
        s += `<text x="${x(v) + 6}" y="${y + alto - 2}" font-size="12" fill="#5D5468">${opt.fmtTip ? opt.fmtTip(v) : fmt(v)}</text>`; });
      s += `<rect class="hit" data-i="${i}" x="0" y="${y0 - 4}" width="${W}" height="${fila}" fill="transparent"/>`;
    });
    s += `<line x1="${ml}" x2="${ml}" y1="0" y2="${H}" stroke="#CFC6DA"/></svg>`;
    cont.innerHTML = `<div class="leyenda">${series.map((se) => `<span style="--c:${se.c}"><i></i>${esc(se.n)}</span>`).join("")}</div><div class="grafico">${s}</div>`;
    cont.querySelectorAll("rect.hit").forEach((r) => { const i = +r.dataset.i;
      verTip(r, `<b>${esc(etiquetas[i])}</b>` + series.map((se) => `${esc(se.n)}: ${opt.fmtTip ? opt.fmtTip(se.v[i] || 0) : fmt(se.v[i] || 0)}`).join("<br>")); });
  }

  // Un solo tono, de claro a oscuro, para los mapas de calor.
  function calor(v, max) {
    const t = Math.max(0, Math.min(1, max ? v / max : 0));
    const a = [243, 238, 248], b = [75, 31, 96], c = a.map((x, i) => Math.round(x + (b[i] - x) * t));
    return { bg: `rgb(${c.join(",")})`, fg: t > 0.55 ? "#fff" : "#21152A" };
  }

  const S1 = "var(--mk-s1)", S2 = "var(--mk-s2)", S3 = "var(--mk-s3)", CTRL = "var(--mk-ctrl)";
  const V = {};

  V.inicio = () => {
    const ret = filas("retencion"), meses = [...new Set(ret.map((r) => r.mes))].sort();
    const ult = meses[meses.length - 1], pen = meses[meses.length - 2];
    const suma = (m, k) => ret.filter((r) => r.mes === m).reduce((s, r) => s + r[k], 0);
    const camp = filas("campanas").filter((c) => c.desde >= restarDias(D.hoy, 30));
    const pausados = filas("envios").filter((e) => e.estado === "pausado");
    const canj30 = filas("mensajes").slice(-30).reduce((s, m) => s + m.canjes, 0);
    const ultimos = meses.slice(-12);
    const g = {};
    camp.forEach((r) => { const x = g[r.programa] = g[r.programa] || { e: 0, ctrl: 0, cj: 0, costo: 0 }; x.e += r.enviados; x.ctrl += r.control; x.cj += r.canjes; x.costo += r.costo; });
    const rc = Object.entries(g).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${fmt(v.e)}</td><td>${fmt(v.ctrl)}</td><td>${fmt(v.cj)}</td><td>${pesos(v.costo)}</td></tr>`);
    root.innerHTML = `
      <div class="titulo"><h1>Inicio</h1><p>Cómo va la base de clientes Loopy y qué está haciendo el CRM. Datos de Loopy hasta el ${esc(D.loopy_hasta)}.</p></div>
      ${pausados.length ? `<div class="aviso"><div><b>Envíos pausados desde el ${esc(pausados[0].desde || "—")}</b>${pausados.length} procesos automáticos están detenidos (reactivación, recordatorios, sorteos e influencers RD). Los cupones ya enviados siguen valiendo. Ver <a href="${link("envios")}">Estado de envíos</a>.</div></div>` : ""}
      <div class="kpis">
        ${kpi("personas", fmt(suma(pen, "activos")), `Clientes que compraron en ${mesTxt(pen)}`, `${mesTxt(ult)} va en ${fmt(suma(ult, "activos"))} (mes en curso)`)}
        ${kpi("adq", fmt(suma(pen, "nuevos")), `Clientes nuevos en ${mesTxt(pen)}`, "primer sello en Loopy")}
        ${kpi("react", fmt(suma(pen, "reactivados")), `Reactivados en ${mesTxt(pen)}`, "volvieron tras más de 60 días")}
        ${kpi("canjes", fmt(canj30), "Cupones del CRM canjeados", "últimos 30 días")}
      </div>
      <div class="tarjeta"><header><h2>Clientes que compraron cada mes</h2><p>Sello Loopy · el último mes va en curso</p></header><div class="cuerpo" id="gIni"></div></div>
      <div class="dos">
        <div class="tarjeta"><header><h2>Campañas de los últimos 30 días</h2><p><a href="${link("campanas")}">Ver campañas</a></p></header><div class="cuerpo">${rc.length ? tabla(["Programa", "Enviados", "Control", "Canjes", "Costo canjes"], rc) : `<div class="vacio">Sin campañas en 30 días.</div>`}</div></div>
        <div class="tarjeta"><header><h2>Qué hay aquí</h2></header><div class="cuerpo"><p style="margin:0 0 8px;color:var(--mk-ink2)">CRM para ver (y pronto lanzar) campañas; análisis Loopy de cohortes, LTV, adquisición, retención y reactivación; y el resultado de cada campaña contra su grupo de control.</p><p style="margin:0;color:var(--mk-mute);font-size:13px">Se actualiza solo cada mañana. Lanzar campañas a un clic llega en la próxima versión.</p></div></div>
      </div>`;
    barras(q("#gIni"), ultimos.map(mesTxt), [
      { n: "Recurrentes", c: S1, v: ultimos.map((m) => suma(m, "recurrentes")) },
      { n: "Reactivados", c: S2, v: ultimos.map((m) => suma(m, "reactivados")) },
      { n: "Nuevos", c: S3, v: ultimos.map((m) => suma(m, "nuevos")) }], { titulo: "Clientes que compraron por mes" });
  };

  V.campanas = () => {
    const sem = {};
    filas("campanas").forEach((r) => { const k = r.programa + "|" + r.semana;
      const s = sem[k] = sem[k] || { programa: r.programa, semana: r.semana, desde: r.desde, e: 0, q: 0, ctrl: 0, cj: 0, costo: 0, vt: 0, vc: 0, pal: new Set() };
      s.e += r.enviados; s.q += r.en_cola; s.ctrl += r.control; s.cj += r.canjes; s.costo += r.costo; s.vt += r.volvio_t; s.vc += r.volvio_c; s.pal.add(palanca(r.palanca)); if (r.desde < s.desde) s.desde = r.desde; });
    const lista = Object.values(sem).sort((a, b) => b.semana.localeCompare(a.semana) || a.programa.localeCompare(b.programa));
    const pausado = filas("envios").some((e) => e.estado === "pausado");
    const rows = lista.map((s) => { const lt = s.e ? 100 * s.vt / s.e : null, lc = s.ctrl ? 100 * s.vc / s.ctrl : null, d = (lt != null && lc != null) ? lt - lc : null;
      return `<tr><td>${esc(s.programa)}</td><td class="izq">${esc(s.semana)} · ${esc(s.desde)}</td><td class="izq" style="white-space:normal;min-width:180px">${[...s.pal].map(esc).join(", ")}</td><td>${fmt(s.e)}</td><td>${s.q ? fmt(s.q) : "—"}</td><td>${fmt(s.ctrl)}</td><td>${fmt(s.cj)}</td><td>${pesos(s.costo)}</td><td>${p1(lt)}</td><td>${p1(lc)}</td><td class="${d == null ? "" : d > 0 ? "pos" : "neg"}">${dpp(d)}</td></tr>`; });
    root.innerHTML = `
      <div class="titulo"><h1>Campañas</h1><p>Cada tanda del CRM por semana, con su grupo de control. "Volvieron" = compraron (sello Loopy) en los 21 días siguientes.</p></div>
      <div class="filtros"><span class="boton" aria-disabled="true" title="Próximamente: lanzar una campaña a un clic">+ Nueva campaña</span><span class="chip ${pausado ? "bad" : "ok"}">${pausado ? "Envíos en pausa" : "Envíos activos"}</span><span style="color:var(--mk-mute);font-size:13px">Lanzar a un clic llega en la próxima versión.</span></div>
      <div class="tarjeta"><header><h2>Tandas por semana</h2><p>Más reciente arriba · la semana en curso todavía no completa sus 21 días</p></header><div class="cuerpo">${tabla(["Programa", "Semana", "Palancas", "Enviados", "En cola", "Control", "Canjes", "Costo canjes", "Volvieron", "Control volvió", "Diferencia"], rows, [1, 2])}</div></div>`;
  };

  V.audiencias = () => {
    const a = filas("audiencia").filter(enCiudad), modo = estado.audModo, tiers = ["T0", "T1", "T2", "T3", "T4", "T5"], por = {};
    a.forEach((r) => { const t = por[r.tienda] = por[r.tienda] || { ciudad: r.ciudad }; t[r.tier] = (t[r.tier] || 0) + r[modo]; });
    const totalDe = (v) => tiers.reduce((s, t) => s + (v[t] || 0), 0);
    const tiendas = Object.entries(por).filter(([k]) => k !== "Sin tienda").sort((x, y) => totalDe(y[1]) - totalDe(x[1]));
    const tot = tiers.map((t) => a.reduce((s, r) => s + (r.tier === t ? r[modo] : 0), 0));
    const rows = tiendas.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="izq">${esc(v.ciudad)}</td>${tiers.map((t) => `<td>${fmt(v[t] || 0)}</td>`).join("")}<td><b>${fmt(totalDe(v))}</b></td></tr>`);
    rows.push(`<tr class="total"><td>Total</td><td></td>${tot.map((x) => `<td>${fmt(x)}</td>`).join("")}<td>${fmt(tot.reduce((s, x) => s + x, 0))}</td></tr>`);
    const nombres = { personas: "Personas", con_wa: "Con WhatsApp", elegible_wa: "Contactables hoy por WhatsApp", elegible_email: "Contactables hoy por correo" };
    root.innerHTML = `
      <div class="titulo"><h1>Audiencias</h1><p>Clientes Loopy por tienda habitual y por qué tan fríos están. Una persona = un celular, aunque tenga varias tarjetas.</p></div>
      <div class="kpis">${kpi("personas", fmt(tot.reduce((s, x) => s + x, 0)), nombres[modo], estado.ciudad === "todas" ? "todo el país" : esc(estado.ciudad))}${kpi("react", fmt(tot[1]), "T1 · Recién caídos", "el grupo que mejor responde")}${kpi("ret", fmt(tot[3] + tot[4]), "T3–T4 · Dormidos", "")}${kpi("envios", fmt(tot[5]), "T5 · Perdidos", "")}</div>
      <div class="filtros">${selCiudad("audiencia")}<span class="seg" id="segAud">${Object.entries(nombres).map(([k, v]) => `<button data-k="${k}" class="${modo === k ? "on" : ""}">${v}</button>`).join("")}</span></div>
      <div class="nota">T0 activo · T1 recién caído (se saltó una visita) · T2 enfriándose · T3–T4 dormido · T5 perdido. El reloj es de cada cliente: depende de qué tan seguido venía.</div>
      <div class="tarjeta"><header><h2>${nombres[modo]} por tienda y grupo</h2></header><div class="cuerpo">${tabla(["Tienda", "Ciudad", ...tiers, "Total"], rows, [1])}</div></div>`;
    atarCiudad();
    q("#segAud").querySelectorAll("button").forEach((b) => b.onclick = () => { estado.audModo = b.dataset.k; rehacer(); });
  };

  V.plantillas = () => {
    const p = filas("plantillas");
    const cls = (s) => s === "APPROVED" ? "ok" : s === "PENDING" ? "warn" : "bad";
    const txt = (s) => ({ APPROVED: "Aprobada", PENDING: "En revisión", REJECTED: "Rechazada", PAUSED: "Pausada", DISABLED: "Deshabilitada" }[s] || s);
    root.innerHTML = `
      <div class="titulo"><h1>Plantillas de WhatsApp</h1><p>Las plantillas del número del CRM y su estado en Meta. Solo se envía con plantillas aprobadas.</p></div>
      <div class="tarjeta"><header><h2>${p.length} plantillas</h2><p>Se lee de Meta cada mañana</p></header><div class="cuerpo">${p.length ? tabla(["Nombre", "Estado", "Categoría", "Idioma"], p.map((r) => `<tr><td>${esc(r.nombre)}</td><td><span class="chip ${cls(r.estado)}">${txt(r.estado)}</span></td><td>${esc(r.categoria)}</td><td>${esc(r.idioma)}</td></tr>`)) : `<div class="vacio">No se pudo leer la lista de Meta en el último refresco.</div>`}</div></div>`;
  };

  V.envios = () => {
    const e = filas("envios");
    root.innerHTML = `
      <div class="titulo"><h1>Estado de envíos</h1><p>Los procesos automáticos que le escriben a clientes, leídos de la máquina donde corren.</p></div>
      <div class="tarjeta"><header><h2>Procesos</h2><p>Pausar o reanudar se hace en la máquina; esta vista solo muestra el estado</p></header><div class="cuerpo">${tabla(["Proceso", "Qué hace", "Estado", "Desde"], e.map((r) => `<tr><td>${esc(r.proceso)}</td><td class="izq" style="white-space:normal">${esc(r.que)}</td><td><span class="chip ${r.estado === "pausado" ? "bad" : "ok"}">${r.estado === "pausado" ? "Pausado" : "Activo"}</span></td><td>${esc(r.desde || "—")}</td></tr>`), [1])}</div></div>
      <div class="nota">No aparece aquí lo que responde a una acción del cliente (cupones de las landings, juegos, validador) ni los reportes internos al equipo: esos siguen funcionando.</div>`;
  };

  V.cohortes = () => {
    const modo = estado.cohModo, K = 12, ultimoMes = D.loopy_hasta.slice(0, 7), g = {};
    filas("cohortes").filter(enCiudad).forEach((r) => { const x = g[r.cohorte] = g[r.cohorte] || {}; x[r.k] = (x[r.k] || 0) + r.clientes; });
    const cohs = Object.keys(g).sort().slice(-18);
    const rows = cohs.map((m) => { const t = g[m][0] || 0;
      return `<tr><td>${mesTxt(m)}</td><td>${fmt(t)}</td>${[...Array(K)].map((_, i) => { const k = i + 1;
        if (k > dif(m, ultimoMes)) return `<td></td>`;
        const v = g[m][k] || 0, col = calor(t ? v / t : 0, 0.5), enCurso = k === dif(m, ultimoMes);
        return `<td style="background:${col.bg};color:${col.fg}" title="${mesTxt(m)} · mes ${k}: ${fmt(v)} de ${fmt(t)} (${pct(v, t)})${enCurso ? " · mes en curso" : ""}">${modo === "pct" ? pct(v, t, 0) : fmt(v)}${enCurso ? "*" : ""}</td>`; }).join("")}</tr>`; });
    const m1 = cohs.filter((m) => dif(m, ultimoMes) >= 2).map((m) => ({ m, p: g[m][0] ? 100 * (g[m][1] || 0) / g[m][0] : 0 }));
    root.innerHTML = `
      <div class="titulo"><h1>Cohortes</h1><p>Cada fila es un mes de clientes nuevos (su primer sello). Las columnas muestran qué parte volvió a comprar en cada mes siguiente.</p></div>
      <div class="filtros">${selCiudad("cohortes")}<span class="seg" id="segCoh"><button data-k="pct" class="${modo === "pct" ? "on" : ""}">% que volvió</button><button data-k="n" class="${modo === "n" ? "on" : ""}">Clientes</button></span></div>
      <div class="tarjeta"><header><h2>Retención por cohorte</h2><p>* mes en curso, todavía incompleto · más oscuro = más clientes volvieron</p></header><div class="cuerpo">${tabla(["Cohorte", "Nuevos", ...[...Array(K)].map((_, i) => "Mes " + (i + 1))], rows)}</div></div>
      <div class="tarjeta"><header><h2>Volvieron al mes siguiente (mes 1)</h2><p>La señal más temprana de si una cohorte engancha</p></header><div class="cuerpo" id="gM1"></div></div>`;
    barras(q("#gM1"), m1.map((x) => mesTxt(x.m)), [{ n: "Volvió en el mes 1", c: S1, v: m1.map((x) => x.p) }], { fmtEje: (v) => v.toFixed(0) + " %", fmtTip: p1, titulo: "Retención mes 1 por cohorte" });
    atarCiudad();
    q("#segCoh").querySelectorAll("button").forEach((b) => b.onclick = () => { estado.cohModo = b.dataset.k; rehacer(); });
  };

  V.ltv = () => {
    const ultimoMes = D.loopy_hasta.slice(0, 7), g = {}, hitos = [0, 1, 3, 6, 12];
    filas("cohortes").filter(enCiudad).forEach((r) => { const x = g[r.cohorte] = g[r.cohorte] || { n: 0, s: {} }; if (r.k === 0) x.n += r.clientes; x.s[r.k] = (x.s[r.k] || 0) + r.sellos; });
    const acum = (m, h) => { let s = 0; for (let k = 0; k <= h; k++) s += g[m].s[k] || 0; return s; };
    const valor = (m, h) => g[m].n ? acum(m, h) / g[m].n * D.ticket : 0;
    const cohs = Object.keys(g).sort().slice(-18);
    const maxL = Math.max(1, ...cohs.flatMap((m) => hitos.filter((h) => h < dif(m, ultimoMes)).map((h) => valor(m, h))));
    const rows = cohs.map((m) => `<tr><td>${mesTxt(m)}</td><td>${fmt(g[m].n)}</td>${hitos.map((h) => { if (h >= dif(m, ultimoMes)) return `<td></td>`;
      const v = valor(m, h), col = calor(v, maxL);
      return `<td style="background:${col.bg};color:${col.fg}" title="${(g[m].n ? acum(m, h) / g[m].n : 0).toFixed(2).replace(".", ",")} compras por cliente">${pesos(v)}</td>`; }).join("")}</tr>`);
    const m6 = cohs.filter((m) => dif(m, ultimoMes) > 6);
    root.innerHTML = `
      <div class="titulo"><h1>LTV</h1><p>Cuánto vale un cliente nuevo: compras acumuladas (sellos) desde su primer bowl × ticket presencial sin IVA (${pesos(D.ticket)}).</p></div>
      <div class="filtros">${selCiudad("cohortes")}</div>
      <div class="nota">Es una estimación: no todas las compras se sellan y el ticket es el promedio de la red. Sirve para comparar cohortes entre sí y para poner un techo a lo que vale la pena pagar por adquirir o reactivar.</div>
      <div class="tarjeta"><header><h2>Valor acumulado por cliente</h2><p>Mes 0 = el mes del primer sello · casillas vacías = la cohorte aún no llega ahí</p></header><div class="cuerpo">${tabla(["Cohorte", "Clientes", "Mes 0", "Mes 1", "Mes 3", "Mes 6", "Mes 12"], rows)}</div></div>
      <div class="tarjeta"><header><h2>LTV a 6 meses por cohorte</h2></header><div class="cuerpo" id="gLtv"></div></div>`;
    barras(q("#gLtv"), m6.map(mesTxt), [{ n: "LTV a 6 meses", c: S1, v: m6.map((m) => valor(m, 6)) }], { fmtEje: (v) => "$" + Math.round(v / 1000) + " mil", fmtTip: pesos, titulo: "LTV a 6 meses" });
    atarCiudad();
  };

  V.adquisicion = () => {
    const a = filas("adquisicion").filter(enCiudad);
    const meses = [...new Set(a.map((r) => r.mes))].sort().slice(-18);
    const s = (m, k) => a.filter((r) => r.mes === m).reduce((x, r) => x + r[k], 0);
    const ult3 = meses.slice(-4, -1), porT = {};
    a.filter((r) => ult3.includes(r.mes)).forEach((r) => { const t = porT[r.tienda] = porT[r.tienda] || { ciudad: r.ciudad, ins: 0, pc: 0 }; t.ins += r.inscritos; t.pc += r.primera_compra; });
    const rows = Object.entries(porT).filter(([k]) => k !== "Sin tienda").sort((x, y) => y[1].pc - x[1].pc).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="izq">${esc(v.ciudad)}</td><td>${fmt(v.ins)}</td><td>${fmt(v.pc)}</td></tr>`);
    const pen = meses[meses.length - 2];
    root.innerHTML = `
      <div class="titulo"><h1>Adquisición</h1><p>Clientes que entran a Loopy: inscripciones (crean la tarjeta) y primeras compras (su primer sello).</p></div>
      <div class="kpis">${kpi("adq", fmt(s(pen, "inscritos")), `Inscripciones en ${mesTxt(pen)}`, "")}${kpi("personas", fmt(s(pen, "primera_compra")), `Primeras compras en ${mesTxt(pen)}`, "")}</div>
      <div class="filtros">${selCiudad("adquisicion")}</div>
      <div class="tarjeta"><header><h2>Por mes</h2><p>El último mes va en curso</p></header><div class="cuerpo" id="gAdq"></div></div>
      <div class="tarjeta"><header><h2>Por tienda · últimos 3 meses cerrados</h2><p>${ult3.map(mesTxt).join(", ")}</p></header><div class="cuerpo">${tabla(["Tienda", "Ciudad", "Inscripciones", "Primeras compras"], rows, [1])}</div></div>`;
    barras(q("#gAdq"), meses.map(mesTxt), [{ n: "Inscripciones", c: S1, v: meses.map((m) => s(m, "inscritos")) }, { n: "Primeras compras", c: S3, v: meses.map((m) => s(m, "primera_compra")) }], { apilado: false, titulo: "Adquisición por mes" });
    atarCiudad();
  };

  V.retencion = () => {
    const r = filas("retencion").filter(enCiudad);
    const meses = [...new Set(r.map((x) => x.mes))].sort().slice(-18);
    const s = (m, k) => r.filter((x) => x.mes === m).reduce((a, x) => a + x[k], 0);
    const rows = meses.slice().reverse().map((m) => { const act = s(m, "activos"); return `<tr><td>${mesTxt(m)}</td><td>${fmt(act)}</td><td>${fmt(s(m, "recurrentes"))}</td><td>${pct(s(m, "recurrentes"), act)}</td><td>${fmt(s(m, "reactivados"))}</td><td>${fmt(s(m, "nuevos"))}</td></tr>`; });
    root.innerHTML = `
      <div class="titulo"><h1>Retención</h1><p>Quién compró cada mes y de dónde viene: recurrentes (habían comprado en los 60 días anteriores), reactivados (volvieron tras más de 60 días) y nuevos.</p></div>
      <div class="filtros">${selCiudad("retencion")}</div>
      <div class="tarjeta"><header><h2>Clientes que compraron por mes</h2><p>El último mes va en curso</p></header><div class="cuerpo" id="gRet"></div></div>
      <div class="tarjeta"><header><h2>Tabla</h2></header><div class="cuerpo">${tabla(["Mes", "Compraron", "Recurrentes", "% recurrentes", "Reactivados", "Nuevos"], rows)}</div></div>`;
    barras(q("#gRet"), meses.map(mesTxt), [{ n: "Recurrentes", c: S1, v: meses.map((m) => s(m, "recurrentes")) }, { n: "Reactivados", c: S2, v: meses.map((m) => s(m, "reactivados")) }, { n: "Nuevos", c: S3, v: meses.map((m) => s(m, "nuevos")) }], { titulo: "Retención por mes" });
    atarCiudad();
  };

  V.reactivacion = () => {
    const r = filas("retencion").filter(enCiudad);
    const meses = [...new Set(r.map((x) => x.mes))].sort().slice(-18);
    const s = (m, k) => r.filter((x) => x.mes === m).reduce((a, x) => a + x[k], 0);
    const porMes = {};
    filas("campanas").forEach((x) => { const m = x.desde.slice(0, 7); const p = porMes[m] = porMes[m] || { e: 0, vt: 0, ctrl: 0, vc: 0 }; p.e += x.enviados; p.vt += x.volvio_t; p.ctrl += x.control; p.vc += x.volvio_c; });
    const crm = Object.entries(porMes).sort().map(([m, p]) => { const lt = p.e ? p.vt / p.e : 0, lc = p.ctrl ? p.vc / p.ctrl : 0;
      return `<tr><td>${mesTxt(m)}</td><td>${fmt(p.e)}</td><td>${pct(p.vt, p.e)}</td><td>${pct(p.vc, p.ctrl)}</td><td class="${lt > lc ? "pos" : "neg"}">${dpp((lt - lc) * 100)}</td><td>${fmt(Math.max(0, (lt - lc) * p.e))}</td></tr>`; });
    root.innerHTML = `
      <div class="titulo"><h1>Reactivación</h1><p>Clientes que vuelven a comprar después de más de 60 días sin venir, y cuántos de ellos trajo el CRM (contra su grupo de control).</p></div>
      <div class="filtros">${selCiudad("retencion")}</div>
      <div class="tarjeta"><header><h2>Reactivados por mes</h2><p>Todos, con o sin mensaje del CRM · el último mes va en curso</p></header><div class="cuerpo" id="gReact"></div></div>
      <div class="tarjeta"><header><h2>Lo que trajo el CRM</h2><p>Recompra a 21 días de quien recibió mensaje vs. su control · todo el país, todas las palancas</p></header><div class="cuerpo">${tabla(["Mes del envío", "Recibieron", "Volvieron", "Control volvió", "Diferencia", "Clientes traídos por el CRM"], crm)}</div></div>`;
    barras(q("#gReact"), meses.map(mesTxt), [{ n: "Reactivados", c: S2, v: meses.map((m) => s(m, "reactivados")) }], { titulo: "Reactivados por mes" });
    atarCiudad();
  };

  V.palancas = () => {
    const progs = [...new Set(filas("campanas").map((x) => x.programa))];
    if (!progs.includes(estado.prog)) estado.prog = progs[0];
    const g = {};
    filas("campanas").filter((x) => x.programa === estado.prog).forEach((x) => { const k = grupoTier(x.tier) + "|" + palanca(x.palanca);
      const p = g[k] = g[k] || { tg: grupoTier(x.tier), p: palanca(x.palanca), e: 0, vt: 0, ctrl: 0, vc: 0, cj: 0, costo: 0 };
      p.e += x.enviados; p.vt += x.volvio_t; p.ctrl += x.control; p.vc += x.volvio_c; p.cj += x.canjes; p.costo += x.costo; });
    const lista = Object.values(g).filter((x) => x.e > 0).sort((a, b) => a.tg.localeCompare(b.tg) || b.e - a.e);
    const rows = lista.map((x) => { const lt = 100 * x.vt / x.e, lc = x.ctrl ? 100 * x.vc / x.ctrl : null, d = lc == null ? null : lt - lc;
      return `<tr><td>${esc(x.tg)}</td><td class="izq">${esc(x.p)}</td><td>${fmt(x.e)}</td><td>${p1(lt)}</td><td>${fmt(x.ctrl)}</td><td>${p1(lc)}</td><td class="${d == null ? "" : d > 0 ? "pos" : "neg"}">${dpp(d)}</td><td>${fmt(x.cj)}</td><td>${pesos(x.costo)}</td></tr>`; });
    root.innerHTML = `
      <div class="titulo"><h1>Resultados por palanca</h1><p>Qué parte de quienes recibieron cada palanca volvió a comprar en 21 días, contra su grupo de control (no recibió nada).</p></div>
      <div class="filtros"><span class="seg" id="segProg">${progs.map((p) => `<button data-k="${esc(p)}" class="${p === estado.prog ? "on" : ""}">${esc(p)}</button>`).join("")}</span></div>
      <div class="nota">Con controles de menos de 100 personas, una o dos personas mueven el porcentaje: lee la diferencia con cuidado. Los correos de T2–T4 del piloto del 17 al 22 de octubre llevaron un recordatorio que prometía un bowl gratis por error.</div>
      <div class="tarjeta"><header><h2>Volvieron vs. control</h2></header><div class="cuerpo" id="gPal"></div></div>
      <div class="tarjeta"><header><h2>Tabla</h2></header><div class="cuerpo">${tabla(["Grupo", "Palanca", "Recibieron", "Volvieron", "Control", "Control volvió", "Diferencia", "Canjes", "Costo canjes"], rows, [1])}</div></div>`;
    barrasH(q("#gPal"), lista.map((x) => x.tg.split(" · ")[0] + " · " + x.p + ` (${fmt(x.e)})`), [{ n: "Recibieron mensaje", c: S1, v: lista.map((x) => 100 * x.vt / x.e) }, { n: "Control", c: CTRL, v: lista.map((x) => x.ctrl ? 100 * x.vc / x.ctrl : 0) }], { fmtTip: p1, titulo: "Recompra por palanca" });
    q("#segProg").querySelectorAll("button").forEach((b) => b.onclick = () => { estado.prog = b.dataset.k; rehacer(); });
  };

  V.mensajes = () => {
    const m = filas("mensajes"), u30 = m.slice(-30), s = (k) => u30.reduce((a, x) => a + x[k], 0);
    root.innerHTML = `
      <div class="titulo"><h1>Mensajes</h1><p>Qué salió por WhatsApp y correo en los últimos 60 días, y qué pasó con cada mensaje.</p></div>
      <div class="kpis">${kpi("mensajes", fmt(s("wa_enviados")), "WhatsApp enviados · 30 días", `${pct(s("wa_leidos"), s("wa_entregados"))} de los entregados se leyó`)}${kpi("envios", fmt(s("wa_frenados_meta")), "Frenados por Meta (saturación)", `${pct(s("wa_frenados_meta"), s("wa_enviados"))} de lo enviado · si pasa de 10 %, bajar el ritmo`)}${kpi("plantillas", fmt(s("em_enviados")), "Correos enviados · 30 días", `${pct(s("em_abiertos"), s("em_enviados"))} abiertos (inflado por iPhone)`)}${kpi("canjes", fmt(s("canjes")), "Canjes · 30 días", "")}</div>
      <div class="tarjeta"><header><h2>WhatsApp por día</h2></header><div class="cuerpo" id="gWa"></div></div>
      <div class="tarjeta"><header><h2>Correo por día</h2></header><div class="cuerpo" id="gEm"></div></div>`;
    const et = m.map((x) => x.dia.slice(8) + "/" + x.dia.slice(5, 7));
    barras(q("#gWa"), et, [{ n: "Enviados", c: S1, v: m.map((x) => x.wa_enviados) }, { n: "Leídos", c: S3, v: m.map((x) => x.wa_leidos) }], { apilado: false, titulo: "WhatsApp por día" });
    barras(q("#gEm"), et, [{ n: "Enviados", c: S1, v: m.map((x) => x.em_enviados) }, { n: "Abiertos", c: S3, v: m.map((x) => x.em_abiertos) }], { apilado: false, titulo: "Correo por día" });
  };

  V.canjes = () => {
    const c = filas("canjes"), porT = {}, pals = [...new Set(c.map((x) => palanca(x.palanca)))];
    c.forEach((x) => { const t = porT[x.tienda] = porT[x.tienda] || { n: 0, costo: 0, p: {} }; t.n += x.canjes; t.costo += x.costo; t.p[palanca(x.palanca)] = (t.p[palanca(x.palanca)] || 0) + x.canjes; });
    const rows = Object.entries(porT).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `<tr><td>${esc(k)}</td>${pals.map((p) => `<td>${fmt(v.p[p] || 0)}</td>`).join("")}<td><b>${fmt(v.n)}</b></td><td>${pesos(v.costo)}</td></tr>`);
    const dias = [...new Set(c.map((x) => x.dia))].sort();
    root.innerHTML = `
      <div class="titulo"><h1>Canjes y costos</h1><p>Cupones atados a una tienda que se validaron en caja, últimos 60 días. El costo es el esperado por canje (sello $700, topping ≈ $1.500, martes ≈ $2.000).</p></div>
      <div class="kpis">${kpi("canjes", fmt(c.reduce((s, x) => s + x.canjes, 0)), "Canjes · 60 días", "")}${kpi("ltv", pesos(c.reduce((s, x) => s + x.costo, 0)), "Costo de los canjes", "sin contar mensajes")}</div>
      <div class="tarjeta"><header><h2>Canjes por día</h2></header><div class="cuerpo" id="gCj"></div></div>
      <div class="tarjeta"><header><h2>Por tienda</h2></header><div class="cuerpo">${rows.length ? tabla(["Tienda", ...pals, "Total", "Costo"], rows) : `<div class="vacio">Sin canjes en 60 días.</div>`}</div></div>`;
    barras(q("#gCj"), dias.map((d) => d.slice(8) + "/" + d.slice(5, 7)), [{ n: "Canjes", c: S1, v: dias.map((d) => c.filter((x) => x.dia === d).reduce((s, x) => s + x.canjes, 0)) }], { titulo: "Canjes por día" });
  };

  (V[SEC] || V.inicio)();
}
