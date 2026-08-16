#!/usr/bin/env python3
"""Ingesta de SOPORTES desde el Drive de compras -> Postgres (`factura_soportes`).

El equipo de compras archiva a mano el PDF de cada documento en Drive:

    COMPRAS / AÑO / MES / DESTINO /  "(FC-1-9135) Amande_A12623_29072026_PER001.pdf"
                                       └id doc  └proveedor └nº    └DDMMAAAA └destino

Ese árbol es DOS cosas que el portal no tenía: (a) el respaldo visual de cada
factura y (b) la clasificación humana por tienda (el DESTINO). Este script las
conecta sin tocar nada de lo humano.

Qué hace, en orden:
  1. Recorre COMPRAS/AÑO/MES/** (recursivo: FRANQUICIADOS tiene sub-carpetas).
  2. Parsea el nombre de forma TOLERANTE (Regla 19: el archivo del humano cambia
     de forma). Verificado contra julio-2026: 697 archivos, 6 variantes reales
     (sin `(ID)`, `(NC)` sin lote, destino en minúscula, destino vacío,
     multi-destino `_BOG001_BOG004_`, fechas con typo `2272026`).
  3. Matchea contra `facturas` por llave FUERTE primero (Regla 3):
        numero_norm + NIT/proveedor  ->  alta
        numero_norm + fecha ±5 días  ->  alta
        numero_norm único en la base  ->  media
        ambiguo o sin match           ->  huerfano (visible, no silenciado)
     Nunca por valor, nunca por prefijo, nunca "parecido".
  4. UPSERT por `drive_file_id` (re-correr no duplica; es idempotente).
  5. Opcional `--sembrar-destino`: escribe `factura_estado.destino` SOLO si está
     vacío, con `destino_fuente='drive'`. Si ya hay valor humano y difiere, lo
     REPORTA y no lo toca (Regla 13: lo humano es sagrado). Multi-destino jamás
     siembra. Cada siembra deja evento en la bitácora encadenada.
  6. Reporta por mes × destino: matcheadas, PDF sin factura, factura sin PDF,
     discrepancias de destino.

Auth: delegación de dominio (DWD) impersonando a dzuluaga@manelfoods.com — las
service accounts no tienen cuota de Drive. Mismo mecanismo que
`contabilidad/facturacion/drive_links.py` del repo datawarehouse, inlineado acá
para que el portal no dependa de otro repo. Corre EN LA VM (la SA vive ahí).

Uso:
    python3 scripts/ingest_soportes_drive.py --mes 2026-07            # dry-run
    python3 scripts/ingest_soportes_drive.py --mes 2026-07 --commit
    python3 scripts/ingest_soportes_drive.py --anio 2026 --commit     # todos los meses
    python3 scripts/ingest_soportes_drive.py --mes 2026-08 --commit --sembrar-destino
    python3 scripts/ingest_soportes_drive.py --mes 2026-07 --excel /tmp/soportes.xlsx

DRY-RUN POR DEFECTO: sin `--commit` hace todo el trabajo y ROLLBACK.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

import psycopg2
import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url, registrar_evento  # noqa: E402

# Raíz del archivo de compras en Drive: "COMPRAS" (padre de las carpetas de año).
CARPETA_COMPRAS = "103pdJz8Cs0zFhQBcXORPMNRwpZF7P5B2"
SA_EMAIL = "664413392517-compute@developer.gserviceaccount.com"
SUBJECT_DRIVE = "dzuluaga@manelfoods.com"
SCOPE_DRIVE = "https://www.googleapis.com/auth/drive"

MESES = {1: "enero", 2: "febrero", 3: "marzo", 4: "abril", 5: "mayo", 6: "junio",
         7: "julio", 8: "agosto", 9: "septiembre", 10: "octubre", 11: "noviembre",
         12: "diciembre"}

# Tolerancia de fecha para el match débil. 5 días cubre el desfase real entre la
# fecha del nombre (que compras escribe a mano, a veces la de recepción) y la
# fecha de emisión DIAN. Más ancho empezaría a colisionar con recurrentes.
TOLERANCIA_DIAS = 5


# ---------------------------------------------------------------------------
# Auth Drive (DWD). Ver docstring: SA -> signJwt(sub=dzuluaga@) -> access token.
# ---------------------------------------------------------------------------
def drive_token() -> str:
    r = requests.get(
        "http://metadata.google.internal/computeMetadata/v1/instance/"
        "service-accounts/default/token",
        headers={"Metadata-Flavor": "Google"}, timeout=10)
    r.raise_for_status()
    base = r.json()["access_token"]

    ahora = int(time.time())
    claims = {"iss": SA_EMAIL, "sub": SUBJECT_DRIVE, "scope": SCOPE_DRIVE,
              "aud": "https://oauth2.googleapis.com/token",
              "iat": ahora, "exp": ahora + 3600}
    r = requests.post(
        "https://iamcredentials.googleapis.com/v1/projects/-/"
        f"serviceAccounts/{SA_EMAIL}:signJwt",
        headers={"Authorization": f"Bearer {base}"},
        json={"payload": json.dumps(claims)}, timeout=15)
    r.raise_for_status()
    firmado = r.json()["signedJwt"]

    r = requests.post("https://oauth2.googleapis.com/token", timeout=15, data={
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": firmado})
    r.raise_for_status()
    return r.json()["access_token"]


def hijos(token: str, folder_id: str) -> list[dict]:
    """Lista TODO el contenido de una carpeta, paginando (no hay tope de 100)."""
    salida, page = [], None
    while True:
        params = {"q": f"'{folder_id}' in parents and trashed = false",
                  "fields": "nextPageToken,files(id,name,mimeType,webViewLink)",
                  "pageSize": 1000, "supportsAllDrives": True,
                  "includeItemsFromAllDrives": True}
        if page:
            params["pageToken"] = page
        r = requests.get("https://www.googleapis.com/drive/v3/files", params=params,
                         headers={"Authorization": f"Bearer {token}"}, timeout=60)
        r.raise_for_status()
        j = r.json()
        salida += j.get("files", [])
        page = j.get("nextPageToken")
        if not page:
            return salida


def es_carpeta(f: dict) -> bool:
    return f["mimeType"] == "application/vnd.google-apps.folder"


def recorrer(token: str, folder_id: str, ruta: list[str]) -> list[dict]:
    """Archivos (no carpetas) bajo `folder_id`, recursivo, con su ruta relativa."""
    salida = []
    for f in hijos(token, folder_id):
        if es_carpeta(f):
            salida += recorrer(token, f["id"], ruta + [f["name"]])
        else:
            salida.append({"id": f["id"], "nombre": f["name"],
                           "url": f.get("webViewLink") or
                                  f"https://drive.google.com/file/d/{f['id']}/view",
                           "path": "/".join(ruta)})
    return salida


def carpetas_periodo(token: str, anio: int, mes: int | None) -> list[tuple[int, int, str]]:
    """(anio, mes, folder_id) de las carpetas de mes a procesar.

    Las carpetas de mes se llaman "7. Julio". Se resuelve por NÚMERO y por
    NOMBRE del mes (Regla 19: el humano las renombra) — nunca por posición.
    """
    anios = {f["name"].strip(): f["id"] for f in hijos(token, CARPETA_COMPRAS) if es_carpeta(f)}
    if str(anio) not in anios:
        raise SystemExit(f"ERROR: no existe la carpeta del año {anio} en COMPRAS "
                         f"(hay: {', '.join(sorted(anios))})")
    salida = []
    for f in hijos(token, anios[str(anio)]):
        if not es_carpeta(f):
            continue
        nom = f["name"].strip().lower()
        num = None
        m = re.match(r"^\s*(\d{1,2})\s*[.\-_)]", nom)
        if m:
            num = int(m.group(1))
        else:
            for k, v in MESES.items():
                if v in _sin_tildes(nom):
                    num = k
                    break
        if num is None or not 1 <= num <= 12:
            print(f"  · aviso: carpeta '{f['name']}' no parece un mes, se omite")
            continue
        if mes is None or num == mes:
            salida.append((anio, num, f["id"]))
    return sorted(salida)


# ---------------------------------------------------------------------------
# Parseo del nombre. TOLERANTE: cualquier campo puede salir NULL. Nunca revienta
# ni inventa; lo que no entiende queda NULL y el archivo se registra igual.
# ---------------------------------------------------------------------------
def _sin_tildes(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn")


# El prefijo entre paréntesis puede ser "FC-1-9135", "CC-11-591", "NC",
# "FC IMPORTACION" o el propio número. Solo se cree la parte TIPO-lote-doc.
RE_PREFIJO = re.compile(r"^\((?P<contenido>[^)]*)\)\s*(?P<resto>.+)$")
RE_DOC_ID = re.compile(r"^(?P<tipo>FC|CC|NC|ND)\s*[-\s]\s*(?P<lote>\d+)\s*-\s*(?P<doc>\d+)$", re.I)
RE_SOLO_TIPO = re.compile(r"^(?P<tipo>FC|CC|NC|ND)\b", re.I)
# La fecha se escribe DDMMAAAA, pero el humano se come dígitos ('2272026',
# '2407206'). Se acepta 7-8 para NO perder el número ni el destino del archivo;
# si no son 8 válidos, `fecha_doc` queda NULL (no se inventa una fecha).
RE_FECHA8 = re.compile(r"^\d{7,8}$")


def normalizar_numero(n: str | None) -> str | None:
    """Llave de match. Regla 15: normalizar IGUAL en ambos lados del viaje."""
    if not n:
        return None
    n = re.sub(r"[\s.\-_/]", "", _sin_tildes(n)).upper()
    return n or None


def parsear_nombre(nombre: str) -> dict:
    base = re.sub(r"\.(pdf|jpe?g|png|xml|zip)$", "", nombre, flags=re.I)
    doc_tipo = doc_id = None

    m = RE_PREFIJO.match(base)
    if m:
        contenido, base = m.group("contenido").strip(), m.group("resto").strip()
        mid = RE_DOC_ID.match(contenido)
        if mid:
            doc_tipo = mid.group("tipo").upper()
            doc_id = f"{mid.group('lote')}-{mid.group('doc')}"
        else:
            mt = RE_SOLO_TIPO.match(contenido)          # "(NC)", "(FC IMPORTACION)"
            if mt:
                doc_tipo = mt.group("tipo").upper()

    partes = [p for p in base.split("_")]
    # La fecha ancla el nombre: proveedor | numero | DDMMAAAA | destino(s).
    # Se prefiere SIEMPRE un token de 8 dígitos; el de 7 (typo) solo si no hay
    # ninguno de 8 — así un número de factura de 7 cifras no se confunde con fecha.
    idx = [i for i, p in enumerate(partes) if re.fullmatch(r"\d{8}", p.strip())]
    if not idx:
        idx = [i for i, p in enumerate(partes) if RE_FECHA8.match(p.strip())]
    if not idx:
        return {"doc_tipo": doc_tipo, "doc_id": doc_id, "proveedor_txt": base or None,
                "numero_txt": None, "numero_norm": None, "fecha_txt": None,
                "fecha_doc": None, "destinos": []}

    i = idx[-1]
    fecha_txt = partes[i].strip()
    numero_txt = partes[i - 1].strip() if i >= 1 else None
    proveedor = "_".join(partes[: max(i - 1, 0)]).strip() or None
    destinos = [d.strip().upper() for d in partes[i + 1:] if d.strip()]

    try:                                    # DDMMAAAA; typos ('2272026') -> NULL
        fecha_doc = datetime.strptime(fecha_txt, "%d%m%Y").date()
    except ValueError:
        fecha_doc = None

    return {"doc_tipo": doc_tipo, "doc_id": doc_id, "proveedor_txt": proveedor,
            "numero_txt": numero_txt or None, "numero_norm": normalizar_numero(numero_txt),
            "fecha_txt": fecha_txt, "fecha_doc": fecha_doc, "destinos": destinos}


def tokens_proveedor(s: str | None) -> set[str]:
    """Tokens ≥4 letras del nombre del proveedor, para desempatar (Regla 10:
    con límite de palabra y sin boilerplate — nunca substrings pelados)."""
    if not s:
        return set()
    ruido = {"SAS", "LTDA", "COLOMBIA", "SOCIEDAD", "ANONIMA", "EMPRESA", "GRUPO",
             "COMERCIAL", "FACTURA", "OAKBERRY", "MANEL", "MANELFOODS"}
    brutos = re.findall(r"[A-Z]{4,}", _sin_tildes(s).upper())
    return {t for t in brutos if t not in ruido}


# ---------------------------------------------------------------------------
# Match contra `facturas`. Llave fuerte primero; ambiguo NO afirma (Reglas 3/4).
# ---------------------------------------------------------------------------
def indexar_facturas(cur) -> dict[str, list[dict]]:
    cur.execute("""SELECT cufe, numero, nombre_proveedor, nit_proveedor, fecha_emision
                     FROM facturas""")
    idx: dict[str, list[dict]] = defaultdict(list)
    for cufe, numero, prov, nit, fecha in cur.fetchall():
        clave = normalizar_numero(numero)
        if clave:
            idx[clave].append({"cufe": cufe, "numero": numero, "proveedor": prov,
                               "nit": nit, "fecha": fecha,
                               "tokens": tokens_proveedor(prov)})
    return idx


def emparejar(sop: dict, idx: dict[str, list[dict]]) -> tuple[str | None, str | None, str, str | None]:
    """-> (cufe, metodo, confianza, nota)."""
    clave = sop["numero_norm"]
    if not clave:
        return None, None, "huerfano", "el nombre no trae número de factura"
    cands = idx.get(clave, [])
    if not cands:
        return None, None, "huerfano", "número sin factura DIAN en el portal"

    # 1) llave fuerte: número + proveedor (tokens del nombre del archivo).
    toks = tokens_proveedor(sop["proveedor_txt"])
    if toks:
        por_prov = [c for c in cands if c["tokens"] & toks]
        if len(por_prov) == 1:
            return por_prov[0]["cufe"], "numero+nit", "alta", None
        if len(por_prov) > 1:
            cands = por_prov                       # reduce, sigue desempatando

    # 2) llave fuerte: número + fecha dentro de la tolerancia.
    if sop["fecha_doc"]:
        cerca = [c for c in cands
                 if c["fecha"] and abs((c["fecha"] - sop["fecha_doc"]).days) <= TOLERANCIA_DIAS]
        if len(cerca) == 1:
            return cerca[0]["cufe"], "numero+fecha", "alta", None
        if len(cerca) > 1:
            return None, None, "huerfano", (
                f"{len(cerca)} facturas con el mismo número y fecha cercana — ambiguo")

    # 3) número único en toda la base: creíble, pero sin confirmación -> media.
    if len(cands) == 1:
        return cands[0]["cufe"], "numero", "media", None

    return None, None, "huerfano", f"{len(cands)} facturas comparten ese número — ambiguo"


# ---------------------------------------------------------------------------
# Escritura
# ---------------------------------------------------------------------------
SQL_UPSERT = """
INSERT INTO factura_soportes
  (drive_file_id, tenant, drive_nombre, drive_url, drive_path, anio, mes,
   destino_carpeta, doc_tipo, doc_id, proveedor_txt, numero_txt, numero_norm,
   fecha_txt, fecha_doc, destinos_txt, cufe, match_metodo, match_confianza,
   match_nota, actualizado_en)
