#!/bin/bash
# Portal — vuelve a aprender las tarifas de retención a partir de lo que el equipo
# confirmó a mano (en el modal o subiendo el Excel): por CONCEPTO y por
# PROVEEDOR. Lo del proveedor se registra en `maestro_retenciones`.
#
# Regla 17: el cron ES parte del módulo. Sin esto las reglas se quedan en la foto
# del día que se corrió a mano — que es exactamente lo que pasó: se calcularon
# el 20-ago y ahí se congelaron. Un módulo que "aprende" y no vuelve a mirar no
# aprende: memoriza una vez y envejece.
#
# Diario a las 11:20 UTC = 6:20am Bogotá, después del refresco completo del
# portal (10:00 UTC) para que el día ya esté cerrado y las retenciones de ayer
# cuenten. No corre más seguido a propósito: esto no es urgente y una tarifa que
# cambia de un rato a otro es una tarifa en la que nadie confía.
#
# Lo que produce NO se aplica solo: alimenta la SUGERENCIA del modal de
# retenciones, que dice de dónde salió y en cuántos casos se basa. Las reglas
# que un humano fijó (fuente='humano') no se tocan nunca.
set -e

PORTAL="/home/daniel/proyectos/portal"
PYTHON="/usr/bin/python3"
LOGDIR="/home/daniel/proyectos/datawarehouse/logs"
LOG="$LOGDIR/aprender_retenciones_$(date +%Y%m%d).log"
LOCKFILE="/tmp/oakberry_aprender_retenciones.lock"

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

# El `cd` no es adorno: el script resuelve DATABASE_URL desde .env.local del
# repo. Sin esto el cron corre desde $HOME y no encuentra nada (Regla 17).
cd "$PORTAL"
echo "=== $(date '+%F %T') - aprender retenciones por CONCEPTO ===" >> "$LOG"
$PYTHON scripts/aprender_retenciones.py --aplicar >> "$LOG" 2>&1

# Y por PROVEEDOR, que va al maestro de retenciones. Los dos en la misma corrida
# a propósito: miran los mismos datos y el modal usa los dos (la tarifa del
# proveedor manda sobre la del concepto, por ser más específica).
echo "=== $(date '+%F %T') - registrar tarifas por PROVEEDOR en el maestro ===" >> "$LOG"
$PYTHON scripts/aprender_retenciones_proveedor.py --aplicar >> "$LOG" 2>&1
echo "=== $(date '+%F %T') - done ===" >> "$LOG"

find "$LOGDIR" -name "aprender_retenciones_*.log" -mtime +30 -delete 2>/dev/null || true
