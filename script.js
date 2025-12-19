document.addEventListener("DOMContentLoaded", () => {
  const el = {
    file: document.getElementById("fileInput"),
    dual: document.getElementById("dualOCRBtn"),
    ocr: document.getElementById("ocrOnlyBtn"),
    parse: document.getElementById("parseBtn"),
    raw: document.getElementById("rawText"),
    clean: document.getElementById("cleanedText"),
    json: document.getElementById("jsonPreview"),
    status: document.getElementById("statusBar"),
    theme: document.getElementById("themeSelect")
  };

  let state = {
  ocrText: "",
  extractedText: "",
  finalText: "",
  analysis: null   // ← NEW
};
  

  const setStatus = (msg, err = false) => {
    el.status.textContent = msg;
    el.status.style.color = err ? "red" : "green";
  };

  /* THEME */
  el.theme.addEventListener("change", () => {
    document.body.className = "theme-" + el.theme.value;
  });

  /* OCR (UNCHANGED, DOES ITS OWN JOB) */
  async function runOCR(file) {
    try {
      const OCR = window.Tesseract || window.TesseractJS;
      if (!OCR) throw new Error("OCR engine missing");

      const res = await OCR.recognize(file, "eng", {
        logger: m => {
          if (m.status === "recognizing text") {
            setStatus(`OCR ${Math.round(m.progress * 100)}%`);
          }
        }
      });

      state.ocrText = res.data.text || "";
      return state.ocrText;
    } catch (e) {
      console.warn("OCR failed", e);
      return "";
    }
  }

  /* TEXT EXTRACTION (PDF / ZIP) */
  async function extractText(file) {
    const name = file.name.toLowerCase();

    if (name.endsWith(".zip")) {
      const zip = await JSZip.loadAsync(file);
      let text = "";
      for (const f of Object.values(zip.files)) {
        if (!f.dir && f.name.endsWith(".txt")) {
          text += await f.async("string") + "\n";
        }
      }
      return text;
    }

    if (name.endsWith(".pdf")) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

      const pdf = await pdfjsLib.getDocument(URL.createObjectURL(file)).promise;
      let text = "";

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(i => i.str).join(" ") + "\n";
      }
      return text;
    }

    return "";
  }

  /* ORCHESTRATION (THIS WAS MISSING BEFORE) */
  async function processFile(useOCR) {
    try {
      const file = el.file.files[0];
      if (!file) return setStatus("No file selected", true);

      setStatus("Processing…");

      state.ocrText = "";
      state.extractedText = "";

      // Run independently
      if (useOCR && file.type.startsWith("image/")) {
        await runOCR(file);
      }

    state.extractedText = await extractText(file);

// Choose best available text FIRST
state.finalText =
  state.extractedText.trim() ||
  state.ocrText.trim();

// STEP A: Clean text
state.finalText = cleanExtractedText(state.finalText);
// STEP A.5: Analyze cleaned text (read-only)
state.analysis = analyzeText(state.finalText);
      
// STEP B: Parse cleaned text
state.parsed = parseInvoiceText(state.finalText, state.analysis);
      
  // STEP C: UI Mapping (safe)
el.raw.textContent = state.extractedText || "-";
el.clean.textContent = state.finalText || "-";
el.json.textContent = JSON.stringify(state.parsed, null, 2);

// Optional summary fields
if (document.getElementById("summaryMerchant"))
  summaryMerchant.textContent = state.parsed.merchant || "-";

if (document.getElementById("summaryDate"))
  summaryDate.textContent = state.parsed.date || "-";

if (document.getElementById("summaryTotal"))
  summaryTotal.textContent = state.parsed.total || "-";

if (document.getElementById("summaryConfidence"))
  summaryConfidence.textContent =
    state.parsed.confidence ? state.parsed.confidence + "%" : "-";
      
      setStatus("Text ready ✓");
    } catch (e) {
      console.error(e);
      setStatus("Processing failed ❌", true);
    }
  }

  el.dual.onclick = () => processFile(true);
  el.ocr.onclick = () => processFile(true);

  el.parse.onclick = () => {
    if (!state.finalText) {
      return setStatus("No text to parse", true);
    }
    el.json.textContent = JSON.stringify(state.parsed, null, 2);
    

    setStatus("Parsed ✓");
  };
});
/* ===============================
   STEP A: TEXT CLEANER (SAFE)
   =============================== */

