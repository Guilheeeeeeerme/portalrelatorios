const { request } = require("node:https");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
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
];

function requireEnv() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function replaceDeep(value, from, to) {
  if (typeof value === "string") return value === from ? to : value;
  if (Array.isArray(value)) return value.map((item) => replaceDeep(item, from, to));
  if (value && typeof value === "object") {
    const next = {};
    for (const [k, v] of Object.entries(value)) next[k] = replaceDeep(v, from, to);
    return next;
  }
  return value;
}

function toPowerBiInLiteral(nomeEmpreendimento) {
  const escaped = String(nomeEmpreendimento).replace(/'/g, "''");
  return `'${escaped}'`;
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 120);
}

function callPowerBiQuery(payload) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const activityId = randomUUID();
    const baseUrl = new URL(process.env.PBI_BASE_URL);
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
        protocol: baseUrl.protocol,
        hostname: baseUrl.hostname,
        port: baseUrl.port || 443,
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
          let parsed = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // keep raw
          }
          resolve({
            statusCode: res.statusCode || 500,
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

async function main() {
  requireEnv();

  const empreFile = path.resolve(process.env.PBI_OUTPUT_FILE || "data/empreendimentos.json");
  const templateFile = path.resolve(process.env.PBI_TEMPLATE_FILE || "data/dashboard-query-templates.json");
  const outputDir = path.resolve(
    process.env.PBI_DASHBOARD_OUTPUT_DIR || "data/dashboard-data-by-empreendimento",
  );
  const startAt = Number(process.env.PBI_START_INDEX || 0);
  const endAtEnv = process.env.PBI_END_INDEX;

  const empreData = JSON.parse(await readFile(empreFile, "utf-8"));
  const templateData = JSON.parse(await readFile(templateFile, "utf-8"));

  const empreendimentos = Array.isArray(empreData.empreendimentos)
    ? empreData.empreendimentos
    : Array.isArray(empreData.items)
      ? empreData.items.map((name) => ({ name }))
      : [];
  const templates = Array.isArray(templateData.templates) ? templateData.templates : [];
  if (templates.length === 0) {
    throw new Error("No templates found. Run: npm run pw:capture-templates");
  }

  const endAt = endAtEnv
    ? Math.min(Number(endAtEnv), empreendimentos.length - 1)
    : empreendimentos.length - 1;

  await mkdir(outputDir, { recursive: true });

  for (let i = startAt; i <= endAt; i += 1) {
    const empreendimento = empreendimentos[i];
    if (!empreendimento) continue;

    const results = [];
    for (let t = 0; t < templates.length; t += 1) {
      let payload = templates[t];
      if (empreendimento.skUsinaLeilao) {
        payload = replaceDeep(payload, "__SK_USINA_LEILAO__", empreendimento.skUsinaLeilao);
      }
      payload = replaceDeep(payload, "__EMPREENDIMENTO__", empreendimento.name);
      payload = replaceDeep(
        payload,
        "__EMPREENDIMENTO_LITERAL__",
        toPowerBiInLiteral(empreendimento.name),
      );
      const response = await callPowerBiQuery(payload);
      results.push({
        templateIndex: t,
        statusCode: response.statusCode,
        response: response.body,
      });
    }

    const file = path.join(
      outputDir,
      `${String(i).padStart(4, "0")}-${slugify(empreendimento.name)}.json`,
    );
    await writeFile(
      file,
      `${JSON.stringify(
        {
          empreendimento,
          index: i,
          generatedAt: new Date().toISOString(),
          templatesUsed: templates.length,
          results,
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    console.log(`[${i}/${endAt}] saved ${file}`);
  }

  console.log("Dashboard data dump completed.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
