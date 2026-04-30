const { request } = require("node:https");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
require("dotenv").config();

const REQUIRED_ENV = [
  "PBI_BASE_URL",
  "PBI_CAPACITY_ID",
  "PBI_WORKLOAD",
  "PBI_SERVICE",
  "PBI_VISIBILITY",
  "PBI_TOKEN",
  "PBI_MODEL_ID",
];

function requireEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function buildRequestBody({ restartToken = null, dataVolume = 500, skFonteEnergia = "0D", skUsinaLeilao = "0D" }) {
  const windowConfig = restartToken ? { RestartTokens: [[restartToken]] } : {};

  return {
    version: "1.0.0",
    queries: [
      {
        Query: {
          Commands: [
            {
              SemanticQueryDataShapeCommand: {
                Query: {
                  Version: 2,
                  From: [
                    { Name: "s", Entity: "SEL FatLeilao", Type: 0 },
                    { Name: "s1", Entity: "SEL DimFonteEnergia", Type: 0 },
                    { Name: "s11", Entity: "SEL DimUsinaLeilao Recurso", Type: 0 },
                  ],
                  Select: [
                    {
                      Column: {
                        Expression: { SourceRef: { Source: "s" } },
                        Property: "_CLM_NomEmpreendimento",
                      },
                      Name: "SEL FatLeilao._NomEmpreendimento",
                    },
                  ],
                  Where: [
                    {
                      Condition: {
                        Comparison: {
                          ComparisonKind: 1,
                          Left: {
                            Column: {
                              Expression: { SourceRef: { Source: "s1" } },
                              Property: "SkFonteEnergia",
                            },
                          },
                          Right: { Literal: { Value: skFonteEnergia } },
                        },
                      },
                    },
                    {
                      Condition: {
                        Comparison: {
                          ComparisonKind: 1,
                          Left: {
                            Column: {
                              Expression: { SourceRef: { Source: "s11" } },
                              Property: "SkUsinaLeilao",
                            },
                          },
                          Right: { Literal: { Value: skUsinaLeilao } },
                        },
                      },
                    },
                  ],
                },
                Binding: {
                  Primary: { Groupings: [{ Projections: [0] }] },
                  DataReduction: {
                    DataVolume: Number(dataVolume),
                    Primary: { Window: windowConfig },
                  },
                  IncludeEmptyGroups: true,
                  Version: 1,
                },
                ExecutionMetricsKind: 1,
              },
            },
          ],
        },
        QueryId: "",
      },
    ],
    cancelQueries: [],
    modelId: Number(process.env.PBI_MODEL_ID),
    userPreferredLocale: "en-US",
    allowLongRunningQueries: true,
  };
}

function callPowerBiQuery(payload) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const activityId = randomUUID();
    const targetUrl = new URL(process.env.PBI_BASE_URL);
    const body = JSON.stringify(payload);
    const urlPath = [
      "/webapi/capacities",
      process.env.PBI_CAPACITY_ID,
      "workloads",
      process.env.PBI_WORKLOAD,
      process.env.PBI_SERVICE,
      process.env.PBI_VISIBILITY,
      "query",
    ].join("/");

    const req = request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || 443,
        method: "POST",
        path: urlPath,
        headers: {
          accept: "application/json, text/plain, */*",
          "content-type": "application/json;charset=UTF-8",
          authorization: `MWCToken ${process.env.PBI_TOKEN}`,
          activityid: activityId,
          requestid: requestId,
          "x-ms-parent-activity-id": requestId,
          "x-ms-root-activity-id": requestId,
          origin: "https://app.powerbi.com",
          referer: "https://app.powerbi.com/",
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          const statusCode = res.statusCode || 500;
          let parsed = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // keep raw text
          }
          resolve({ statusCode, body: parsed });
        });
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function walk(obj, visitor) {
  if (!obj || typeof obj !== "object") return;
  visitor(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) walk(item, visitor);
    return;
  }
  for (const value of Object.values(obj)) {
    walk(value, visitor);
  }
}

function extractValues(responseBody) {
  const values = [];
  walk(responseBody, (node) => {
    if (Array.isArray(node.ValueDicts)) {
      for (const row of node.ValueDicts) {
        if (Array.isArray(row)) {
          values.push(row[0]);
        }
      }
    }
    if (Array.isArray(node.C)) {
      for (const row of node.C) {
        if (Array.isArray(row) && row.length > 0) {
          values.push(row[0]);
        }
      }
    }
    if (Array.isArray(node.RV)) {
      for (const row of node.RV) {
        if (Array.isArray(row) && row.length > 0) {
          values.push(row[0]);
        }
      }
    }
    if (Array.isArray(node.V)) {
      for (const row of node.V) {
        if (Array.isArray(row) && row.length > 0) {
          values.push(row[0]);
        }
      }
    }
    if (Array.isArray(node.DM0)) {
      for (const row of node.DM0) {
        if (row && typeof row === "object" && typeof row.G0 === "string") {
          values.push(row.G0);
        }
      }
    }
  });
  return values;
}

function extractNextRestartToken(responseBody) {
  let latest = null;
  walk(responseBody, (node) => {
    if (Array.isArray(node.RestartTokens)) {
      for (const tokenEntry of node.RestartTokens) {
        if (Array.isArray(tokenEntry) && typeof tokenEntry[0] === "string" && tokenEntry[0]) {
          latest = tokenEntry[0];
        }
      }
    }
    if (Array.isArray(node.RT)) {
      for (const tokenEntry of node.RT) {
        if (Array.isArray(tokenEntry) && typeof tokenEntry[0] === "string" && tokenEntry[0]) {
          latest = tokenEntry[0];
        }
      }
    }
  });
  return latest;
}

async function main() {
  requireEnv();
  const dataVolume = Number(process.env.PBI_DATA_VOLUME || 3);
  const skFonteEnergia = process.env.PBI_SK_FONTE_ENERGIA || "0D";
  const skUsinaLeilao = process.env.PBI_SK_USINA_LEILAO || "0D";
  const outputFile = process.env.PBI_OUTPUT_FILE || "data/empreendimentos.json";

  let restartToken = null;
  let page = 0;
  const allItems = [];

  while (true) {
    page += 1;
    const payload = buildRequestBody({ restartToken, dataVolume, skFonteEnergia, skUsinaLeilao });
    const response = await callPowerBiQuery(payload);

    if (response.statusCode >= 400) {
      throw new Error(`Upstream failed (${response.statusCode}): ${JSON.stringify(response.body)}`);
    }

    if (page === 1 && process.env.PBI_DEBUG_CAPTURE === "true") {
      const debugFile = path.resolve("data/debug-first-response.json");
      await mkdir(path.dirname(debugFile), { recursive: true });
      await writeFile(debugFile, `${JSON.stringify(response.body, null, 2)}\n`, "utf-8");
      console.log(`Debug: saved first response to ${debugFile}`);
    }

    const pageItems = extractValues(response.body).filter(Boolean);
    allItems.push(...pageItems);

    const nextToken = extractNextRestartToken(response.body);
    console.log(`Page ${page}: +${pageItems.length} items (total ${allItems.length})`);

    if (!nextToken || nextToken === restartToken) break;
    restartToken = nextToken;
  }

  const uniqueItems = [...new Set(allItems)].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const output = {
    generatedAt: new Date().toISOString(),
    totalRawItems: allItems.length,
    totalUniqueItems: uniqueItems.length,
    items: uniqueItems,
  };

  const absolutePath = path.resolve(outputFile);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
  console.log(`Done. Saved ${uniqueItems.length} empreendimento names to ${absolutePath}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
