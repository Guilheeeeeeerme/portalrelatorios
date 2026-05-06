#!/usr/bin/env bash
# Zombie crawl: run one Playwright pass, retry on non-zero until exit 0.
#
#   npm run crawl:dados-empreendimento
#   npm run crawl:dados-empreendimento:headed
#
# Usage (from repo root):
#   bash scripts/crawl-dados-empreendimento-until-done.sh
#   bash scripts/crawl-dados-empreendimento-until-done.sh --headed --fast
#   CRAWL_RETRY_SECONDS=120 bash scripts/crawl-dados-empreendimento-until-done.sh --quiet
#
# Extra CLI args are appended after fixed flags, e.g. --quiet --refresh-options --max=5
#
# Fresh checkpoint: delete
#   data/resultados-leiloes-geracao/dados-do-empreendimento/crawl-state.json

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CRAWLER="src/pages/resultados-leiloes-geracao/reports/dados-do-empreendimento/crawlers/by-empreendimento.js"
RETRY_SEC="${CRAWL_RETRY_SECONDS:-90}"

fixed=(--resume --fast --settle-ms=3000)
extra=("$@")

until node "$ROOT/$CRAWLER" "${fixed[@]}" "${extra[@]}"; do
  status=$?
  echo "[$(date -Iseconds)] crawl exited ${status} — sleeping ${RETRY_SEC}s, then retry (Ctrl+C to stop)" >&2
  sleep "$RETRY_SEC"
done

echo "[$(date -Iseconds)] crawl finished successfully (exit 0). Nothing left to do or run completed cleanly." >&2
