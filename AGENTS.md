# Agent Instructions

## Scope

- Visual crawl + JSON export for **Dados do Empreendimento** (Power BI embed):

  `npm run crawl:dados-empreendimento`

- Overnight / self-healing (retries on failure, stops when crawl exits 0):

  `npm run crawl:dados-empreendimento:until-done`

  Optional: `CRAWL_RETRY_SECONDS=120 npm run crawl:dados-empreendimento:until-done -- --quiet`

- Optional flags: `--only=Nome`, `--max=N`, `--force`, `--screenshots`, `--headed`, `--quiet`, `--fast`, `--settle-ms=N`, `--resume`, `--refresh-options`
- Checkpoint file: `data/resultados-leiloes-geracao/dados-do-empreendimento/crawl-state.json` (created if missing; updated after each item / skip). It also stores `option_names` after a full dropdown scan so **`--resume` can skip the slow scroll**; use `--refresh-options` to rescan the slicer list.

- Do not reintroduce a Fastify API or other unrelated servers unless the user asks.

- Never commit real `.env` secrets.

## Verification

```bash
node --check src/pages/resultados-leiloes-geracao/reports/dados-do-empreendimento/crawlers/by-empreendimento.js
node --check src/pages/resultados-leiloes-geracao/reports/dados-do-empreendimento/parsers/visual-cards-parser.js
```

## Browser automation

- **Cursor IDE Browser MCP** helps with the outer ANEEL shell; the report lives in a **cross-origin Power BI iframe** and is driven by **Playwright** in `by-empreendimento.js`.

## Data

- Generated files under `data/resultados-leiloes-geracao/dados-do-empreendimento/by-empreendimento/`. Preserve them unless the task is to regenerate.
