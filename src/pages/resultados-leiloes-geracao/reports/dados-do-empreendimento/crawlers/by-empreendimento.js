#!/usr/bin/env node
/**
 * dados-do-empreendimento-by-empreendimento — Playwright visual crawler (Power BI iframe).
 *
 * Flow: navigate → open Empreendimento slicer → merge visible labels into option list →
 * if any visible row still needs JSON, select it and parse → else scroll list → repeat until
 * discovery stagnates (virtual list). Cursor IDE Browser MCP can validate the outer shell only;
 * the slicer lives in a cross-origin iframe and is driven here.
 *
 * CLI:
 *   node .../by-empreendimento.js [--only=Nome] [--max=N] [--force] [--screenshots]
 *   [--quiet] [--fast] [--settle-ms=N] [--resume] [--refresh-options] [--dry-list]
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { parseVisualCardText } = require("../parsers/visual-cards-parser.js");
const { KNOWN_LABELS } = require("../schemas/label-map.js");

const SOURCE_PAGE = "resultados-leiloes-geracao";
const SOURCE_URL =
  "https://portalrelatorios.aneel.gov.br/resultadosLeiloes/leiloesGeracaoPortugues#";
const REPORT_ID = "dados-do-empreendimento";
const FILTER_ID = "empreendimento";

/** Fixed layout size so Power BI / portal match a desktop surface. */
const VIEWPORT = Object.freeze({ width: 1920, height: 1080 });

function ts() {
  return new Date().toISOString();
}

