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
# Uso:  soportes_drive.sh            # mes en curso + anterior
#       soportes_drive.sh 2026-03    # un mes puntual
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

# La VM vive en UTC pero el negocio en Bogotá (Regla 1): el mes se calcula en
# hora Colombia, si no los primeros días del mes se ingiere el mes equivocado.
if [ -n "$1" ]; then
    MESES="$1"
else
    MESES="$(TZ=America/Bogota date +%Y-%m) $(TZ=America/Bogota date -d "$(TZ=America/Bogota date +%Y-%m-01) -1 day" +%Y-%m)"
fi

cd "$PORTAL"
for M in $MESES; do
    echo "=== $(date '+%F %T') - soportes $M ===" >> "$LOG"
    $PYTHON scripts/ingest_soportes_drive.py --mes "$M" --commit --sembrar-destino \
        --actor cron_soportes >> "$LOG" 2>&1
done
echo "=== $(date '+%F %T') - done ===" >> "$LOG"

find "$LOGDIR" -name "soportes_drive_*.log" -mtime +30 -delete 2>/dev/null || true
