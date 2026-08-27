#!/usr/bin/env bash
# GASTOS PERIÓDICOS — crea el documento del mes de cada gasto que se repite.
#
# Cron (VM, crontab del usuario):
#   35 11 * * *  /home/daniel/proyectos/portal/scripts/gastos_periodicos.sh   # 11:35 UTC = 6:35am Bogotá
#
# El `cd` NO es cosmético: el script busca `.env.local` y compila `lib/` con
# rutas relativas a la raíz del repo, y el cwd de cron no es el del repo (esto ya
# nos mordió dos veces — Regla 17).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs
LOG="logs/gastos_periodicos_$(date -u +%Y%m%d).log"
{
  echo "── $(date -u +'%Y-%m-%dT%H:%M:%SZ') (UTC) ──"
  node scripts/generar_gastos_periodicos.js --aplicar
} >> "$LOG" 2>&1