function log(msg, quiet) {
  if (quiet) return;
  process.stdout.write(`[${ts()}] [dados-empreendimento] ${msg}\n`);
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
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

function sameEmpreendimento(a, b) {
  const left = slugify(a);
  const right = slugify(b);
  if (left === right) return true;
  const rawLeft = String(a ?? "");
  const rawRight = String(b ?? "");
  if (!rawLeft.includes("…") && !rawRight.includes("…")) return false;
  const leftPrefix = slugify(rawLeft.replace(/…+$/u, ""));
  const rightPrefix = slugify(rawRight.replace(/…+$/u, ""));
  return (
    (leftPrefix.length >= 12 && right.startsWith(leftPrefix)) ||
    (rightPrefix.length >= 12 && left.startsWith(rightPrefix))
  );
}

function usesEllipsis(value) {
  return String(value ?? "").includes("…");
}

function parseArgs(argv) {
  const out = {
    only: null,
    max: Infinity,
    force: false,
    screenshots: false,
    headless: true,
    quiet: false,
    fast: false,
    settleMs: 6500,
    resume: false,
    refreshOptions: false,
    dryList: false,
    allowSmallList: false,
  };
  for (const a of argv.slice(2)) {
    if (a === "--force") out.force = true;
    else if (a === "--screenshots") out.screenshots = true;
    else if (a === "--headed") out.headless = false;
    else if (a === "--quiet") out.quiet = true;
    else if (a === "--resume") out.resume = true;
    else if (a === "--refresh-options") out.refreshOptions = true;
    else if (a === "--dry-list") out.dryList = true;
    else if (a === "--allow-small-list") out.allowSmallList = true;
    else if (a === "--fast") {
      out.fast = true;
      out.settleMs = 4200;
    } else if (a.startsWith("--only=")) out.only = a.slice("--only=".length).trim();
    else if (a.startsWith("--max=")) {
      const n = Number.parseInt(a.slice("--max=".length), 10);
      if (Number.isFinite(n) && n >= 0) out.max = n;
    } else if (a.startsWith("--settle-ms=")) {
      const n = Number.parseInt(a.slice("--settle-ms=".length), 10);
      if (Number.isFinite(n) && n >= 0) out.settleMs = n;
    }
  }
  return out;
}

function outputDir() {
  return path.join(process.cwd(), "data", SOURCE_PAGE, REPORT_ID, "by-empreendimento");
}

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
    option_names: null,
    option_names_captured_at: null,
    selection_failures: {},
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

function recordCrawlProgress(statePath, name, quiet) {
  const slug = slugify(name);
  writeCrawlState(statePath, {
    last_completed_name: name,
    last_completed_slug: slug,
    last_completed_at: new Date().toISOString(),
  });
  log(`  checkpoint → ${path.relative(process.cwd(), statePath)} (last=${slug})`, quiet);
}

function recordSelectionFailure(statePath, name, reason, quiet) {
  const prev = readCrawlState(statePath);
  const slug = slugify(name);
  const failures = prev.selection_failures ?? {};
  writeCrawlState(statePath, {
    selection_failures: {
      ...failures,
      [slug]: {
        name,
        reason,
        failed_at: new Date().toISOString(),
      },
    },
  });
  log(`  selection failure quarantined → ${slug}: ${reason}`, quiet);
}

function failedOptionSlugs(statePath) {
  const state = readCrawlState(statePath);
  return new Set(Object.keys(state.selection_failures ?? {}));
}

/** Persist merged sorted labels; logs when the crawled set grows. */
function mergeOptionNamesIntoState(statePath, discovered, quiet) {
  const prev = readCrawlState(statePath);
  const prevArr = Array.isArray(prev.option_names) ? prev.option_names : [];
  const prevSet = new Set(prevArr);
  let added = 0;
  for (const x of discovered) {
    if (!prevSet.has(x)) added += 1;
  }
  const names = [...discovered].sort((a, b) => a.localeCompare(b, "pt-BR"));
  writeCrawlState(statePath, {
    option_names: names,
    options_count: names.length,
    option_names_captured_at: new Date().toISOString(),
  });
  if (added > 0) log(`  option list +${added} new → ${names.length} unique`, quiet);
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

function debugDir() {
  return path.join(
    process.cwd(),
    "research",
    "api-inspection",
    SOURCE_PAGE,
    REPORT_ID,
    "debug"
  );
}

function jsonPathFor(outDir, name) {
  return path.join(outDir, `${slugify(name)}.json`);
}

function jsonExists(outDir, name) {
  return fs.existsSync(jsonPathFor(outDir, name));
}

function pendingExtractions(discovered, outDir, force, statePath) {
  const failed = force || !statePath ? new Set() : failedOptionSlugs(statePath);
  return [...discovered]
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .filter((n) => (force || !jsonExists(outDir, n)) && !failed.has(slugify(n)));
}

function parsedCardLabels(parsed) {
  return new Set((parsed.raw_cards ?? []).map((card) => card.label));
}

function missingCardLabels(parsed) {
  const labels = parsedCardLabels(parsed);
  return [...KNOWN_LABELS].filter((label) => !labels.has(label));
}

async function getPowerBiFrame(page) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const frames = page.frames().filter((fr) => (fr.url() || "").includes("powerbi.com"));
    for (const f of frames) {
      const text = await f
        .locator("body")
        .first()
        .innerText({ timeout: 1000 })
        .catch(() => "");
      if (text.includes("Empreendimento") || text.includes("Dados por Empreendimento")) return f;
      const hasSlicer = await f.locator(".visual-slicer").first().count().catch(() => 0);
      if (hasSlicer > 0) return f;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("Power BI iframe/report content not found");
}

/**
 * Navigate to the portal, open the report tile, wait for the embed. Retries with a full
 * refresh on transient load failures (network / incomplete DOM).
 */
async function openPortalAndReport(page, quiet, t0) {
  const maxAttempts = Math.max(
    1,
    Number.parseInt(process.env.CRAWL_LOAD_MAX_ATTEMPTS ?? "5", 10) || 5
  );
  const retryPauseMs = Math.max(
    500,
    Number.parseInt(process.env.CRAWL_LOAD_RETRY_MS ?? "3000", 10) || 3000
  );
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      log(
        attempt === 1 ? "Opening portal…" : `Opening portal (retry ${attempt}/${maxAttempts})…`,
        quiet
      );
      await page.goto(SOURCE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForTimeout(5000);

      log("Selecting report “Dados do Empreendimento”…", quiet);
      const tile = page.getByText("Dados do Empreendimento", { exact: true }).first();
      await tile.waitFor({ state: "visible", timeout: 90000 });
      await tile.click({ timeout: 30000 });
      await page.waitForTimeout(12000);

      log(`Report shell ready (${Date.now() - t0}ms since start)`, quiet);

      const frame = await getPowerBiFrame(page);
      log("Power BI iframe attached.", quiet);
      return frame;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      log(`Load/report error (attempt ${attempt}/${maxAttempts}): ${msg}`, quiet);
      if (attempt >= maxAttempts) break;

      log(`Waiting ${retryPauseMs}ms, then reloading portal…`, quiet);
      await page.waitForTimeout(retryPauseMs);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "portal load failed"));
}

function empreendimentoSlicerDropdown(frame) {
  return frame
    .locator(".visual-slicer")
    .filter({ has: frame.locator('.slicer-header-text:text-is("Empreendimento")') })
    .locator('[data-testid="slicer-dropdown"]');
}

function empreendimentoSlicer(frame) {
  return frame
    .locator(".visual-slicer")
    .filter({ has: frame.locator('.slicer-header-text:text-is("Empreendimento")') })
    .first();
}

async function findEmpreendimentoClickableHandle(frame) {
  const handle = await frame.evaluateHandle(() => {
    const textOf = (el) => (el.textContent || "").trim();
    const headers = Array.from(document.querySelectorAll(".slicer-header-text"));
    const header = headers.find((el) => textOf(el) === "Empreendimento");
    const root = header ? header.closest(".visual-slicer") : null;
    if (!root) return null;
    return (
      root.querySelector('[data-testid="slicer-dropdown"]') ||
      root.querySelector('[role="combobox"]') ||
      root.querySelector('[aria-haspopup="listbox"]') ||
      root.querySelector(".slicer-dropdown") ||
      root
    );
  });
  const element = handle.asElement();
  if (!element) await handle.dispose().catch(() => {});
  return element;
}

async function clickEmpreendimentoDropdownInDom(frame) {
  return frame.evaluate(() => {
    const textOf = (el) => (el.textContent || "").trim();
    const headers = Array.from(document.querySelectorAll(".slicer-header-text"));
    const header = headers.find((el) => textOf(el) === "Empreendimento");
    const root = header ? header.closest(".visual-slicer") : null;
    if (!root) return false;
    const target =
      root.querySelector('[data-testid="slicer-dropdown"]') ||
      root.querySelector('[role="combobox"]') ||
      root.querySelector('[aria-haspopup="listbox"]') ||
      root.querySelector(".slicer-dropdown") ||
      root;
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  });
}

async function waitForListboxInDom(frame, timeout) {
  await frame.waitForFunction(
    () => {
      const lb = document.querySelector('[role="listbox"]');
      if (!lb) return false;
      const box = lb.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    },
    null,
    { timeout }
  );
}

async function isListboxVisibleInDom(frame) {
  return frame
    .evaluate(() => {
      const lb = document.querySelector('[role="listbox"]');
      if (!lb) return false;
      const box = lb.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    })
    .catch(() => false);
}

async function clickOptionInDom(frame, name) {
  return frame.evaluate((targetName) => {
    const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
    const target = normalize(targetName);
    const options = Array.from(document.querySelectorAll('[role="option"]'));
    const option = options.find((el) => normalize(el.textContent) === target);
    if (!option) return false;
    const eventTarget =
      option.querySelector(".slicerCheckbox") ||
      option.querySelector(".slicerText") ||
      option.firstElementChild ||
      option;
    eventTarget.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    eventTarget.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    eventTarget.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
    eventTarget.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    eventTarget.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  }, name);
}

async function currentEmpreendimentoSlicerValue(frame) {
  const bodyText = await frame.locator("body").first().innerText({ timeout: 5000 }).catch(() => "");
  const lines = String(bodyText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const idx = lines.findIndex((line, i) => line === "Empreendimento" && lines[i + 1] !== "Vendedora");
  return idx >= 0 ? lines[idx + 1] ?? "" : "";
}

async function selectionAppearsApplied(frame, name) {
  const bodyText = await frame.locator("body").first().innerText({ timeout: 5000 }).catch(() => "");
  const parsed = parseVisualCardText(bodyText, name);
  if (!parsed.error && sameEmpreendimento(parsed.data?.empreendimento?.nome, name)) return true;
  const slicerValue = await currentEmpreendimentoSlicerValue(frame);
  return slicerValue !== "" && slicerValue !== "All";
}

async function clickFirstVisible(locator, timeout) {
  const count = await locator.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const item = locator.nth(i);
    if (!(await item.isVisible().catch(() => false))) continue;
    await item.click({ timeout });
    return true;
  }
  return false;
}

async function tryClearSlicerSearch(frame, page) {
  for (const re of [/Search/i, /Buscar/i, /Filtrar/i, /search/i, /Find/i]) {
    const inp = frame.getByPlaceholder(re).first();
    if ((await inp.count()) === 0) continue;
    try {
      await inp.fill("", { timeout: 2000 });
      await page.waitForTimeout(250);
      return true;
    } catch (_) {}
  }
  const generic = frame.locator('input[type="search"]').first();
  if ((await generic.count()) > 0) {
    try {
      await generic.fill("", { timeout: 1500 });
      await page.waitForTimeout(200);
      return true;
    } catch (_) {}
  }
  return false;
}

async function wheelOnLocator(locator, page, deltaY) {
  try {
    await locator.hover({ timeout: 5000 });
    await page.mouse.wheel(0, deltaY);
  } catch (_) {}
}

async function mergeVisibleIntoDiscovered(frame, discovered) {
  const texts = await getVisibleOptionTexts(frame);
  let added = 0;
  for (const t of texts) {
    const s = t.trim();
    if (!s) continue;
    const before = discovered.size;
    discovered.add(s);
    if (discovered.size > before) added += 1;
  }
  return added;
}

async function getVisibleOptionTexts(frame) {
  return frame.evaluate(() =>
    Array.from(document.querySelectorAll('[role="option"]'))
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean)
  );
}