VALUES (%(id)s, %(tenant)s, %(nombre)s, %(url)s, %(path)s, %(anio)s, %(mes)s,
        %(destino)s, %(doc_tipo)s, %(doc_id)s, %(proveedor_txt)s, %(numero_txt)s,
        %(numero_norm)s, %(fecha_txt)s, %(fecha_doc)s, %(destinos)s, %(cufe)s,
        %(metodo)s, %(confianza)s, %(nota)s, now())
ON CONFLICT (drive_file_id) DO UPDATE SET
  drive_nombre = EXCLUDED.drive_nombre, drive_url = EXCLUDED.drive_url,
  drive_path = EXCLUDED.drive_path, anio = EXCLUDED.anio, mes = EXCLUDED.mes,
  destino_carpeta = EXCLUDED.destino_carpeta, doc_tipo = EXCLUDED.doc_tipo,
  doc_id = EXCLUDED.doc_id, proveedor_txt = EXCLUDED.proveedor_txt,
  numero_txt = EXCLUDED.numero_txt, numero_norm = EXCLUDED.numero_norm,
  fecha_txt = EXCLUDED.fecha_txt, fecha_doc = EXCLUDED.fecha_doc,
  destinos_txt = EXCLUDED.destinos_txt, cufe = EXCLUDED.cufe,
  match_metodo = EXCLUDED.match_metodo, match_confianza = EXCLUDED.match_confianza,
  match_nota = EXCLUDED.match_nota, actualizado_en = now()
