#!/usr/bin/env python3
"""Le escribe al PROVEEDOR — vacía la cola `correo_saliente` por Amazon SES.

Tres correos cierran el ciclo del intake:

  certificacion_invalida  el papel que subió no es una certificación del banco
                          -> pídele el documento real (si no, su solicitud se
                             queda quieta para siempre y él nunca se entera)
  aprobacion              aprobamos -> "mándanos la factura respondiendo a este
                             correo; si no la tienes, respóndenos con el número"
  pago_hecho              ya salió la plata -> soporte ADJUNTO, en el MISMO HILO
                             de la aprobación, y se le pide la factura del saldo

Por qué corre en la VM y no en el portal: acá viven las llaves de SES (Secret
Manager) y acá se puede bajar el soporte de Drive para adjuntarlo. El portal
solo ENCOLA, dentro de la transacción que aprueba o paga.

El correo sale `From: contabilidad@manelfoods.co` con `Reply-To` y `CC` a
`compras@manelfoods.com`, que es el buzón que ya lee el pipeline DIAN: la
factura que el proveedor mande de respuesta se captura sola.

Pasa por la compuerta de envío compartida (common/envio_seguro.py): tope por
corrida, ventana horaria de Bogotá y apagador de emergencia por archivo.

Uso:
    python3 scripts/enviar_correos.py                    # dry-run
    python3 scripts/enviar_correos.py --commit
    python3 scripts/enviar_correos.py --commit --solo dzuluaga@manelfoods.com
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from email.message import EmailMessage
from email.utils import make_msgid, formataddr

import psycopg2
import requests

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from sync_bq_to_pg import cargar_database_url  # noqa: E402
from ingest_soportes_drive import drive_token  # noqa: E402

DW = "/home/daniel/proyectos/datawarehouse"
sys.path.insert(0, DW)
try:
    from common.envio_seguro import Compuerta, EnvioBloqueado  # noqa: E402
except Exception:                                   # el repo puede no estar (dev)
    Compuerta = None

    class EnvioBloqueado(Exception):
        pass

REMITENTE = os.environ.get("PORTAL_EMAIL_FROM", "Contabilidad ManelFoods <contabilidad@manelfoods.co>")
BUZON_COMPRAS = os.environ.get("PORTAL_EMAIL_CC", "compras@manelfoods.com")
REGION = os.environ.get("AWS_SES_REGION", "us-east-2")
MAX_INTENTOS = 5
RE_ID_DRIVE = re.compile(r"/d/([A-Za-z0-9_-]{20,})")

# La marca del portal, sobria: esto es contabilidad, no una promoción.
MORADO, CREMA, TINTA = "#5f4b8b", "#faf7f2", "#2f2a3a"


def pesos(v) -> str:
    try:
        return "$" + f"{round(float(v)):,}".replace(",", ".")
    except Exception:
        return "—"


def secreto(nombre: str) -> str:
    """Lee de Secret Manager con el mismo mapa que usan los senders del CRM."""
    import subprocess
    r = subprocess.run(["gcloud", "secrets", "versions", "access", "latest",
                        f"--secret={nombre}", "--project=project-oakberry-colombia-dw"],
                       capture_output=True, text=True, timeout=30)
    return r.stdout.strip() if r.returncode == 0 else ""


# ---------------------------------------------------------------------------
# Las plantillas. El TEXTO vive acá y en ningún otro lado: el portal encola un
# `tipo` + datos, así cambiar la redacción no exige desplegar la web.
# ---------------------------------------------------------------------------
def envoltura(cuerpo: str) -> str:
    return f"""<div style="background:{CREMA};padding:24px 12px;font-family:
