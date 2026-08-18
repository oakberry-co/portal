#!/bin/bash
# Portal — (1) lee las certificaciones bancarias que llegan por los portales
# públicos y extrae la cuenta oficial del proveedor, y (2) le escribe al
# proveedor lo que quedó pendiente. Corre en la VM: ahí viven tesseract, poppler,
# las credenciales de Drive y las llaves de SES; en Vercel no existe ninguna.
#
# Regla 17: el cron ES parte del módulo. Sin esto, el proveedor sube su
# certificación, nadie la lee, la cuenta nunca queda certificada y no puede
# entrar al archivo del banco — una trampa armada que solo se descubre el día
# del pago.
#
# Cada 15 min en horas de oficina: el proveedor que acaba de enviar ve su estado
# resuelto el mismo rato, no al otro día.
set -e

PORTAL="/home/daniel/proyectos/portal"
PYTHON="/usr/bin/python3"
LOGDIR="/home/daniel/proyectos/datawarehouse/logs"
LOG="$LOGDIR/certificaciones_$(date +%Y%m%d).log"
LOCKFILE="/tmp/oakberry_certificaciones.lock"

mkdir -p "$LOGDIR"

if [ -f "$LOCKFILE" ]; then
    PID=$(cat "$LOCKFILE" 2>/dev/null)
    if kill -0 "$PID" 2>/dev/null; then
        echo "=== $(date '+%F %T') - ya corriendo (PID $PID), salto ===" >> "$LOG"
        exit 0
    fi
    rm -f "$LOCKFILE"
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

cd "$PORTAL"
echo "=== $(date '+%F %T') - leer certificaciones ===" >> "$LOG"
$PYTHON scripts/leer_certificaciones.py --commit >> "$LOG" 2>&1

# Y en la misma corrida se vacía la cola de correos al proveedor: el lector acaba
# de encolar los avisos de "tu certificación no sirve", y las aprobaciones/pagos
# del portal esperan acá. Van juntos a propósito — el proveedor recibe el aviso
# el mismo rato, no al otro día.
echo "=== $(date '+%F %T') - enviar correos ===" >> "$LOG"
$PYTHON scripts/enviar_correos.py --commit >> "$LOG" 2>&1
echo "=== $(date '+%F %T') - done ===" >> "$LOG"

find "$LOGDIR" -name "certificaciones_*.log" -mtime +30 -delete 2>/dev/null || true
