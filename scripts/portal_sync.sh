#!/bin/bash
# Portal conciliación — sync BQ→Postgres (Neon). Corre en la VM por cron.
#   - ciclo frecuente (horas de oficina): atiende el botón + trae facturas nuevas
#   - diario (--full): refresco histórico completo de propuestas
# La app NO se monta sobre BQ; este es el único puente. Lockfile evita solaparse.
#
# Uso:  portal_sync.sh          # ciclo reciente (45d)
#       portal_sync.sh --full   # refresco completo
set -e

PORTAL="/home/daniel/proyectos/portal"
PYTHON="/usr/bin/python3"
LOGDIR="/home/daniel/proyectos/datawarehouse/logs"
DATE=$(date +%Y%m%d)
LOG="$LOGDIR/portal_sync_${DATE}.log"
LOCKFILE="/tmp/oakberry_portal_sync.lock"

mkdir -p "$LOGDIR"

if [ -f "$LOCKFILE" ]; then
    PID=$(cat "$LOCKFILE" 2>/dev/null)
    if kill -0 "$PID" 2>/dev/null; then
        echo "=== $(date '+%F %T') - portal_sync ya corriendo (PID $PID), salto ===" >> "$LOG"
        exit 0
    fi
    rm -f "$LOCKFILE"
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

echo "=== $(date '+%F %T') - portal_sync $* ===" >> "$LOG"
cd "$PORTAL"
$PYTHON scripts/portal_sync_cron.py "$@" >> "$LOG" 2>&1
echo "=== $(date '+%F %T') - done ===" >> "$LOG"

find "$LOGDIR" -name "portal_sync_*.log" -mtime +30 -delete 2>/dev/null || true
