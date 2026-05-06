# Evidências de API — `dados-do-empreendimento`

O relatório é um **Power BI embed** (`app.powerbi.com/reportEmbed`). As consultas analíticas são enviadas para hosts dedicados `*.pbidedicated.windows.net`, endpoint típico:

`.../QueryExecutionService/automatic/public/query`

**Cursor IDE Browser MCP**: navegação na casca ANEEL; o relatório fica em **iframe**. Para **inspecionar rede**, use a ferramenta **browser_network_requests** do MCP no mesmo sandbox — pode não mostrar todo tráfego do iframe embed como o Chromium faz por dentro.

## Lista de Empreendimentos (`option_names`)

O crawler **`by-empreendimento.js`** mantém `option_names` em `crawl-state.json` **incrementalmente**: cada vez que o dropdown mostra novos `[role=option]`, os rótulos são fundidos na lista (scroll no virtual list até estagnação, com reaberturas desde o topo).

Para só descobrir rótulos sem gerar JSON por linha, chame o crawler com **`--dry-list`** (sem script npm dedicado):

```bash
node src/pages/resultados-leiloes-geracao/reports/dados-do-empreendimento/crawlers/by-empreendimento.js --dry-list
```

Opcional: validação de piso após descoberta — variável de ambiente `CRAWL_MIN_EXPECTED_OPTIONS` (ex.: `1500`) ou `--allow-small-list` em desenvolvimento.

O embed continua emitindo `/query` para `*.pbidedicated.windows.net`; isso não é capturado nem gravado nos JSONs exportados.