function visibleRangeLabel(visible) {
  if (visible.length === 0) return "none visible";
  return `visible="${visible[0]}" → "${visible[visible.length - 1]}" (${visible.length} rows)`;
}

async function openEmpreendimentoDropdown(frame, page, quiet) {
  log("  opening Empreendimento dropdown…", quiet);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  const dd = empreendimentoSlicerDropdown(frame).first();
  const slicer = empreendimentoSlicer(frame);

  const attempts = [
    async () => {
      const clicked = await clickEmpreendimentoDropdownInDom(frame);
      if (!clicked) throw new Error("Empreendimento slicer DOM node not found");
    },
    async () => {
      const handle = await findEmpreendimentoClickableHandle(frame);
      if (!handle) throw new Error("Empreendimento slicer DOM node not found");
      await handle.click({ timeout: 7000 });
      await handle.dispose().catch(() => {});
    },
    async () => dd.click({ timeout: 7000 }),
    async () => dd.click({ timeout: 7000, force: true }),
    async () =>
      clickFirstVisible(
        slicer.locator(
          '[role="combobox"], [aria-haspopup="listbox"], [data-testid="slicer-dropdown"], .slicer-dropdown'
        ),
        5000
      ),
    async () => {
      const box = await slicer.boundingBox();
      if (!box) throw new Error("Empreendimento slicer has no bounding box");
      await page.mouse.click(box.x + box.width - 28, box.y + Math.min(42, box.height / 2));
    },
  ];

  const failures = [];
  for (const [idx, attempt] of attempts.entries()) {
    try {
      log(`  dropdown open attempt ${idx + 1}/${attempts.length}…`, quiet);
      const clicked = await attempt();
      if (clicked === false) {
        failures.push("no visible dropdown candidate");
        continue;
      }
      await waitForListboxInDom(frame, 8000);
      await page.waitForTimeout(350);
      log(`  dropdown open attempt ${idx + 1} succeeded.`, quiet);
      return;
    } catch (err) {
      failures.push(errorMessage(err).split("\n")[0]);
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(250);
    }
  }

  throw new Error(`Unable to open Empreendimento slicer dropdown: ${failures.join(" | ")}`);
}

