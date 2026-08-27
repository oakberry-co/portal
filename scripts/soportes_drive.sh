#!/bin/bash
# Portal — ingesta de SOPORTES del Drive de compras (COMPRAS/AÑO/MES/DESTINO)
# hacia `factura_soportes` en Neon. Corre en la VM por cron (ahí vive la SA con
# delegación de dominio para Drive).
#
# Diseño (Regla 17: el cron ES parte del módulo, y lleva `cd` explícito):
#   · Corre a DIARIO sobre el mes EN CURSO y el ANTERIOR. Julio llegó incompleto
#     y agosto ni existía cuando se construyó esto: el archivo se llena de a poco
#     y a destiempo, así que revisar solo el mes actual dejaría huecos.
#   · Es idempotente (PK = drive_file_id): re-correr no duplica ni pisa lo humano.
#   · Si la carpeta del mes aún no existe en Drive, sale limpio (exit 0).
#
#   · De NOCHE corre un BARRIDO (--barrido): todo lo clasificado y sin archivar,
#     de CUALQUIER mes. La ventana "mes actual + anterior" deja un hueco real —
#     una factura de junio clasificada en octubre no entraría nunca — y el
#     barrido es barato: solo llama a Drive por lo que falta de verdad.
#
# Uso:  soportes_drive.sh            # mes en curso + anterior (leer + archivar)
#       soportes_drive.sh 2026-03    # un mes puntual
#       soportes_drive.sh --barrido  # solo archivar, TODO lo pendiente
set -e

PORTAL="/home/daniel/proyectos/portal"
PYTHON="/usr/bin/python3"
LOGDIR="/home/daniel/proyectos/datawarehouse/logs"
LOG="$LOGDIR/soportes_drive_$(date +%Y%m%d).log"
LOCKFILE="/tmp/oakberry_soportes_drive.lock"

mkdir -p "$LOGDIR"

if [ -f "$LOCKFILE" ]; then
    PID=$(cat "$LOCKFILE" 2>/dev/null)
    if kill -0 "$PID" 2>/dev/null; then
        echo "=== $(date '+%F %T') - soportes_drive ya corriendo (PID $PID), salto ===" >> "$LOG"
        exit 0
    fi
    rm -f "$LOCKFILE"
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

cd "$PORTAL"

# Barrido nocturno: NO relee el árbol de Drive (eso es del turno de la mañana),
# solo baja al archivo lo que el equipo clasificó durante el día, sin importar de
# qué mes sea la factura.
if [ "$1" = "--barrido" ]; then
    echo "=== $(date '+%F %T') - barrido de pendientes (archivar) ===" >> "$LOG"
    $PYTHON scripts/archivar_en_drive.py --pendientes --commit \
        --actor cron_barrido_nocturno >> "$LOG" 2>&1
    echo "=== $(date '+%F %T') - done (barrido) ===" >> "$LOG"
    find "$LOGDIR" -name "soportes_drive_*.log" -mtime +30 -delete 2>/dev/null || true
    exit 0
fi

# La VM vive en UTC pero el negocio en Bogotá (Regla 1): el mes se calcula en
# hora Colombia, si no los primeros días del mes se ingiere el mes equivocado.
if [ -n "$1" ]; then
    MESES="$1"
else
    MESES="$(TZ=America/Bogota date +%Y-%m) $(TZ=America/Bogota date -d "$(TZ=America/Bogota date +%Y-%m-01) -1 day" +%Y-%m)"
fi

for M in $MESES; do
    # 1) LEER el árbol: lo que compras archivó a mano entra al portal.
    echo "=== $(date '+%F %T') - soportes $M (ingest) ===" >> "$LOG"
    $PYTHON scripts/ingest_soportes_drive.py --mes "$M" --commit --sembrar-destino \
        --actor cron_soportes >> "$LOG" 2>&1

    # 2) ESCRIBIR el árbol: lo que el equipo clasificó en el portal se archiva
    #    solo, en la carpeta que dice su destino. Va DESPUÉS del ingest a
    #    propósito: así no re-archiva lo que compras acababa de poner a mano.
    echo "=== $(date '+%F %T') - soportes $M (archivar) ===" >> "$LOG"
    $PYTHON scripts/archivar_en_drive.py --mes "$M" --commit \
        --actor cron_soportes >> "$LOG" 2>&1
done
echo "=== $(date '+%F %T') - done ===" >> "$LOG"

find "$LOGDIR" -name "soportes_drive_*.log" -mtime +30 -delete 2>/dev/null || true
