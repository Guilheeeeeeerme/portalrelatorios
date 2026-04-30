const { chromium } = require("playwright");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
require("dotenv").config();

function walk(value, visitor, pathParts = []) {
  if (!value || typeof value !== "object") return;
  visitor(value, pathParts);
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, visitor, [...pathParts, String(i)]));
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    walk(v, visitor, [...pathParts, k]);
  }
}

function collectEmpreendimentoLiteralPaths(payload) {
  const paths = [];
  walk(payload, (node, pathParts) => {
    if (!node || typeof node !== "object") return;
    const prop = node?.Condition?.Comparison?.Left?.Column?.Property;
    const literal = node?.Condition?.Comparison?.Right?.Literal?.Value;
    if (prop === "SkUsinaLeilao" && typeof literal === "string") {
      paths.push({
        path: [...pathParts, "Condition", "Comparison", "Right", "Literal", "Value"],
        currentValue: literal,
      });
    }
  });
  return paths;
}

function setPathValue(target, pathParts, newValue) {
  let ref = target;
  for (let i = 0; i < pathParts.length - 1; i += 1) {
    ref = ref[pathParts[i]];
    if (ref === undefined) return false;
  }
  ref[pathParts[pathParts.length - 1]] = newValue;
  return true;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function main() {
  const targetUrl =
    process.env.PW_TARGET_URL ||
    "https://portalrelatorios.aneel.gov.br/resultadosLeiloes/leiloesGeracaoPortugues#!";
  const endpointContains = "/QueryExecutionService/automatic/public/query";
  const selectedEmpreendimento = process.env.PBI_CAPTURE_VALUE || "";
  const empreFile = path.resolve(process.env.PBI_OUTPUT_FILE || "data/empreendimentos.json");
  const outputFile = path.resolve(process.env.PBI_TEMPLATE_FILE || "data/dashboard-query-templates.json");
  const warmupMs = Number(process.env.PBI_CAPTURE_WAIT_MS || 12000);
  const headless = process.env.PW_HEADLESS === "true";
  const debugAllPayloads = process.env.PBI_CAPTURE_DEBUG_ALL === "true";

  const browser = await chromium.launch({ headless, slowMo: Number(process.env.PW_SLOW_MO || 50) });
  const context = await browser.newContext();
  const page = await context.newPage();

  const captured = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    if (!request.url().includes(endpointContains)) return;
    const postData = request.postData();
    if (!postData) return;
    try {
      const payload = JSON.parse(postData);
      captured.push({
        capturedAt: new Date().toISOString(),
        url: request.url(),
        payload,
      });
    } catch {
      // ignore non-json payloads
    }
  });

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  const targetTab = process.env.PBI_CAPTURE_TAB || "Dados do Empreendimento";
  try {
    await page.getByRole("link", { name: targetTab }).click({ timeout: 5000 });
    await page.waitForTimeout(1500);
  } catch {
    // Keep going if tab link is not interactable.
  }
  await page.waitForTimeout(warmupMs);

  const uniqueByPayload = [];
  const seen = new Set();
  for (const item of captured) {
    const key = JSON.stringify(item.payload);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueByPayload.push(item);
    }
  }

  const listContent = await readFile(empreFile, "utf-8");
  const empreendimentoData = JSON.parse(listContent);
  const skList = new Set(
    (empreendimentoData.empreendimentos || []).map((item) => item.skUsinaLeilao).filter(Boolean),
  );
  const nameList = new Set((empreendimentoData.items || []).filter(Boolean));

  const templates = [];
  let inferredValue = selectedEmpreendimento || null;
  const debugMatches = [];
  for (const item of uniqueByPayload) {
    const payload = clone(item.payload);
    const literalPaths = collectEmpreendimentoLiteralPaths(payload);
    if (literalPaths.length > 0) {
      debugMatches.push({
        url: item.url,
        literalPaths,
      });
    }
    if (literalPaths.length === 0) continue;

    for (const literalPath of literalPaths) {
      const current = literalPath.currentValue;
      if (!inferredValue && (skList.has(current) || nameList.has(current))) {
        inferredValue = current;
      }
      const replacement =
        (selectedEmpreendimento && current === selectedEmpreendimento) ||
        (!selectedEmpreendimento && skList.has(current))
          ? "__SK_USINA_LEILAO__"
          : (!selectedEmpreendimento && nameList.has(current))
            ? "__EMPREENDIMENTO__"
          : current;
      setPathValue(payload, literalPath.path, replacement);
    }

    templates.push(payload);
  }

  await mkdir(path.dirname(outputFile), { recursive: true });

  if (debugAllPayloads) {
    const debugFile = path.resolve("data/debug-captured-query-payloads.json");
    await writeFile(
      debugFile,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          capturedCount: captured.length,
          uniqueCount: uniqueByPayload.length,
          matchedCount: debugMatches.length,
          matched: debugMatches,
          uniquePayloads: uniqueByPayload,
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    console.log(`Debug payload file saved: ${debugFile}`);
  }

  await writeFile(
    outputFile,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        endpointHint: endpointContains,
        selectedEmpreendimento: inferredValue,
        templatePlaceholder: "__SK_USINA_LEILAO__",
        warmupMs,
        capturedCount: captured.length,
        uniqueTemplateCount: templates.length,
        templates,
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );

  console.log(`Saved ${templates.length} unique templates to ${outputFile}`);
  if (!inferredValue) {
    console.log("Warning: could not infer empreendimento value from payloads.");
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
