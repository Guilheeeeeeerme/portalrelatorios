const { mkdir, readdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
require("dotenv").config();

function normalizeSelectMap(select = []) {
  const map = {};
  for (const item of select) {
    if (!item || typeof item !== "object") continue;
    if (!item.Value || !item.Name) continue;
    map[item.Value] = item.Name;
  }
  return map;
}

function flattenRows(ds = []) {
  const rows = [];
  for (const dataset of ds) {
    if (!dataset?.PH) continue;
    for (const ph of dataset.PH) {
      if (!Array.isArray(ph?.DM0)) continue;
      for (const row of ph.DM0) {
        rows.push(row);
      }
    }
  }
  return rows;
}

function rowToMeaningful(row, selectMap) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (k === "S") continue;
    const label = selectMap[k] || k;
    out[label] = v;
  }
  return out;
}

function extractWarnings(ds = []) {
  const warnings = [];
  for (const dataset of ds) {
    if (!Array.isArray(dataset?.Msg)) continue;
    for (const msg of dataset.Msg) {
      warnings.push({
        code: msg.Code,
        severity: msg.Severity,
        message: msg.Message,
      });
    }
  }
  return warnings;
}

async function main() {
  const inputDir = path.resolve(
    process.env.PBI_DASHBOARD_OUTPUT_DIR || "data/dashboard-data-by-empreendimento",
  );
  const outputDir = path.resolve(
    process.env.PBI_FORMATTED_OUTPUT_DIR || "data/dashboard-data-by-empreendimento-formatted",
  );
  const sampleSize = Number(process.env.PBI_VALIDATE_SAMPLE_SIZE || 10);

  await mkdir(outputDir, { recursive: true });
  const files = (await readdir(inputDir)).filter((f) => f.endsWith(".json")).sort();

  const validationSample = [];
  const summary = {
    generatedAt: new Date().toISOString(),
    sourceCount: files.length,
    formattedCount: 0,
    sampleComparisons: [],
  };

  for (const file of files) {
    const fullPath = path.join(inputDir, file);
    const rawText = await readFile(fullPath, "utf-8");
    const data = JSON.parse(rawText);

    const formattedResults = [];
    for (const result of data.results || []) {
      const queryData = result?.response?.results?.[0]?.result?.data;
      const descriptorSelect = queryData?.descriptor?.Select || [];
      const ds = queryData?.dsr?.DS || [];
      const selectMap = normalizeSelectMap(descriptorSelect);
      const rawRows = flattenRows(ds);
      const meaningfulRows = rawRows.map((row) => rowToMeaningful(row, selectMap));
      const warnings = extractWarnings(ds);

      formattedResults.push({
        templateIndex: result.templateIndex,
        statusCode: result.statusCode,
        descriptor: {
          selectMap,
          rawSelect: descriptorSelect,
        },
        warnings,
        meaningfulRows,
        raw: result.response,
      });
    }

    const formatted = {
      empreendimento: data.empreendimento,
      index: data.index,
      generatedAt: data.generatedAt,
      templatesUsed: data.templatesUsed,
      formattedResults,
    };

    await writeFile(path.join(outputDir, file), `${JSON.stringify(formatted, null, 2)}\n`, "utf-8");
    summary.formattedCount += 1;

    if (validationSample.length < sampleSize && formattedResults.length > 0) {
      const first = formattedResults[0];
      validationSample.push({
        empreendimento: data.empreendimento?.name || null,
        statusCode: first.statusCode,
        selectMap: first.descriptor.selectMap,
        firstMeaningfulRow: first.meaningfulRows[0] || null,
      });
    }
  }

  summary.sampleComparisons = validationSample;
  const summaryFile = path.resolve("data/dashboard-data-formatted-summary.json");
  await writeFile(summaryFile, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");

  console.log(`Formatted ${summary.formattedCount} files into ${outputDir}`);
  console.log(`Validation sample (${sampleSize}) saved in ${summaryFile}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
