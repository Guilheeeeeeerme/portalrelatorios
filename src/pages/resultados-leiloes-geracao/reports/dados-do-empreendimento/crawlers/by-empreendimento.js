#!/usr/bin/env node
/**
 * dados-do-empreendimento-by-empreendimento — Playwright visual crawler (Power BI iframe).
 *
 * Cursor IDE Browser MCP cannot automate cross-origin iframe UI; this script drives the embed.
 *
 * CLI:
 *   node .../by-empreendimento.js [--only=Nome] [--max=N] [--force] [--screenshots]
 *   [--quiet] [--fast] [--settle-ms=N] [--resume] [--refresh-options]
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { parseVisualCardText } = require("../parsers/visual-cards-parser.js");
const { attachQueryEvidence } = require("./network-evidence.js");

const SOURCE_PAGE = "resultados-leiloes-geracao";
const SOURCE_URL =
  "https://portalrelatorios.aneel.gov.br/resultadosLeiloes/leiloesGeracaoPortugues#";
const REPORT_ID = "dados-do-empreendimento";
const FILTER_ID = "empreendimento";

function ts() {
  return new Date().toISOString();
}

function log(msg, quiet) {
  if (quiet) return;
  process.stdout.write(`[${ts()}] [dados-empreendimento] ${msg}\n`);
}

function slugify(name) {
  const s = String(name)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "item";
}

function parseArgs(argv) {
  const out = {
    only: null,
    max: Infinity,
    force: false,
    screenshots: false,
    headless: true,
    quiet: false,
    settleMs: 6500,
    resume: false,
    refreshOptions: false,
  };
  for (const a of argv.slice(2)) {
    if (a === "--force") out.force = true;
    else if (a === "--screenshots") out.screenshots = true;
    else if (a === "--headed") out.headless = false;
    else if (a === "--quiet") out.quiet = true;
    else if (a === "--resume") out.resume = true;
    else if (a === "--refresh-options") out.refreshOptions = true;
    else if (a === "--fast") out.settleMs = 4200;
    else if (a.startsWith("--only=")) out.only = a.slice("--only=".length).trim();
    else if (a.startsWith("--max="))
      out.max = Math.max(1, Number.parseInt(a.slice("--max=".length), 10) || 1);
    else if (a.startsWith("--settle-ms=")) {
      const n = Number.parseInt(a.slice("--settle-ms=".length), 10);
      if (Number.isFinite(n) && n >= 0) out.settleMs = n;
    }
  }
  return out;
}

function outputDir() {
  return path.join(
    process.cwd(),
    "data",
    SOURCE_PAGE,
    REPORT_ID,
    "by-empreendimento"
  );
}

/** Last-sync checkpoint for `--resume` (created if missing, updated after each item). */
function crawlStatePath() {
  return path.join(process.cwd(), "data", SOURCE_PAGE, REPORT_ID, "crawl-state.json");
}

function defaultCrawlState() {
  return {
    version: 1,
    source_page: SOURCE_PAGE,
    report: REPORT_ID,
    filter: FILTER_ID,
    last_completed_name: null,
    last_completed_slug: null,
    last_completed_at: null,
    updated_at: null,
    options_count: null,
    /** Full sorted Empreendimento labels; filled after a dropdown scan; reused with --resume. */
    option_names: null,
    option_names_captured_at: null,
  };
}

function readCrawlState(statePath) {
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw);
    return { ...defaultCrawlState(), ...parsed };
  } catch {
    return defaultCrawlState();
  }
}

function writeCrawlState(statePath, patch) {
  const prev = fs.existsSync(statePath) ? readCrawlState(statePath) : defaultCrawlState();
  const next = {
    ...prev,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(next, null, 2), "utf8");
}

function ensureCrawlStateFile(statePath) {
  if (!fs.existsSync(statePath)) {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(defaultCrawlState(), null, 2), "utf8");
  }
}

function sliceAfterResume(names, state, quiet) {
  const last = state.last_completed_name;
  if (!last) {
    log("Resume: no last_completed_* in crawl-state.json; using full list.", quiet);
    return names;
  }
  const idx = names.findIndex((n) => n === last);
  if (idx < 0) {
    log(
      `Resume: last “${last}” not found in current option list (${names.length} options); using full list.`,
      quiet
    );
    return names;
  }
  const rest = names.slice(idx + 1);
  log(
    `Resume: last synced “${last}” (${state.last_completed_slug}); ${rest.length} item(s) left in list after that.`,
    quiet
  );
  return rest;
}

