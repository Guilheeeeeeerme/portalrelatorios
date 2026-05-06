# Objetivo do Projeto

Este projeto deve fazer apenas uma coisa:

> Extrair dados estruturados dos relatórios do portal da ANEEL e salvar esses dados em JSON.

Tudo que não estiver diretamente relacionado a esse objetivo pode ser removido, ignorado ou simplificado.

A solução inicial deve funcionar como um crawler visual usando Playwright, mas também deve investigar se existe uma API interna reutilizável para substituir ou complementar o crawler no futuro.

---

# Contexto

O portal possui múltiplas páginas, relatórios e filtros.

Por isso, a arquitetura deve ser organizada por:

```txt
pagina
↓
relatorio
↓
filtro
↓
opcao do filtro
↓
dados extraidos
```

Essa divisão é importante porque futuramente podemos precisar adicionar novos relatórios do mesmo site sem reescrever tudo.

Exemplo inicial:

```txt
Página: Resultados de Leilões - Geração
Relatório: Dados do Empreendimento
Filtro: Empreendimento
Opção do filtro: Abil
```

Essa combinação deve gerar nomes previsíveis como:

```txt
resultados-leiloes-geracao/
  dados-do-empreendimento/
    by-empreendimento/
      abil.json
```

---

# Página Inicial

Abrir:

```txt
https://portalrelatorios.aneel.gov.br/resultadosLeiloes/leiloesGeracaoPortugues#
```

Nome técnico da página:

```txt
resultados-leiloes-geracao
```

---

# Relatório Inicial

Selecionar o relatório:

```txt
Dados do Empreendimento
```

Nome técnico:

```txt
dados-do-empreendimento
```

---

# Filtro Inicial

Usar o filtro:

```txt
Empreendimento
```

Nome técnico:

```txt
empreendimento
```

Crawler técnico:

```txt
dados-do-empreendimento-by-empreendimento
```

---

# Regra de Naming

Todos os nomes devem seguir:

* lowercase
* kebab-case para arquivos, pastas e scripts
* snake_case para chaves JSON
* sem acentos
* sem espaços
* sem caracteres especiais

Exemplos:

```txt
Dados do Empreendimento
→ dados-do-empreendimento

Empreendimento
→ empreendimento

Dados do Empreendimento filtrado por Empreendimento
→ dados-do-empreendimento-by-empreendimento
```

---

# Estrutura Recomendada de Pastas

```txt
src/
  pages/
    resultados-leiloes-geracao/
      reports/
        dados-do-empreendimento/
          crawlers/
            by-empreendimento.ts
          parsers/
            visual-cards-parser.ts
          schemas/
            dados-do-empreendimento.schema.ts
          samples/
            abil.raw.json
            abil.parsed.json

data/
  resultados-leiloes-geracao/
    dados-do-empreendimento/
      by-empreendimento/
        abil.json

research/
  api-inspection/
    resultados-leiloes-geracao/
      dados-do-empreendimento/
        network-samples/
        endpoints.md
```

---

# Estratégia Principal

Use Playwright como crawler manual automatizado.

O crawler deve:

1. abrir a página
2. selecionar o relatório
3. identificar opções disponíveis no filtro
4. iterar por cada opção do filtro
5. aguardar a visualização carregar
6. capturar os dados visuais
7. converter para JSON
8. salvar o resultado

---

# Estratégia Secundária: Inspeção da API

Enquanto o crawler roda, também deve inspecionar a API.

Monitore:

* XHR
* fetch
* payloads
* query params
* headers relevantes
* endpoints
* responses
* paginação
* IDs internos
* filtros enviados
* formato dos dados retornados

Mas essa investigação não deve bloquear o crawler visual.

Prioridade:

```txt
1. Coletar dados via Playwright visual
2. Em paralelo, descobrir API
3. Depois, se possível, substituir parsing visual por API
```

---

# Regra Importante

Mesmo que uma API seja encontrada, continue processando via crawler visual inicialmente.

Só substitua o fluxo visual por API quando houver evidência suficiente de que:

* a API retorna todos os campos necessários
* os valores batem com a visualização
* os filtros são reproduzíveis
* a resposta é estável
* não há campos calculados apenas no front-end

---

# Fluxo Inicial Detalhado

Para o relatório:

```txt
Dados do Empreendimento
```

e para o filtro:

```txt
Empreendimento
```

executar:

```txt
for each empreendimento in filtroEmpreendimento:
  selecionar empreendimento
  aguardar carregamento
  extrair cards visuais
  converter cards para JSON
  salvar em data/resultados-leiloes-geracao/dados-do-empreendimento/by-empreendimento/{empreendimento}.json
```

Exemplo:

```txt
Empreendimento: Abil

Output:
data/resultados-leiloes-geracao/dados-do-empreendimento/by-empreendimento/abil.json
```

---

# Como Interpretar a Visualização

A tela é formada por cards.

Cada card geralmente tem:

```txt
ícone
valor principal
descrição do campo
```

Exemplo:

```txt
Abil
Empreendimento
```

Significa:

```txt
campo = Empreendimento
valor = Abil
```

No JSON:

```json
{
  "empreendimento": "Abil"
}
```

---

# O Que Ignorar

Na extração visual, ignore:

* ícones
* cores
* alinhamento
* grid
* largura dos cards
* altura dos cards
* espaçamento
* fontes
* decoração visual

Extraia apenas:

```txt
campo -> valor
```

---

# Normalização de Campos

Converta descrições visuais para chaves JSON em snake_case.

Exemplos:

