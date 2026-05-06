const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(180000);
  try {
    await page.goto(
      "https://portalrelatorios.aneel.gov.br/resultadosLeiloes/leiloesGeracaoPortugues#",
      { waitUntil: "domcontentloaded" }
    );
    await page.waitForTimeout(3000);
    await page.getByText("Dados do Empreendimento", { exact: true }).first().click();
    await page.waitForTimeout(6000);

    const iframe = page.frameLocator("iframe[src*='powerbi.com']");
    await iframe.getByText("DADOS DOS EMPREENDIMENTOS", { exact: true }).click();
    await page.waitForTimeout(10000);

    const iframeBody = await iframe.locator("body").first().innerText();
    console.log("iframe body sample (first 10000 chars):\n", iframeBody.slice(0, 10000));
  } finally {
    await browser.close();
  }
})();
