# Contrato `rrhh_quincenas.snapshot` — v2 (nómina electrónica DIAN)

**Productor:** `snapshotDe()` en `app/(nomina)/nomina/quincena/_nomina.ts` (cálculo en
`lib/rrhh/quincena.ts → lineaQuincena`). Se congela al **aprobar** la quincena
(`_aprobarQuincena` en `lib/rrhh/actions.ts`, que **rechaza** la aprobación si una línea
no pasa `validarSnapshotV2`).
**Consumidor:** el generador Python del XML de nómina electrónica: lee las **dos**
quincenas aprobadas del mes y suma por `empleadoId`.

## Forma

`snapshot` es una lista JSON, una entrada por empleado. Cada entrada conserva los
campos v1 (no se quitó ninguno) y agrega `v2`:

Ejemplo real (salario mínimo 2026, 2ª quincena de octubre, 3 días de incapacidad
común, 4 h nocturnas, 3 h extra diurnas, una cuota de préstamo) — sale de
`lineaQuincena` y pasa `validarSnapshotV2`:

```jsonc
{
  // ---- v1 (compatibilidad; no usar para la DIAN) ----
  "empleadoId": 123, "nombre": "Ana Pérez", "basico": 875453, "recargos": 17927, "descuentos": 0,
  "ibc": 918394, "salud": 36736, "pension": 36736, "fsp": 0, "auxilio": 99638, "novedades": -50000, "neto": 894560,
  // ---- v2 ----
  "v2": {
    "v": 2, "empleadoId": 123, "nombre": "Ana Pérez",
    "desde": "2026-10-16", "hasta": "2026-10-31",
    "diasPagados": 12, "basico": 700362,
    "horas": {
      "nocturna":     { "cantidad": 4, "pct": 35, "pago": 11673 },   // solo el recargo
      "extra_diurna": { "cantidad": 3, "pct": 25, "pago": 31268 }    // hora completa: 3 × 8.338 + 25 %
    },
    "auxilio": 99638,                                                  // 12 de 15 días con derecho
    "ausencias": [
      { "tipo": "Incapacidad", "origen": "comun", "desde": "2026-10-20", "hasta": "2026-10-22", "dias": 3, "pago": 175091, "descuento": 0 }
    ],
    "prima": null, "interesesCesantias": null, "cesantiasConsignadas": null,
    "novedades": [ { "tipo": "prestamo", "descripcion": "cuota 2/6", "valor": 50000, "naturaleza": "deduccion" } ],
    "ibc": 918394, "salud": 36736, "pension": 36736, "fsp": 0, "retencion": 0,
    "devengado": 1018032,      // 700362 + 175091 + 11673 + 31268 + 99638
    "deducciones": 123472,     // 36736 + 36736 + 50000
    "neto": 894560,
    "reglas": { "desde": "2026-07-01", "divisor": 210, "smlmv": 1750905, "uvt": 52374 }
  }
}
```

## Unidades y signos

- **Todo dinero en COP, entero, ≥ 0.** Las deducciones van en **positivo** y **restan**.
- Días con la **convención de 30** (el 31 no cuenta; el último día de febrero completa 30):
  una quincena completa vale 15.
- Horas en horas decimales (cuartos de hora: 7.75).

## Campos de `v2`

| Campo | Qué es |
|---|---|
| `v` | Siempre `2`. Un snapshot sin `v2` es de antes del 23-oct-2026 (v1): no sirve para la DIAN. |
| `desde`, `hasta` | La quincena (YYYY-MM-DD). |
| `diasPagados` | Días que se pagan como **sueldo trabajado**: días del período (prorrateados por ingreso/retiro) **menos** los días de cada ausencia. DIAN: `Basico/@DiasTrabajados`. |
| `basico` | `salario × diasPagados / 30`. DIAN: `Basico/@SueldoTrabajado`. |
| `horas` | Solo tipos con cantidad > 0. **No** aparecen `ordinaria` (su valor está en `basico`), `descanso` ni `ausencia`. `pct` = recargo aplicado (`REGLAS.recargo`). **`pago`:** en `nocturna`, `dominical`, `nocturna_dominical` = **solo el recargo** (la hora base ya está en el básico; DIAN HRN/HRDDF/HRNDF); en `extra_*` = **hora completa** (base + recargo; DIAN HED/HEN/HEDDF/HENDF), porque la hora extra no está dentro del salario fijo. |
| `auxilio` | Auxilio de transporte por los días con derecho (no se paga en incapacidad, licencias, vacaciones ni ausencias no remuneradas). |
| `ausencias[]` | Una por solicitud aprobada que toca la quincena. `tipo` = catálogo (`lib/rrhh/catalogos.ts`); `origen` solo en incapacidades (`comun` EPS / `laboral` ARL); `desde/hasta` ya recortados a la quincena; `dias` (convención 30; en no remuneradas = días hábiles); `pago` = lo que se paga por esos días; `descuento` = lo que no se paga. **`pago + descuento = salario × dias / 30`.** Mapeo DIAN sugerido: Incapacidad → `Incapacidades` (Tipo 1 común / 2 laboral); Vacaciones → `VacacionesComunes`; Maternidad/Paternidad → `LicenciaMP`; luto, calamidad, cita médica, votación → `LicenciaR`; permiso no remunerado, suspensión, injustificada → `LicenciaNR` (sin pago). |
| `prima` | `{ dias, pago }` en la 2ª quincena de junio y la 1ª de diciembre; si no, `null`. Suma al devengado, **no** al IBC. |
| `interesesCesantias` | `{ pago }` en la 2ª quincena de enero (año anterior); si no, `null`. |
| `cesantiasConsignadas` | `{ pago }` en la 1ª quincena de febrero. **Informativo: va al fondo, NO entra al devengado ni al neto.** |
| `novedades[]` | `{ tipo, descripcion, valor, naturaleza }`, `valor` positivo; `naturaleza` = `devengado` (incentivo, bonificación) o `deduccion` (préstamo, embargo, descuento). |
| `ibc` | IBC de la quincena: básico + pago de ausencias + recargos + extras. Sin auxilio, prima, intereses ni novedades. |
| `salud`, `pension`, `fsp` | Aportes del trabajador (4 %, 4 %, FSP según `motor.pctFsp`). |
| `retencion` | Retención en la fuente (proc. 1, mensual): solo en la 2ª quincena; en la 1ª es 0. |
| `devengado` | `basico + Σ ausencias.pago + Σ horas.pago + auxilio + prima.pago + interesesCesantias.pago + Σ novedades(devengado)` |
| `deducciones` | `salud + pension + fsp + retencion + Σ novedades(deduccion)` |
| `neto` | `devengado − deducciones` (**al peso**; lo afirma el código y lo revalida la aprobación). |
| `reglas` | La fila de `REGLAS` usada (`desde` = inicio de su vigencia), para auditar. |

## Sumas de control que el consumidor debe repetir

1. `devengado − deducciones = neto` por línea.
2. `devengado` y `deducciones` = suma de sus conceptos (fórmulas de arriba).
3. Mes = suma de las dos quincenas por `empleadoId`; si falta una de las dos aprobadas, **no** generar el XML de esa persona.

## Pendiente (no está en v2)

- Cédula/tipo de documento, cuenta bancaria y datos del contrato: el generador los toma del maestro.
- Prórroga de incapacidad (cada solicitud reinicia la cuenta de días 1-2).
- Salario variable en la base de prima/cesantías (hoy: salario fijo de la ficha).
