/** Visual card labels (Portuguese) → normalized snake_case field keys. */

const LABEL_TO_FIELD = {
  Empreendimento: "empreendimento_nome",
  Vendedora: "vendedora",
  Localidade: "localidade",
  UF: "uf",
  Fonte: "fonte",
  Status: "status",
  "Potência (MW)": "potencia_mw",
  "Garantia Física(MWm)": "garantia_fisica_mwm",
  "Energia Vendida(MWm)": "energia_vendida_mwm",
  "Preço(R$/MWm)": "preco_rs_mwm",
  "Deságio(%)": "desagio_percentual",
  "Invest. Previsto(R$)": "investimento_previsto_rs",
  "Atual. IPCA(R$)": "atual_ipca_rs",
  Leilão: "leilao_numero",
  "Tipo Leilão": "tipo_leilao",
  "Data do Leilão": "data_leilao",
  "Data de Homologação": "data_homologacao",
  "Ato de Outorga": "ato_outorga",
  "Data de Outorga": "data_outorga",
  "Data Início Operação": "data_inicio_operacao",
};

const KNOWN_LABELS = new Set(Object.keys(LABEL_TO_FIELD));

module.exports = { LABEL_TO_FIELD, KNOWN_LABELS };
