"use client";
import { useEffect, useRef, useState } from "react";
import { marcar } from "@/lib/rrhh/actions";

// EL MARCADOR: cámara frontal + GPS del navegador. La foto se reduce a 320 px
// de ancho (JPEG ~20-40 KB) antes de enviarse; la geocerca y la hora las
// valida el servidor (la acción `marcar`), el teléfono solo aporta evidencia.
type Props = { empleadoId: number; tienda: { nombre: string; lat: number | null; lng: number | null; radio: number }; siguiente: "entrada" | "salida"; turno: string };

function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}

export function Marcador({ empleadoId, tienda, siguiente, turno }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [foto, setFoto] = useState<string | null>(null);
  const [pos, setPos] = useState<{ lat: number; lng: number; prec: number } | null>(null);
  const [gpsErr, setGpsErr] = useState<string | null>(null);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [estado, setEstado] = useState<"listo" | "enviando" | "ok" | "fuera" | "error">("listo");
  const [msg, setMsg] = useState<string>("");
  const [simular, setSimular] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 } }, audio: false })
      .then((s) => { stream = s; if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}); } })
      .catch((e) => setCamErr("Sin cámara: " + (e?.message ?? "permiso denegado")));
    const w = navigator.geolocation?.watchPosition(
      (g) => { setPos({ lat: g.coords.latitude, lng: g.coords.longitude, prec: Math.round(g.coords.accuracy) }); setGpsErr(null); },
      (e) => setGpsErr("Sin ubicación: " + e.message), { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
    return () => { stream?.getTracks().forEach((t) => t.stop()); if (w != null) navigator.geolocation?.clearWatch(w); };
  }, []);

  const tomar = () => {
    const v = video.current; if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas"); const w = 320, h = Math.round(v.videoHeight * (w / v.videoWidth));
    c.width = w; c.height = h; c.getContext("2d")!.drawImage(v, 0, 0, w, h);
    setFoto(c.toDataURL("image/jpeg", 0.7));
  };
  const enviar = async () => {
    if (!foto) return;
    setEstado("enviando");
    const fd = new FormData();
    fd.set("empleado_id", String(empleadoId)); fd.set("tipo", siguiente); fd.set("selfie", foto);
    const p = simular && tienda.lat != null ? { lat: tienda.lat + 0.0002, lng: tienda.lng!, prec: 10 } : pos;
    if (p) { fd.set("lat", String(p.lat)); fd.set("lng", String(p.lng)); fd.set("precision", String(p.prec)); }
    const r = await marcar(fd);
    setMsg(r.mensaje); setEstado(r.ok ? (r.dentro ? "ok" : "fuera") : "error");
    if (r.ok) setTimeout(() => location.reload(), 1800);
  };
  const dist = pos && tienda.lat != null && tienda.lng != null ? distM(pos, { lat: tienda.lat, lng: tienda.lng }) : null;
  const dentro = dist != null && dist <= tienda.radio + Math.min(pos?.prec ?? 0, 50);

  return (
    <div className="nm-phone"><div className="scr">
      <div style={{ fontSize: 12, color: "var(--lav)" }}>Turno de hoy: <b>{turno}</b></div>
      <div className="cam" style={{ overflow: "hidden", padding: 0 }}>
        {foto ? <img src={foto} alt="selfie" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : camErr ? <span style={{ fontSize: 12, padding: 12 }}>{camErr}</span>
          : <video ref={video} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />}
      </div>
      <div className="gps">
        {gpsErr ? <span style={{ color: "var(--danger)" }}>{gpsErr}</span>
          : !pos ? "📍 Buscando ubicación…"
          : dist == null ? `📍 Ubicación lista (±${pos.prec} m)`
          : dentro ? `📍 A ${dist} m de ${tienda.nombre} · dentro del radio (${tienda.radio} m)` : <span style={{ color: "var(--danger)" }}>📍 A {dist} m de {tienda.nombre} · FUERA del radio ({tienda.radio} m)</span>}
      </div>
      {estado === "listo" || estado === "error" ? (
        !foto ? <button className="big" type="button" onClick={tomar} disabled={!!camErr}>📸 Tomar foto</button>
          : <>
            <button className="big" type="button" onClick={enviar} disabled={!pos && !simular}>Marcar {siguiente.toUpperCase()}</button>
            <button className="big out" type="button" onClick={() => setFoto(null)}>Repetir foto</button>
          </>
      ) : estado === "enviando" ? <button className="big" type="button" disabled>Enviando…</button> : null}
      {msg && <div style={{ fontSize: 12.5, fontWeight: 700, color: estado === "ok" ? "var(--ok)" : estado === "fuera" ? "var(--warn)" : "var(--danger)" }}>{msg}</div>}
      <label style={{ fontSize: 10.5, color: "var(--lav)", display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={simular} onChange={(e) => setSimular(e.target.checked)} />Simular que estoy en la tienda (solo pruebas)</label>
      <div style={{ fontSize: 10.5, color: "var(--lav)" }}>La foto y la ubicación quedan como evidencia. Hora del servidor.</div>
    </div></div>
  );
}
