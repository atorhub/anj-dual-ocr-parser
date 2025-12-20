document.addEventListener("DOMContentLoaded", () => {
  /* =========================
     SAFE DOM REFERENCES
  ========================== */
  const el = {
    file: document.getElementById("fileInput"),
    raw: document.getElementById("rawText"),
    clean: document.getElementById("cleanedText"),
    json: document.getElementById("jsonPreview"),
    status: document.getElementById("statusBar"),
    dual: document.getElementById("dualOCRBtn"),
    ocr: document.getElementById("ocrOnlyBtn"),
    parse: document.getElementById("parseBtn"),
    theme: document.getElementById("themeSelect"),
  };

  /* =========================
     STATE (SINGLE SOURCE)
  ========================== */
  const state = {
    ocrText: "",
    extractedText: "",
    finalText: "",
    parsed: null,
  };

  /* =========================
     STATUS HELPER
  ========================== */
  function setStatus(msg, error = false) {
    el.status.textContent = msg;
    el.status.style.color = error ? "#ff5f5f" : "#6bff95";
  }

  /* =========================
     THEME SWITCH (SAFE)
  ========================== */
  el.theme.addEventListener("change", () => {
    document.body.className = `theme-${el.theme.value}`;
  });

  /* =========================
     OCR (IMAGES ONLY)
  ========================== */
  async function runOCR(file) {
    try {
      if (!window.Tesseract) throw new Error("Tesseract missing");

      const res = await Tesseract.recognize(file, "eng", {
        logger: m => {
          if (m.status === "recognizing text") {
            setStatus(`OCR ${Math.round(m.progress * 100)}%`);
          }
        },
      });

      state.ocrText = res.data.text || "";
      return state.ocrText;
    } catch (e) {
      console.error("OCR failed:", e);
      return "";
    }
  }

  /* =========================
     TEXT EXTRACTION (PDF / ZIP)
  ========================== */
  async function extractText(file) {
    const name = file.name.toLowerCase();

    // ZIP → read .txt files
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

    // PDF → text layer
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

  /* =========================
     CLEANER (SAFE, NO AI)
  ========================== */
  function cleanText(raw) {
    if (!raw || typeof raw !== "string") return "";
    return raw
      .replace(/\r/g, "")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  /* =========================
     SIMPLE PARSER (PHASE 1)
  ========================== */
  function parseInvoice(text) {
    const result = {
      merchant: null,
      date: null,
      total: null,
      confidence: 0,
      rawLength: text.length,
    };

    const merchant = text.match(/^[A-Z0-9 &.,\-]{5,}$/m);
    if (merchant) {
      result.merchant = merchant[0];
      result.confidence += 30;
    }

    const total = text.match(/(?:total|amount)[^\d]{0,10}([\d,.]+)/i);
    if (total) {
      result.total = total[1];
      result.confidence += 30;
    }

    if (text.length > 200) result.confidence += 20;
    if (text.length > 500) result.confidence += 20;

    if (result.confidence > 100) result.confidence = 100;
    return result;
  }

  /* =========================
     CORE PIPELINE (STABLE)
  ========================== */
  async function processFile(useOCR) {
    try {
      const file = el.file.files[0];
      if (!file) return setStatus("No file selected", true);

      setStatus("Processing…");

      // reset
      state.ocrText = "";
      state.extractedText = "";
      state.finalText = "";
      state.parsed = null;

      // OCR only if image
      if (useOCR && file.type.startsWith("image/")) {
        await runOCR(file);
      }

      // Extract text (PDF / ZIP)
      state.extractedText = await extractText(file);

      // Choose best source
      state.finalText =
        state.extractedText.trim() || state.ocrText.trim();

      // Clean
      state.finalText = cleanText(state.finalText);

      // Parse
      state.parsed = parseInvoice(state.finalText);

      // UI
      el.raw.textContent = state.extractedText || state.ocrText || "-";
      el.clean.textContent = state.finalText || "-";
      el.json.textContent = JSON.stringify(state.parsed, null, 2);

      setStatus("Ready ✓");
    } catch (e) {
      console.error(e);
      setStatus("Processing failed ✖", true);
    }
  }

  /* =========================
     BUTTON HOOKS
  ========================== */
  el.dual.onclick = () => processFile(true);
  el.ocr.onclick = () => processFile(true);
  el.parse.onclick = () => {
    if (!state.finalText) return setStatus("No text to parse", true);
    el.json.textContent = JSON.stringify(state.parsed, null, 2);
    setStatus("Parsed ✓");
  };

  /* =========================
     READY
  ========================== */
  console.info("[ANJ] Script loaded cleanly");
});
