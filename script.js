document.addEventListener("DOMContentLoaded", () => {
  console.log("[INFO] DOM ready");

  /* ===============================
     SAFE ELEMENT BINDINGS
  =============================== */
  const el = {
    file: document.getElementById("fileInput"),
    raw: document.getElementById("rawText"),
    clean: document.getElementById("cleanedText"),
    json: document.getElementById("jsonPreview"),
    status: document.getElementById("status"),
    dual: document.getElementById("dualBtn"),
    ocr: document.getElementById("ocrBtn"),
    parse: document.getElementById("parseBtn"),
    theme: document.getElementById("themeSelect")
  };

  /* ===============================
     SAFE STATE (SINGLE SOURCE)
  =============================== */
  const state = {
    ocrText: "",
    extractedText: "",
    finalText: "",
    parsed: {}
  };

  /* ===============================
     STATUS + DEBUG
  =============================== */
  function setStatus(msg, isError = false) {
    el.status.textContent = msg;
    el.status.style.color = isError ? "red" : "lime";
    console.log(isError ? "[ERROR]" : "[STATUS]", msg);
  }

  /* ===============================
     THEME (PURE UI – NO LOGIC)
  =============================== */
  if (el.theme) {
    el.theme.addEventListener("change", () => {
      document.body.className = "theme-" + el.theme.value;
      console.log("[THEME]", el.theme.value);
    });
  }

  /* ===============================
     OCR (IMAGE ONLY)
  =============================== */
  async function runOCR(file) {
    try {
      if (!window.Tesseract) throw new Error("Tesseract missing");
      setStatus("OCR running...");

      const res = await Tesseract.recognize(file, "eng", {
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

  /* ===============================
     TEXT EXTRACTION (PDF / ZIP)
  =============================== */
  async function extractText(file) {
    const name = file.name.toLowerCase();

    // ZIP
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

      const pdf = await pdfjsLib.getDocument(URL.createObjectURL(file)).promise;
      let text = "";

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(it => it.str).join(" ") + "\n";
      }
      return text;
    }

    return "";
  }

  /* ===============================
     CLEANER (SAFE, DUMB)
  =============================== */
  function cleanText(txt) {
    return txt
      .replace(/\s+/g, " ")
      .replace(/[^\x20-\x7E₹$€]/g, "")
      .trim();
  }

  /* ===============================
     PARSER (NO AI)
  =============================== */
  function parseInvoiceText(txt) {
    const result = {
      merchant: null,
      date: null,
      total: null,
      currency: null,
      confidence: 0
    };

    const lines = txt.split("\n");

    result.merchant = lines[0]?.slice(0, 80) || null;

    const totalMatch = txt.match(/(₹|\$|€)\s?\d+[.,]?\d*/);
    if (totalMatch) {
      result.total = totalMatch[0];
      result.currency = totalMatch[1];
      result.confidence += 40;
    }

    if (txt.length > 100) result.confidence += 30;
    if (result.merchant) result.confidence += 30;

    if (result.confidence > 100) result.confidence = 100;
    return result;
  }

  /* ===============================
     MAIN PIPELINE (ONE ENTRY)
  =============================== */
  async function processFile(useOCR) {
    console.log("[PIPELINE] processFile()");
    try {
      if (!el.file.files[0]) {
        setStatus("No file selected", true);
        return;
      }

      const file = el.file.files[0];
      setStatus("Processing...");

      // reset
      state.ocrText = "";
      state.extractedText = "";
      state.finalText = "";
      state.parsed = {};

      if (useOCR && file.type.startsWith("image/")) {
        await runOCR(file);
      }

      state.extractedText = await extractText(file);

      state.finalText =
        cleanText(state.extractedText) ||
        cleanText(state.ocrText);

      state.parsed = parseInvoiceText(state.finalText);

      // UI
      el.raw.textContent = state.extractedText || state.ocrText || "-";
      el.clean.textContent = state.finalText || "-";
      el.json.textContent = JSON.stringify(state.parsed, null, 2);

      setStatus("Parsed ✓");
    } catch (e) {
      console.error(e);
      setStatus("Processing failed", true);
    }
  }

  /* ===============================
     BUTTON BINDINGS (CRITICAL)
  =============================== */
  el.dual.addEventListener("click", () => processFile(true));
  el.ocr.addEventListener("click", () => processFile(true));
  el.parse.addEventListener("click", () => processFile(false));

});
