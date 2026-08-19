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
    # Agregados 2026-08-19 al medir la lista contra los 54 proveedores que el
    # equipo ya tenía cargados: PIBANK aparecía y el lector lo habría rechazado.
    # La lista es un FILTRO de autenticidad, no un catálogo — pero un banco que
    # falta se ve como "esto no es del banco", que es un rechazo INJUSTO. Por eso
    # el sentinela `banco_desconocido` avisa cuál agregar en vez de que el
    # proveedor rebote en silencio.
    "PIBANK": ["pibank"],
    "UNION": ["banco union", "banco unión"],
    "SANTANDER": ["santander"],
    "CITIBANK": ["citibank"],
    "BANCOOMEVA": ["bancoomeva", "coomeva"],
    "CONFIAR": ["confiar"],
    "COTRAFA": ["cotrafa"],
    "JURISCOOP": ["juriscoop"],
    "COMULTRASAN": ["comultrasan"],
    "IRIS": ["banco iris", "coltefinanciera"],
    "MIBANCO": ["mibanco"],
    "DALE": ["dale!", "dale "],
    "POWWI": ["powwi"],
    "UALA": ["uala", "ualá"],
    "TPAGA": ["tpaga"],
    "CREZCAMOS": ["crezcamos"],
    "CONTACTAR": ["contactar"],
}

# Lenguaje propio de una certificación. Un Word improvisado rara vez lo trae.
SENAS_CERTIFICACION = ["certifica", "certificacion", "certificamos", "consta que",
                       "titular", "hace constar"]

TIPOS_CUENTA = [("ahorros", ["ahorro"]), ("corriente", ["corriente"])]

# Número de cuenta colombiano: 8-22 dígitos. Se exige un ancla de contexto
# ('cuenta', 'no.', '#') para no confundirlo con un NIT, un teléfono o una fecha
# larga — el error clásico de matchear números pelados.
#
# El número NO admite espacios adentro, y eso es a propósito. Los bancos
# imprimen el certificado como TABLA:
#
#     CUENTA CORRIENTE        17391143238        1978/02/23        ACTIVA
#
# Si se permitieran espacios, el patrón se comería la columna siguiente y
# devolvería '173911432381978' — una cuenta que no existe, con la fecha pegada.
# Preferimos no leerla (y pedir el documento) antes que inventar un número:
# a esa cuenta se le manda plata. Los separadores que sí se aceptan son los que
# el banco escribe DENTRO del número: guiones y puntos.
RE_CUENTA = re.compile(
    r"(?:cuenta|cta|no\.?|n[uú]mero|#)[^0-9]{0,40}((?:\d[.\-]?){7,21}\d)", re.I)

# Las columnas de esas tablas van separadas por varios espacios. Se convierten en
# salto de línea para que el número no pueda cruzar de una columna a otra; el
# ancla sí puede, porque su hueco admite cualquier carácter que no sea dígito.
RE_COLUMNAS = re.compile(r"[ \t]{2,}")
# Anclas del documento del titular. Se aplica sobre el texto SIN TILDES (ver
# `interpretar`): el certificado de Nu dice "Cédula de ciudadanía" y sin quitar
# la tilde el patrón no encontraba la cédula de la titular — solo el NIT del
# banco del encabezado, que es justo el número equivocado.
RE_NIT = re.compile(
    r"(?:nit|c\.?c\.?|cedula|identificacion|documento)[^0-9]{0,20}((?:\d[\s.\-]?){6,15}\d)", re.I)


def norm(s: str) -> str:
    return _sin_tildes(s or "").lower()


