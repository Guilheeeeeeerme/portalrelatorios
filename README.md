# Power BI query wrapper (Node.js)

This project provides a small Node.js wrapper API around the Power BI QueryExecutionService request.

## Why Fastify

- Very fast and lightweight for API wrappers
- Minimal setup and clean route handlers
- Good logging defaults for production/debugging

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your env file:

```bash
cp .env.example .env
```

3. Fill `PBI_TOKEN` in `.env` with your current MWC token value (without `MWCToken ` prefix).

## Run

```bash
npm run start
```

Server starts on `http://localhost:3000` by default.

## Endpoints

- `GET /health`
- `POST /powerbi/query`
- `POST /powerbi/query/all/start`
- `GET /powerbi/query/all/status/:jobId`

### `POST /powerbi/query` body

You can override the two filter values:

```json
{
  "skFonteEnergia": "0D",
  "skUsinaLeilao": "0D"
}
```

If omitted, both default to `"0D"`.

### Example request to wrapper

```bash
curl -X POST "http://localhost:3000/powerbi/query" \
  -H "content-type: application/json" \
  -d '{"skFonteEnergia":"0D","skUsinaLeilao":"0D"}'
```

## Background sequential loading (all upcoming items)

This mode starts a background job that keeps calling Power BI in sequence using `RestartTokens` until pagination ends.

1. Start background load:

```bash
curl -X POST "http://localhost:3000/powerbi/query/all/start" \
  -H "content-type: application/json" \
  -d '{"skFonteEnergia":"0D","skUsinaLeilao":"0D","dataVolume":500}'
```

2. Poll status:

```bash
curl "http://localhost:3000/powerbi/query/all/status/<jobId>"
```

When complete, the job response includes:

- `pagesLoaded`
- `itemsLoaded`
- `result.items` with aggregated rows

## Dump to JSON (project goal)

To generate a local JSON dump of all `Empreendimento` names, run:

```bash
npm run dump:empreendimentos
```

This script:

- Calls Power BI `QueryExecutionService` in sequence
- Uses `RestartTokens` to paginate all pages
- Collects and de-duplicates `Empreendimento` values
- Saves output to `data/empreendimentos.json` (configurable via `PBI_OUTPUT_FILE`)

## Playwright bootstrap

Install browsers once:

```bash
npx playwright install chromium
```

Run bootstrap:

```bash
npm run pw:bootstrap
```

This step opens the portal and stores required config from `.env` in browser localStorage as `pbi.config`.
# portalrelatorios