async function ensureEmpreendimentoDropdownOpen(frame, page, quiet) {
  if (await isListboxVisibleInDom(frame)) return;
  await openEmpreendimentoDropdown(frame, page, quiet);
}

async function ensureListboxFocused(frame, page) {
  const lb = frame.locator('[role="listbox"]').first();
  if ((await lb.count()) === 0) return null;
  await lb.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await lb.click({ position: { x: 8, y: 14 }, timeout: 5000 }).catch(() => {});
  return lb;
}

async function scrollListboxStep(lb, page, tick) {
  const phase = tick % 5;
  if (phase === 0 || phase === 3) {
    await lb.evaluate((el) => {
      el.scrollTop += Math.max(130, Math.floor(el.clientHeight * 0.92));
    });
  } else if (phase === 1) {
    await lb.press("PageDown").catch(() => {});
  } else if (phase === 4) {
    await wheelOnLocator(lb, page, 1100);
  } else {
    await lb.press("PageDown").catch(() => {});
    await wheelOnLocator(lb, page, 700);
  }
}

async function reopenDropdownFromTop(frame, page, quiet) {
  await openEmpreendimentoDropdown(frame, page, quiet);
  await tryClearSlicerSearch(frame, page);
  const lb = await ensureListboxFocused(frame, page);
  if (lb) {
    await lb.press("Home").catch(() => {});
    await page.waitForTimeout(600);
    log("  discovery: reopened slicer from top (virtual-list pass).", quiet);
  }
}

