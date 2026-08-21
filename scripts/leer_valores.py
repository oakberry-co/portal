#!/usr/bin/env python3
"""Lee el DOCUMENTO SOPORTE de cada solicitud y saca TODOS los montos que trae.

Hermano de `leer_certificaciones.py` y con el mismo reparto de trabajo: la
máquina lee, el humano decide. Allá el problema es a QUIÉN se le paga; acá es
CUÁNTO.

El caso que lo originó (COT-0026, 21-ago-2026): la cotización decía
`TOTAL A PAGAR $ 149.340,24` y el proveedor tecleó `$ 14.934.024` — el mismo
número sin la coma, cien veces más grande, con 100% de adelanto.

QUÉ HACE Y QUÉ NO:
  * Saca todos los montos del documento. NO elige cuál es el total: cada
    proveedor rotula distinto ("TOTAL A PAGAR", "NETO", "VALOR") y equivocarse
    eligiendo sería peor que no elegir.
  * NO emite el veredicto. Guarda los candidatos y el portal compara contra el
    valor que la solicitud tiene HOY (lib/valor-documento.ts). Así, cuando el
    equipo corrige un monto, el semáforo se recalcula solo — sin releer el PDF y
    sin que quede una opinión vieja sobre una cifra que ya no existe.
  * NUNCA corrige el valor. Regla 3: el parecido sugiere, jamás afirma.

Reusa el descargador de Drive y la extracción de texto/OCR de
`leer_certificaciones.py` — importadas, no copiadas: dos lectores que dejen de
leer igual es el bug que nadie encuentra.

ESPEJO: `montos_de_texto` de acá tiene que dar lo MISMO que `montosDeTexto` de
lib/valor-documento.ts. Lo comprueba `scripts/test_valor_documento.js` sobre las
mismas fixtures, igual que nit.py ↔ lib/nit.ts.

Uso:
    python3 scripts/leer_valores.py                  # dry-run de lo pendiente
    python3 scripts/leer_valores.py --commit
    python3 scripts/leer_valores.py --id 7 --commit --verbose
    python3 scripts/leer_valores.py --releer --commit   # también las ya leídas
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from collections import Counter

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url  # noqa: E402
from ingest_soportes_drive import drive_token  # noqa: E402
from leer_certificaciones import descargar, texto_de_pdf, texto_por_ocr  # noqa: E402

RE_ID_DRIVE = re.compile(r"/d/([A-Za-z0-9_-]{20,})")

# Un número "de plata": con `$` delante, o escrito con separadores. Se exige uno
# de los dos porque una cotización está llena de cantidades sueltas ("168 POTE X
# 210 ML") que no son montos.
RE_MONTO = re.compile(r"(\$\s*)?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)")
# Lo que NUNCA es plata aunque se escriba con puntos. Espejo de
# ETIQUETA_NO_ES_PLATA en lib/valor-documento.ts — sale de mirar 18 documentos
# reales: el NIT con sus puntos, el rango de numeración de la DIAN ("DESDE
# MVF/200001 HASTA MVF/1000000"), la resolución, la placa, el CUFE, convenios.
#
# Sesgo deliberado: sobra excluir. Un candidato de MENOS solo produce un aviso
# que un humano descarta en un clic; uno de MÁS puede hacer que un monto
# equivocado "cuadre" y se pague.
RE_ETIQUETA = re.compile(
    r"NIT|C\.?C\.?|CEDULA|CÉDULA|CUENTA|CTA|TEL|CEL|PBX|NO\.?\s*$|N°|NUMERAC|RESOLUC"
    r"|DESDE|HASTA|VIGENC|FECHA|AUTORIZ|PLACA|POLIZA|PÓLIZA|CUFE|CONVENIO|NUMERO|NÚMERO")


def pesos(crudo: str) -> float | None:
    """Espejo de `pesos()` en lib/pesos.ts.

    En Colombia el punto separa miles y la coma marca decimales ('1.234.567,50'),
    pero también llega a la gringa ('1,234,567.50') o pelado. La regla: el ÚLTIMO
    separador seguido de 1 o 2 dígitos es el decimal; lo demás son miles.
    `9.870` son nueve mil ochocientos setenta, no 9,87.
    """
    limpio = re.sub(r"[$\s]", "", crudo)
    ultimo = max(limpio.rfind(","), limpio.rfind("."))
    decimales = len(limpio) - ultimo - 1 if ultimo >= 0 else 0
    es_decimal = ultimo >= 0 and 1 <= decimales <= 2
    entera = (limpio[:ultimo] if es_decimal else limpio).replace(".", "").replace(",", "")
    fraccion = limpio[ultimo + 1:] if es_decimal else ""
    if not re.fullmatch(r"-?\d*", entera) or not re.fullmatch(r"\d*", fraccion):
        return None
    try:
        return float(entera + ("." + fraccion if fraccion else ""))
    except ValueError:
        return None


def en_pesos(n: float) -> int:
    """Redondea a peso entero COMO LO HACE JAVASCRIPT (medio hacia arriba).

    `round()` de Python usa redondeo bancario: `round(6.5)` da 6 y `round(7.5)`
    da 8. `Math.round` de JS da 7 y 8. Esto no es trivia: el portal recalcula el
    veredicto con el módulo TS sobre los mismos candidatos que escribe este
    script, y un peso de diferencia es la diferencia entre "cuadra" y "no
    cuadra". Lo cazó el centinela del espejo con un documento real.
    """
    return int(math.floor(n + 0.5))


def montos_de_texto(texto: str) -> list[int]:
    """Todos los montos del documento, en pesos enteros, de mayor a menor."""
    vistos: set[int] = set()
    for m in RE_MONTO.finditer(texto):
        con_peso = bool(m.group(1))
        crudo = m.group(2)
        if not con_peso and not re.search(r"[.,]", crudo):
            continue   # cantidad suelta, no monto
        # EL NIT NO ES UN MONTO: se escribe con puntos igual que la plata
        # ("NIT : 830.514.578-2"). Se mira la etiqueta de antes y el dígito de
        # verificación pegado con guion de después.
        ini = m.start(1) if con_peso else m.start(2)
        antes = texto[max(0, ini - 16):ini].upper()
        if RE_ETIQUETA.search(antes):
            continue
        # Pegado a una barra o a un numeral es parte de un código, no un monto:
        # "MVF/1000000" es el tope de la numeración autorizada por la DIAN.
        if ini > 0 and texto[ini - 1] in "/#":
            continue
        despues = texto[m.end():m.end() + 2]
        if re.match(r"^-\d", despues):
            continue
        # Una TARIFA no es un monto ("RTE FTE 2,5%").
        if re.match(r"^\s*%", despues):
            continue
        n = pesos(crudo)
        if n is None or n <= 0:
            continue
        vistos.add(en_pesos(n))
    return sorted(vistos, reverse=True)


def leer_documento(token: str, url: str, file_id: str | None) -> tuple[str, str] | None:
    """(texto, metodo) del soporte, o None si no se pudo bajar."""
    fid = file_id or (RE_ID_DRIVE.search(url or "").group(1) if RE_ID_DRIVE.search(url or "") else None)
    if not fid:
        return None
    bajado = descargar(token, fid)
    if not bajado:
        return None
    ruta, es_pdf = bajado
    try:
        texto = texto_de_pdf(ruta) if es_pdf else ""
        metodo = "texto_pdf"
        # Poco texto = PDF escaneado (una foto metida en un PDF). 40 caracteres
        # es el umbral: por debajo no hay ni un encabezado, solo basura.
        if len(texto.strip()) < 40:
            texto = texto_por_ocr(ruta, es_pdf)
            metodo = "ocr"
        return texto, metodo
    finally:
        try:
            os.unlink(ruta)
        except OSError:
            pass


# El soporte se encola al recibir el envío (lib/intake.ts). Esta es la RED: la
# fila puede faltar porque el envío es anterior a este módulo, o porque el INSERT
# falló y no se quiso tumbar el envío del proveedor por eso. Sin la fila, el
# candado del portal bloquea (que es el lado seguro) pero nadie lee nunca — o
# sea, un humano tendría que verificar a mano algo que la máquina podía mirar.
SQL_FALTANTES = """
SELECT origen_tipo, origen_id, valor, doc->>'path' AS drive_url
  FROM (
    SELECT 'cotizacion'::text AS origen_tipo, id AS origen_id, valor,
           jsonb_array_elements(documentos) AS doc
      FROM cotizaciones
    UNION ALL
    SELECT 'cuenta_cobro', id, valor, jsonb_array_elements(documentos)
      FROM cuentas_cobro
  ) x
 WHERE doc->>'clase' = 'soporte'
   AND doc->>'estado' = 'subido'
   AND COALESCE(doc->>'path', '') <> ''
   AND NOT EXISTS (SELECT 1 FROM lectura_valor lv
                    WHERE lv.origen_tipo = x.origen_tipo AND lv.origen_id = x.origen_id)
 ORDER BY 1, 2
