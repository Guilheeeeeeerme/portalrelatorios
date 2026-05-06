/**
 * Documentação do formato normalizado produzido pelo parser visual.
 * Validação em runtime não é obrigatória na primeira versão.
 */

const OUTPUT_SHAPE = {
  metadata: [
    "source_page",
    "source_url",
    "report",
    "filter",
    "filter_value",
    "extraction_method",
    "generated_at",
    "crawl_log",
  ],
  data: ["empreendimento", "energia", "financeiro", "leilao", "outorga"],
};

module.exports = { OUTPUT_SHAPE };
