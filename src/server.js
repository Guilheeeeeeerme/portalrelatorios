const Fastify = require("fastify");
const { request } = require("node:https");
const { randomUUID } = require("node:crypto");
require("dotenv").config();

const app = Fastify({ logger: true });
const jobs = new Map();

const REQUIRED_ENV = [
  "PBI_BASE_URL",
  "PBI_CAPACITY_ID",
  "PBI_WORKLOAD",
  "PBI_SERVICE",
  "PBI_VISIBILITY",
  "PBI_TOKEN",
  "PBI_DATASET_ID",
  "PBI_REPORT_ID",
  "PBI_VISUAL_ID",
  "PBI_MODEL_ID",
];

function requireEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function buildRequestBody({
  skFonteEnergia = "0D",
  skUsinaLeilao = "0D",
  restartToken = null,
  dataVolume = 500,
}) {
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
                  Primary: {
                    Groupings: [{ Projections: [0] }],
                  },
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
        ApplicationContext: {
          DatasetId: process.env.PBI_DATASET_ID,
          Sources: [
            {
              ReportId: process.env.PBI_REPORT_ID,
              VisualId: process.env.PBI_VISUAL_ID,
            },
          ],
        },
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

    const urlPath = [
      "/webapi/capacities",
      process.env.PBI_CAPACITY_ID,
      "workloads",
      process.env.PBI_WORKLOAD,
      process.env.PBI_SERVICE,
      process.env.PBI_VISIBILITY,
      "query",
    ].join("/");

    const body = JSON.stringify(payload);
    const targetUrl = new URL(process.env.PBI_BASE_URL);

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
          "x-ms-workload-resource-moniker": process.env.PBI_DATASET_ID,
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
            // Keep raw text when not JSON.
          }
          resolve({
            statusCode,
            headers: res.headers,
            body: parsed,
          });
        });
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function walk(obj, visitor) {
  if (!obj || typeof obj !== "object") {
    return;
  }
  visitor(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) {
      walk(item, visitor);
    }
    return;
  }
  for (const value of Object.values(obj)) {
    walk(value, visitor);
  }
}

function extractRows(responseBody) {
  const values = [];
  walk(responseBody, (node) => {
    if (Array.isArray(node.ValueDicts)) {
      values.push(...node.ValueDicts);
    }
    if (Array.isArray(node.Rows)) {
      values.push(...node.Rows);
    }
  });
  return values;
}

function extractNextRestartToken(responseBody) {
  const tokens = [];
  walk(responseBody, (node) => {
    if (Array.isArray(node.RestartTokens)) {
      for (const entry of node.RestartTokens) {
        if (Array.isArray(entry) && typeof entry[0] === "string" && entry[0]) {
          tokens.push(entry[0]);
        }
      }
    }
  });
  return tokens.at(-1) || null;
}

async function loadAllItemsSequentially({ skFonteEnergia, skUsinaLeilao, dataVolume }, jobId) {
  let restartToken = null;
  let pages = 0;
  const allItems = [];

  while (true) {
    const payload = buildRequestBody({
      skFonteEnergia,
      skUsinaLeilao,
      restartToken,
      dataVolume,
    });

    const result = await callPowerBiQuery(payload);
    if (result.statusCode >= 400) {
      throw new Error(`Upstream error ${result.statusCode}`);
    }

    const items = extractRows(result.body);
    allItems.push(...items);
    pages += 1;

    const nextToken = extractNextRestartToken(result.body);
    const currentJob = jobs.get(jobId);
    if (currentJob) {
      currentJob.pagesLoaded = pages;
      currentJob.itemsLoaded = allItems.length;
      currentJob.lastRestartToken = nextToken;
      jobs.set(jobId, currentJob);
    }

    // Power BI pagination stops when no new restart token is returned.
    if (!nextToken || nextToken === restartToken) {
      break;
    }

    restartToken = nextToken;
  }

  return { pages, items: allItems };
}

app.post("/powerbi/query", async (req, reply) => {
  const { skFonteEnergia = "0D", skUsinaLeilao = "0D", restartToken = null, dataVolume = 500 } =
    req.body || {};
  const payload = buildRequestBody({ skFonteEnergia, skUsinaLeilao, restartToken, dataVolume });

  const result = await callPowerBiQuery(payload);
  return reply.code(result.statusCode).send({
    upstreamStatus: result.statusCode,
    upstreamHeaders: result.headers,
    data: result.body,
  });
});

app.post("/powerbi/query/all/start", async (req, reply) => {
  const { skFonteEnergia = "0D", skUsinaLeilao = "0D", dataVolume = 500 } = req.body || {};
  const jobId = randomUUID();

  jobs.set(jobId, {
    id: jobId,
    status: "running",
    startedAt: new Date().toISOString(),
    pagesLoaded: 0,
    itemsLoaded: 0,
    lastRestartToken: null,
    error: null,
    result: null,
  });

  setImmediate(async () => {
    try {
      const result = await loadAllItemsSequentially(
        { skFonteEnergia, skUsinaLeilao, dataVolume },
        jobId,
      );
      const current = jobs.get(jobId);
      if (!current) return;
      current.status = "completed";
      current.finishedAt = new Date().toISOString();
      current.result = result;
      jobs.set(jobId, current);
    } catch (error) {
      const current = jobs.get(jobId);
      if (!current) return;
      current.status = "failed";
      current.finishedAt = new Date().toISOString();
      current.error = error.message;
      jobs.set(jobId, current);
    }
  });

  return reply.code(202).send({
    jobId,
    status: "running",
    poll: `/powerbi/query/all/status/${jobId}`,
  });
});

app.get("/powerbi/query/all/status/:jobId", async (req, reply) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) {
    return reply.code(404).send({ error: "Job not found" });
  }

  return job;
});

app.get("/health", async () => ({ ok: true }));

async function start() {
  requireEnv();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";
  await app.listen({ port, host });
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
