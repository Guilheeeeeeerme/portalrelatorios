# Portal Relatorios

Small Node.js utility for replaying captured Power BI query templates for each empreendimento and formatting the raw responses into meaningful JSON.

The repository is intentionally scoped to these commands:

```bash
npm run dump:empreendimento-data
npm run format:empreendimento-data
npm run full:empreendimento-data
```

## Prerequisites

1. Node.js and npm installed.

```bash
node --version
npm --version
```

2. A valid Power BI `MWCToken` value.

Use only the token value in `.env`. Do not include the `MWCToken ` prefix.

3. The required input files already present in `data/`:

- `data/empreendimentos.json`
- `data/empreendimento-query-templates.json`

## Step-by-Step Setup

### Automatic Setup

Run the setup script from the repository root:

```bash
bash scripts/setup.sh
```

The script will:

- check that Node.js and npm are installed
- run `npm install`
- install Playwright Chromium browser files when `playwright` is listed in `package.json`
- create `.env` from `.env.example` when needed
- populate missing `.env` keys from `.env.example`
- prompt for `PBI_TOKEN` if it is missing
- validate the required JSON input files
- check script syntax

You can also pass the token non-interactively:

```bash
PBI_TOKEN=replace_with_current_token_value bash scripts/setup.sh
```

If you want to prepare everything except the token prompt:

```bash
SETUP_SKIP_TOKEN_PROMPT=1 bash scripts/setup.sh
```

If Playwright is listed in `package.json` but you are setting up in CI or offline and do not want browser files installed:

```bash
SETUP_SKIP_PLAYWRIGHT=1 bash scripts/setup.sh
```

### Manual Setup

1. Install dependencies.

```bash
npm install
```

2. If `playwright` is listed in `package.json`, install Chromium browser files.

```bash
npx playwright install chromium
```

3. Create the local environment file.

```bash
cp .env.example .env
```

4. Open `.env` and set `PBI_TOKEN`.

```env
PBI_TOKEN=replace_with_current_token_value
```

5. Confirm the default paths in `.env`.

```env
PBI_OUTPUT_FILE=data/empreendimentos.json
PBI_TEMPLATE_FILE=data/empreendimento-query-templates.json
PBI_EMPREENDIMENTO_OUTPUT_DIR=data/empreendimento-data
PBI_FORMATTED_OUTPUT_DIR=data/empreendimento-data-formatted
```

6. Confirm the input files exist.

```bash
test -f data/empreendimentos.json
test -f data/empreendimento-query-templates.json
```

7. Check script syntax.

```bash
node --check scripts/dump-dashboard-data.js
node --check scripts/format-dashboard-data.js
```

## Required Inputs

`data/empreendimentos.json` contains the list of empreendimentos to process.

Supported shapes:

```json
{
  "empreendimentos": [
    {
      "name": "Abil",
      "skUsinaLeilao": "optional-value"
    }
  ]
}
```

or:

```json
{
  "items": ["Abil", "Acacia"]
}
```

`data/empreendimento-query-templates.json` must contain a `templates` array with captured Power BI query payloads.

Templates may use these placeholders:

- `__SK_USINA_LEILAO__`
- `__EMPREENDIMENTO__`
- `__EMPREENDIMENTO_LITERAL__`

## Environment Reference

Required Power BI connection variables:

- `PBI_BASE_URL`
- `PBI_CAPACITY_ID`
- `PBI_WORKLOAD`
- `PBI_SERVICE`
- `PBI_VISIBILITY`
- `PBI_TOKEN`

Optional paths and run controls:

- `PBI_OUTPUT_FILE`: defaults to `data/empreendimentos.json`
- `PBI_TEMPLATE_FILE`: defaults to `data/empreendimento-query-templates.json`
- `PBI_EMPREENDIMENTO_OUTPUT_DIR`: defaults to `data/empreendimento-data`
- `PBI_FORMATTED_OUTPUT_DIR`: defaults to `data/empreendimento-data-formatted`
- `PBI_START_INDEX`: defaults to `0`
- `PBI_END_INDEX`: optional inclusive end index for chunked runs
- `PBI_VALIDATE_SAMPLE_SIZE`: defaults to `10`

## Execution

### Option 1: Full Run

Use this when the token is valid and you want to dump raw data and immediately format it.

```bash
npm run full:empreendimento-data
```

This runs:

```bash
npm run dump:empreendimento-data
npm run format:empreendimento-data
```

Outputs:

- Raw Power BI responses: `data/empreendimento-data/<index>-<slug>.json`
- Formatted JSON: `data/empreendimento-data-formatted/<index>-<slug>.json`
- Formatting summary: `data/empreendimento-data-formatted-summary.json`

### Option 2: Dump Only

Use this when you only want to call Power BI and save raw responses.

```bash
npm run dump:empreendimento-data
```

The command reads:

- `PBI_OUTPUT_FILE`
- `PBI_TEMPLATE_FILE`
- `PBI_START_INDEX`
- `PBI_END_INDEX`

It writes raw files to:

```text
data/empreendimento-data/
```

### Option 3: Format Only

Use this when raw files already exist and you only want to regenerate formatted JSON.

```bash
npm run format:empreendimento-data
```

The command reads:

```text
data/empreendimento-data/
```

It writes:

```text
data/empreendimento-data-formatted/
data/empreendimento-data-formatted-summary.json
```

## Chunked or Resumable Runs

Use `PBI_START_INDEX` and `PBI_END_INDEX` in `.env` to process part of the list.

Example: process items 0 through 99.

```env
PBI_START_INDEX=0
PBI_END_INDEX=99
```

Then run:

```bash
npm run dump:empreendimento-data
```

Example: resume from item 100 and continue to the end.

```env
PBI_START_INDEX=100
# PBI_END_INDEX=99
```

Then run:

```bash
npm run dump:empreendimento-data
```

After all chunks are dumped, format everything:

```bash
npm run format:empreendimento-data
```

## Validate the Result

1. Check that raw files were created.

```bash
find data/empreendimento-data -name '*.json' | wc -l
```

2. Check that formatted files were created.

```bash
find data/empreendimento-data-formatted -name '*.json' | wc -l
```

3. Inspect the summary.

```bash
sed -n '1,120p' data/empreendimento-data-formatted-summary.json
```

4. Inspect one formatted file.

```bash
sed -n '1,160p' data/empreendimento-data-formatted/0000-abil.json
```

## Troubleshooting

- `Missing required environment variables`: fill the missing values in `.env`.
- `No templates found`: check `PBI_TEMPLATE_FILE` and confirm it contains a `templates` array.
- `ENOENT` for `data/empreendimentos.json`: check `PBI_OUTPUT_FILE`.
- HTTP errors in raw output: refresh `PBI_TOKEN` and rerun the affected chunk.
- Unexpected formatted fields: inspect the matching raw file and the template descriptor returned by Power BI.

## Notes

- `npm run dump:empreendimento-data` and `npm run full:empreendimento-data` call the live Power BI endpoint.
- `npm run format:empreendimento-data` is local-only and does not call Power BI.
- Generated data can be large. Review JSON output intentionally before committing it.