```txt
Empreendimento -> empreendimento
Vendedora -> vendedora
Localidade -> localidade
UF -> uf
Fonte -> fonte
Status -> status
Potência (MW) -> potencia_mw
Garantia Física(MWm) -> garantia_fisica_mwm
Energia Vendida(MWm) -> energia_vendida_mwm
Preço(R$/MWm) -> preco_rs_mwm
Deságio(%) -> desagio_percentual
Invest. Previsto(R$) -> investimento_previsto_rs
Atual. IPCA(R$) -> atual_ipca_rs
Leilão -> leilao
Tipo Leilão -> tipo_leilao
Data do Leilão -> data_leilao
Data de Homologação -> data_homologacao
Ato de Outorga -> ato_outorga
Data de Outorga -> data_outorga
Data Início Operação -> data_inicio_operacao
```

---

# Conversão de Tipos

## Texto

```txt
Abil -> "Abil"
Renova Energia S.A. -> "Renova Energia S.A."
BA -> "BA"
LER -> "LER"
```

## Número

```txt
24 -> 24
11.00 -> 11.00
105.20 -> 105.20
```

## Percentual

```txt
10.08% -> 10.08
```

Usar a chave com sufixo:

```json
{
  "desagio_percentual": 10.08
}
```

## Datas

Converter datas brasileiras:

```txt
23/08/2013
```

para ISO:

```txt
2013-08-23
```

## Valores abreviados com K

Quando aparecer:

```txt
94,201K
185,648K
```

preservar o valor original e também o valor normalizado.

Exemplo:

```json
{
  "investimento_previsto": {
    "raw": "94,201K",
    "value": 94201,
    "unit": "R$"
  }
}
```

Não assuma multiplicação por mil sem confirmar a semântica do portal.

---

# Exemplo de Conversão Visual para JSON

Visualização:

```txt
Abil
Empreendimento

Renova Energia S.A.
Vendedora

Caetité
Localidade

BA
UF

Eólica
Fonte

Operação
Status

24
Potência (MW)

11.00
Garantia Física(MWm)

11.00
Energia Vendida(MWm)

105.20
Preço(R$/MWm)

10.08%
Deságio(%)

94,201K
Invest. Previsto(R$)

185,648K
Atual. IPCA(R$)

5/2013
Leilão

LER
Tipo Leilão

23/08/2013
Data do Leilão

19/11/2013
Data de Homologação

Portaria MME nº 109
Ato de Outorga

19/03/2014
Data de Outorga

2/10/2022
Data Início Operação
```

Resultado JSON recomendado:

```json
{
  "metadata": {
    "source_page": "resultados-leiloes-geracao",
    "source_url": "https://portalrelatorios.aneel.gov.br/resultadosLeiloes/leiloesGeracaoPortugues#",
    "report": "dados-do-empreendimento",
    "filter": "empreendimento",
    "filter_value": "Abil",
    "extraction_method": "playwright-visual-crawler"
  },
  "data": {
    "empreendimento": {
      "nome": "Abil",
      "vendedora": "Renova Energia S.A.",
      "localidade": "Caetité",
      "uf": "BA",
      "fonte": "Eólica",
      "status": "Operação"
    },
    "energia": {
      "potencia_mw": 24,
      "garantia_fisica_mwm": 11.0,
      "energia_vendida_mwm": 11.0
    },
    "financeiro": {
      "preco_rs_mwm": 105.2,
      "desagio_percentual": 10.08,
      "investimento_previsto_rs": {
        "raw": "94,201K",
        "value": 94201
      },
      "atual_ipca_rs": {
        "raw": "185,648K",
        "value": 185648
      }
    },
    "leilao": {
      "numero": "5/2013",
      "tipo": "LER",
      "data_leilao": "2013-08-23",
      "data_homologacao": "2013-11-19"
    },
    "outorga": {
      "ato": "Portaria MME nº 109",
      "data_outorga": "2014-03-19",
      "data_inicio_operacao": "2022-10-02"
    }
  },
  "raw_cards": [
    {
      "label": "Empreendimento",
      "value": "Abil"
    },
    {
      "label": "Vendedora",
      "value": "Renova Energia S.A."
    },
    {
      "label": "Localidade",
      "value": "Caetité"
    }
  ]
}
```

---

# Requisitos de Qualidade

Cada extração deve salvar:

1. JSON final normalizado
2. dados brutos extraídos dos cards
3. screenshot opcional para auditoria
4. logs do filtro utilizado
5. evidências de API, se existirem

---

# Formato de Saída por Item

Cada arquivo deve conter:

```json
{
  "metadata": {},
  "data": {},
  "raw_cards": [],
  "api_evidence": {}
}
```

---

# Exemplo de Arquivo

Para:

```txt
Página: Resultados de Leilões - Geração
Relatório: Dados do Empreendimento
Filtro: Empreendimento
Valor: Abil
```

Salvar em:

```txt
data/resultados-leiloes-geracao/dados-do-empreendimento/by-empreendimento/abil.json
```

---

# Comportamento Esperado do Agente

O agente deve:

* ser incremental
* criar código pequeno e testável
* evitar overengineering
* manter o projeto focado
* remover código morto
* documentar decisões
* não criar funcionalidades fora do escopo
* não misturar relatórios diferentes
* não misturar filtros diferentes
* não sobrescrever dados sem necessidade
* manter outputs previsíveis

---

# Definição de Pronto

A primeira versão estará pronta quando conseguir:

1. abrir o portal
2. selecionar `Dados do Empreendimento`
3. iterar opções do filtro `Empreendimento`
4. extrair pelo menos o item `Abil`
5. converter a visualização para JSON
6. salvar arquivo com nome e pasta corretos
7. registrar evidências básicas de network/API
8. permitir extensão futura para outros relatórios e filtros
