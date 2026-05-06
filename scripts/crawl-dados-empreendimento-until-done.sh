#!/usr/bin/env bash
# Re-run the Empreendimento crawl with --resume until it exits 0 (success).
# On failure (network, parse error, etc.), wait and retry so an overnight run can self-heal.
#
# Usage (from repo root):
#   bash scripts/crawl-dados-empreendimento-until-done.sh
#   CRAWL_RETRY_SECONDS=120 bash scripts/crawl-dados-empreendimento-until-done.sh --quiet
#
# Extra args are passed after the fixed flags, e.g. --refresh-options

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RETRY_SEC="${CRAWL_RETRY_SECONDS:-90}"

fixed=(--resume --fast)
extra=("$@")

until npm run crawl:dados-empreendimento -- "${fixed[@]}" "${extra[@]}"; do
  status=$?
  echo "[$(date -Iseconds)] crawl exited ${status} — sleeping ${RETRY_SEC}s, then retry (Ctrl+C to stop)" >&2
  sleep "$RETRY_SEC"
done

echo "[$(date -Iseconds)] crawl finished successfully (exit 0). Nothing left to do or run completed cleanly." >&2
