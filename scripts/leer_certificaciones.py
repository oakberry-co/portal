#!/usr/bin/env python3
"""Lee las CERTIFICACIONES BANCARIAS del intake y saca la cuenta de pago.

Por qué existe: hasta el 2026-08-17 el proveedor TECLEABA banco/tipo/número en
el formulario público y ese dato viajaba hasta el CSV del pago masivo. Un dígito
mal escrito manda plata a una cuenta ajena, y un estafador podía escribir la que
quisiera. Ahora el proveedor solo sube la certificación que emite su banco, y
**lo que diga ese documento es la cuenta oficial**.

    certificación (PDF o foto) -> texto -> banco + tipo + número + titular
                               -> certificacion_bancaria.estado

La cuenta NO se escribe en `cuentas_bancarias_proveedor` desde acá: eso pasa
cuando alguien APRUEBA la solicitud en la bandeja. De ese maestro sale el
archivo del banco para todo el proveedor —facturas DIAN incluidas—, así que un
envío público sin revisar no puede decidirlo.

Cómo lee, en orden:
  1. Texto embebido del PDF (pdftotext / PyMuPDF) — los bancos generan PDFs con
     texto, así que este camino cubre la mayoría y es exacto.
  2. OCR (tesseract, español) — para fotos y escaneos, que es lo que manda el
     proveedor pequeño.

Y NO se cree cualquier cosa. Para dar 'valida' exige las tres señales de un
documento real del banco:
  · el nombre de un banco conocido,
  · lenguaje de certificación ('certifica', 'titular', 'cuenta'),
  · un número de cuenta plausible.
Si falta alguna -> 'no_es_certificacion' (un Word hecho a mano no pasa).
Si viene con CLAVE, se intenta abrir con el documento que el proveedor escribió
en el formulario (así lo cifran los bancos); si ninguna variante abre ->
'protegido', que NO es lo mismo que ilegible y lleva su propio correo.
Si no se pudo extraer texto -> 'ilegible'.
Los dos casos disparan el correo que le pide al proveedor el documento real.

Y una cuenta ya registrada NUNCA se pisa: si el NIT tenía otra, se guarda cuál
era (`cuenta_anterior`) y la bandeja exige confirmar el cambio aparte antes de
aprobar. El intake es público: sin esa regla, mandar una cuenta de cobro con el
NIT de un proveedor grande bastaría para desviarle el pago.

Uso:
    python3 scripts/leer_certificaciones.py            # dry-run de lo pendiente
    python3 scripts/leer_certificaciones.py --commit
    python3 scripts/leer_certificaciones.py --id 42 --commit --verbose
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
from collections import Counter

import psycopg2
import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url  # noqa: E402
from ingest_soportes_drive import drive_token, _sin_tildes  # noqa: E402

# Bancos con presencia real en Colombia. La lista es un FILTRO de autenticidad,
# no un catálogo: si el documento no nombra a ninguno, no es del banco.
BANCOS = {
    "BANCOLOMBIA": ["bancolombia"],
    "DAVIVIENDA": ["davivienda"],
    "BBVA": ["bbva"],
    "BANCO DE BOGOTA": ["banco de bogota", "bancodebogota"],
    "DE OCCIDENTE": ["banco de occidente", "occidente"],
    "POPULAR": ["banco popular"],
    "AV VILLAS": ["av villas", "avvillas"],
    "COLPATRIA": ["colpatria", "scotiabank"],
    "ITAU": ["itau"],
    "CAJA SOCIAL": ["caja social", "bcsc"],
    "AGRARIO": ["banco agrario"],
    "FALABELLA": ["falabella"],
    "PICHINCHA": ["pichincha"],
    "GNB SUDAMERIS": ["sudameris", "gnb"],
    "SERFINANZA": ["serfinanza"],
    "NEQUI": ["nequi"],
    "DAVIPLATA": ["daviplata"],
    "LULO": ["lulo bank", "lulobank"],
    "NU": ["nu colombia", "nubank"],
    "BOLD": ["bold cf", "bold "],
    "MOVII": ["movii"],
    "RAPPIPAY": ["rappipay"],
    "COOPCENTRAL": ["coopcentral"],
    "MUNDO MUJER": ["mundo mujer"],
    "BANCAMIA": ["bancamia"],
    "W": ["banco w"],
    "FINANDINA": ["finandina"],
    "JP MORGAN": ["jp morgan", "jpmorgan"],
}

# Lenguaje propio de una certificación. Un Word improvisado rara vez lo trae.
SENAS_CERTIFICACION = ["certifica", "certificacion", "certificamos", "consta que",
                       "titular", "hace constar"]

TIPOS_CUENTA = [("ahorros", ["ahorro"]), ("corriente", ["corriente"])]

# Número de cuenta colombiano: 8-20 dígitos, tolerando separadores. Se exige un
# ancla de contexto ('cuenta', 'no.', '#') para no confundirlo con un NIT, un
# teléfono o una fecha larga — el error clásico de matchear números pelados.
RE_CUENTA = re.compile(
    r"(?:cuenta|cta|no\.?|n[uú]mero|#)[^0-9]{0,25}((?:\d[\s.\-]?){8,22}\d)", re.I)
RE_NIT = re.compile(r"(?:nit|c\.?c\.?|cedula|documento)[^0-9]{0,15}((?:\d[\s.\-]?){6,15}\d)", re.I)


def norm(s: str) -> str:
    return _sin_tildes(s or "").lower()


def solo_digitos(s: str) -> str:
    return re.sub(r"\D", "", s or "")


# ---------------------------------------------------------------------------
# Extracción de texto
# ---------------------------------------------------------------------------
def claves_probables(doc_num: str) -> list[str]:
    """Claves con las que un certificado bancario suele venir protegido.

    Los bancos (Bancolombia sobre todo) entregan el certificado cifrado con el
    DOCUMENTO DEL TITULAR — que es justo el dato que el proveedor ya escribió en
    el formulario. O sea: la llave no hay que pedírsela a nadie, ya la tenemos.

    Se prueban pocas variantes y todas derivadas de ese número: esto NO es
    fuerza bruta (no tendría sentido — si no abre con su documento, el que la
    tiene es el proveedor y hay que pedírsela a él).
    """
    d = re.sub(r"\D", "", doc_num or "")
    if not d:
        return []
    cand = [d]
    if len(d) > 9:
        cand.append(d[:-1])          # NIT sin dígito de verificación
    cand += [(doc_num or "").strip(), d[-10:], d[:10]]
    vistas, out = set(), []
    for c in cand:
        if c and c not in vistas:
            vistas.add(c)
            out.append(c)
    return out


def desproteger(ruta: str, doc_num: str) -> tuple[str, str | None]:
    """-> (ruta utilizable, clave que sirvió | None si no estaba protegido).

    Si el PDF viene con clave y ninguna de las probables abre, devuelve
    (ruta, '?') para que el dictamen lo marque como protegido y se le pida al
    proveedor el archivo sin candado. Guardar la clave sería innecesario y feo:
    se re-deriva del documento cada vez.
    """
    try:
        import fitz
    except Exception:
        return ruta, None
    try:
        doc = fitz.open(ruta)
    except Exception:
        return ruta, None
    if not doc.needs_pass:
        doc.close()
        return ruta, None
    for clave in claves_probables(doc_num):
        if doc.authenticate(clave):
            libre = ruta + ".libre.pdf"
            # Se guarda una copia SIN candado para que el resto del camino
            # (pdftotext y, si toca, el render a imagen para OCR) funcione igual
            # que con cualquier otro documento.
            doc.save(libre)
            doc.close()
            return libre, clave
    doc.close()
    return ruta, "?"


def texto_de_pdf(ruta: str) -> str:
    """Texto embebido. pdftotext primero (rápido y fiel); PyMuPDF de respaldo."""
    try:
        r = subprocess.run(["pdftotext", "-layout", ruta, "-"],
                           capture_output=True, timeout=60)
        if r.returncode == 0 and len(r.stdout.strip()) > 40:
            return r.stdout.decode("utf-8", "ignore")
    except Exception:
        pass
    try:
        import fitz
        with fitz.open(ruta) as doc:
            return "\n".join(p.get_text() for p in doc)
    except Exception:
        return ""


def texto_por_ocr(ruta: str, es_pdf: bool) -> str:
    """OCR en español. Para el proveedor pequeño que manda una foto del papel."""
    try:
        import pytesseract
        from PIL import Image
        if es_pdf:
            import fitz
            partes = []
            with fitz.open(ruta) as doc:
                for pagina in doc[:3]:                 # 3 páginas bastan
                    # 200 dpi: por debajo el OCR se come dígitos, que es justo
                    # lo único que no podemos equivocar acá.
                    pix = pagina.get_pixmap(dpi=200)
                    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                        pix.save(tmp.name)
                        partes.append(pytesseract.image_to_string(Image.open(tmp.name), lang="spa"))
                    os.unlink(tmp.name)
            return "\n".join(partes)
        return pytesseract.image_to_string(Image.open(ruta), lang="spa")
    except Exception as e:
        print(f"    (OCR falló: {e})")
        return ""


# ---------------------------------------------------------------------------
# Interpretación
# ---------------------------------------------------------------------------
def interpretar(texto: str) -> dict:
    t = norm(texto)
    banco = next((nombre for nombre, claves in BANCOS.items()
                  if any(c in t for c in claves)), None)
    tiene_lenguaje = any(s in t for s in SENAS_CERTIFICACION)
    tipo = next((nombre for nombre, claves in TIPOS_CUENTA
                 if any(c in t for c in claves)), None)

    # Cuenta: se toma la candidata con contexto MÁS LARGA (los bancos escriben la
    # cuenta completa; los números cortos suelen ser sucursal o consecutivo).
    cuentas = [solo_digitos(m) for m in RE_CUENTA.findall(texto)]
    cuentas = [c for c in cuentas if 8 <= len(c) <= 22]
    num = max(cuentas, key=len) if cuentas else None

    docs = [solo_digitos(m) for m in RE_NIT.findall(texto)]
    titular_doc = next((d for d in docs if d != num and 6 <= len(d) <= 15), None)

    return {"banco": banco, "tipo_cuenta": tipo, "num_cuenta": num,
            "titular_doc": titular_doc, "tiene_lenguaje": tiene_lenguaje}


def dictaminar(d: dict, texto: str, protegido: bool = False) -> tuple[str, str | None]:
    """-> (estado, motivo). Conservador a propósito: en duda, NO valida."""
    if protegido:
        # NO es "ilegible": el documento puede estar perfecto. Decirle al
        # proveedor "no se entiende" cuando el problema es un candado lo manda a
        # reenviar lo mismo, y el trámite se queda dando vueltas.
        return "protegido", ("El certificado viene protegido con una clave y no pudimos abrirlo "
                             "con tu número de documento.")
    if len(texto.strip()) < 40:
        return "ilegible", ("No pudimos leer el documento (llegó vacío, en blanco o "
                            "con una imagen ilegible).")
    if not d["banco"]:
        return "no_es_certificacion", ("El documento no parece emitido por un banco: "
                                       "no aparece el nombre de ninguna entidad bancaria.")
    if not d["tiene_lenguaje"]:
        return "no_es_certificacion", ("El documento no tiene el texto de una "
                                       "certificación bancaria (no dice que el banco "
                                       "certifique la cuenta).")
    if not d["num_cuenta"]:
        return "ilegible", ("Encontramos el banco pero no pudimos leer el número de "
                            "cuenta en el documento.")
    return "valida", None


# ---------------------------------------------------------------------------
def descargar(token: str, file_id: str) -> tuple[str, bool] | None:
    r = requests.get(f"https://www.googleapis.com/drive/v3/files/{file_id}",
                     params={"fields": "name,mimeType"},
                     headers={"Authorization": f"Bearer {token}"}, timeout=30)
    if r.status_code != 200:
        return None
    meta = r.json()
    c = requests.get(f"https://www.googleapis.com/drive/v3/files/{file_id}",
                     params={"alt": "media"},
                     headers={"Authorization": f"Bearer {token}"}, timeout=120)
    c.raise_for_status()
    es_pdf = meta["mimeType"] == "application/pdf"
    sufijo = ".pdf" if es_pdf else os.path.splitext(meta["name"])[1] or ".bin"
    with tempfile.NamedTemporaryFile(suffix=sufijo, delete=False) as tmp:
        tmp.write(c.content)
        return tmp.name, es_pdf


RE_ID_DRIVE = re.compile(r"/d/([A-Za-z0-9_-]{20,})")


ORIGEN_TABLA = {"cuenta_cobro": ("cuentas_cobro", "num_doc"),
                "cotizacion": ("cotizaciones", "nit")}


def encolar_aviso(cur, cid: int, otipo: str, oid: int, motivo: str, protegido: bool = False) -> bool:
    """Le pide al proveedor el documento REAL del banco.

    Sin este correo el proveedor sube un papel que no sirve, no se entera, y su
    solicitud se queda quieta para siempre esperando una cuenta que nunca va a
    llegar (Regla 18: el loop humano tiene que cerrar).

    Idempotente por partida doble: `avisado_en` marca que ya se avisó y el
    índice único de `correo_saliente` impide el duplicado aunque se relea la
    misma certificación.
    """
    tabla, _ = ORIGEN_TABLA.get(otipo, (None, None))
    if not tabla:
        return False
    cur.execute(f"SELECT razon_social, correo FROM {tabla} WHERE id=%s", (oid,))
    fila = cur.fetchone()
    if not fila or not (fila[1] or "").strip():
        return False                      # no dejó correo: la bandeja lo muestra
    cur.execute("""INSERT INTO correo_saliente
                     (tipo, origen_tipo, origen_id, para, datos, creado_por)
                   VALUES ('certificacion_invalida', %s, %s, %s,
                           jsonb_build_object('proveedor', %s::text, 'motivo', %s::text,
                                              'protegido', %s::boolean),
                           'lector_certificaciones')
                   ON CONFLICT (tipo, origen_tipo, origen_id) DO NOTHING""",
                (otipo, oid, fila[1].strip(), fila[0], motivo, protegido))
    encolado = cur.rowcount > 0
    cur.execute("UPDATE certificacion_bancaria SET avisado_en=now() WHERE id=%s", (cid,))
    return encolado


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--id", type=int, help="Una sola certificación (para probar).")
    ap.add_argument("--verbose", action="store_true", help="Muestra el texto leído.")
    args = ap.parse_args()

    dsn = cargar_database_url()
    if not dsn:
        print("ERROR: falta DATABASE_URL", file=sys.stderr)
        return 2
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()

    filtro = "AND id = %(id)s" if args.id else "AND estado = 'pendiente'"
    cur.execute(f"""SELECT id, origen_tipo, origen_id, nit, drive_url, drive_file_id
                      FROM certificacion_bancaria
                     WHERE TRUE {filtro}
                     ORDER BY id""", {"id": args.id})
    filas = cur.fetchall()
    print(f"→ {len(filas)} certificaciones por leer")
    if not filas:
        return 0

    token = drive_token()
    res = Counter()

    for (cid, otipo, oid, nit, url, file_id) in filas:
        file_id = file_id or (RE_ID_DRIVE.search(url or "") or [None, None])[1] \
            if RE_ID_DRIVE.search(url or "") else file_id
        if not file_id:
            print(f"  #{cid}: sin id de Drive, se salta")
            res["sin_archivo"] += 1
            continue

        bajado = descargar(token, file_id)
        if not bajado:
            res["sin_archivo"] += 1
            continue
        ruta, es_pdf = bajado
        libre = None
        protegido = False
        try:
            if es_pdf:
                # Los bancos mandan el certificado cifrado con la cédula del
                # titular: se abre con el documento que el proveedor ya escribió.
                libre, clave = desproteger(ruta, nit)
                protegido = (clave == "?")
                if clave and clave != "?":
                    print(f"    (venía protegido; abierto con el documento del proveedor)")
                if not protegido:
                    ruta = libre
            metodo = "texto_pdf"
            texto = "" if protegido else (texto_de_pdf(ruta) if es_pdf else "")
            if not protegido and len(texto.strip()) < 40:   # PDF escaneado o imagen
                texto = texto_por_ocr(ruta, es_pdf)
                metodo = "ocr"
        finally:
            for f in {ruta, libre}:
                if f and os.path.exists(f):
                    os.unlink(f)

        d = interpretar(texto)
        estado, motivo = dictaminar(d, texto, protegido)
        res[estado] += 1
        print(f"  #{cid} [{metodo}] -> {estado}"
              + (f" · {d['banco']} {d['tipo_cuenta'] or ''} {d['num_cuenta'] or ''}"
                 if estado == "valida" else f" · {motivo}"))
        if args.verbose:
            print("    " + (texto[:400].replace("\n", " ") or "(vacío)"))

        cur.execute("""UPDATE certificacion_bancaria
                          SET banco=%s, tipo_cuenta=%s, num_cuenta=%s, titular_doc=%s,
                              estado=%s, motivo=%s, metodo=%s, texto_crudo=%s,
                              aplicada=FALSE, cuenta_anterior=NULL, leido_en=now()
                        WHERE id=%s""",
                    (d["banco"], d["tipo_cuenta"], d["num_cuenta"], d["titular_doc"],
                     estado, motivo, metodo, texto[:8000], cid))

        # Certificación que no sirve -> se le pide al proveedor la de verdad.
        if estado in ("ilegible", "no_es_certificacion", "protegido"):
            try:
                if encolar_aviso(cur, cid, otipo, oid, motivo or estado, estado == "protegido"):
                    res["aviso_encolado"] += 1
            except Exception as e:                    # Regla 12: un correo que
                print(f"    (no se pudo encolar el aviso: {e})")   # falla no
                                                      # tumba la lectura del lote

        # El lector NO escribe la cuenta en el maestro. A propósito.
        #
        # `cuentas_bancarias_proveedor` es de donde sale el archivo del banco
        # para TODO, incluidas las facturas DIAN de ese mismo NIT. Si acá
        # escribiéramos, un envío del portal PÚBLICO —que nadie ha mirado—
        # decidiría a qué cuenta se le paga a ese proveedor. La cuenta entra al
        # circuito de pago cuando un humano APRUEBA en la bandeja, no cuando un
        # OCR termina (lib/cuenta-certificada.ts).
        #
        # Lo que sí hace acá: dejar servida la decisión. Si el NIT ya tenía OTRA
        # cuenta, se guarda cuál era -> la bandeja muestra "cambió la cuenta" y
        # exige confirmarlo aparte antes de poder aprobar.
        if estado == "valida" and nit:
            cur.execute("SELECT num_cuenta FROM cuentas_bancarias_proveedor WHERE nit=%s", (nit,))
            fila = cur.fetchone()
            previa = solo_digitos(fila[0]) if fila and fila[0] else ""
            nueva = solo_digitos(d["num_cuenta"])
            if previa and previa != nueva:
                cur.execute("UPDATE certificacion_bancaria SET cuenta_anterior=%s WHERE id=%s",
                            (fila[0], cid))
                res["cambio_de_cuenta"] += 1
                print(f"     ⚠ el NIT {nit} ya tenía la cuenta ...{previa[-4:]} y esta trae "
                      f"...{nueva[-4:]}: NO se pisa, hay que confirmarlo en la bandeja")

    print(f"\n{dict(res)}")
    if args.commit:
        conn.commit()
        print("✅ COMMIT")
    else:
        conn.rollback()
        print("🔎 DRY-RUN (ROLLBACK)")
    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
