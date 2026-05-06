const { LABEL_TO_FIELD, KNOWN_LABELS } = require("../schemas/label-map.js");

function parseBrazilianDate(s) {
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return String(s);
  const [, dd, mm, yyyy] = m;
  const d = String(dd).padStart(2, "0");
  const mo = String(mm).padStart(2, "0");
  return `${yyyy}-${mo}-${d}`;
}

function parseNumberLoose(s) {
  const t = String(s).trim();
  if (!t) return null;
  if (t.endsWith("%")) {
    return parseFloat(t.replace("%", "").replace(",", ".").trim());
  }
  if (/k$/i.test(t)) return null;
  if (t.includes(",") && !t.includes(".")) {
    return parseFloat(t.replace(/\./g, "").replace(",", "."));
  }
  if (t.includes(".") && !t.includes(",")) {
    return parseFloat(t);
  }
  if (t.includes(".") && t.includes(",")) {
    return parseFloat(t.replace(/\./g, "").replace(",", "."));
  }
  const n = parseFloat(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * "94,201K" / "185,648K" → { raw, value } per README (comma as thousands).
 */
function parseKMoney(raw) {
  const s = String(raw).trim();
  const base = s.replace(/k$/i, "").trim();
  const digits = base.replace(/,/g, "");
  const value = digits ? Number.parseInt(digits, 10) : NaN;
  return {
    raw: s,
    value: Number.isFinite(value) ? value : null,
  };
}

/** Potência / preço sometimes show as `93K` or `220.60K` in the visual. */
function parseMetricValue(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const base = t.replace(/k$/i, "").trim();
  return parseNumberLoose(base);
}

function buildStructured(byField, filterValue) {
  const nome =
    byField.empreendimento_nome != null ? String(byField.empreendimento_nome) : filterValue;

  return {
    empreendimento: {
      nome,
      vendedora: byField.vendedora ?? null,
      localidade: byField.localidade ?? null,
      uf: byField.uf ?? null,
      fonte: byField.fonte ?? null,
      status: byField.status ?? null,
    },
    energia: {
      potencia_mw: parseMetricValue(byField.potencia_mw),
      garantia_fisica_mwm: parseMetricValue(byField.garantia_fisica_mwm),
      energia_vendida_mwm: parseMetricValue(byField.energia_vendida_mwm),
    },
    financeiro: {
      preco_rs_mwm: parseMetricValue(byField.preco_rs_mwm),
      desagio_percentual:
        byField.desagio_percentual != null
          ? parseNumberLoose(String(byField.desagio_percentual))
          : null,
      investimento_previsto_rs: parseKMoney(String(byField.investimento_previsto_rs ?? "")),
      atual_ipca_rs: parseKMoney(String(byField.atual_ipca_rs ?? "")),
    },
    leilao: {
      numero: byField.leilao_numero != null ? String(byField.leilao_numero) : null,
      tipo: byField.tipo_leilao != null ? String(byField.tipo_leilao) : null,
      data_leilao: byField.data_leilao
        ? parseBrazilianDate(String(byField.data_leilao))
        : null,
      data_homologacao: byField.data_homologacao
        ? parseBrazilianDate(String(byField.data_homologacao))
        : null,
    },
    outorga: {
      ato: byField.ato_outorga != null ? String(byField.ato_outorga) : null,
      data_outorga: byField.data_outorga
        ? parseBrazilianDate(String(byField.data_outorga))
        : null,
      data_inicio_operacao: byField.data_inicio_operacao
        ? parseBrazilianDate(String(byField.data_inicio_operacao))
        : null,
    },
  };
}

/**
 * @param {string} text - `innerText` of the Power BI frame body (dropdown closed).
 * @param {string} filterValue - selected empreendimento name
 */
function parseVisualCardText(text, filterValue) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  /** Cards use value-then-label; the title/slicer block also contains "…\nEmpreendimento\n". Require the real card row: nome, Empreendimento, …, Vendedora. */
  let start = -1;
  for (let i = 0; i < lines.length - 3; i++) {
    if (lines[i + 1] !== "Empreendimento") continue;
    if (lines[i] === "Empreendimento") continue;
    if (lines[i] === "Dados por Empreendimento") continue;
    if (lines[i + 3] === "Vendedora") {
      start = i;
      break;
    }
  }
  if (start < 0) {
    return { raw_cards: [], data: null, error: "card_section_not_found" };
  }

  const raw_cards = [];
  for (let j = start; j < lines.length - 1; j += 2) {
    const value = lines[j];
    const label = lines[j + 1];
    if (!KNOWN_LABELS.has(label)) break;
    raw_cards.push({ label, value });
  }

  const byField = {};
  for (const { label, value } of raw_cards) {
    const key = LABEL_TO_FIELD[label];
    if (key) byField[key] = value;
  }

  const data = buildStructured(byField, filterValue);
  return { raw_cards, data };
}

module.exports = {
  parseVisualCardText,
  parseBrazilianDate,
};