async function selectEmpreendimento(frame, page, name, settleMs) {
  await ensureEmpreendimentoDropdownOpen(frame, page);

  const option = frame.getByRole("option", { name, exact: true }).first();
  await option.waitFor({ state: "visible", timeout: 5000 });
  const attempts = [
    async () => option.click({ timeout: 7000 }),
    async () => {
      await option.focus({ timeout: 5000 });
      await page.keyboard.press("Space");
    },
    async () => {
      await option.focus({ timeout: 5000 });
      await page.keyboard.press("Enter");
    },
    async () => option.click({ timeout: 5000, force: true }),
    async () => {
      const clicked = await clickOptionInDom(frame, name);
      if (!clicked) throw new Error(`DOM option not found: ${name}`);
    },
  ];

  const failures = [];
  for (const [idx, attempt] of attempts.entries()) {
    try {
      if (idx > 0) await ensureEmpreendimentoDropdownOpen(frame, page);
      await attempt();
      await page.waitForTimeout(900);
      if (await selectionAppearsApplied(frame, name)) {
        await page.waitForTimeout(settleMs);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(450);
        return;
      }
      failures.push(`attempt ${idx + 1} did not change slicer`);
    } catch (err) {
      failures.push(`attempt ${idx + 1}: ${errorMessage(err).split("\n")[0]}`);
    }
  }

  throw new Error(`Visible option did not apply: ${name}; ${failures.join(" | ")}`);
}

