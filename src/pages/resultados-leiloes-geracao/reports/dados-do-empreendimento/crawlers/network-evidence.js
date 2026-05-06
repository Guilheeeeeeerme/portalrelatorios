/** Attach listeners that capture Power BI `/query` traffic for api_evidence (non-blocking). */

function attachQueryEvidence(page, bucket, { maxEntries = 120 } = {}) {
  page.on("request", (req) => {
    const url = req.url();
    if (!url.includes("/query")) return;
    let bodySnippet = "";
    try {
      const body = req.postData();
      if (body && body.length < 6000) bodySnippet = body.slice(0, 1200);
    } catch (_) {}
    bucket.push({
      at: new Date().toISOString(),
      method: req.method(),
      url: url.slice(0, 600),
      body_preview: bodySnippet || undefined,
    });
    while (bucket.length > maxEntries) bucket.shift();
  });
}

module.exports = { attachQueryEvidence };
