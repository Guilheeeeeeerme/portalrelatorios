# Evidências de API — `dados-do-empreendimento`

O relatório é um **Power BI embed** (`app.powerbi.com/reportEmbed`). As consultas analíticas são enviadas para hosts dedicados `*.pbidedicated.windows.net`, endpoint típico:

`.../QueryExecutionService/automatic/public/query`

O crawler Node (`by-empreendimento.js`) registra amostras dessas requisições em `api_evidence.query_requests` dentro de cada JSON gerado.

**Cursor IDE Browser MCP**: útil para navegação na casca do portal ANEEL; o relatório em si fica em **iframe entre origens** e normalmente **não é automatizável** por esse MCP. Use Playwright no script deste repositório para o embed.