"""


def sembrar_destino(cur, sop: dict, actor: str) -> str:
    """'sembrado' | 'discrepa' | 'ya_tenia' | 'sin_destino' | 'multi' | 'sin_maestro'.

    Escribe SOLO sobre destino vacío. Nunca pisa lo humano (Regla 13).
    """
    destinos = sop["destinos"] or ([sop["destino_carpeta"]] if sop["destino_carpeta"] else [])
    destinos = [d for d in destinos if d]
    if not destinos:
        return "sin_destino"
    if len(destinos) > 1:
        return "multi"                       # un PDF repartido entre tiendas: no decide
    destino = destinos[0]

    # El destino debe existir en el maestro (Regla 6: en rutas de negocio, un
    # código ausente del maestro NO se inventa — se reporta).
    cur.execute("""SELECT nombre FROM maestro_destinos
                    WHERE activo AND (UPPER(short_code) = %s OR UPPER(nombre) = %s)
                    LIMIT 1""", (destino, destino))
    fila = cur.fetchone()
    if not fila:
        return "sin_maestro"
    nombre_destino = fila[0]

    cur.execute("SELECT destino, destino_fuente FROM factura_estado WHERE cufe = %s",
                (sop["cufe"],))
    est = cur.fetchone()
    if est is None:
        return "sin_destino"
    actual, fuente = est
    if actual and actual.strip():
        iguales = _sin_tildes(actual).strip().upper() in (
            destino, _sin_tildes(nombre_destino).strip().upper())
        return "ya_tenia" if iguales else "discrepa"

    cur.execute("""UPDATE factura_estado
                      SET destino = %s, destino_fuente = 'drive', actualizado_en = now()
                    WHERE cufe = %s AND (destino IS NULL OR destino = '')""",
                (nombre_destino, sop["cufe"]))
    if cur.rowcount:
        registrar_evento(cur, cufe=sop["cufe"], tipo="soporte_drive",
                         valor_nuevo={"destino": nombre_destino,
                                      "archivo": sop["drive_nombre"],
                                      "carpeta": sop["drive_path"]},
                         actor=actor, origen="ingest_soportes_drive")
        return "sembrado"
    return "ya_tenia"


# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mes", help="Periodo AAAA-MM (ej. 2026-07).")
    ap.add_argument("--anio", type=int, help="Todos los meses de ese año.")
    ap.add_argument("--commit", action="store_true",
                    help="Persiste. Sin esto: dry-run con ROLLBACK.")
    ap.add_argument("--sembrar-destino", action="store_true",
                    help="Escribe destino en las facturas que lo tengan VACÍO.")
    ap.add_argument("--tenant", default="manelfoods")
    ap.add_argument("--actor", default="ingest_soportes")
    ap.add_argument("--excel", help="Ruta para el reporte detallado (.xlsx).")
    args = ap.parse_args()

    if args.mes:
        try:
            anio, mes = int(args.mes[:4]), int(args.mes[5:7])
        except (ValueError, IndexError):
            print("ERROR: --mes debe ser AAAA-MM (ej. 2026-07)", file=sys.stderr)
            return 2
    elif args.anio:
        anio, mes = args.anio, None
    else:
        hoy = date.today()
        anio, mes = hoy.year, hoy.month
        print(f"(sin --mes/--anio: se toma el mes en curso {anio}-{mes:02d})")

    dsn = cargar_database_url()
    if not dsn:
        print("ERROR: falta DATABASE_URL (ni en el entorno ni en ../.env.local)",
              file=sys.stderr)
        return 2

    print(f"→ Drive: COMPRAS/{anio}/" + (f"{mes:02d}" if mes else "*"))
    token = drive_token()
    periodos = carpetas_periodo(token, anio, mes)
    if not periodos:
        print(f"No hay carpeta de mes para {anio}-{mes:02d}. "
              "Nada que ingerir todavía (¿el mes aún no se crea en Drive?).")
        return 0

    archivos = []
    for a, m, fid in periodos:
        encontrados = recorrer(token, fid, [])
        print(f"  · {a}-{m:02d}: {len(encontrados)} archivos")
        for f in encontrados:
            f["anio"], f["mes"] = a, m
            archivos.append(f)
    if not archivos:
        print("Sin archivos.")
        return 0

    conn = psycopg2.connect(dsn)
    cur = conn.cursor()
    idx = indexar_facturas(cur)
    print(f"  · {sum(len(v) for v in idx.values())} facturas indexadas en el portal")

    soportes, conf = [], Counter()
    for f in archivos:
        p = parsear_nombre(f["nombre"])
        destino_carpeta = (f["path"].split("/")[-1].strip().upper() or None) if f["path"] else None
        # Quién manda en el destino:
        #   · si el NOMBRE lista varios (_BOG001_BOG004_) -> multi: nadie siembra;
        #   · si no, manda la CARPETA (es la clasificación deliberada del equipo);
        #   · y si el archivo está suelto sin carpeta, lo que diga el nombre.
        if len(p["destinos"]) > 1:
            destinos = p["destinos"]
        elif destino_carpeta:
            destinos = [destino_carpeta]
        else:
            destinos = p["destinos"]

        cufe, metodo, confianza, nota = emparejar(p, idx)
        conf[confianza] += 1
        soportes.append({**p, "id": f["id"], "drive_nombre": f["nombre"],
                         "drive_url": f["url"], "drive_path": f["path"],
                         "anio": f["anio"], "mes": f["mes"],
                         "destino_carpeta": destino_carpeta, "destinos": destinos,
                         "cufe": cufe, "metodo": metodo, "confianza": confianza,
                         "nota": nota})

    for s in soportes:
        cur.execute(SQL_UPSERT, {
            "id": s["id"], "tenant": args.tenant, "nombre": s["drive_nombre"],
            "url": s["drive_url"], "path": s["drive_path"], "anio": s["anio"],
            "mes": s["mes"], "destino": s["destino_carpeta"], "doc_tipo": s["doc_tipo"],
            "doc_id": s["doc_id"], "proveedor_txt": s["proveedor_txt"],
            "numero_txt": s["numero_txt"], "numero_norm": s["numero_norm"],
            "fecha_txt": s["fecha_txt"], "fecha_doc": s["fecha_doc"],
            "destinos": s["destinos"] or None, "cufe": s["cufe"],
            "metodo": s["metodo"], "confianza": s["confianza"], "nota": s["nota"]})

    destino_res = Counter()
    discrepancias = []
    if args.sembrar_destino:
        for s in soportes:
            if not s["cufe"] or s["confianza"] != "alta":
                continue                       # solo el match confiable siembra
            r = sembrar_destino(cur, s, args.actor)
            destino_res[r] += 1
            if r == "discrepa":
                discrepancias.append(s)

    # ---- Reporte -----------------------------------------------------------
    total = len(soportes)
    print(f"\n{'='*70}\nSOPORTES {anio}" + (f"-{mes:02d}" if mes else "") +
          f"  ·  {total} archivos en Drive")
    print(f"  match alto     {conf['alta']:5d}  ({conf['alta']*100//total}%)")
    print(f"  match medio    {conf['media']:5d}  (número único, sin confirmar)")
    print(f"  huérfanos      {conf['huerfano']:5d}  (PDF sin factura DIAN en el portal)")

    # Facturas del periodo SIN soporte (la otra cara: Regla 2, mirar los dos lados).
    if mes:
        ini = date(anio, mes, 1)
        fin = date(anio + (mes == 12), (mes % 12) + 1, 1)
        cur.execute("""SELECT COUNT(*) FROM facturas f
                        WHERE f.fecha_emision >= %s AND f.fecha_emision < %s
                          AND NOT EXISTS (SELECT 1 FROM factura_soportes s
                                           WHERE s.cufe = f.cufe)""", (ini, fin))
        sin_pdf = cur.fetchone()[0]
        print(f"  facturas sin PDF de soporte (emisión del mes): {sin_pdf}")

    por_destino = defaultdict(Counter)
    for s in soportes:
        por_destino[s["drive_path"] or "(raíz)"][s["confianza"]] += 1
    print(f"\n  {'carpeta':28s} {'total':>6s} {'alto':>6s} {'medio':>6s} {'huérf':>6s}")
    for k in sorted(por_destino):
        c = por_destino[k]
        print(f"  {k[:28]:28s} {sum(c.values()):6d} {c['alta']:6d} {c['media']:6d} {c['huerfano']:6d}")

    if args.sembrar_destino:
        print("\n  siembra de destino:", dict(destino_res))
        for s in discrepancias[:20]:
            print(f"    ⚠ discrepa: {s['drive_nombre'][:60]} — carpeta dice "
                  f"{s['destino_carpeta']}, el portal dice otra cosa (NO se tocó)")

    huerfanos = [s for s in soportes if s["confianza"] == "huerfano"]
    if huerfanos:
        print(f"\n  huérfanos (muestra de {len(huerfanos)}):")
        for s in huerfanos[:15]:
            print(f"    · {s['drive_nombre'][:62]:62s} {s['nota']}")

    if args.excel:
        escribir_excel(args.excel, soportes)
        print(f"\n  reporte detallado → {args.excel}")

    if args.commit:
        conn.commit()
        print("\n✅ COMMIT — soportes guardados en `factura_soportes`.")
    else:
        conn.rollback()
        print("\n🔎 DRY-RUN (ROLLBACK). Repite con --commit para persistir.")
    cur.close()
    conn.close()
    return 0


def escribir_excel(ruta: str, soportes: list[dict]) -> None:
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "soportes"
    cols = ["anio", "mes", "drive_path", "destino_carpeta", "doc_tipo", "doc_id",
            "proveedor_txt", "numero_txt", "fecha_txt", "cufe", "metodo",
            "confianza", "nota", "drive_nombre", "drive_url"]
    ws.append(cols)
    for s in soportes:
        ws.append([s.get(c) if not isinstance(s.get(c), (list, tuple))
                   else ", ".join(s[c]) for c in cols])
    ws.freeze_panes = "A2"
    wb.save(ruta)


if __name__ == "__main__":
    sys.exit(main())
