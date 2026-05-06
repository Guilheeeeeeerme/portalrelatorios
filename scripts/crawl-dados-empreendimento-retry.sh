#!/usr/bin/env bash
# Retry crawl: run one Playwright pass, retry on non-zero until exit 0.
#
#   npm run crawl:dados-empreendimento:retry
#   npm run crawl:dados-empreendimento:retry:headed
#
# Usage (from repo root):
#   bash scripts/crawl-dados-empreendimento-retry.sh
#   bash scripts/crawl-dados-empreendimento-retry.sh --headed --fast
#   CRAWL_RETRY_SECONDS=120 bash scripts/crawl-dados-empreendimento-retry.sh --quiet
#
# Extra CLI args are appended after the fixed retry flags, e.g. --quiet --refresh-options --max=5
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

log_attempt() {
  printf '[%s] crawl attempt: node %q' "$(date -Iseconds)" "$ROOT/$CRAWLER" >&2
  for arg in "${fixed[@]}" "${extra[@]}"; do
    printf ' %q' "$arg" >&2
  done
  printf '\n' >&2
}

while true; do
  log_attempt
  node "$ROOT/$CRAWLER" "${fixed[@]}" "${extra[@]}"
  status=$?
  if [ "$status" -eq 0 ]; then
    break
  fi
  echo "[$(date -Iseconds)] crawl exited ${status} — sleeping ${RETRY_SEC}s, then retry (Ctrl+C to stop)" >&2
  sleep "$RETRY_SEC"
done

echo "[$(date -Iseconds)] crawl finished successfully (exit 0). Nothing left to do or run completed cleanly." >&2