"""


def encolar_faltantes(cur, commit: bool) -> None:
    cur.execute(SQL_FALTANTES)
    filas = cur.fetchall()
    print(f"→ {len(filas)} solicitudes con soporte y sin lectura encolada")
    for (otipo, oid, valor, url) in filas:
        fid_m = RE_ID_DRIVE.search(url or "")
        print(f"  + {otipo}/{oid} valor={valor}")
        if commit:
            cur.execute("""INSERT INTO lectura_valor
                             (origen_tipo, origen_id, drive_url, drive_file_id, valor_declarado)
                           VALUES (%s,%s,%s,%s,%s)""",
                        (otipo, oid, url, fid_m.group(1) if fid_m else None, valor))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--id", type=int, help="Una sola lectura (para probar).")
    ap.add_argument("--releer", action="store_true", help="También las ya leídas.")
    ap.add_argument("--verbose", action="store_true", help="Muestra el texto leído.")
    ap.add_argument("--encolar-faltantes", action="store_true",
                    help="Crea la fila de lectura para las solicitudes que tienen soporte y no la tienen.")
    args = ap.parse_args()

    dsn = cargar_database_url()
    if not dsn:
        print("ERROR: falta DATABASE_URL", file=sys.stderr)
        return 2
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()

    if args.encolar_faltantes:
        encolar_faltantes(cur, args.commit)

    if args.id:
        filtro = "AND id = %(id)s"
    elif args.releer:
        filtro = ""
    else:
        filtro = "AND estado = 'pendiente'"
    cur.execute(f"""SELECT id, origen_tipo, origen_id, drive_url, drive_file_id, valor_declarado
                      FROM lectura_valor
                     WHERE TRUE {filtro}
                     ORDER BY id""", {"id": args.id})
    filas = cur.fetchall()
    print(f"→ {len(filas)} soportes por leer")
    if not filas:
        return 0

    token = drive_token()
    res = Counter()

    for (lid, otipo, oid, url, file_id, declarado) in filas:
        leido = leer_documento(token, url, file_id)
        if leido is None:
            print(f"  #{lid} {otipo}/{oid}: no se pudo bajar de Drive")
            res["sin_archivo"] += 1
            continue
        texto, metodo = leido
        if args.verbose:
            print(f"  --- texto ({metodo}) ---\n{texto[:1200]}\n  ---")
        candidatos = montos_de_texto(texto)
        estado = "leido" if candidatos else "ilegible"
        mayor = max(candidatos) if candidatos else None

        # El veredicto NO se guarda (lo calcula el portal), pero sí se imprime:
        # es lo que hace útil el dry-run.
        pista = ""
        if declarado is not None and candidatos:
            d = en_pesos(float(declarado))
            pista = " ✅ cuadra" if d in candidatos else (
                f" ⚠️  NO CUADRA — registrado {d:,} vs mayor del documento {mayor:,}")
        print(f"  #{lid} {otipo}/{oid} [{metodo}] {len(candidatos)} montos"
              f"{' (mayor ' + format(mayor, ',') + ')' if mayor else ''}{pista}")
        res[estado] += 1

        if args.commit:
            cur.execute("""UPDATE lectura_valor
                              SET estado = %s, candidatos = %s::jsonb, valor_leido = %s,
                                  metodo = %s, texto_crudo = %s, leido_en = now()
                            WHERE id = %s""",
                        (estado, json.dumps(candidatos), mayor, metodo, texto[:20000], lid))

    if args.commit:
        conn.commit()
        print(f"✔ guardado: {dict(res)}")
    else:
        print(f"(dry-run) {dict(res)} — corre con --commit para guardar")
    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
