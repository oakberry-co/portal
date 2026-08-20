"""EL NIT Y SU DÍGITO DE VERIFICACIÓN — espejo de lib/nit.ts.

Existe en los dos lados porque el NIT entra por los dos: el portal (TypeScript)
y los cargues desde Sheet (Python). Si solo se normalizara en uno, el otro
seguiría metiendo la clave torcida — que es exactamente lo que pasó: las 4
cuentas con el DV pegado entraron por el cargue, no por la web.

La clave canónica de la casa es el NIT SIN dígito de verificación, que es como
llegan las facturas de la DIAN.
"""
from __future__ import annotations

import re

PESOS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]


def solo_digitos(t: str | None) -> str:
    return re.sub(r"\D", "", t or "")


def digito_verificacion(nit_sin_dv: str) -> str:
    """DV oficial DIAN."""
    n = solo_digitos(nit_sin_dv).zfill(15)
    r = sum(int(n[14 - i]) * PESOS[i] for i in range(15)) % 11
    return str(r if r < 2 else 11 - r)


def nit_canonico(t: str | None) -> str:
    """Quita el DV SOLO cuando de verdad lo es.

    Ojo con "si son 10 dígitos quítale el último": una CÉDULA de 10 dígitos tiene
    ~9% de probabilidad de que su último dígito sea, por casualidad, el DV de los
    9 anteriores — se truncaría una cédula buena. Por eso se exige que venga
    escrito con guion (o punto) marcando dónde va el DV, y que el DV verifique.
    """
    bruto = (t or "").strip()
    d = solo_digitos(bruto)
    if len(d) < 10:
        return d
    m = re.match(r"^([\d.\s]+)-\s*(\d)\s*$", bruto)
    if m:
        base = solo_digitos(m.group(1))
        if digito_verificacion(base) == m.group(2):
            return base
    return d


def mismo_nit(a: str | None, b: str | None) -> bool:
    """¿Son el mismo documento? Tolera el DV pegado en cualquiera de los dos
    lados, pero solo si el dígito es el correcto."""
    x, y = solo_digitos(a), solo_digitos(b)
    if not x or not y:
        return False
    if x == y:
        return True
    corto, largo = (x, y) if len(x) < len(y) else (y, x)
    return (len(largo) == len(corto) + 1
            and largo.startswith(corto)
            and digito_verificacion(corto) == largo[-1])