function recordCrawlProgress(statePath, name, quiet) {
  const slug = slugify(name);
  writeCrawlState(statePath, {
    last_completed_name: name,
    last_completed_slug: slug,
    last_completed_at: new Date().toISOString(),
  });
  log(
    `  checkpoint → ${path.relative(process.cwd(), statePath)} (last=${slug})`,
    quiet
  );
}

function screenshotsDir() {
  return path.join(
    process.cwd(),
    "research",
    "api-inspection",
    SOURCE_PAGE,
    REPORT_ID,
    "screenshots"
  );
}

async function getPowerBiFrame(page) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const f = page.frames().find((fr) => (fr.url() || "").includes("powerbi.com"));
    if (f) return f;
    await page.waitForTimeout(250);
  }
  throw new Error("Power BI iframe not found");
}

function empreendimentoSlicerDropdown(frame) {
  return frame
    .locator(".visual-slicer")
    .filter({ has: frame.locator('.slicer-header-text:text-is("Empreendimento")') })
    .locator('[data-testid="slicer-dropdown"]');
}

async function collectOptionNames(frame, page, quiet) {
  log("Collecting Empreendimento filter options (scrolling list)…", quiet);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const dd = empreendimentoSlicerDropdown(frame);
  await dd.click();
  await page.waitForTimeout(900);

  const seen = new Set();
  let stale = 0;
  let scrolls = 0;
  while (stale < 5) {
    const texts = await frame.locator('[role="option"]').allTextContents();
    const before = seen.size;
    for (const t of texts) seen.add(t.trim());
    if (seen.size === before) stale++;
    else stale = 0;

    if (seen.size !== before) {
      log(`  options discovered so far: ${seen.size}`, quiet);
    }

    const lb = frame.locator('[role="listbox"]').first();
    if ((await lb.count()) === 0) break;
    await lb.evaluate((el) => {
      el.scrollTop += Math.max(100, Math.floor(el.clientHeight * 0.85));
    });
    scrolls += 1;
    await page.waitForTimeout(400);
  }

  log(`  done scrolling (${scrolls} steps), unique options: ${seen.size}`, quiet);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  return [...seen].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

async function selectEmpreendimento(frame, page, name, settleMs) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  const dd = empreendimentoSlicerDropdown(frame);
  await dd.click();
  await page.waitForTimeout(900);
  const opt = frame.getByRole("option", { name, exact: true });
  await opt.click();
  await page.waitForTimeout(settleMs);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(450);
}

