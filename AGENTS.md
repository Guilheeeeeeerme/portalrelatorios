# Agent Instructions

## Scope

- Visual crawl + JSON export for **Dados do Empreendimento** (Power BI embed):

  `npm run crawl:dados-empreendimento`

- Optional flags: `--only=Nome`, `--max=N`, `--force`, `--screenshots`, `--headed`, `--quiet`, `--fast`, `--settle-ms=N`, `--resume`
- Checkpoint file: `data/resultados-leiloes-geracao/dados-do-empreendimento/crawl-state.json` (created if missing; updated after each item / skip).

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
