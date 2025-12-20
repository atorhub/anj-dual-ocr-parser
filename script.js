document.addEventListener("DOMContentLoaded", () => {
  /* =========================
     SAFE QUERY (NO CRASH)
  ========================== */
  const $ = (id) => document.getElementById(id) || null;

  const el = {
    file: $("fileInput"),
    raw: $("rawText"),
    clean: $("cleanedText"),
    json: $("jsonPreview"),
    status: $("statusBar"),
    dual: $("dualOCRBtn"),
    ocr: $("ocrOnlyBtn"),
    parse: $("parseBtn"),
    theme: $("themeSelect"),
  };

  /* =========================
     STATUS (SAFE)
  ========================== */
  function setStatus(msg, error = false) {
    if (!el.status) return;
    el.status.textContent = msg;
    el.status.style.color = error ? "#ff5f5f" : "#6bff95";
  }

  /* =========================
     DEBUG VISIBILITY
  ========================== */
  console.info("[ANJ] script.js loaded");
  Object.entries(el).forEach(([k, v]) => {
    if (!v) console.warn(`[ANJ] Missing element: ${k}`);
  });

  /* =========================
     STATE
  ========================== */
  const state = {
    extracted: "",
    ocr: "",
    final: "",
    parsed: null,
  };

  /* =========================
     THEME (NON-BLOCKING)
  ========================== */
  if (el.theme) {
    el.theme.addEventListener("change", () => {
      document.body.className = `theme-${el.theme.value}`;
    });
  }

  /* =========================
     OCR (IMAGES ONLY)
  ========================== */
  async function runOCR(file) {
    if (!window.Tesseract) {
      setStatus("Tesseract not loaded", true);
      return "";
    }

    const res = await Tesseract.recognize(file, "eng", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          setStatus(`OCR ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    return res?.data?.text || "";
  }

  /* =========================
     PDF / ZIP EXTRACTION
  ========================== */
  async function extractText(file) {
    const name = file.name.toLowerCase();

    if (name.endsWith(".zip") && window.JSZip) {
      const zip = await JSZip.loadAsync(file);
      let txt = "";
      for (const f of Object.values(zip.files)) {
        if (!f.dir && f.name.endsWith(".txt")) {
          txt += await f.async("string") + "\n";
        }
      }
      return txt;
    }

    if (name.endsWith(".pdf") && window.pdfjsLib) {
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
     CLEANER
  ========================== */
  function cleanText(t) {
    return (t || "")
      .replace(/\r/g, "")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  /* =========================
     PARSER (PHASE-1)
  ========================== */
  function parseText(t) {
    return {
      length: t.length,
      hasNumbers: /\d/.test(t),
      preview: t.slice(0, 200),
    };
  }

  /* =========================
     PIPELINE (SINGLE ENTRY)
  ========================== */
  async function processFile(useOCR) {
    if (!el.file || !el.file.files.length) {
      setStatus("No file selected", true);
      return;
    }

    try {
      setStatus("Processing…");

      const file = el.file.files[0];
      state.extracted = "";
      state.ocr = "";
      state.final = "";
      state.parsed = null;

      if (useOCR && file.type.startsWith("image/")) {
        state.ocr = await runOCR(file);
      }

      state.extracted = await extractText(file);
      state.final = cleanText(state.extracted || state.ocr);
      state.parsed = parseText(state.final);

      if (el.raw) el.raw.textContent = state.extracted || state.ocr || "-";
      if (el.clean) el.clean.textContent = state.final || "-";
      if (el.json) el.json.textContent = JSON.stringify(state.parsed, null, 2);

      setStatus("Ready ✓");
    } catch (e) {
      console.error(e);
      setStatus("Failed", true);
    }
  }

  /* =========================
     BUTTON WIRING (SAFE)
  ========================== */
  if (el.dual) el.dual.onclick = () => processFile(true);
  if (el.ocr) el.ocr.onclick = () => processFile(true);
  if (el.parse)
    el.parse.onclick = () => {
      if (el.json && state.parsed) {
        el.json.textContent = JSON.stringify(state.parsed, null, 2);
        setStatus("Parsed ✓");
      }
    };

  setStatus("Ready");
});
