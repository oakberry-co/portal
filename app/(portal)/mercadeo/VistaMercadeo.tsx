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
    // Solo los procesos de Colombia (sorteos e influencers RD tienen su propia pausa).
    const pausado = filas("envios").some((e) => e.estado === "pausado" && ["daily_campanas.sh CO", "hourly_wa_dispatch.sh", "hourly_email_dispatch.sh"].includes(e.proceso));
    const rows = lista.map((s) => { const lt = s.e ? 100 * s.vt / s.e : null, lc = s.ctrl ? 100 * s.vc / s.ctrl : null, d = (lt != null && lc != null) ? lt - lc : null;
      return `<tr><td>${esc(s.programa)}</td><td class="izq">${esc(s.semana)} · ${esc(s.desde)}</td><td class="izq" style="white-space:normal;min-width:180px">${[...s.pal].map(esc).join(", ")}</td><td>${fmt(s.e)}</td><td>${s.q ? fmt(s.q) : "—"}</td><td>${fmt(s.ctrl)}</td><td>${fmt(s.cj)}</td><td>${pesos(s.costo)}</td><td>${p1(lt)}</td><td>${p1(lc)}</td><td class="${d == null ? "" : d > 0 ? "pos" : "neg"}">${dpp(d)}</td></tr>`; });
    // Va debajo de la lista de campañas (campanas/page.tsx): el histórico de tandas por semana.
    root.innerHTML = `
      <div class="tarjeta"><header><h2>Histórico: tandas por semana <span class="chip ${pausado ? "bad" : "ok"}" style="margin-left:8px;vertical-align:middle">${pausado ? "Envíos en pausa" : "Envíos activos"}</span></h2><p>Cada tanda del CRM con su control · "Volvieron" = compraron (sello Loopy) en los 21 días siguientes · la semana en curso todavía no completa sus 21 días</p></header><div class="cuerpo">${tabla(["Programa", "Semana", "Palancas", "Enviados", "En cola", "Control", "Canjes", "Costo canjes", "Volvieron", "Control volvió", "Diferencia"], rows, [1, 2])}</div></div>`;
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

  // ── Gasto y canales (17-nov-2026) ───────────────────────────────────────────
  // Bloques opcionales de la foto: si el export no los pudo cargar llegan en null y la
  // sección lo dice, sin romper el resto del módulo.
  const tab = (o) => (o?.filas || []).map((f) => Object.fromEntries(o.cols.map((c, i) => [c, f[i]])));
  const mm = (x) => (x == null || isNaN(x)) ? "—" : (x < -50000 ? "−" : "") + "$" + (Math.abs(x) / 1e6).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " M";
  const fechaLarga = (d) => d ? new Date(d + "T12:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short" }) : "—";
  const sinDatos = (h1, txt) => `<div class="titulo"><h1>${h1}</h1></div><div class="vacio">${txt}</div>`;
  const avisos = (lista) => (lista || []).map(([e, t]) => `<div class="aviso ${e === "🔴" ? "" : "amarillo"}"><span>${e}</span><div>${esc(t)}</div></div>`).join("");

  V.presupuesto = () => {
    const P = D.ppto;
    if (!P) { root.innerHTML = sinDatos("Presupuesto de mercadeo en vivo", "Todavía no hay datos del presupuesto en vivo. Se recalcula cada semana, el martes en la tarde."); return; }
    const T = P.totales, est = T.est_facturas + (T.est_cobros || 0) + T.est_pauta, G = tab(P.grilla), E = tab(P.estimados);
    const sello = new Date(P.generado).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    const ancho = (x) => Math.max(0, Math.min(100, 100 * x / (T.ppto_anual || 1))).toFixed(2) + "%";
    // Por grupo (Comunidad y Eventos ya vienen juntos desde el cálculo; es_mkt también).
    const grupos = {};
    G.forEach((f) => { const g = grupos[f.grupo] = grupos[f.grupo] || { mkt: f.es_mkt, pa: 0, ph: 0, of: 0, es: 0, ci: 0 };
      g.pa += f.ppto; g.ph += f.ppto_a_hoy; g.of += f.oficial; g.es += f.est_facturas + (f.est_cobros || 0) + f.est_pauta; g.ci += f.cierre; });
    const fila = (n, g, cls = "") => { const gas = g.of + g.es, r = g.ph ? gas / g.ph : null;
      return `<tr class="${cls}"><td>${esc(n)}</td><td>${mm(g.pa)}</td><td>${mm(g.ph)}</td><td>${mm(g.of)}</td><td>${mm(g.es)}</td><td><b>${mm(gas)}</b></td><td class="${r != null && r > 1 ? "neg" : ""}">${r == null ? "—" : pct(gas, g.ph, 0)}</td><td>${mm(g.ci)}</td></tr>`; };
    const mkt = Object.entries(grupos).filter(([, g]) => g.mkt).sort((a, b) => b[1].pa - a[1].pa);
    const tot = mkt.reduce((t, [, g]) => { ["pa", "ph", "of", "es", "ci"].forEach((k) => t[k] += g[k]); return t; }, { pa: 0, ph: 0, of: 0, es: 0, ci: 0 });
    const fuera = Object.entries(grupos).filter(([, g]) => !g.mkt);
    // Por mes
    const meses = Array.from({ length: 12 }, (_, i) => i + 1), sm = (m, k) => G.filter((f) => f.es_mkt && f.mes === m).reduce((s, f) => s + (f[k] || 0), 0);
    const mHoy = +P.fecha.slice(5, 7), MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const rowsMes = meses.map((m) => `<tr><td>${MES[m - 1]}${m === mHoy ? " (en curso)" : ""}</td><td>${mm(sm(m, "ppto"))}</td><td>${mm(sm(m, "oficial"))}</td><td>${mm(sm(m, "est_facturas"))}</td><td>${mm(sm(m, "est_cobros"))}</td><td>${mm(sm(m, "est_pauta"))}</td><td><b>${m <= mHoy ? mm(sm(m, "vivo")) : "—"}</b></td><td>${m >= mHoy ? mm(sm(m, "proyeccion")) : "—"}</td></tr>`);
    // Lo que NO suma viaja en la misma tabla con su capa: facturas sin Mapeo y cuentas de cobro sin revisar.
    const noSuma = (r) => /^(Por clasificar|Cuenta de cobro por revisar)/.test(String(r.capa));
    const estimados = E.filter((r) => !noSuma(r)).sort((a, b) => b.valor_ppto - a.valor_ppto);
    const porClasificar = E.filter((r) => String(r.capa).startsWith("Por clasificar"));
    const porRevisar = E.filter((r) => String(r.capa).startsWith("Cuenta de cobro por revisar"));
    root.innerHTML = `
      <div class="titulo"><h1>Presupuesto de mercadeo en vivo</h1><p>Cuánto llevamos gastado hoy contra el presupuesto del año. Lo oficial sale de Siigo; lo que Siigo todavía no tiene se estima con las facturas que llegan de la DIAN, las cuentas de cobro aprobadas en el portal y la pauta de Meta. Calculado el ${esc(sello)} · se recalcula ${esc(P.frecuencia || "cada semana")}.</p></div>
      <div class="mk-ppto">
        <p class="mk-ppto-cifra">Llevamos <b>${mm(T.gastado)}</b> de ${mm(T.ppto_anual)} del año. Al ${fechaLarga(P.fecha)} el presupuesto iba en ${mm(T.ppto_a_hoy)}: vamos en <b>${pct(T.gastado, T.ppto_a_hoy, 0)}</b>.</p>
        <div class="mk-ppto-barra" role="img" aria-label="Gastado ${mm(T.gastado)} de ${mm(T.ppto_anual)}; el presupuesto a hoy iba en ${mm(T.ppto_a_hoy)}">
          <i class="of" style="width:${ancho(T.oficial)}"></i><i class="es" style="left:${ancho(T.oficial)};width:${ancho(est)}"></i><span class="hoy" style="left:${ancho(T.ppto_a_hoy)}"></span>
        </div>
        <div class="leyenda mk-ppto-eje"><span style="--c:var(--mk-s1)"><i></i>Oficial ${mm(T.oficial)}</span><span style="--c:var(--mk-s2)"><i></i>Estimado ${mm(est)}</span><span style="--c:var(--mk-ink)"><i></i>Presupuesto a hoy ${mm(T.ppto_a_hoy)}</span><span>Año ${mm(T.ppto_anual)}</span></div>
      </div>
      ${avisos(P.alertas)}
      <div class="kpis">${kpi("pnl", mm(T.gastado), "Gastado a hoy", `${mm(T.oficial)} oficial + ${mm(est)} estimado`)}${kpi("tablero", mm(T.ppto_a_hoy), "Presupuesto a hoy", `vamos en ${pct(T.gastado, T.ppto_a_hoy, 0)}`)}${kpi("soportes", mm(est), "Estimado (aún no en Siigo)", `${mm(T.est_facturas)} facturas · ${mm(T.est_cobros || 0)} cuentas de cobro · ${mm(T.est_pauta)} Meta`)}${kpi("gasto", mm(T.cierre), "Cierre del año en vivo", `${pct(T.cierre, T.ppto_anual, 0)} del presupuesto del año`)}</div>
      <div class="tarjeta"><header><h2>Presupuesto y gastado por mes</h2><p>Millones de COP sin IVA · solo mercadeo</p></header><div class="cuerpo" id="gPpto"></div></div>
      <div class="tarjeta"><header><h2>Por grupo</h2><p>«Presupuesto a hoy» cuenta el mes en curso hasta hoy</p></header><div class="cuerpo">${tabla(["Grupo", "Ppto año", "Ppto a hoy", "Oficial", "Estimado", "Gastado", "% del ppto a hoy", "Cierre en vivo"],
        [...mkt.map(([n, g]) => fila(n, g)), fila("TOTAL MERCADEO", tot, "total"), ...fuera.map(([n, g]) => fila(n + " (no suma)", g))])}</div></div>
      <div class="tarjeta"><header><h2>Por mes</h2><p>«Oficial» ya incluye toda la pauta y las cuentas de cobro que Siigo registró. «Cuentas de cobro aún no en Siigo» son las de influencers, UGC y promotoras aprobadas en el portal que el contador todavía no registra. «Meta aún no en Siigo» es lo consumido en Meta desde septiembre que Siigo todavía no tiene: va entero en el mes en curso.</p></header><div class="cuerpo">${tabla(["Mes", "Ppto", "Oficial", "Facturas aún no en Siigo", "Cuentas de cobro aún no en Siigo", "Meta aún no en Siigo", "Gastado", "Proyección"], rowsMes)}</div></div>
      <div class="tarjeta"><header><h2>Lo estimado, renglón por renglón</h2><p>Sale de aquí cuando Siigo lo registra: nada se cuenta dos veces</p></header><div class="cuerpo">${estimados.length ? tabla(["Proveedor", "Al ppto", "Rubro", "Qué es", "Fecha", "Número", "Por qué cuenta"],
        estimados.map((r) => `<tr><td>${esc(r.proveedor)}</td><td><b>${mm(r.valor_ppto)}</b></td><td class="izq">${esc(r.rubro)}</td><td class="izq">${esc(r.capa)}</td><td>${esc(r.fecha)}</td><td>${esc(r.numero)}</td><td class="izq">${esc(r.motivo || "")}</td></tr>`), [2, 3, 6]) : `<div class="vacio">Nada estimado: Siigo está al día.</div>`}</div></div>
      ${porClasificar.length ? `<div class="tarjeta"><header><h2>Con destino Mercadeo pero sin clasificar</h2><p>NO suman hasta que el proveedor se clasifique en la pestaña Mapeo del Sheet de control</p></header><div class="cuerpo">${tabla(["Proveedor", "Fecha", "Número", "Valor sin IVA"], porClasificar.map((r) => `<tr><td>${esc(r.proveedor)}</td><td>${esc(r.fecha)}</td><td>${esc(r.numero)}</td><td>${mm(r.base)}</td></tr>`))}</div></div>` : ""}
      ${porRevisar.length ? `<div class="tarjeta"><header><h2>Cuentas de cobro esperando revisión</h2><p>Llegaron por el portal y nadie las ha aprobado: NO suman todavía (muchas se rechazan por venir repetidas o con errores)</p></header><div class="cuerpo">${tabla(["Quién cobra", "Valor sin IVA", "Qué cobra", "Fecha", "Número"], porRevisar.map((r) => `<tr><td>${esc(r.proveedor)}</td><td><b>${mm(r.base)}</b></td><td class="izq">${esc(r.motivo || "")}</td><td>${esc(r.fecha)}</td><td>${esc(r.numero)}</td></tr>`), [2])}</div></div>` : ""}
      <div class="nota">Siigo al ${esc(P.siigo_al || "—")} · facturas DIAN al ${esc((P.facturas_sync || "—").replace("T", " ").replace("Z", " UTC"))} · Meta al ${esc(P.meta_hasta || "—")}. No incluye todavía Google, TikTok ni LinkedIn (se pagan con la tarjeta Clara, sin conexión) ni el 12,5 % de Rappi Ads.${P.sheet_url ? ` <a href="${esc(P.sheet_url)}" target="_blank" rel="noopener">Ver el detalle en el Sheet de control</a>.` : ""}</div>`;
    barras(q("#gPpto"), MES.slice(0, mHoy), [{ n: "Presupuesto", c: CTRL, v: meses.slice(0, mHoy).map((m) => sm(m, "ppto")) }, { n: "Gastado", c: S1, v: meses.slice(0, mHoy).map((m) => sm(m, "vivo")) }],
      { apilado: false, titulo: "Presupuesto y gastado por mes", fmtEje: (g) => (g / 1e6).toFixed(0) + " M", fmtTip: mm });
  };

  V.rappi = () => {
    const R = D.rappi;
    if (!R) { root.innerHTML = sinDatos("Rappi", "Todavía no hay datos de Rappi. Los Sheets de Rappi se cargan cada semana, el martes en la tarde."); return; }
    const Mn = tab(R.mensual), Sm = tab(R.semanal), Vi = tab(R.virales), Vt = tab(R.virales_tiendas), Pl = tab(R.planning);
    const s = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0);
    const meses = [...new Set(Mn.map((x) => x.mes))].sort(), ult = meses[meses.length - 1], M = Mn.filter((x) => x.mes === ult);
    const semanas = [...new Set(Sm.map((x) => x.semana))].sort(), sw = (w, marca) => s(Sm.filter((x) => x.semana === w && x.marca === marca), "ordenes");
    const hoy = D.hoy, mesLargo = (m) => new Date(m.slice(0, 7) + "-15T12:00:00").toLocaleDateString("es-CO", { month: "long", year: "numeric" });
    const estado = (p) => p.fin < hoy ? (Vi.some((v) => Math.abs((new Date(v.ini) - new Date(p.ini)) / 864e5) <= 1) ? `<span class="chip ok">Con análisis</span>` : `<span class="chip warn">Sin análisis de Rappi</span>`) : p.ini <= hoy ? `<span class="chip ok">En curso</span>` : `<span class="chip">Próximo</span>`;
    const porTienda = {};
    Vt.forEach((x) => { const t = porTienda[x.tienda] = porTienda[x.tienda] || { ciudad: x.ciudad, o: 0, e: 0, dv: 0, n: 0 }; t.o += x.ordenes; t.e += x.ordenes_esperadas; t.dv += x.delta_venta; t.n++; });
    const pctx = (x) => x == null || isNaN(x) ? "—" : (x >= 0 ? "+" : "") + (100 * x).toFixed(1).replace(".", ",") + " %";
    root.innerHTML = `
      <div class="titulo"><h1>Rappi</h1><p>Venta, tráfico, pauta y virales de Rappi, con las cifras que Rappi comparte (sus Sheets). La venta oficial de la marca sigue siendo la de Toteat.${R.frecuencia ? ` <span class="mk-frecuencia">Se actualiza ${esc(R.frecuencia)}.</span>` : ""}</p></div>
      <div class="kpis">${kpi("ordenes", mm(s(M, "venta")), `Venta en Rappi · ${mesLargo(ult)}`, `${fmt(s(M, "ordenes"))} órdenes · ${M.length} tiendas`)}${kpi("pnl", mm(s(M, "ads")), `RappiAds pagado · ${mesLargo(ult)}`, `${pct(s(M, "ads"), s(M, "venta"))} de la venta`)}${kpi("audiencia", pct(s(M, "ordenes"), s(M, "trafico")), "Conversión (órdenes ÷ tráfico)", `${fmt(s(M, "trafico"))} visitas a las tiendas`)}${kpi("canjes", Vi.length ? fmt(s(Vi, "nuevos")) : "—", "Clientes nuevos con virales", Vi.length ? `${Vi.length} virales · venta extra ${pct(s(Vi, "venta_incremental"), s(Vi, "descuento"), 0)} del descuento` : "")}</div>
      <div class="tarjeta"><header><h2>Órdenes por semana</h2><p>Oakberry y Oakberry Turbo · últimas 26 semanas</p></header><div class="cuerpo" id="gRappiSem"></div></div>
      <div class="tarjeta"><header><h2>Virales (Turbo)</h2><p>Análisis de Rappi, corte ${esc(R.corte_virales || "—")} · esperado = los 28 días previos sin otros virales</p></header><div class="cuerpo">
        <div id="gVir"></div>
        ${Vi.length ? tabla(["Viral", "Más órdenes", "Venta incr. ÷ descuento", "Nuevos", "Volvieron", "Cazadores", "Venta incremental", "Descuento", "Órdenes", "Esperadas"],
          Vi.map((v) => `<tr><td>${fechaLarga(v.ini)} – ${fechaLarga(v.fin)}</td><td class="pos">${pctx(v.lift_ordenes)}</td><td class="${v.incr_sobre_descuento >= 1 ? "pos" : "neg"}">${v.incr_sobre_descuento == null ? "—" : v.incr_sobre_descuento.toFixed(2).replace(".", ",")}</td><td>${fmt(v.nuevos)}</td><td>${v.retencion == null ? "—" : pct(v.retencion, 1, 0)}</td><td>${v.cazadores_pct == null ? "—" : pct(v.cazadores_pct, 1, 0)}</td><td>${mm(v.venta_incremental)}</td><td>${mm(v.descuento)}</td><td>${fmt(v.ordenes)}</td><td>${fmt(v.ordenes_esperadas)}</td></tr>`)) : `<div class="vacio">Rappi no ha mandado análisis de virales.</div>`}
        <p class="mk-sub">«Volvieron» = clientes nuevos con al menos una orden después del viral (los virales recientes tienen menos días para volver). «Cazadores» = compraron en algún viral y nunca en días sin descuento.</p>
      </div></div>
      <div class="tarjeta"><header><h2>Calendario de virales</h2><p>Planning Deals de Rappi</p></header><div class="cuerpo">${Pl.length ? tabla(["Fechas", "Estado", "Producto", "Precio final", "Descuento", "Bolsa", "Territorio"],
        Pl.map((p) => `<tr><td>${esc(p.fecha)}</td><td>${estado(p)}</td><td class="izq">${esc(p.producto)}</td><td>${pesos(p.precio_final)}</td><td>${p.dcto_total == null ? "—" : pct(p.dcto_total, 1, 0)}</td><td>${mm(p.presupuesto)}</td><td class="izq">${esc(p.territorio)}</td></tr>`), [2, 6]) : `<div class="vacio">Sin calendario.</div>`}</div></div>
      <div class="tarjeta"><header><h2>Por tienda · ${mesLargo(ult)}</h2><p>Tráfico = personas que entraron a la tienda en la app</p></header><div class="cuerpo">${tabla(["Tienda", "Venta", "Ads", "Ads ÷ venta", "Órdenes", "Tráfico", "Conversión", "Canceladas", "Ciudad"],
        M.map((x) => `<tr><td>${esc(x.tienda)}</td><td>${mm(x.venta)}</td><td>${mm(x.ads)}</td><td>${pct(x.ads, x.venta)}</td><td>${fmt(x.ordenes)}</td><td>${fmt(x.trafico)}</td><td>${pct(x.ordenes, x.trafico, 0)}</td><td>${fmt(x.canceladas)}</td><td class="izq">${esc(x.ciudad)}</td></tr>`), [8])}</div></div>
      ${Object.keys(porTienda).length ? `<div class="tarjeta"><header><h2>Virales por tienda</h2><p>Los ${Vi.length} virales sumados</p></header><div class="cuerpo">${tabla(["Tienda", "Ciudad", "Órdenes", "Esperadas", "Más órdenes", "Venta extra"],
        Object.entries(porTienda).sort((a, b) => b[1].o - a[1].o).map(([t, x]) => `<tr><td>${esc(t)}</td><td class="izq">${esc(x.ciudad)}</td><td>${fmt(x.o)}</td><td>${fmt(x.e)}</td><td class="${x.o >= x.e ? "pos" : "neg"}">${pctx(x.e ? x.o / x.e - 1 : null)}</td><td class="${x.dv >= 0 ? "" : "neg"}">${mm(x.dv)}</td></tr>`), [1])}</div></div>` : ""}
      <div class="nota">Cifras de Rappi (venta comisionable), no de Toteat. «Ads» = lo que se pagó en RappiAds ese mes según Rappi; el archivo financiero de Rappi lo confirma dentro de ±15 % (septiembre: −2,5 %). Rappi publica el mes con unas seis semanas de rezago.</div>`;
    barras(q("#gRappiSem"), semanas.map((w) => w.slice(8) + "/" + w.slice(5, 7)), [{ n: "Oakberry", c: S1, v: semanas.map((w) => sw(w, "Oakberry")) }, { n: "Oakberry Turbo", c: S2, v: semanas.map((w) => sw(w, "Turbo")) }], { titulo: "Órdenes por semana en Rappi" });
    if (Vi.length) barras(q("#gVir"), Vi.map((v) => fechaLarga(v.ini)), [{ n: "Esperadas", c: CTRL, v: Vi.map((v) => v.ordenes_esperadas) }, { n: "Con viral", c: S2, v: Vi.map((v) => v.ordenes) }], { apilado: false, alto: 200, titulo: "Órdenes con viral vs esperadas" });
  };

  (V[SEC] || V.inicio)();
}
