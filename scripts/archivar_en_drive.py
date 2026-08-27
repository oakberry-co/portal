#!/usr/bin/env python3
"""Clasificar = archivar. Del portal hacia Drive (el carril inverso al ingest).

Hasta ahora el árbol `COMPRAS/AÑO/MES/DESTINO/` lo llenaba una persona a mano, y
por eso venía incompleto (julio al 91%, mayo al 74%) y siempre tarde. Este script
lo da vuelta: **cuando una factura queda clasificada en el portal, su documento se
archiva solo** en la carpeta que le corresponde según el destino.

    factura_estado.destino  ->  maestro_destinos (short_code / nombre)
                            ->  COMPRAS / 2026 / 8. Agosto / BOG001 /
                                Amande_A12623_29072026_BOG001.pdf

REGLA (2026-08-27): **una carpeta por destino**. El destino que marca compras ES
la ruta; si la carpeta no existe dentro del mes, se crea. `drive_carpeta` quedó
como EXCEPCIÓN para la estructura que no se deduce del nombre (el contenedor
`FRANQUICIADOS/`). Antes era al revés —sin `drive_carpeta` el script se abstenía—
y por eso 182 facturas clasificadas llevaban meses sin archivarse (30% de agosto).

Qué NO hace, a propósito:
  · No toca lo que compras ya archivó a mano: si el documento ya está en la
    carpeta que toca, lo deja quieto.
  · No archiva sin destino. Sin clasificación no hay ruta, y adivinarla sería
    meter plata en la carpeta equivocada.
  · **No crea carpeta para un destino que no está en Maestros o está
    desactivado.** El maestro es la compuerta: un typo suelto ('coli') se
    volvería una carpeta basura que nadie vuelve a juntar. Se reporta.

Idempotente: re-correr no duplica (mira `factura_soportes` antes de copiar).

Uso:
    python3 scripts/archivar_en_drive.py --mes 2026-08              # dry-run
    python3 scripts/archivar_en_drive.py --mes 2026-08 --commit
    python3 scripts/archivar_en_drive.py --mes 2026-07 --commit --limit 20
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import unicodedata
from collections import Counter
from datetime import date, datetime

import psycopg2
import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url, registrar_evento  # noqa: E402
from ingest_soportes_drive import (  # noqa: E402
    CARPETA_COMPRAS, MESES, drive_token, hijos, es_carpeta, normalizar_numero, _sin_tildes,
)

DRIVE_FILES = "https://www.googleapis.com/drive/v3/files"


# ---------------------------------------------------------------------------
# Carpetas: buscar SIN distinguir mayúsculas antes de crear.
# El equipo ya escribió el contenedor de tres formas (FRANQUICIADOS /
# FRANQUICIAS / Franquiciados). Crear a ciegas agregaría una cuarta y partiría
# el archivo en dos mitades que nadie volvería a juntar.
# ---------------------------------------------------------------------------
def _clave(nombre: str) -> str:
    return _sin_tildes(nombre).strip().lower()


def buscar_o_crear(token: str, padre: str, nombre: str, crear: bool,
                   alias: list[str] | None = None) -> str | None:
    """id de la subcarpeta `nombre` bajo `padre`. `alias` = otros nombres que
    cuentan como la misma carpeta (para no duplicar el contenedor)."""
    quiero = {_clave(nombre)} | {_clave(a) for a in (alias or [])}
    for f in hijos(token, padre):
        if es_carpeta(f) and _clave(f["name"]) in quiero:
            return f["id"]
    if not crear:
        return None
    r = requests.post(DRIVE_FILES, headers={"Authorization": f"Bearer {token}"},
                      json={"name": nombre, "mimeType": "application/vnd.google-apps.folder",
                            "parents": [padre]}, timeout=30)
    r.raise_for_status()
    return r.json()["id"]


def carpeta_mes(token: str, anio: int, mes: int, crear: bool) -> str | None:
    """id de COMPRAS/AAAA/'N. Mes', creándola si falta."""
    anio_id = buscar_o_crear(token, CARPETA_COMPRAS, str(anio), crear)
    if not anio_id:
        return None
    # El mes se busca por NÚMERO (el humano lo escribe '7. Julio', '07 Julio'…);
    # solo si no existe se crea con el formato canónico.
    for f in hijos(token, anio_id):
        if not es_carpeta(f):
            continue
        m = re.match(r"^\s*(\d{1,2})\s*[.\-_) ]", f["name"].strip())
        if m and int(m.group(1)) == mes:
            return f["id"]
        if MESES[mes] in _clave(f["name"]):
            return f["id"]
    if not crear:
        return None
    return buscar_o_crear(token, anio_id, f"{mes}. {MESES[mes].capitalize()}", True)


CONTENEDOR_ALIAS = ["FRANQUICIAS", "Franquiciados", "franquiciados"]


def carpeta_destino(token: str, mes_id: str, ruta: str, crear: bool, cache: dict) -> str | None:
    """id de la carpeta del destino dentro del mes. `ruta` = 'BOG001' o
    'FRANQUICIADOS/PER001'."""
    padre, clave = mes_id, ""
    for i, tramo in enumerate(ruta.split("/")):
        clave = clave + "/" + tramo
        if (mes_id, clave) in cache:
            padre = cache[(mes_id, clave)]
            continue
        alias = CONTENEDOR_ALIAS if i == 0 and tramo.upper().startswith("FRANQUICI") else None
        hijo = buscar_o_crear(token, padre, tramo, crear, alias)
        if not hijo:
            return None
        cache[(mes_id, clave)] = hijo
        padre = hijo
    return padre


# ---------------------------------------------------------------------------
# El archivo
# ---------------------------------------------------------------------------
RE_ID_DRIVE = re.compile(r"/d/([A-Za-z0-9_-]{20,})")


def id_de_link(link: str | None) -> str | None:
    if not link:
        return None
    m = RE_ID_DRIVE.search(link)
    return m.group(1) if m else None


def slug(s: str | None, maxlen: int = 40) -> str:
    """Nombre apto para el archivo, con la convención que ya usa compras:
    espacios y puntuación a '_', sin tildes."""
    s = _sin_tildes(s or "").strip()
    s = re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_")
    return s[:maxlen].strip("_") or "SIN_NOMBRE"


# Formas jurídicas: ruido puro en el nombre del archivo. El equipo escribe
# "Amande", no "AMANDE COCINA S.A.S." — y un nombre largo se corta feo en Drive.
FORMAS_JURIDICAS = {"SAS", "SA", "SAA", "LTDA", "EU", "SCA", "ESP", "BIC", "PH",
                    "S", "A", "E", "U", "EN", "DE", "Y", "CIA", "COMPANIA"}


def slug_proveedor(s: str | None, maxlen: int = 28, max_palabras: int = 3) -> str:
    """'AMANDE COCINA S.A.S.' -> 'Amande_Cocina'. Se queda con las primeras
    palabras con significado, en Title Case, como lo escribe compras."""
    limpio = re.sub(r"[^A-Za-z0-9 ]+", " ", _sin_tildes(s or ""))
    palabras = [p for p in limpio.split() if p.upper() not in FORMAS_JURIDICAS]
    if not palabras:                       # nombre que era puro forma jurídica
        palabras = limpio.split() or ["SIN_NOMBRE"]
    nombre = "_".join(p.capitalize() for p in palabras[:max_palabras])
    return nombre[:maxlen].strip("_")


def nombre_archivo(prov: str | None, numero: str | None, fecha: date,
                   destino_cod: str, ext: str) -> str:
    """'Amande_A12623_29072026_BOG001.pdf' — la MISMA convención del archivo
    manual, para que el ingest la vuelva a leer sin casos especiales."""
    return (f"{slug_proveedor(prov)}_{slug(numero, 24)}_{fecha.strftime('%d%m%Y')}_"
            f"{destino_cod}{ext}")


def copiar(token: str, file_id: str, carpeta_id: str, nombre: str) -> dict:
    r = requests.post(f"{DRIVE_FILES}/{file_id}/copy",
                      headers={"Authorization": f"Bearer {token}"},
                      params={"fields": "id,name,webViewLink"},
                      json={"name": nombre, "parents": [carpeta_id]}, timeout=60)
    r.raise_for_status()
    return r.json()


def mover(token: str, file_id: str, carpeta_id: str, nombre: str) -> dict:
    """Reubica el archivo en otra carpeta (y lo renombra, porque el nombre lleva
    el código del destino).

    MOVER, no copiar-y-borrar: conserva el mismo `drive_file_id`, así que
    `factura_soportes` sigue apuntando al archivo correcto y no se rompe ningún
    enlace que alguien haya guardado. Copiar y borrar dejaría un id muerto en la
    base y un enlace roto en cualquier lado donde estuviera pegado.
    """
    r = requests.get(f"{DRIVE_FILES}/{file_id}", params={"fields": "parents"},
                     headers={"Authorization": f"Bearer {token}"}, timeout=30)
    r.raise_for_status()
    padres = ",".join(r.json().get("parents") or [])
    r = requests.patch(f"{DRIVE_FILES}/{file_id}",
                       headers={"Authorization": f"Bearer {token}"},
                       params={"addParents": carpeta_id, "removeParents": padres,
                               "fields": "id,name,webViewLink"},
                       json={"name": nombre}, timeout=60)
    r.raise_for_status()
    return r.json()


def meta_archivo(token: str, file_id: str) -> dict | None:
    r = requests.get(f"{DRIVE_FILES}/{file_id}",
                     params={"fields": "id,name,mimeType,trashed"},
                     headers={"Authorization": f"Bearer {token}"}, timeout=30)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    j = r.json()
    return None if j.get("trashed") else j


# ---------------------------------------------------------------------------
SQL_PENDIENTES = """
SELECT f.cufe, f.nombre_proveedor, f.numero, f.fecha_emision, f.link_drive,
       e.destino, d.nombre AS maestro_nombre, d.short_code, d.drive_carpeta, d.activo,
       -- dónde YA está archivado este documento (por compras o por nosotros):
       -- se compara contra la carpeta que toca, en Python, con la misma
       -- normalización que la deriva (Regla 15).
       -- Los soportes CON DETALLE, no solo las carpetas: para reubicar un archivo
       -- hay que saber su file_id y quién lo puso. Lo que archivó compras a mano
       -- no se toca (Regla 13); lo que pusimos nosotros y quedó obsoleto porque
       -- el destino cambió, se MUEVE a la carpeta que ahora le toca.
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'file_id', s.drive_file_id, 'carpeta', upper(s.destino_carpeta),
                    'origen', s.origen, 'nombre', s.drive_nombre))
                   FROM factura_soportes s
                  WHERE s.cufe = f.cufe AND s.destino_carpeta IS NOT NULL),
                '[]'::jsonb) AS soportes
  FROM facturas f
  JOIN factura_estado e USING (cufe)
  -- LATERAL con LIMIT 1, no un JOIN simple: el maestro tiene el MISMO nombre en
  -- dos filas ('OAKBERRY ANDINO' desactivada y 'Oakberry Andino'/BOG009 viva), y
  -- comparando en mayúsculas un JOIN normal duplica la factura y engancha la
  -- fila muerta la mitad de las veces. Se elige una sola, y la viva primero.
  -- SIN filtrar por `activo` a propósito: hay que poder distinguir "el destino
  -- no existe en el maestro" de "existe pero está desactivado". Los dos se
  -- reportan, ninguno se archiva.
  LEFT JOIN LATERAL (
      SELECT m.nombre, m.short_code, m.drive_carpeta, m.activo
        FROM maestro_destinos m
       WHERE upper(m.nombre) = upper(e.destino)
       ORDER BY m.activo DESC,
                (m.drive_carpeta IS NOT NULL) DESC,
                (m.short_code IS NOT NULL) DESC
       LIMIT 1
  ) d ON TRUE
 WHERE e.destino IS NOT NULL AND e.destino <> ''
   -- La ventana es opcional: en modo barrido (--pendientes) se pasa NULL y se
   -- mira TODO el histórico. Una factura de junio clasificada en octubre no
   -- entra en la ventana "mes actual + anterior" y sin esto no se archiva nunca.
   AND (%(ini)s::date IS NULL OR f.fecha_emision >= %(ini)s)
   AND (%(fin)s::date IS NULL OR f.fecha_emision <  %(fin)s)
 ORDER BY f.fecha_emision