async function main() {
  const args = parseArgs(process.argv);
  const out = outputDir();
  const statePath = crawlStatePath();
  const quiet = args.quiet;
  fs.mkdirSync(out, { recursive: true });
  ensureCrawlStateFile(statePath);

  log(`Starting crawl → ${SOURCE_URL}`, quiet);
  log(`Output directory: ${out}`, quiet);
  log(`Sync state: ${statePath}`, quiet);
  log(`Post-select settle wait: ${args.settleMs}ms (use --fast or --settle-ms=N to tune)`, quiet);

  const evidenceBucket = [];
  const t0 = Date.now();
  const browser = await chromium.launch({ headless: args.headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  attachQueryEvidence(page, evidenceBucket);

  log("Opening portal…", quiet);
  await page.goto(SOURCE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  log("Selecting report “Dados do Empreendimento”…", quiet);
  await page.getByText("Dados do Empreendimento", { exact: true }).first().click();
  await page.waitForTimeout(12000);
  log(`Report shell ready (${Date.now() - t0}ms since start)`, quiet);

  const frame = await getPowerBiFrame(page);
  log("Power BI iframe attached.", quiet);

  let names;
  if (args.only) {
    names = [args.only];
    log(`Single item mode: --only=${args.only} (--resume ignored)`, quiet);
  } else {
    const snap = readCrawlState(statePath);
    let usedCached = false;

    if (
      args.resume &&
      Array.isArray(snap.option_names) &&
      snap.option_names.length > 0 &&
      !args.refreshOptions
    ) {
      names = [...snap.option_names];
      usedCached = true;
      const last = snap.last_completed_name;
      if (last && !names.includes(last)) {
        log(
          `Cached list (${names.length} options) has no last_completed “${last}”; rescanning dropdown…`,
          quiet
        );
        usedCached = false;
      } else {
        log(
          `Using cached Empreendimento list (${names.length} options, saved ${snap.option_names_captured_at ?? "?"}). This avoids the long dropdown scroll. Use --refresh-options to rescan.`,
          quiet
        );
      }
    }

    if (args.refreshOptions) {
      log("--refresh-options: scanning dropdown (ignoring cached option list)…", quiet);
    }

    if (!usedCached) {
      names = await collectOptionNames(frame, page, quiet);
      writeCrawlState(statePath, {
        options_count: names.length,
        option_names: names,
        option_names_captured_at: new Date().toISOString(),
      });
    }
  }

  if (!args.only && args.resume) {
    const state = readCrawlState(statePath);
    names = sliceAfterResume(names, state, quiet);
  }

  names = names.slice(0, args.max);
  log(
    `Will process ${names.length} item(s)${args.max !== Infinity ? ` (--max=${args.max})` : ""}${args.force ? " (--force: overwrite)" : ""}${args.resume && !args.only ? " (--resume)" : ""}`,
    quiet
  );

  const shotsRoot = args.screenshots ? screenshotsDir() : null;
  if (shotsRoot) fs.mkdirSync(shotsRoot, { recursive: true });

  const summary = [];
  let index = 0;
  for (const name of names) {
    index += 1;
    const slug = slugify(name);
    const dest = path.join(out, `${slug}.json`);
    if (!args.force && fs.existsSync(dest)) {
      log(`[${index}/${names.length}] skip (exists): ${slug}.json`, quiet);
      summary.push(`skip existing ${slug}`);
      recordCrawlProgress(statePath, name, quiet);
      continue;
    }

    const itemStart = Date.now();
    log(`[${index}/${names.length}] selecting “${name}”…`, quiet);
    await selectEmpreendimento(frame, page, name, args.settleMs);
    log(`[${index}/${names.length}] extracting text + parsing (${Date.now() - itemStart}ms so far)…`, quiet);
    const bodyText = await frame.locator("body").first().innerText();

    const parsed = parseVisualCardText(bodyText, name);
    if (parsed.error) {
      const msg = `[${index}/${names.length}] Parse failed for “${name}” (${slug}): ${parsed.error}`;
      log(msg, quiet);
      console.error(msg);
      console.error(
        "(exit 1 — no JSON written, crawl-state.json not updated for this item)"
      );
      await browser.close().catch(() => {});
      process.exit(1);
    }

    log(
      `[${index}/${names.length}] parsed ${parsed.raw_cards?.length ?? 0} card row(s)`,
      quiet
    );

    const payload = {
      metadata: {
        source_page: SOURCE_PAGE,
        source_url: SOURCE_URL,
        report: REPORT_ID,
        filter: FILTER_ID,
        filter_value: name,
        extraction_method: "playwright-visual-crawler",
        generated_at: new Date().toISOString(),
        crawl_log: [
          `run_items=${names.length}`,
          `empreendimento=${name}`,
          `slug=${slug}`,
        ].join("\n"),
      },
      data: parsed.data,
      raw_cards: parsed.raw_cards,
      api_evidence: {
        query_requests: evidenceBucket.slice(-80),
      },
    };

    fs.writeFileSync(dest, JSON.stringify(payload, null, 2), "utf8");
    const rel = path.relative(process.cwd(), dest);
    log(
      `[${index}/${names.length}] wrote ${rel} (total ${Date.now() - itemStart}ms for this item)`,
      quiet
    );
    summary.push(`wrote ${rel}`);
    recordCrawlProgress(statePath, name, quiet);

    if (shotsRoot) {
      const sp = path.join(shotsRoot, `${slug}.png`);
      await page.screenshot({ path: sp, fullPage: true });
    }
  }

  await browser.close();
  log(`Finished in ${Date.now() - t0}ms. Summary:\n${summary.join("\n")}`, quiet);
  if (quiet) {
    process.stdout.write(`${summary.join("\n")}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