/**
 * Clean extracted text without altering meaning.
 * Works for PDF text & OCR text.
 */
function cleanExtractedText(rawText) {
  if (!rawText || typeof rawText !== "string") return "";

  // 1. Normalize line breaks
  let lines = rawText
    .replace(/\r/g, "")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // 2. Remove duplicate consecutive lines (PDF header repeats)
  const deduped = [];
  let lastLine = "";

  for (const line of lines) {
    if (line !== lastLine) {
      deduped.push(line);
      lastLine = line;
    }
  }

  // 3. Collapse excessive spaces (keep currency + numbers intact)
  const cleaned = deduped.map(line =>
    line.replace(/\s{2,}/g, " ")
  );

  // 4. Final joined text
  return cleaned.join("\n");
}
/* =========================================================
   PHASE 1 · STEP 2
   IMPROVED DETERMINISTIC PARSER (NO AI)
   ========================================================= */

function parseInvoiceText(cleanText, analysis) {
  const result = {
    merchant: null,
    date: null,
    currency: null,
    total: null,
    confidence: 0,
    confidenceBreakdown: {
      merchant: false,
      date: false,
      currency: false,
      total: false,
      textLength: false
    },
    rawLength: cleanText ? cleanText.length : 0
  };

  if (!cleanText || !analysis) return result;

  /* ---------------------------
     MERCHANT DETECTION
     --------------------------- */
  const ignoreWords = /invoice|tax|gst|receipt|bill|cash|order/i;

  let bestMerchant = null;
  let bestScore = 0;

  analysis.headerCandidates.forEach(line => {
    let score = 0;

    if (line.length > 6) score += 1;
    if (line === line.toUpperCase()) score += 2;
    if (!/\d/.test(line)) score += 1;
    if (!ignoreWords.test(line)) score += 2;

    if (score > bestScore) {
      bestScore = score;
      bestMerchant = line;
    }
  });

  if (bestScore >= 3) {
    result.merchant = bestMerchant;
    result.confidenceBreakdown.merchant = true;
  }

  /* ---------------------------
     DATE DETECTION
     --------------------------- */
  if (analysis.dateCandidates.length) {
    result.date = analysis.dateCandidates[0];
    result.confidenceBreakdown.date = true;
  }

  /* ---------------------------
     CURRENCY DETECTION
     --------------------------- */
  const currencyMap = [
    { re: /₹|rs\.?|inr/i, val: "INR" },
    { re: /\$/i, val: "USD" },
    { re: /€/i, val: "EUR" },
    { re: /£/i, val: "GBP" },
    { re: /aed/i, val: "AED" }
  ];

  for (const line of analysis.currencyCandidates) {
    for (const c of currencyMap) {
      if (c.re.test(line)) {
        result.currency = c.val;
        result.confidenceBreakdown.currency = true;
        break;
      }
    }
    if (result.currency) break;
  }

  /* ---------------------------
     TOTAL DETECTION
     --------------------------- */
  let highestAmount = 0;

  analysis.totalCandidates.forEach(line => {
    const matches = line.match(/[\₹$€£]?\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?/g);
    if (!matches) return;

    matches.forEach(raw => {
      const value = parseFloat(
        raw.replace(/[^\d.]/g, "")
      );
      if (!isNaN(value) && value > highestAmount) {
        highestAmount = value;
        result.total = raw.trim();
      }
    });
  });

  if (result.total) {
    result.confidenceBreakdown.total = true;
  }

  /* ---------------------------
     TEXT LENGTH SIGNAL
     --------------------------- */
  if (cleanText.length > 300) {
    result.confidenceBreakdown.textLength = true;
  }

  /* ---------------------------
     CONFIDENCE SCORE
     --------------------------- */
  Object.values(result.confidenceBreakdown).forEach(v => {
    if (v) result.confidence += 20;
  });

  if (result.confidence > 100) result.confidence = 100;

  return result;
}