async function waitForAccurateVisualCards(frame, page, name, quiet) {
  const timeoutMs = Math.max(
    5000,
    Number.parseInt(process.env.CRAWL_VISUAL_READY_TIMEOUT_MS ?? "45000", 10) || 45000
  );
  const deadline = Date.now() + timeoutMs;
  let lastReason = "not_checked";

  while (Date.now() < deadline) {
    const bodyText = await frame.locator("body").first().innerText();
    const parsed = parseVisualCardText(bodyText, name);

    if (parsed.error) {
      lastReason = parsed.error;
    } else {
      const parsedName = parsed.data?.empreendimento?.nome;
      const missing = missingCardLabels(parsed);
      if (!sameEmpreendimento(parsedName, name)) {
        lastReason = `selected_visual_mismatch expected="${name}" actual="${parsedName ?? ""}"`;
      } else {
        if (missing.length > 0) {
          log(
            `Visual cards for "${name}" are missing ${missing.length} label(s); writing available fields with parser nulls.`,
            quiet
          );
        }
        return parsed;
      }
    }

    await page.waitForTimeout(500);
  }

  log(`Visual cards did not become accurate for "${name}": ${lastReason}`, quiet);
  throw new Error(lastReason);
}

async function extractAndWrite({
  frame,
  page,
  name,
  index,
  totalHint,
  args,
  out,
  statePath,
  shotsRoot,
  quiet,
}) {
  const slug = slugify(name);
  const dest = jsonPathFor(out, name);
  const itemStart = Date.now();
  log(`[${index}${totalHint}] selecting “${name}”…`, quiet);
  await selectEmpreendimento(frame, page, name, args.settleMs);
  log(
    `[${index}${totalHint}] selected “${name}”; waiting for cards before writing ${path.relative(process.cwd(), dest)}`,
    quiet
  );
  log(`[${index}${totalHint}] extracting text + parsing (${Date.now() - itemStart}ms so far)…`, quiet);
  const parsed = await waitForAccurateVisualCards(frame, page, name, quiet).catch(async (err) => {
    const reason = err instanceof Error ? err.message : String(err);
    const msg = `[${index}${totalHint}] Parse failed for “${name}” (${slug}): ${reason}`;
    const dbgDir = debugDir();
    fs.mkdirSync(dbgDir, { recursive: true });
    const dbgPath = path.join(dbgDir, `${slug}.txt`);
    const bodyText = await frame.locator("body").first().innerText({ timeout: 5000 }).catch(() => "");
    fs.writeFileSync(dbgPath, `reason=${reason}\n\n${bodyText}`, "utf8");
    log(msg, quiet);
    console.error(msg);
    console.error(`debug text: ${path.relative(process.cwd(), dbgPath)}`);
    console.error("(exit 1 — no JSON written, crawl-state.json not updated for this item)");
    throw err;
  });

  log(`[${index}${totalHint}] parsed ${parsed.raw_cards?.length ?? 0} card row(s)`, quiet);

  if (usesEllipsis(parsed.data?.empreendimento?.nome)) {
    parsed.data.empreendimento.nome = name;
  }

  const payload = {
    metadata: {
      source_page: SOURCE_PAGE,
      source_url: SOURCE_URL,
      report: REPORT_ID,
      filter: FILTER_ID,
      filter_value: name,
      extraction_method: "playwright-visual-crawler",
      generated_at: new Date().toISOString(),
      crawl_log: [`empreendimento=${name}`, `slug=${slug}`].join("\n"),
    },
    data: parsed.data,
    raw_cards: parsed.raw_cards,
  };

  fs.writeFileSync(dest, JSON.stringify(payload, null, 2), "utf8");
  const rel = path.relative(process.cwd(), dest);
  log(`[${index}${totalHint}] wrote ${rel} (total ${Date.now() - itemStart}ms for this item)`, quiet);
  recordCrawlProgress(statePath, name, quiet);

  if (shotsRoot) {
    const sp = path.join(shotsRoot, `${slug}.png`);
    await page.screenshot({ path: sp, fullPage: true });
  }
  return rel;
}

