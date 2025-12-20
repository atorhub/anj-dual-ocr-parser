document.addEventListener("DOMContentLoaded", () => {
  // ===== BOOTSTRAP A: SAFE ELEMENT MAP =====
const el = {
  file: document.getElementById("fileInput"),
  raw: document.getElementById("rawText"),
  clean: document.getElementById("cleanedText"),
  json: document.getElementById("jsonPreview"),
  status: document.getElementById("status"),
  dual: document.getElementById("dualBtn"),
  ocr: document.getElementById("ocrBtn"),
  parse: document.getElementById("parseBtn"),
  theme: document.getElementById("themeSelect"),
};

// ===== BOOTSTRAP A.5: SAFE STATE =====
const state = {
  ocrText: "",
  extractedText: "",
  finalText: "",
  parsed: null,
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

    // ===== BOOTSTRAP B: SAFE PROCESS PIPELINE =====
async function processFile(useOCR) {
  try {
    if (!el.file || !el.file.files[0]) {
      setStatus("No file selected", true);
      return;
    }

    const file = el.file.files[0];
    setStatus("Processing…");

    // reset state safely
    state.ocrText = "";
    state.extractedText = "";
    state.finalText = "";
    state.parsed = null;

    // OCR only if image
    if (useOCR && file.type.startsWith("image/")) {
      try {
        state.ocrText = await runOCR(file);
      } catch {
        state.ocrText = "";
      }
    }

    try {
      state.extractedText = await extractText(file);
    } catch {
      state.extractedText = "";
    }

    // choose best available text
    state.finalText =
      (state.extractedText || "").trim() ||
      (state.ocrText || "").trim() ||
      "";

    // clean text (safe)
    state.finalText = cleanExtractedText(state.finalText);

    // parse (safe)
    try {
      state.parsed = parseInvoiceText(state.finalText);
    } catch {
      state.parsed = null;
    }

    renderUI();
    setStatus("Text ready ✓");
  } catch (err) {
    console.error(err);
    setStatus("Processing failed ❌", true);
  }
}
   // ===== BOOTSTRAP C: SINGLE RENDER =====
function renderUI() {
  if (el.raw) el.raw.textContent = state.extractedText || "-";
  if (el.clean) el.clean.textContent = state.finalText || "-";
  if (el.json)
    el.json.textContent = JSON.stringify(state.parsed || {}, null, 2);
}
    if (el.dual) el.dual.onclick = () => processFile(true);
if (el.ocr) el.ocr.onclick = () => processFile(true);
if (el.parse)
  el.parse.onclick = () => {
    if (!state.finalText) {
      setStatus("No text to parse", true);
      return;
    }
    try {
      state.parsed = parseInvoiceText(state.finalText);
      renderUI();
      setStatus("Parsed ✓");
    } catch {
      setStatus("Parse failed ❌", true);
    }
  };
  

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

