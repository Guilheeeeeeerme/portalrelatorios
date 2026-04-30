const { chromium } = require("playwright");
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

function maskToken(token) {
  if (!token || token.length < 12) return "***";
  return `${token.slice(0, 6)}...${token.slice(-6)}`;
}

async function main() {
  requireEnv();

  const targetUrl =
    process.env.PW_TARGET_URL ||
    "https://portalrelatorios.aneel.gov.br/resultadosLeiloes/leiloesGeracaoPortugues#!";

  const headless = process.env.PW_HEADLESS === "true";
  const slowMo = Number(process.env.PW_SLOW_MO || 50);

  const browser = await chromium.launch({ headless, slowMo });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  // Keep the required keys available in localStorage for next automation steps.
  await page.evaluate((payload) => {
    localStorage.setItem("pbi.config", JSON.stringify(payload));
  }, {
    baseUrl: process.env.PBI_BASE_URL,
    capacityId: process.env.PBI_CAPACITY_ID,
    workload: process.env.PBI_WORKLOAD,
    service: process.env.PBI_SERVICE,
    visibility: process.env.PBI_VISIBILITY,
    modelId: process.env.PBI_MODEL_ID,
    token: process.env.PBI_TOKEN,
  });

  console.log("Playwright bootstrap complete.");
  console.log(`Page: ${page.url()}`);
  console.log(`Token: ${maskToken(process.env.PBI_TOKEN)}`);
  console.log("Stored localStorage key: pbi.config");
  console.log("Browser left open for manual validation. Press Ctrl+C to stop.");

  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
