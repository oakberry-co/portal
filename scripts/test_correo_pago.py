#!/usr/bin/env python3
"""CENTINELA DEL CORREO DE PAGO (Regla 14 + Regla 18).

Desde el 20-ago el aviso de "ya te pagamos" NO lleva el soporte adjunto: se le
cuenta al proveedor POR ESCRITO qué documento se le pagó, cuánto era, cuánto se
le retuvo y cuánto se le transfirió.

El desglose no es adorno. Sin él al proveedor le llega un total MÁS BAJO que su
cuenta de cobro y no tiene cómo saber por qué — y lo que hace entonces es
llamar, o peor, volver a cobrar. Por eso este test comprueba que los tres
números salgan en el correo y que el adjunto quede desactivado incluso para las
filas que ya estaban en cola con su `adjunto_url` puesto.

    python3 scripts/test_correo_pago.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

fallos = []


def check(ok, titulo, detalle=""):
    print(f"  {'✅' if ok else '❌'} {titulo}{' — ' + detalle if detalle else ''}")
    if not ok:
        fallos.append(titulo)


def main():
    import enviar_correos as ec

    base = {"ref": "CC-21", "proveedor": "Manuela Quintero", "monto": 148551,
            "fecha": "2026-08-20", "bruto": 150000, "retenciones": 1449,
            "documento": "REC-9981", "saldo": 0, "_es_cuenta_cobro": True}

    print("\n1) El correo dice, por escrito, los tres números")
    asunto, html, texto = ec.plantilla("pago_hecho", dict(base))
    for etiqueta, aguja in (("valor del documento", "150.000"),
                            ("retenciones", "1.449"),
                            ("total transferido", "148.551")):
        check(aguja in html, f"el HTML trae el {etiqueta}", aguja)
        check(aguja in texto, f"la versión de texto trae el {etiqueta}")
    check("REC-9981" in html, "y el número del documento que se pagó")

    print("\n2) Ya NO se ofrece ningún adjunto")
    check("Adjuntamos" not in html and "adjunt" not in texto.lower(),
          "no promete un soporte que no va", texto[:90])
    check("revisa tu cuenta" in texto.lower(), "en cambio le dice qué hacer para verificar")

    print("\n3) Sin retenciones, no se inventa una línea en cero")
    _, html2, _ = ec.plantilla("pago_hecho", dict(base, retenciones=0, bruto=100000, monto=100000))
    check("Retenciones" not in html2, "una fila 'Retenciones $0' confunde más de lo que informa")
    check("100.000" in html2, "y el total sigue estando")

    print("\n4) El candado del adjunto está en el emisor, no solo en quien encola")
    # Una fila YA EN COLA con su adjunto_url puesto (de antes del cambio) tampoco
    # debe salir con archivo: "ya no adjuntamos" vale también para esas.
    fila = {"tipo": "pago_hecho", "datos": dict(base), "adjunto_url": "https://drive.google.com/file/d/XYZ/view",
            "origen_tipo": "cuenta_cobro", "hilo_ref": None, "para": "x@y.com", "cc": None}
    try:
        msg, _, _ = ec.armar(fila)
        adjuntos = [p.get_filename() for p in msg.iter_attachments()]
        check(not adjuntos, "una fila vieja con adjunto_url igual sale sin archivo", str(adjuntos))
    except Exception as e:                                   # noqa: BLE001
        check(False, "armar() corrió sobre una fila con adjunto_url", str(e)[:120])

    print("\n5) La revisión previa sigue deteniendo un correo con huecos")
    _, _, texto_malo = ec.plantilla("pago_hecho", dict(base, monto=0))
    pegas = ec.revisar_correo({"tipo": "pago_hecho", "para": "x@y.com",
                               "datos": dict(base, monto=0)}, "asunto", texto_malo)
    check(bool(pegas), "un pago en cero no se manda", str(pegas))

    print(f"\n❌ {len(fallos)} fallo(s): {', '.join(fallos)}\n" if fallos
          else "\n🟢 todo OK\n")
    sys.exit(1 if fallos else 0)


if __name__ == "__main__":
    main()