function checkMinExpected(count, args, quiet) {
  const raw = process.env.CRAWL_MIN_EXPECTED_OPTIONS;
  const minExp = raw === undefined || raw === "" ? null : Number.parseInt(raw, 10);
  if (minExp === null || !Number.isFinite(minExp) || minExp <= 0) return;
  if (args.only || args.allowSmallList) return;
  if (count < minExp) {
    const msg = `FATAL: ${count} Empreendimento option(s) discovered; env CRAWL_MIN_EXPECTED_OPTIONS=${minExp}. Use --allow-small-list for dev or widen discovery (OPTION_DISCOVERY_* env).`;
    log(msg, quiet);
    console.error(msg);
    process.exit(1);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const out = outputDir();
  const statePath = crawlStatePath();
  const quiet = args.quiet;
  fs.mkdirSync(out, { recursive: true });
  ensureCrawlStateFile(statePath);

  if (args.refreshOptions) {
    writeCrawlState(statePath, {
      option_names: [],
      option_names_captured_at: null,
      options_count: 0,
    });
    log("--refresh-options: cleared cached option_names; will rebuild during discovery.", quiet);
  }

  const discovered = new Set();
  if (!args.refreshOptions) {
    const snap = readCrawlState(statePath);
    if (Array.isArray(snap.option_names)) {
      for (const x of snap.option_names) discovered.add(x);
      log(
        `Starting with ${discovered.size} name(s) from crawl-state (merged as new rows appear).`,
        quiet
      );
    }
  }

  log(`Starting crawl → ${SOURCE_URL}`, quiet);
  log(`Output directory: ${out}`, quiet);
  log(`Sync state: ${statePath}`, quiet);
  log(`Post-select settle wait: ${args.settleMs}ms (use --fast or --settle-ms=N to tune)`, quiet);

  const t0 = Date.now();
  const browser = await chromium.launch({ headless: args.headless });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(120000);

  const frame = await openPortalAndReport(page, quiet, t0);

  const shotsRoot = args.screenshots ? screenshotsDir() : null;
  if (shotsRoot) fs.mkdirSync(shotsRoot, { recursive: true });

  const STALE_LIMIT = Math.max(
    8,
    Number.parseInt(process.env.OPTION_DISCOVERY_STALE_SCROLLS ?? "72", 10) || 72
  );
  const MAX_REOPEN_PASSES = Math.max(
    0,
    Number.parseInt(process.env.OPTION_DISCOVERY_REOPEN_PASSES ?? "4", 10) || 4
  );

  const summary = [];
  let processed = 0;
  let stagnation = 0;
  let reopenPass = 0;
  let scrollTick = 0;
  let heartbeatTick = 0;

  try {
    if (args.only) {
      const dest = jsonPathFor(out, args.only);
      if (!args.force && fs.existsSync(dest)) {
        log(`--only: skip (exists): ${path.relative(process.cwd(), dest)}`, quiet);
      } else {
        const rel = await extractAndWrite({
          frame,
          page,
          name: args.only,
          index: 1,
          totalHint: "/1",
          args,
          out,
          statePath,
          shotsRoot,
          quiet,
        });
        summary.push(`wrote ${rel}`);
        processed += 1;
      }
      discovered.add(args.only);
      mergeOptionNamesIntoState(statePath, discovered, quiet);
      checkMinExpected(discovered.size, args, quiet);
    } else {
      log(
        `Incremental loop (stale_after=${STALE_LIMIT} scrolls, reopen_passes≤${MAX_REOPEN_PASSES}).`,
        quiet
      );

      while (processed < args.max) {
        await ensureEmpreendimentoDropdownOpen(frame, page, quiet);
        await tryClearSlicerSearch(frame, page);
        log("  focusing Empreendimento listbox…", quiet);
        const lb = await ensureListboxFocused(frame, page);
        if (!lb) {
          console.error("Empreendimento slicer listbox not found.");
          process.exit(1);
        }

        log("  reading visible Empreendimento options…", quiet);
        await mergeVisibleIntoDiscovered(frame, discovered);
        mergeOptionNamesIntoState(statePath, discovered, quiet);
        let visible = await getVisibleOptionTexts(frame);

        if (!args.dryList) {
          const visibleSet = new Set(visible);
          const pendingSorted = pendingExtractions(discovered, out, args.force, statePath);
          const next = pendingSorted.find((n) => visibleSet.has(n));
          if (next) {
            log(`  next visible pending option: “${next}” (${pendingSorted.length} pending known).`, quiet);
            try {
              const rel = await extractAndWrite({
                frame,
                page,
                name: next,
                index: processed + 1,
                totalHint: args.max !== Infinity ? `/${args.max}` : "",
                args,
                out,
                statePath,
                shotsRoot,
                quiet,
              });
              summary.push(`wrote ${rel}`);
              processed += 1;
            } catch (err) {
              const reason = errorMessage(err);
              if (!reason.startsWith("Visible option did not apply:")) throw err;
              recordSelectionFailure(statePath, next, reason, quiet);
              summary.push(`skipped ${next}: ${reason}`);
            }
            stagnation = 0;
            reopenPass = 0;
            continue;
          }
        }

        const sizeBefore = discovered.size;
        await scrollListboxStep(lb, page, scrollTick);
        scrollTick += 1;
        await page.waitForTimeout(args.fast ? 300 : 420);
        await mergeVisibleIntoDiscovered(frame, discovered);
        mergeOptionNamesIntoState(statePath, discovered, quiet);
        visible = await getVisibleOptionTexts(frame);

        if (discovered.size === sizeBefore) stagnation += 1;
        else stagnation = 0;

        heartbeatTick += 1;
        if (heartbeatTick % 10 === 0 || stagnation === STALE_LIMIT - 1) {
          const pendingCount = args.dryList
            ? "dry-list"
            : `${pendingExtractions(discovered, out, args.force, statePath).length} pending`;
          log(
            `  discovery scroll ${scrollTick}: ${discovered.size} unique, ${pendingCount}, stagnation ${stagnation}/${STALE_LIMIT}, ${visibleRangeLabel(visible)}`,
            quiet
          );
        }

        if (stagnation < STALE_LIMIT) continue;

        const pending = pendingExtractions(discovered, out, args.force, statePath);

        if (args.dryList) {
          if (reopenPass < MAX_REOPEN_PASSES) {
            reopenPass += 1;
            stagnation = 0;
            await reopenDropdownFromTop(frame, page, quiet);
            await mergeVisibleIntoDiscovered(frame, discovered);
            mergeOptionNamesIntoState(statePath, discovered, quiet);
            await page.keyboard.press("Escape");
            await page.waitForTimeout(280);
            continue;
          }
          log(
            `--dry-list: discovery stagnant after ${reopenPass} reopen pass(es); ${discovered.size} unique label(s).`,
            quiet
          );
          break;
        }

        if (pending.length === 0) {
          log(
            `No pending JSON files and discovery stagnant — finished (${discovered.size} labels seen).`,
            quiet
          );
          break;
        }

        if (reopenPass < MAX_REOPEN_PASSES) {
          reopenPass += 1;
          stagnation = 0;
          log(
            `Discovery stagnant with ${pending.length} pending extraction(s); reopen ${reopenPass}/${MAX_REOPEN_PASSES}…`,
            quiet
          );
          await reopenDropdownFromTop(frame, page, quiet);
          await mergeVisibleIntoDiscovered(frame, discovered);
          mergeOptionNamesIntoState(statePath, discovered, quiet);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(280);
          continue;
        }

        const msg = `FATAL: discovery stagnant — ${pending.length} Empreendimento(s) still missing JSON (try OPTION_DISCOVERY_STALE_SCROLLS / OPTION_DISCOVERY_REOPEN_PASSES).`;
        log(msg, quiet);
        console.error(msg);
        process.exit(1);
      }

      checkMinExpected(discovered.size, args, quiet);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  log(`Finished in ${Date.now() - t0}ms. Summary:\n${summary.join("\n")}`, quiet);
  if (quiet) process.stdout.write(`${summary.join("\n")}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