-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:{TINTA}">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;
       padding:26px 28px;border:1px solid #ece6f5">
    <div style="font-weight:800;color:{MORADO};font-size:15px;letter-spacing:.02em;
         margin-bottom:16px">MANELFOODS · Contabilidad</div>
    {cuerpo}
    <hr style="border:none;border-top:1px solid #ece6f5;margin:22px 0 14px">
    <div style="font-size:12px;color:#8b849b;line-height:1.5">
      Responde a este mismo correo: llega directo al equipo de compras.
    </div>
  </div>
</div>"""


PORTAL = os.environ.get("PORTAL_URL", "https://www.manelfoods.co")


def boton_completar(d: dict) -> str:
    """El enlace que evita que el proveedor repita TODO el formulario.

    Sin esto, "vuelve a enviarlo" significa llenar diez campos y subir cuatro
    documentos por un solo archivo — y ahí es donde el proveedor abandona o
    llama por teléfono, que sale más caro que el trámite.
    """
    tk = d.get("token")
    if not tk:
        return ""
    return (f"""<p style="margin:18px 0"><a href="{PORTAL}/completar/{tk}"
        style="background:#5f4b8b;color:#fff;text-decoration:none;border-radius:10px;
        padding:13px 22px;font-weight:700;font-size:15px;display:inline-block">
        Subir el documento</a></p>
        <p style="font-size:13px;color:#8b849b;line-height:1.5">Ese enlace es solo tuyo y ya tiene
        tus datos: <b>no tienes que llenar el formulario otra vez</b>.</p>""")


def plantilla(tipo: str, d: dict) -> tuple[str, str, str]:
    """-> (asunto, html, texto_plano)."""
    prov = d.get("proveedor") or "Hola"
    ref = d.get("ref") or ""

    if tipo == "rechazo":
        # Antes rechazar no mandaba NADA: el proveedor quedaba esperando para
        # siempre, sin saber que su solicitud se había devuelto ni por qué.
        asunto = f"Devolvimos tu solicitud {ref} — falta algo"
        cuerpo = f"""
        <p style="font-size:15px;line-height:1.6">Hola <b>{prov}</b>,</p>
        <p style="font-size:15px;line-height:1.6">Tuvimos que <b>devolver</b> tu solicitud
        <b>{ref}</b>. No la perdimos: queda esperando a que la completes.</p>
        <p style="font-size:14px;line-height:1.6;background:{CREMA};border-radius:10px;padding:12px 14px">
        <b>Motivo:</b> {d.get('motivo') or 'falta información'}</p>
        {boton_completar(d)}
        <p style="font-size:15px;line-height:1.6">Si algo no te queda claro, responde este correo.</p>"""
        texto = (f"Hola {prov}, devolvimos tu solicitud {ref}. Motivo: "
                 f"{d.get('motivo') or 'falta información'}. "
                 + (f"Complétala acá: {PORTAL}/completar/{d.get('token')} — el enlace ya tiene tus "
                    "datos, no tienes que llenar el formulario otra vez."
                    if d.get("token") else "Responde este correo y te ayudamos."))
        return asunto, envoltura(cuerpo), texto

    if tipo == "certificacion_invalida":
        # Un certificado con CANDADO no es lo mismo que uno ilegible: puede
        # estar perfecto. Decirle "no se entiende" lo manda a reenviar lo mismo
        # y el trámite se queda dando vueltas.
        if d.get("protegido"):
            asunto = f"Tu certificación bancaria viene con clave ({ref})"
            cuerpo = f"""
        <p style="font-size:15px;line-height:1.6">Hola <b>{prov}</b>,</p>
        <p style="font-size:15px;line-height:1.6">Recibimos tu certificación bancaria de la
        solicitud <b>{ref}</b>, pero <b>viene protegida con una clave</b> y no pudimos abrirla.</p>
        <p style="font-size:15px;line-height:1.6">Varios bancos entregan el certificado con clave
        (normalmente tu número de documento). Necesitamos una versión <b>sin clave</b>:</p>
        <ul style="font-size:15px;line-height:1.7;padding-left:20px">
          <li>Ábrelo en tu computador con la clave y guárdalo o imprímelo <b>como PDF nuevo</b>, o</li>
          <li>tómale una <b>foto o captura nítida</b> donde se vean el banco y el número de cuenta, o</li>
          <li>descárgalo otra vez desde tu banca en línea eligiendo la opción sin protección.</li>
        </ul>
        {boton_completar(d)}
        <p style="font-size:15px;line-height:1.6"><b>No nos mandes la clave por correo</b>,
        no la necesitamos.</p>"""
            texto = (f"Hola {prov}, tu certificación bancaria de la solicitud {ref} viene protegida "
                     "con clave y no pudimos abrirla. Envíanos una versión sin clave: ábrela y "
                     "vuelve a guardarla como PDF, o mándanos una foto nítida donde se vean el banco "
                     "y el número de cuenta. No nos mandes la clave por correo.")
            return asunto, envoltura(cuerpo), texto

        asunto = f"No pudimos validar tu certificación bancaria ({ref})"
        motivo = d.get("motivo") or "no se pudo leer el documento"
        cuerpo = f"""
        <p style="font-size:15px;line-height:1.6">Hola <b>{prov}</b>,</p>
        <p style="font-size:15px;line-height:1.6">Recibimos tu solicitud
        <b>{ref}</b>, pero <b>no pudimos validar la certificación bancaria</b>
        que adjuntaste.</p>
        <p style="font-size:14px;line-height:1.6;background:{CREMA};border-radius:10px;
           padding:12px 14px"><b>Motivo:</b> {motivo}</p>
        <p style="font-size:15px;line-height:1.6">Necesitamos el documento que
        <b>emite tu banco</b> (el certificado de cuenta bancaria, con el nombre del
        banco y el número de cuenta). Sirve el PDF que descargas de tu banca en
        línea o una foto nítida del original. No sirve un documento escrito por ti.</p>
        <p style="font-size:15px;line-height:1.6">De ese documento sacamos la cuenta
        a la que te vamos a pagar, por eso no la tomamos de otra parte:
        <b>así nadie puede cambiarla por error</b>.</p>
        {boton_completar(d)}"""
        texto = (f"Hola {prov}, no pudimos validar la certificación bancaria de tu "
                 f"solicitud {ref}. Motivo: {motivo}. Necesitamos el documento que "
                 "emite tu banco (certificado de cuenta bancaria)."
                 + (f" Súbelo acá: {PORTAL}/completar/{d.get('token')} — el enlace ya tiene tus "
                    "datos, no tienes que llenar el formulario otra vez."
                    if d.get("token") else " Vuelve a enviarlo por el mismo formulario."))
        return asunto, envoltura(cuerpo), texto

    if tipo == "aprobacion":
        # UNA CUENTA DE COBRO NO TIENE FACTURA — ese es su motivo de existir: la
        # usa quien NO factura electrónicamente. Pedirle "mándanos la factura"
        # es pedirle lo único que no puede dar, y lo deja pensando que le falta
        # un trámite. Su cuenta de cobro YA es el documento.
        if d.get("_es_cuenta_cobro"):
            plazo = d.get("plazo_dias") or 30
            asunto = f"Aprobamos tu cuenta de cobro {ref}"
            # Que vea el descuento ANTES de que le llegue menos plata de la que
            # esperaba: una retención sin avisar se lee como un pago incompleto.
            ret = float(d.get("retenciones") or 0)
            if ret > 0:
                retencion = (f"""<p style="font-size:15px;line-height:1.6">Te vamos a consignar
        <b>{pesos(d.get('valor'))}</b>: son <b>{pesos(d.get('valor_bruto'))}</b> menos
        <b>{pesos(ret)}</b> de <b>retenciones de ley</b>, que le declaramos a la DIAN a tu
        nombre.</p>""")
            else:
                retencion = (f"""<p style="font-size:15px;line-height:1.6">Te vamos a consignar
        <b>{pesos(d.get('valor'))}</b>.</p>""")
            cuerpo = f"""
        <p style="font-size:15px;line-height:1.6">Hola <b>{prov}</b>,</p>
        <p style="font-size:15px;line-height:1.6">Tu cuenta de cobro <b>{ref}</b> quedó
        <b>aprobada</b> y entró a la programación de pagos, a <b>{plazo} días</b> desde que la
        recibimos.</p>
        {retencion}
        <p style="font-size:15px;line-height:1.6"><b>No tienes que enviarnos nada más.</b>
        Tu cuenta de cobro es el documento del trámite — no necesitamos factura.</p>
        <p style="font-size:14px;line-height:1.6;color:#6b6480">Te vamos a pagar a la cuenta de la
        certificación bancaria que nos enviaste. Cuando salga el pago te avisamos por este mismo
        correo con el soporte.</p>"""
            texto = (f"Hola {prov}, tu cuenta de cobro {ref} quedó aprobada y entró a la "
                     f"programación de pagos, a {plazo} días. Te consignaremos "
                     f"{pesos(d.get('valor'))}"
                     + (f" ({pesos(d.get('valor_bruto'))} menos {pesos(ret)} de retenciones de ley). "
                        if ret > 0 else ". ")
                     + "No tienes que enviarnos nada más: tu cuenta de cobro es el documento del "
                       "trámite. Cuando salga el pago te avisamos con el soporte.")
            return asunto, envoltura(cuerpo), texto

        asunto = f"Aprobamos tu solicitud {ref} — envíanos la factura"
        adelanto = d.get("adelanto")
        if adelanto:
            plata = (f"""<p style="font-size:15px;line-height:1.6">Vamos a pagarte el
            <b>adelanto del {d.get('adelanto_pct')}%</b>: <b>{pesos(adelanto)}</b>
            (de {pesos(d.get('valor'))} cotizados).</p>""")
        else:
            plazo = d.get("plazo_dias") or 30
            plata = (f"""<p style="font-size:15px;line-height:1.6">Queda programada por
            <b>{pesos(d.get('valor'))}</b>, a <b>{plazo} días</b> desde que la recibimos.</p>""")
        # Pedirle el código en la factura es lo ÚNICO que permite descontar el
        # adelanto solo, sin que un humano adivine cuál factura corresponde.
        pide_codigo = (f"""<p style="font-size:14px;line-height:1.6;background:#fff8e6;
        border-radius:10px;padding:12px 14px;color:#6b4d05"><b>Importante:</b> escribe el código
        <b>{ref}</b> en tu factura (en el concepto o en las observaciones). Con eso descontamos
        el adelanto automáticamente y te pagamos el saldo sin demoras.</p>""" if adelanto else "")
        cuerpo = f"""
        <p style="font-size:15px;line-height:1.6">Hola <b>{prov}</b>,</p>
        <p style="font-size:15px;line-height:1.6">Tu solicitud <b>{ref}</b> quedó
        <b>aprobada</b> y entró a la programación de pagos.</p>
        {plata}
        <p style="font-size:15px;line-height:1.6"><b>Envíanos la factura respondiendo
        a este correo.</b> Si aún no la tienes, respóndenos igual con el
        <b>número de factura</b> y nosotros la buscamos.</p>
        {pide_codigo}
        <p style="font-size:14px;line-height:1.6;color:#6b6480">Te vamos a pagar a la
        cuenta de la certificación bancaria que nos enviaste.</p>"""
        texto = (f"Hola {prov}, tu solicitud {ref} quedó aprobada y entró a la "
                 "programación de pagos. Envíanos la factura respondiendo a este "
                 "correo; si aún no la tienes, respóndenos con el número de factura."
                 + (f" IMPORTANTE: escribe el código {ref} en la factura, así "
                    "descontamos el adelanto automáticamente." if adelanto else ""))
        return asunto, envoltura(cuerpo), texto

    if tipo == "pago_hecho":
        asunto = f"Te pagamos {pesos(d.get('monto'))} — solicitud {ref}"
        saldo = float(d.get("saldo") or 0)

        # EL AVISO VA POR ESCRITO, NO ADJUNTO (decisión del 20-ago).
        #
        # Antes se mandaba el soporte de la transferencia. Ahora se le dice al
        # proveedor lo mismo con palabras: qué documento se le pagó, cuánto era,
        # cuánto se le retuvo y cuánto se le transfirió. El desglose no es
        # adorno: sin él le llega un total más bajo que su cuenta de cobro y no
        # tiene cómo saber por qué (Regla 18). El comprobante se sigue
        # guardando en Drive; lo que cambia es que no sale por correo.
        bruto = float(d.get("bruto") or 0)
        reten = float(d.get("retenciones") or 0)
        docu = d.get("documento")
        filas = [("Documento", f"{ref}" + (f" · {docu}" if docu else ""))]
        if bruto > 0:
            filas.append(("Valor del documento", pesos(bruto)))
        if reten > 0:
            filas.append(("Retenciones", "− " + pesos(reten)))
        filas.append(("<b>Total transferido</b>", "<b>" + pesos(d.get("monto")) + "</b>"))
        detalle = "".join(
            f'<tr><td style="padding:4px 12px 4px 0;font-size:14px;color:#5b5566">{k}</td>'
            f'<td style="padding:4px 0;font-size:14px;text-align:right">{v}</td></tr>'
            for k, v in filas)
        soporte = f"""<table style="border-collapse:collapse;margin:14px 0">{detalle}</table>
            <p style="font-size:15px;line-height:1.6">El pago ya salió
            de nuestro banco: <b>revisa tu cuenta</b>. Si en 24 horas no lo ves,
            respóndenos a este correo y lo revisamos contigo.</p>"""
        if d.get("_es_cuenta_cobro"):
            # Sin factura de por medio: el trámite se cierra aquí.
            pendiente = ("""<p style="font-size:15px;line-height:1.6">Con esto queda saldada tu
        cuenta de cobro. Gracias por trabajar con nosotros.</p>""")
        elif saldo > 0:
            pendiente = (f"""<p style="font-size:15px;line-height:1.6">Queda un
        <b>saldo de {pesos(saldo)}</b>. Para pagarlo necesitamos tu
        <b>factura</b>: respóndenos a este mismo correo con ella.</p>""")
        else:
            pendiente = ("""<p style="font-size:15px;line-height:1.6">Si aún no nos has
        enviado la factura, respóndenos a este correo con ella.</p>""")
        cuerpo = f"""
        <p style="font-size:15px;line-height:1.6">Hola <b>{prov}</b>,</p>
        <p style="font-size:15px;line-height:1.6">Te transferimos
        <b>{pesos(d.get('monto'))}</b> el <b>{d.get('fecha')}</b> por la solicitud
        <b>{ref}</b>.</p>
        {soporte}
        {pendiente}"""
        texto = (f"Hola {prov}, te transferimos {pesos(d.get('monto'))} el "
                 f"{d.get('fecha')} por la solicitud {ref}. "
                 + (f"Valor del documento {pesos(bruto)}. " if bruto > 0 else "")
                 + (f"Retenciones -{pesos(reten)}. " if reten > 0 else "")
                 + "El pago ya salió de nuestro banco: revisa tu cuenta. "
                 + ("Con esto queda saldada tu cuenta de cobro." if d.get("_es_cuenta_cobro")
                    else f"Queda un saldo de {pesos(saldo)}: respóndenos con tu factura." if saldo > 0
                    else "Si aún no nos enviaste la factura, respóndenos con ella."))
        return asunto, envoltura(cuerpo), texto

    raise ValueError(f"tipo de correo desconocido: {tipo}")


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# LA REVISIÓN ANTES DE ENVIAR
#
# Cada correo malo cuesta un reproceso: el proveedor hace algo que no debía, o
# toca escribirle otra vez a mano. En un solo día salieron dos —uno con el
# asunto "...bancaria ()" porque faltaba la referencia, y otro pidiéndole una
# factura a una CUENTA DE COBRO, que por definición no tiene—. Los dos eran
# detectables leyendo el correo ya armado.
#
# Así que se lee. Si algo huele mal, NO se manda: queda en 'revisar' con el
# motivo y el sentinela lo reporta. Un correo que no sale se arregla en 5
# minutos; uno que salió mal cuesta una llamada y la confianza del proveedor.
# ---------------------------------------------------------------------------

# Frases que delatan un dato que no se resolvió al armar la plantilla.
HUECOS = ["()", "( )", "None", "undefined", "null", "$ —", "{", "NaN"]

# Pedirle factura a una cuenta de cobro es el error de fondo: no existe.
PIDE_FACTURA = ["envíanos la factura", "envianos la factura", "con tu factura",
                "número de factura", "numero de factura", "respóndenos con ella"]


def revisar_correo(fila: dict, asunto: str, texto: str) -> list[str]:
    """Qué está mal en este correo. Lista vacía = se puede enviar."""
    problemas = []
    plano = " ".join((asunto + " " + texto).split())
    bajo = plano.lower()

    if "@" not in (fila.get("para") or ""):
        problemas.append("destinatario inválido")
    for h in HUECOS:
        if h in plano:
            problemas.append(f"quedó un hueco sin llenar en el texto ({h!r})")
            break
    if not (fila.get("datos") or {}).get("ref"):
        problemas.append("sin referencia (el proveedor no sabría de qué solicitud le hablan)")
    # Una cuenta de cobro NO tiene factura: pedírsela es mandarlo a un trámite
    # que no existe.
    if fila.get("origen_tipo") == "cuenta_cobro":
        for f in PIDE_FACTURA:
            if f in bajo:
                problemas.append("le pide FACTURA a una cuenta de cobro (no tiene)")
                break
    if fila.get("tipo") == "pago_hecho":
        monto = (fila.get("datos") or {}).get("monto")
        if not monto or float(monto) <= 0:
            problemas.append("avisa un pago sin monto")
    return problemas


def bajar_adjunto(url: str) -> tuple[str, bytes] | None:
    """Baja de Drive el soporte del pago para adjuntarlo al correo."""
    m = RE_ID_DRIVE.search(url or "")
    if not m:
        return None
    try:
        tok = drive_token()
        meta = requests.get(f"https://www.googleapis.com/drive/v3/files/{m.group(1)}",
                            params={"fields": "name,mimeType"},
                            headers={"Authorization": f"Bearer {tok}"}, timeout=30)
        if meta.status_code != 200:
            return None
        cont = requests.get(f"https://www.googleapis.com/drive/v3/files/{m.group(1)}",
                            params={"alt": "media"},
                            headers={"Authorization": f"Bearer {tok}"}, timeout=120)
        cont.raise_for_status()
        return meta.json().get("name", "soporte.pdf"), cont.content
    except Exception as e:
        print(f"    (no se pudo bajar el soporte: {e})")
        return None


def armar(fila: dict) -> tuple[EmailMessage, str, str]:
    """-> (mensaje MIME listo, asunto, message-id propio)."""
    datos = dict(fila["datos"] or {})
    # EL AVISO DE PAGO NO LLEVA ADJUNTO (decisión del 20-ago): se le cuenta al
    # proveedor por escrito qué se le pagó y cuánto. El candado está acá y no
    # solo en quien encola, porque puede haber correos ya en cola con su
    # `adjunto_url` puesto — y "ya no adjuntamos" tiene que valer también para
    # esos. El comprobante se sigue guardando en Drive.
    sin_adjunto = fila["tipo"] == "pago_hecho"
    adjunto = None if sin_adjunto else (bajar_adjunto(fila["adjunto_url"]) if fila["adjunto_url"] else None)
    datos["_con_adjunto"] = bool(adjunto)
    # De qué carril viene: una cuenta de cobro NO termina en factura.
    datos["_es_cuenta_cobro"] = fila["origen_tipo"] == "cuenta_cobro"
    asunto, html, texto = plantilla(fila["tipo"], datos)

    msg = EmailMessage()
    mid = make_msgid(domain="manelfoods.co")
    msg["Message-ID"] = mid
    # MISMO HILO: el correo del pago responde al de la aprobación, así el
    # proveedor lo ve como continuación y no como un correo suelto.
    if fila["hilo_ref"]:
        msg["In-Reply-To"] = fila["hilo_ref"]
        msg["References"] = fila["hilo_ref"]
        asunto = asunto if asunto.lower().startswith("re:") else "Re: " + asunto
    msg["Subject"] = asunto
    msg["From"] = REMITENTE
    msg["To"] = fila["para"]
    # CC al buzón que lee el pipeline DIAN -> cuando SÍ hay factura (cotización),
    # la respuesta del proveedor se captura sola. En una cuenta de cobro no hay
    # factura que capturar, pero el CC se deja igual: es como el equipo se entera
    # de qué se le prometió al proveedor sin entrar al portal.
    msg["Cc"] = fila["cc"] or BUZON_COMPRAS
    msg["Reply-To"] = BUZON_COMPRAS
    msg.set_content(texto)
    msg.add_alternative(html, subtype="html")
    if adjunto:
        nombre, blob = adjunto
        sub = "pdf" if nombre.lower().endswith(".pdf") else "octet-stream"
        msg.add_attachment(blob, maintype="application", subtype=sub, filename=nombre)
    return msg, asunto, mid


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--commit", action="store_true", help="enviar de verdad")
    ap.add_argument("--limite", type=int, default=50)
    ap.add_argument("--solo", help="enviar SOLO a este destinatario (prueba)")
    ap.add_argument("--id", type=int, help="una sola fila de la cola")
    args = ap.parse_args()

    dsn = cargar_database_url()
    if not dsn:
        print("ERROR: falta DATABASE_URL", file=sys.stderr)
        return 2
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()

    filtro = "AND id = %(id)s" if args.id else ""
    cur.execute(f"""SELECT id, tipo, origen_tipo, origen_id, para, cc, datos,
                           adjunto_url, hilo_ref, intentos
                      FROM correo_saliente
                     WHERE estado = 'pendiente' AND intentos < {MAX_INTENTOS} {filtro}
                     ORDER BY id LIMIT %(lim)s""",
                {"id": args.id, "lim": args.limite})
    cols = [c[0] for c in cur.description]
    filas = [dict(zip(cols, r)) for r in cur.fetchall()]
    if args.solo:
        filas = [f for f in filas if f["para"] == args.solo]
    print(f"→ {len(filas)} correos por enviar")
    if not filas:
        return 0

    # Compuerta compartida: tope, ventana de Bogotá y apagador por archivo.
    if Compuerta:
        try:
            filas = Compuerta(canal="email", programa="portal_intake").autorizar(
                filas, limite=args.limite, confirmar_prod=args.commit)
        except EnvioBloqueado as e:
            print(f"⛔ {e}")
            return 0

    ses = None
    if args.commit:
        import boto3
        ses = boto3.client(
            "ses", region_name=REGION,
            aws_access_key_id=os.environ.get("AWS_SES_ACCESS_KEY") or secreto("aws-ses-access-key"),
            aws_secret_access_key=os.environ.get("AWS_SES_SECRET_KEY") or secreto("aws-ses-secret-key"))

    ok = err = 0
    for f in filas:
        # Regla 12: el except envuelve UN correo. Un adjunto veneno o un correo
        # mal escrito no puede tumbar el resto de la cola.
        try:
            # MISMO HILO: se resuelve ACÁ y no al encolar, porque cuando se
            # registra el pago la aprobación puede no haberse enviado todavía
            # (y sin Message-ID no hay hilo que encadenar).
            if f["tipo"] == "pago_hecho" and not f["hilo_ref"]:
                cur.execute("""SELECT message_id FROM correo_saliente
                                WHERE tipo='aprobacion' AND origen_tipo=%s AND origen_id=%s
                                  AND message_id IS NOT NULL""",
                            (f["origen_tipo"], f["origen_id"]))
                prev = cur.fetchone()
                if prev:
                    f["hilo_ref"] = prev[0]
                    cur.execute("UPDATE correo_saliente SET hilo_ref=%s WHERE id=%s",
                                (prev[0], f["id"]))
                    conn.commit()
            msg, asunto, mid = armar(f)
            print(f"  #{f['id']} {f['tipo']} → {f['para']}\n     « {asunto} »")

            # Se lee el correo ya armado antes de soltarlo.
            pegas = revisar_correo(f, asunto, msg.get_body(("plain",)).get_content()
                                   if msg.get_body(("plain",)) else asunto)
            if pegas:
                print("     ⛔ NO se envía: " + "; ".join(pegas))
                if args.commit:
                    cur.execute("""UPDATE correo_saliente
                                      SET estado='revisar', error=%s, asunto=%s
                                    WHERE id=%s""", ("; ".join(pegas)[:400], asunto, f["id"]))
                    conn.commit()
                err += 1
                continue

            if not args.commit:
                continue
            # CANDADO DEL AMBIENTE DE PRUEBAS. Si esta variable está puesta, el
            # correo va SOLO a esa dirección, pase lo que pase — nunca al
            # proveedor. Es una variable de entorno y no un flag a propósito: un
            # flag hay que acordarse de escribirlo, y el día que se olvide, un
            # proveedor recibe "su cuenta fue aprobada" por una prueba.
            forzado = (os.environ.get("CORREO_DESTINO_FORZADO") or "").strip()
            if forzado:
                print(f"     🧪 ambiente de pruebas: en vez de {f['para']} va a {forzado}")
                dest = [forzado]
            else:
                dest = [f["para"]] + [x for x in [(f["cc"] or BUZON_COMPRAS)] if x]
            resp = ses.send_raw_email(Source=REMITENTE, Destinations=dest,
                                      RawMessage={"Data": msg.as_bytes()})
            cur.execute("""UPDATE correo_saliente
                              SET estado='enviado', enviado_en=now(), asunto=%s,
                                  message_id=%s, intentos=intentos+1, error=NULL
                            WHERE id=%s""", (asunto, mid, f["id"]))
            conn.commit()
            ok += 1
            print(f"     ✅ SES {resp.get('MessageId','')}")
        except Exception as e:
            conn.rollback()
            detalle = str(e)[:400]
            # Regla 8: lo fallido es REINTENTABLE. Solo se da por perdido tras
            # MAX_INTENTOS, y ahí el sentinela lo reporta — nunca en silencio.
            cur.execute("""UPDATE correo_saliente
                              SET intentos = intentos + 1, error = %s,
                                  estado = CASE WHEN intentos + 1 >= %s THEN 'fallido'
                                                ELSE 'pendiente' END
                            WHERE id = %s""", (detalle, MAX_INTENTOS, f["id"]))
            conn.commit()
            err += 1
            print(f"     ❌ {detalle}")

    if Compuerta and args.commit:
        try:
            Compuerta(canal="email", programa="portal_intake").registrar(enviados=ok, fallidos=err)
        except Exception:
            pass
    print(f"\n{'✅' if not err else '⚠️'} enviados={ok} fallidos={err}"
          + ("" if args.commit else "   🔎 DRY-RUN (no se envió nada)"))
    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