"""


# ---------------------------------------------------------------------------
# La ruta del destino dentro del mes.
#
# REGLA (decidida 2026-08-27): **una carpeta por destino**. El destino que marca
# compras ES la ruta; si la carpeta no existe dentro del mes, se crea. Antes era
# al revés — sin `drive_carpeta` explícito el script se abstenía — y por eso 182
# facturas clasificadas (30% de agosto) llevaban meses sin archivarse.
#
# `drive_carpeta` deja de ser requisito y queda como EXCEPCIÓN: sirve para la
# estructura que NO se deduce del nombre. El caso real es el contenedor
# `FRANQUICIADOS/` — "Oakberry Pereira" no dice en ninguna parte "franquiciado",
# así que derivar a secas crearía `PER001` en la raíz del mes y partiría en dos
# un archivo que ya tiene cientos de documentos.
# ---------------------------------------------------------------------------
def normalizar_carpeta(nombre: str) -> str:
    """'Bodega Empaques' -> 'BODEGA_EMPAQUES'. Mismo estilo que las carpetas que
    el equipo ya creó a mano (BOG001, BODBOG, GENERAL, MERCADEO)."""
    n = re.sub(r"[^A-Za-z0-9]+", "_", _sin_tildes(nombre or "")).strip("_")
    return n.upper()


def ruta_destino_maestro(short_code: str | None, drive_carpeta: str | None,
                         nombre: str | None) -> str | None:
    """Cascada, de lo más explícito a lo más derivado."""
    if drive_carpeta and drive_carpeta.strip():
        return drive_carpeta.strip()          # 1. la excepción mapeada a mano
    if short_code and short_code.strip():
        return normalizar_carpeta(short_code)  # 2. el código con el que ya se nombra
    if nombre and nombre.strip():
        return normalizar_carpeta(nombre)      # 3. el destino, tal cual lo marcó compras
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mes", help="Periodo AAAA-MM (default: el mes en curso, hora Bogotá).")
    ap.add_argument("--commit", action="store_true", help="Persiste. Sin esto: dry-run.")
    ap.add_argument("--limit", type=int, help="Tope de documentos (para probar).")
    ap.add_argument("--pendientes", action="store_true",
                    help="Barrido: TODO lo clasificado y sin archivar, de cualquier mes. "
                         "Es lo que corre de noche; --mes queda para trabajo puntual.")
    ap.add_argument("--recolocar", action="store_true",
                    help="Copia también los documentos que compras ya archivó en OTRA "
                         "carpeta. Por defecto NO: dejaría el mismo documento en dos "
                         "sitios de un mes cerrado.")
    ap.add_argument("--actor", default="archivador_drive")
    args = ap.parse_args()

    if args.pendientes:
        anio = mes = None
        ini = fin = None
        periodo = "barrido completo"
    else:
        if args.mes:
            anio, mes = int(args.mes[:4]), int(args.mes[5:7])
        else:
            hoy = date.today()
            anio, mes = hoy.year, hoy.month
        ini = date(anio, mes, 1)
        fin = date(anio + (mes == 12), (mes % 12) + 1, 1)
        periodo = f"{anio}-{mes:02d}"

    dsn = cargar_database_url()
    if not dsn:
        print("ERROR: falta DATABASE_URL", file=sys.stderr)
        return 2

    conn = psycopg2.connect(dsn)
    cur = conn.cursor()
    cur.execute(SQL_PENDIENTES, {"ini": ini, "fin": fin})
    filas = cur.fetchall()
    print(f"→ {periodo}: {len(filas)} facturas clasificadas")
    if not filas:
        print("Nada que archivar.")
        return 0

    token = drive_token()

    # La carpeta del mes se resuelve PEREZOSAMENTE, por la fecha de cada factura:
    # en barrido hay varios meses en la misma corrida, y listar Drive para un mes
    # donde no hay nada pendiente es una llamada tirada a la basura.
    meses: dict = {}

    def mes_id_de(fecha: date) -> str | None:
        clave = (fecha.year, fecha.month)
        if clave not in meses:
            meses[clave] = carpeta_mes(token, fecha.year, fecha.month, crear=args.commit)
            if not meses[clave]:
                # En dry-run seguimos: el reporte de qué se archivaría vale igual,
                # y no queremos crear carpetas solo para poder mirar.
                print(f"    (la carpeta de {fecha.year}-{fecha.month:02d} todavía no "
                      "existe en Drive; se crea al correr con --commit)")
        return meses[clave]

    cache: dict = {}
    res = Counter()
    sin_ruta: Counter = Counter()      # el destino no llega al maestro
    sin_doc: list[str] = []
    otra_carpeta: list[tuple] = []     # ya archivado por compras, en otra carpeta
    reubicados: list[tuple] = []       # nuestro, movido porque cambió el destino
    archivados: list[tuple] = []

    for (cufe, prov, numero, fecha, link, destino, maestro_nombre, short_code,
         drive_carpeta, activo, soportes) in filas[: args.limit or None]:
        ya_en = {x["carpeta"] for x in soportes}

        # Guardarraíl: el maestro es la compuerta. Un destino que nadie dio de
        # alta (o que el equipo desactivó) NO crea carpeta — se grita, porque
        # casi siempre es un typo y una carpeta basura no se vuelve a juntar.
        if maestro_nombre is None:
            res["destino_no_esta_en_maestro"] += 1
            sin_ruta[f"{destino} (no está en Maestros)"] += 1
            continue
        if not activo:
            res["destino_inactivo"] += 1
            sin_ruta[f"{destino} (desactivado en Maestros)"] += 1
            continue

        ruta = ruta_destino_maestro(short_code, drive_carpeta, maestro_nombre)
        if not ruta:
            res["sin_carpeta_mapeada"] += 1
            sin_ruta[destino] += 1
            continue

        # El código del nombre del archivo es la ÚLTIMA hoja de la ruta
        # ('FRANQUICIADOS/PER001' -> PER001): es lo que el equipo escribe al
        # final del nombre y lo que el ingest vuelve a leer (Regla 15).
        destino_cod = ruta.split("/")[-1].upper()

        if destino_cod in (ya_en or []):
            res["ya_archivado"] += 1
            continue

        file_id = id_de_link(link)
        if not file_id:
            res["sin_documento"] += 1
            sin_doc.append(f"{numero} · {prov}")
            continue

        meta = meta_archivo(token, file_id)
        if not meta:
            res["documento_no_existe"] += 1
            continue
        ext = ".pdf" if meta["mimeType"] == "application/pdf" else \
              (".xml" if "xml" in meta["mimeType"] else "")
        nombre = nombre_archivo(prov, numero, fecha, destino_cod, ext)

        # Ya archivado, pero en OTRA carpeta. Dos casos MUY distintos:
        #
        #  a) lo archivamos NOSOTROS y el destino cambió después (la máquina lo
        #     sembró y un humano lo corrigió). Esa copia quedó en la tienda
        #     equivocada: se MUEVE a la que ahora le toca. Pasa poco —14 veces en
        #     toda la historia— pero es justo el caso que nadie ve a mano.
        #
        #  b) lo archivó COMPRAS a mano, antes de que el destino tuviera carpeta
        #     propia. No se duplica ni se mueve (Regla 13: su trabajo no se
        #     pisa); se reporta. En julio eran 44 de 48. `--recolocar` fuerza la
        #     copia si algún día se quiere el histórico bajo la carpeta del destino.
        nuestros = [x for x in soportes
                    if x["origen"] == "portal" and x["carpeta"] != destino_cod]
        if ya_en and nuestros:
            for viejo_sop in nuestros:
                if not args.commit:
                    res["se_reubicaria"] += 1
                    print(f"    MOVER {viejo_sop['carpeta']} → {ruta}/{nombre}")
                    continue
                movido = mover(token, viejo_sop["file_id"],
                               carpeta_destino(token, mes_id_de(fecha), ruta, True, cache),
                               nombre)
                reubicados.append((ruta, destino_cod, nombre,
                                   movido.get("webViewLink") or
                                   f"https://drive.google.com/file/d/{viejo_sop['file_id']}/view",
                                   viejo_sop["file_id"]))
                registrar_evento(cur, cufe=cufe, tipo="archivo_drive_reubicado",
                                 valor_nuevo={"de": viejo_sop["carpeta"], "a": destino_cod,
                                              "destino": destino, "archivo": nombre},
                                 actor=args.actor, origen="archivar_en_drive")
                res["reubicado"] += 1
            continue

        if ya_en:
            otra_carpeta.append((destino, destino_cod, ", ".join(sorted(ya_en)), nombre))
            if not args.recolocar:
                res["ya_archivado_por_compras"] += 1
                continue

        if not args.commit:
            res["se_archivaria"] += 1
            if res["se_archivaria"] <= 12:
                print(f"    {ruta}/{nombre}")
            continue

        carp = carpeta_destino(token, mes_id_de(fecha), ruta, True, cache)
        copia = copiar(token, file_id, carp, nombre)
        archivados.append((copia["id"], nombre,
                           copia.get("webViewLink") or f"https://drive.google.com/file/d/{copia['id']}/view",
                           ruta, fecha.year, fecha.month, destino_cod,
                           prov, numero, normalizar_numero(numero),
                           fecha.strftime("%d%m%Y"), fecha, cufe))
        res["archivado"] += 1

    if reubicados:
        # El archivo se movió, no se recreó: mismo `drive_file_id`. Por eso es un
        # UPDATE de la fila que ya existe y no un INSERT (que chocaría con la PK
        # y quedaría en silencio por el ON CONFLICT DO NOTHING).
        cur.executemany("""
            UPDATE factura_soportes
               SET drive_path = %s, destino_carpeta = %s, drive_nombre = %s,
                   drive_url = %s, actualizado_en = now()
             WHERE drive_file_id = %s""", reubicados)

    if archivados:
        cur.executemany("""
            INSERT INTO factura_soportes
              (drive_file_id, drive_nombre, drive_url, drive_path, anio, mes,
               destino_carpeta, proveedor_txt, numero_txt, numero_norm, fecha_txt,
               fecha_doc, cufe, match_metodo, match_confianza, origen, actualizado_en)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'portal','alta','portal', now())
            ON CONFLICT (drive_file_id) DO NOTHING""", archivados)
        registrar_evento(cur, cufe=None, tipo="archivo_drive",
                         valor_nuevo={"periodo": periodo,
                                      "archivados": len(archivados)},
                         actor=args.actor, origen="archivar_en_drive")

    print(f"\n{'='*66}\n{dict(res)}")
    if res.get("reubicado"):
        print(f"\n  ↻ {res['reubicado']} documento(s) MOVIDOS a la carpeta nueva "
              "porque alguien corrigió el destino (el archivo es el mismo, no una copia).")
    if sin_ruta:
        print("\n  ⚠ destinos SIN carpeta mapeada (nadie sabe dónde archivarlos —")
        print("    ponles `drive_carpeta` en Maestros o unifícalos con el que ya existe):")
        for d, n in sin_ruta.most_common():
            print(f"      {n:4d}  {d}")
    if sin_doc:
        print(f"\n  ⚠ {len(sin_doc)} clasificadas SIN documento en Drive (no llegó PDF ni XML):")
        for x in sin_doc[:10]:
            print(f"      {x}")
    if otra_carpeta:
        que = ("se COPIAN a la del destino (--recolocar): quedan en los dos lados"
               if args.recolocar else
               "se DEJAN donde compras las puso (usa --recolocar para moverlas)")
        print(f"\n  ℹ {len(otra_carpeta)} ya estaban archivadas en OTRA carpeta; {que}:")
        for destino, cod, donde, nombre in otra_carpeta[:10]:
            print(f"      {destino} → {cod}   (ya estaba en: {donde})")

    if args.commit:
        conn.commit()
        print(f"\n✅ COMMIT — {res['archivado']} documentos archivados en Drive.")
    else:
        conn.rollback()
        print("\n🔎 DRY-RUN. Repite con --commit para archivar de verdad.")
    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
