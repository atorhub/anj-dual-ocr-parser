document.addEventListener("DOMContentLoaded", () => {
  /* ========= SAFE ELEMENT MAP ========= */
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

  /* ========= SAFE STATE ========= */
  const state = {
    ocrText: "",
    extractedText: "",
    finalText: "",
    parsed: {},
    analysis: {},
  };

  /* ========= STATUS ========= */
  const setStatus = (msg, err = false) => {
    if (!el.status) return;
    el.status.textContent = msg;
    el.status.style.color = err ? "red" : "green";
  };

  /* ========= THEME (SAFE) ========= */
  if (el.theme) {
    el.theme.addEventListener("change", () => {
      document.body.className = "theme-" + el.theme.value;
    });
  }

  /* ========= OCR (DOES ITS OWN JOB) ========= */
  async function runOCR(file) {
    try {
      const OCR = window.Tesseract || window.TesseractJS;
      if (!OCR) throw new Error("OCR missing");

      const res = await OCR.recognize(file, "eng", {
        logger: m => {
          if (m.status === "recognizing text") {
            setStatus(`OCR ${Math.round(m.progress * 100)}%`);
          }
        },
      });

      state.ocrText = res?.data?.text || "";
      return state.ocrText;
    } catch (e) {
      console.warn("OCR failed", e);
      return "";
    }
  }

  /* ========= TEXT EXTRACTION (PDF / ZIP) ========= */
  async function extractText(file) {
    const name = file.name.toLowerCase();

    // ZIP (txt files)
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

    // PDF
    if (name.endsWith(".pdf")) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

      const pdf = await pdfjsLib.getDocument(
        URL.createObjectURL(file)
      ).promise;

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

  /* ========= STEP A: CLEAN TEXT ========= */
  function cleanExtractedText(raw) {
    if (!raw || typeof raw !== "string") return "";
    return raw
      .replace(/\r/g, "")
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .join("\n");
  }

  /* ========= STEP A.5: ANALYSIS (READ-ONLY) ========= */
  function analyzeText(cleanText) {
    const result = {
      hasInvoice: /invoice/i.test(cleanText),
      hasTotal: /total/i.test(cleanText),
      lengthOK: cleanText.length > 50,
      confidence: 0,
    };

    Object.values(result).forEach(v => {
      if (v === true) result.confidence += 25;
    });

    if (result.confidence > 100) result.confidence = 100;
    return result;
  }

  /* ========= STEP B: PARSER (RULE-BASED) ========= */
  function parseInvoiceText(text) {
    if (!text) return {};

    const out = {
      merchant: null,
      date: null,
      currency: null,
      total: null,
      confidence: 0,
    };

    const lines = text.split("\n");

    out.merchant = lines[0] || null;

    const totalMatch = text.match(/(?:total|amount)\s*[:\-]?\s*₹?\$?\s*([\d,]+\.?\d*)/i);
    if (totalMatch) out.total = totalMatch[1];

    const dateMatch = text.match(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/);
    if (dateMatch) out.date = dateMatch[0];

    if (out.total) out.confidence += 40;
    if (out.merchant) out.confidence += 30;
    if (out.date) out.confidence += 30;

    if (out.confidence > 100) out.confidence = 100;
    return out;
  }

  /* ========= BOOTSTRAP: SAFE PIPELINE ========= */
  async function processFile(useOCR) {
    try {
      if (!el.file || !el.file.files[0]) {
        setStatus("No file selected", true);
        return;
      }

      const file = el.file.files[0];
      setStatus("Processing...");

      // reset state
      state.ocrText = "";
      state.extractedText = "";
      state.finalText = "";
      state.parsed = {};
      state.analysis = {};

      // OCR (optional, never blocks)
      if (useOCR && file.type.startsWith("image/")) {
        try { await runOCR(file); } catch (_) {}
      }

      // Extraction (always runs)
      try {
        state.extractedText = await extractText(file);
      } catch (_) {
        state.extractedText = "";
      }

      // choose best text
      state.finalText =
        (state.extractedText && state.extractedText.trim()) ||
        (state.ocrText && state.ocrText.trim()) ||
        "";

      // clean
      state.finalText = cleanExtractedText(state.finalText);

      // analysis (non-blocking)
      try {
        state.analysis = analyzeText(state.finalText);
      } catch (_) {
        state.analysis = {};
      }

      // parse (non-blocking)
      try {
        const p = parseInvoiceText(state.finalText);
        state.parsed = p && typeof p === "object" ? p : {};
      } catch (_) {
        state.parsed = {};
      }

      // UI render (always)
      el.raw.textContent = state.extractedText || state.ocrText || "";
      el.clean.textContent = state.finalText || "";
      el.json.textContent = JSON.stringify(state.parsed || {}, null, 2);

      setStatus("Done ✓");
    } catch (e) {
      console.warn("Non-fatal pipeline error", e);
      setStatus("Done");
    }
  }

  /* ========= BUTTONS ========= */
  if (el.dual) el.dual.onclick = () => processFile(true);
  if (el.ocr) el.ocr.onclick = () => processFile(true);
  if (el.parse) el.parse.onclick = () => processFile(false);
});
      
