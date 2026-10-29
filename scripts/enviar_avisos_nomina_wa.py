#!/usr/bin/env python3
"""Le escribe a la PERSONA que se le pagó la nómina — vacía la cola `nomina_avisos`
por WhatsApp (línea de RRHH, +57 350 8323304).

El portal ENCOLA al confirmar el pago de un lote (Contabilidad › Pagos de nómina),
dentro de la misma transacción, con el texto ya resuelto: cuánto, a qué cuenta
(enmascarada) y QUÉ DÍA le debería entrar (lib/nomina-abono.ts). Acá solo se manda.

Por qué en la VM y no en el portal: acá vive el token de Meta (Secret Manager) y la
compuerta de envío compartida (common/envio_seguro.py: tope, ventana 6-22 Bogotá y
apagador PARAR_ENVIOS). Corre desde certificaciones.sh, junto con los correos.

Quien respondió SALIR a la línea de RRHH no recibe (mismo criterio que el reporte de
ventas: cuenta el último texto de cada persona).

Uso:
    python3 scripts/enviar_avisos_nomina_wa.py                 # ensayo: muestra, no manda
    python3 scripts/enviar_avisos_nomina_wa.py --commit
    WA_DESTINO_FORZADO=573213691318 python3 scripts/enviar_avisos_nomina_wa.py --commit   # pruebas
    python3 scripts/enviar_avisos_nomina_wa.py --plantilla preview|crear|estado
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

import psycopg2

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from sync_bq_to_pg import cargar_database_url  # noqa: E402
from enviar_correos import base_de_produccion  # noqa: E402

DW = "/home/daniel/proyectos/datawarehouse"
sys.path.insert(0, DW)
try:
    from common.envio_seguro import Compuerta, EnvioBloqueado  # noqa: E402
except Exception:                                   # el repo puede no estar (dev)
    Compuerta = None

    class EnvioBloqueado(Exception):
        pass

PROJECT = "project-oakberry-colombia-dw"
# La línea de RRHH: la misma del reporte de ventas (config/reporte_ventas_wa.json del
# repo datawarehouse). Se repite acá a propósito y no se lee de allá: si el reporte
# cambia de línea, la nómina no tiene por qué irse con él.
WABA_ID = "4279751375648735"
PHONE_ID = "1187267117808058"
TOKEN_SECRET = "OAKBERRY_MENSAJERIA_TOKEN"
API = "v22.0"
PLANTILLA = "nomina_pago_confirmado_v1"
IDIOMA = "es"
MAX_INTENTOS = 5

# Cada variable va en UNA línea (Meta rechaza saltos de línea dentro de una variable).
CUERPO = ("Hola {{1}} 👋\n\n"
          "ManelFoods te confirma el {{2}}: *{{3}}* a tu cuenta {{4}}.\n\n"
          "Deberías verlo reflejado a más tardar el *{{5}}*. "
          "Si para ese día no te ha entrado, responde este mensaje y lo revisamos.")
PIE = "ManelFoods · Responde SALIR para no recibir más"       # regla: toda plantilla con opt-out
EJEMPLO = ["Jenny Milena", "pago de la 1ª quincena de noviembre 2026", "$ 1.120.450",
           "Bancolombia terminada en 3737", "lunes 17 de noviembre"]
ORDEN = ["nombre", "que", "valor", "cuenta", "cuando"]

OPTOUT_RE = re.compile(r"\b(salir|stop|baja|darme de baja|cancelar|no m[aá]s|no quiero)\b", re.I)


def token() -> str:
    t = os.environ.get("OAKBERRY_MENSAJERIA_TOKEN", "").strip()
    if t:
        return t
    r = subprocess.run(["gcloud", "secrets", "versions", "access", "latest",
                        f"--secret={TOKEN_SECRET}", f"--project={PROJECT}"],
                       capture_output=True, text=True, timeout=30)
    if r.returncode != 0 or not r.stdout.strip():
        raise SystemExit(f"No se pudo leer el secreto {TOKEN_SECRET}: {r.stderr[:200]}")
    return r.stdout.strip()


def http(method: str, path: str, tok: str, body: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(
        f"https://graph.facebook.com/{API}/{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except ValueError:
            return e.code, {}


def renderizar(datos: dict) -> str:
    txt = CUERPO
    for i, k in enumerate(ORDEN, 1):
        txt = txt.replace("{{%d}}" % i, str(datos[k]))
    return txt


def variables_validas(datos: dict) -> list[str]:
    """Lo que Meta rechazaría o lo que no se le puede decir a una persona."""
    malas = []
    for k in ORDEN:
        v = str(datos.get(k) or "").strip()
        if not v:
            malas.append(f"falta «{k}»")
        elif "\n" in v or "\t" in v or "    " in v:
            malas.append(f"«{k}» trae saltos de línea o tabulaciones")
    if not re.search(r"\d{4}$", str(datos.get("cuenta") or "")):
        malas.append("la cuenta no termina en 4 dígitos")
    return malas


def plantilla(accion: str) -> int:
    if accion == "preview":
        print(renderizar(dict(zip(ORDEN, EJEMPLO))) + "\n\n" + PIE)
        print(f"\n{len(PIE)} chars de pie (tope 60)")
        assert len(PIE) <= 60
        return 0
    tok = token()
    if accion == "crear":
        st, r = http("POST", f"{WABA_ID}/message_templates", tok, {
            "name": PLANTILLA, "language": IDIOMA, "category": "UTILITY",
            "components": [{"type": "BODY", "text": CUERPO, "example": {"body_text": [EJEMPLO]}},
                           {"type": "FOOTER", "text": PIE}]})
    else:
        st, r = http("GET", f"{WABA_ID}/message_templates?name={PLANTILLA}"
                            f"&fields=name,status,category,rejected_reason,language", tok)
    print(f"HTTP {st}\n{json.dumps(r, indent=2, ensure_ascii=False)}")
    return 0 if st < 300 else 1


def optouts() -> set[str]:
    """Celulares que respondieron SALIR a la línea de RRHH (el webhook guarda lo que
    llega en rrhh_manelfoods.wa_recepciones). Si BigQuery falla NO se envía: mandarle
    a alguien que pidió no recibir es peor que demorar un aviso (Regla 12)."""
    from google.cloud import bigquery
    c = bigquery.Client(project=PROJECT)
    rows = c.query("""
        SELECT remitente, ARRAY_AGG(caption ORDER BY received_at DESC LIMIT 1)[OFFSET(0)] ultimo
          FROM `rrhh_manelfoods.wa_recepciones`
         WHERE phone_number_id = @pid AND media_type = 'text' AND caption IS NOT NULL
         GROUP BY 1""", job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("pid", "STRING", PHONE_ID)])).result()
    return {r.remitente for r in rows if OPTOUT_RE.search(r.ultimo or "")}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--commit", action="store_true", help="enviar de verdad")
    ap.add_argument("--limite", type=int, default=80)
    ap.add_argument("--lote", type=int, help="solo los avisos de este lote")
    ap.add_argument("--plantilla", choices=["preview", "crear", "estado"])
    a = ap.parse_args()
    if a.plantilla:
        return plantilla(a.plantilla)

    dsn = cargar_database_url()
    if not dsn:
        print("ERROR: falta DATABASE_URL", file=sys.stderr)
        return 2
    forzado = re.sub(r"\D", "", os.environ.get("WA_DESTINO_FORZADO", ""))
    # CANDADO DEL AMBIENTE: la base de pruebas es copia de producción y puede traer
    # celulares REALES. Desde una base que no es la de producción solo se manda al
    # número forzado (variable de entorno, no flag: un flag hay que acordarse).
    if a.commit and not base_de_produccion(dsn) and not forzado:
        print("⛔ Esta NO es la base de producción y no hay WA_DESTINO_FORZADO. No se envía.", file=sys.stderr)
        return 2

    conn = psycopg2.connect(dsn)
    cur = conn.cursor()
    cur.execute("SELECT to_regclass('public.nomina_avisos') IS NOT NULL")
    if not cur.fetchone()[0]:
        print("→ el portal todavía no tiene la cola nomina_avisos (§30): nada que hacer")
        return 0
    filtro = "AND lote_id = %(lote)s" if a.lote else ""
    cur.execute(f"""SELECT id, lote_id, num_doc, celular, datos, intentos FROM nomina_avisos
                     WHERE estado = 'pendiente' AND intentos < {MAX_INTENTOS} {filtro}
                     ORDER BY id LIMIT %(lim)s""", {"lote": a.lote, "lim": a.limite})
    cols = [d[0] for d in cur.description]
    filas = [dict(zip(cols, r)) for r in cur.fetchall()]
    print(f"→ {len(filas)} aviso(s) de nómina por enviar")
    if not filas:
        return 0

    if Compuerta:
        try:
            filas = Compuerta(canal="wa", programa="nomina_avisos").autorizar(
                filas, limite=a.limite, confirmar_prod=a.commit)
        except EnvioBloqueado as e:
            print(f"⛔ {e}")
            return 0

    bajas = optouts() if a.commit else set()
    tok = token() if a.commit else ""
    ok = err = 0
    for f in filas:
        datos = f["datos"] if isinstance(f["datos"], dict) else json.loads(f["datos"])
        destino = forzado or f["celular"]
        print(f"  #{f['id']} lote {f['lote_id']} → {destino[:-4]}****  «{datos['valor']} · {datos['cuando']}»")
        malas = variables_validas(datos)
        if malas:
            print("     ⛔ NO se envía: " + "; ".join(malas))
            if a.commit:
                cur.execute("UPDATE nomina_avisos SET estado='fallido', error=%s WHERE id=%s",
                            ("; ".join(malas)[:400], f["id"]))
                conn.commit()
            err += 1
            continue
        if not a.commit:
            continue
        if f["celular"] in bajas:
            cur.execute("UPDATE nomina_avisos SET estado='cancelado', error='respondió SALIR a la línea de RRHH' WHERE id=%s",
                        (f["id"],))
            conn.commit()
            continue
        # Regla 12: el except envuelve UN aviso; uno malo no tumba el resto.
        try:
            st, r = http("POST", f"{PHONE_ID}/messages", tok, {
                "messaging_product": "whatsapp", "to": destino, "type": "template",
                "template": {"name": PLANTILLA, "language": {"code": IDIOMA},
                             "components": [{"type": "body", "parameters": [
                                 {"type": "text", "text": str(datos[k])} for k in ORDEN]}]}})
            wamid = ((r.get("messages") or [{}])[0]).get("id")
            if st < 300 and wamid:
                cur.execute("""UPDATE nomina_avisos SET estado='enviado', wa_message_id=%s,
                                      enviado_en=now(), intentos=intentos+1, error=NULL WHERE id=%s""",
                            (wamid, f["id"]))
                ok += 1
            else:
                msg = json.dumps(r.get("error") or r, ensure_ascii=False)[:400]
                cur.execute("""UPDATE nomina_avisos SET intentos=intentos+1, error=%s,
                                      estado = CASE WHEN intentos+1 >= %s THEN 'fallido' ELSE 'pendiente' END
                                WHERE id=%s""", (f"HTTP {st}: {msg}", MAX_INTENTOS, f["id"]))
                print(f"     ✗ HTTP {st}: {msg}")
                err += 1
            conn.commit()
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            cur.execute("UPDATE nomina_avisos SET intentos=intentos+1, error=%s WHERE id=%s",
                        (f"{type(e).__name__}: {e}"[:400], f["id"]))
            conn.commit()
            print(f"     ✗ {type(e).__name__}: {e}")
            err += 1
    print(f"→ enviados {ok} · con error {err}{' (ensayo: no se mandó nada)' if not a.commit else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