def solo_digitos(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def mismo_documento(a: str, b: str) -> bool:
    """¿Son el mismo documento? Tolera el dígito de verificación del NIT.

    El formulario recibe '860035748-1' y el certificado imprime '860035748' (o
    al revés). Sin esta tolerancia, todo NIT de empresa daría "no coincide".
    """
    x, y = solo_digitos(a), solo_digitos(b)
    if not x or not y:
        return True                      # sin dato no se puede afirmar nada
    return x == y or x == y[:-1] or y == x[:-1]


def misma_cuenta(a: str, b: str) -> bool:
    """¿Es la misma cuenta, escrita distinto?

    Los CEROS A LA IZQUIERDA son el clásico: el banco imprime '05314486074' y el
    equipo la cargó a mano como '5314486074'. Comparadas como texto son
    distintas, y sin esto el sistema gritaría "cambió la cuenta" contra un
    proveedor que nunca la cambió — una alarma falsa que bloquea el pago y que,
    peor, enseña al equipo a ignorar la alarma de verdad.

    Caso real: NIT 79448558, primera certificación leída del carril nuevo.
    """
    x, y = solo_digitos(a).lstrip("0"), solo_digitos(b).lstrip("0")
    return bool(x) and x == y


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


def desproteger(ruta: str, doc_num: str, clave_dada: str | None = None) -> tuple[str, str | None]:
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
    candidatas = ([clave_dada.strip()] if clave_dada and clave_dada.strip() else []) \
        + claves_probables(doc_num)
    for clave in candidatas:
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
    # Sin tildes y con las columnas cortadas: 'Cédula' tiene que encontrarse
    # igual que 'Cedula', y el número no puede cruzar de una columna a otra.
    plano = RE_COLUMNAS.sub("\n", _sin_tildes(texto))
    cuentas = [solo_digitos(m) for m in RE_CUENTA.findall(plano)]
    docs = [solo_digitos(m) for m in RE_NIT.findall(plano)]

    # Un número que es el NIT/cédula del titular NO es la cuenta. Pasa seguido:
    # "identificado con NIT 860035748" está a pocos caracteres de un ancla.
    cuentas = [c for c in cuentas if 8 <= len(c) <= 22 and c not in docs]
    num = max(cuentas, key=len) if cuentas else None

    # TODOS los documentos que aparecen. Ojo: uno de ellos es el NIT DEL BANCO
    # ("Nu Colombia Compañía de Financiamiento S.A., NIT 901.658.107-2" va en el
    # encabezado), así que tomar el primero es tomar el del banco.
    docs = [d for d in docs if d != num and 6 <= len(d) <= 15]

    return {"banco": banco, "tipo_cuenta": tipo, "num_cuenta": num,
            "docs": docs, "titular_doc": docs[0] if docs else None,
            "tiene_lenguaje": tiene_lenguaje}


def dictaminar(d: dict, texto: str, protegido: bool = False,
               doc_solicitud: str | None = None) -> tuple[str, str | None]:
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
    # EL TITULAR TIENE QUE SER QUIEN COBRA.
    #
    # Sin esto, cualquiera podía subir el certificado de OTRA persona: el NIT del
    # formulario sería el del proveedor real y la cuenta la del que sube. Y el
    # candado de "cambió la cuenta" no lo atrapa, porque para un proveedor nuevo
    # no hay cuenta anterior con qué comparar.
    #
    # No bloquea de forma definitiva: manda a revisión humana. Pasa de buena fe
    # que la cuenta esté a nombre del representante legal y no de la empresa.
    # La regla correcta NO es "el primer documento del papel es el titular" —el
    # primero suele ser el NIT del banco— sino: ¿el documento de quien cobra
    # APARECE en el certificado? Si aparece, el papel es suyo. Si no aparece por
    # ningún lado, ahí sí hay que mirar de quién es esa cuenta.
    docs = d.get("docs") or ([d["titular_doc"]] if d.get("titular_doc") else [])
    if doc_solicitud and docs and not any(mismo_documento(x, doc_solicitud) for x in docs):
        return "no_coincide", (
            f"El certificado no menciona el documento {doc_solicitud} de quien hace la "
            f"solicitud (encontramos {', '.join(docs[:3])}). Hay que confirmar de quién "
            "es esa cuenta antes de pagarle.")
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
    # La REFERENCIA va en el asunto. Sin ella el proveedor recibía
    # "No pudimos validar tu certificación bancaria ()" — con el paréntesis
    # vacío, sin saber de cuál de sus solicitudes le están hablando.
    ref_sql = ("'CC-' || id" if otipo == "cuenta_cobro"
               else "coalesce(codigo, 'COT-' || id)")
    cur.execute(f"SELECT razon_social, correo, {ref_sql} FROM {tabla} WHERE id=%s", (oid,))
    fila = cur.fetchone()
    if not fila or not (fila[1] or "").strip():
        return False                      # no dejó correo: la bandeja lo muestra
    cur.execute("""INSERT INTO correo_saliente
                     (tipo, origen_tipo, origen_id, para, datos, creado_por)
                   VALUES ('certificacion_invalida', %s, %s, %s,
                           jsonb_build_object('proveedor', %s::text, 'motivo', %s::text,
                                              'ref', %s::text, 'protegido', %s::boolean),
                           'lector_certificaciones')
                   ON CONFLICT (tipo, origen_tipo, origen_id) DO NOTHING""",
                (otipo, oid, fila[1].strip(), fila[0], motivo, fila[2], protegido))
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

    # Se releen las pendientes y, además, cualquier PROTEGIDA a la que el equipo
    # le acaba de dar la clave (la bandeja la escribe en `clave_intento`).
    filtro = ("AND id = %(id)s" if args.id
              else "AND (estado = 'pendiente' OR (estado = 'protegido' AND clave_intento IS NOT NULL))")
    cur.execute(f"""SELECT id, origen_tipo, origen_id, nit, drive_url, drive_file_id, clave_intento
                      FROM certificacion_bancaria
                     WHERE TRUE {filtro}
                     ORDER BY id""", {"id": args.id})
    filas = cur.fetchall()
    print(f"→ {len(filas)} certificaciones por leer")
    if not filas:
        return 0

    token = drive_token()
    res = Counter()

    for (cid, otipo, oid, nit, url, file_id, clave_dada) in filas:
        # La clave que el equipo consiguió se usa y se BORRA en esta misma
        # corrida, salga bien o mal: no se guarda una contraseña ajena.
        if clave_dada:
            cur.execute("UPDATE certificacion_bancaria SET clave_intento=NULL WHERE id=%s", (cid,))
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
                libre, clave = desproteger(ruta, nit, clave_dada)
                protegido = (clave == "?")
                if clave and clave != "?":
                    print("    (venía protegido; abierto con "
                          + ("la clave que dio el proveedor)" if clave_dada and clave == clave_dada.strip()
                             else "el documento del proveedor)"))
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
        estado, motivo = dictaminar(d, texto, protegido, nit)
        # Se guarda el documento DEL TITULAR, no el primero que aparezca: si el
        # de quien cobra está en el papel, ese es.
        if nit and d.get("docs"):
            propio = next((x for x in d["docs"] if mismo_documento(x, nit)), None)
            if propio:
                d["titular_doc"] = propio
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
            if previa and not misma_cuenta(previa, nueva):
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
