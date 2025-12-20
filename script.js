document.addEventListener("DOMContentLoaded", () => {

  /* ===============================
     BLACK BOX DEBUGGER
  ============================== */

  const debugBox = document.createElement("div");
  debugBox.style.cssText = `
    position:fixed;bottom:10px;right:10px;
    width:300px;max-height:40vh;
    overflow:auto;z-index:9999;
    background:#0b1020;color:#9ef;
    font:12px monospace;
    border:1px solid #334;
    padding:8px;border-radius:8px;
  `;
  document.body.appendChild(debugBox);

  function debug(msg, type = "info") {
    const line = document.createElement("div");
    const color =
      type === "error" ? "#f66" :
      type === "warn"  ? "#fd6" :
                         "#9ef";
    line.style.color = color;
    line.textContent = `[${type.toUpperCase()}] ${msg}`;
    debugBox.appendChild(line);
    debugBox.scrollTop = debugBox.scrollHeight;
  }

  debug("DOM ready");

  /* ===============================
     DOM ELEMENTS
  ============================== */

  const el = {
    file: document.getElementById("fileInput"),
    raw: document.getElementById("rawText"),
    clean: document.getElementById("cleanedText"),
    json: document.getElementById("jsonPreview"),
    status: document.getElementById("status"),
    run: document.getElementById("processBtn")
  };

  if (!el.file) {
    debug("fileInput missing", "error");
    return;
  }

  /* ===============================
     STATE (SINGLE OWNER)
  ============================== */

  const state = {
    finalText: "",
    parsed: {},
    analysis: {}
  };

  function setStatus(msg, err = false) {
    if (!el.status) return;
    el.status.textContent = msg;
    el.status.style.color = err ? "red" : "lime";
  }

  /* ===============================
     PURE HELPERS (NO STATE)
  ============================== */

  async function runOCR(file) {
    debug("OCR selected");
    if (!window.Tesseract) {
      debug("Tesseract missing", "error");
      return "";
    }
    const res = await Tesseract.recognize(file, "eng");
    return res?.data?.text || "";
  }

  async function extractPDF(file) {
    debug("PDF selected");
    if (!window.pdfjsLib) {
      debug("pdfjsLib missing", "error");
      return "";
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    const pdf = await pdfjsLib.getDocument(URL.createObjectURL(file)).promise;
    let text = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      debug(`PDF page ${i}/${pdf.numPages}`);
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(i => i.str).join(" ") + "\n";
    }
    return text;
  }

  async function extractZIP(file) {
    debug("ZIP selected");
    if (!window.JSZip) {
      debug("JSZip missing", "error");
      return "";
    }

    const zip = await JSZip.loadAsync(file);
    let text = "";

    for (const f of Object.values(zip.files)) {
      if (!f.dir && f.name.endsWith(".txt")) {
        text += await f.async("string") + "\n";
      }
    }
    return text;
  }

  function cleanText(t) {
    return t.replace(/\s+/g, " ").trim();
  }

  function parseText(t) {
    const m = t.match(/total[:\s]*₹?\s?([\d,.]+)/i);
    return { total: m ? m[1] : null };
  }

  /* ===============================
     PIPELINE (ONLY STATE WRITER)
  ============================== */

  async function processFile() {
    try {
      if (!el.file.files[0]) {
        setStatus("No file selected", true);
        debug("No file selected", "warn");
        return;
      }

      const file = el.file.files[0];
      debug(`File: ${file.name}`);

      state.finalText = "";
      state.parsed = {};
      state.analysis = {};

      let raw = "";

      if (file.type.startsWith("image/")) {
        raw = await runOCR(file);
      } else if (file.name.endsWith(".pdf")) {
        raw = await extractPDF(file);
      } else if (file.name.endsWith(".zip")) {
        raw = await extractZIP(file);
      } else {
        debug("Unsupported file type", "error");
      }

      if (!raw) {
        setStatus("No text extracted", true);
        debug("Extraction returned empty", "error");
        return;
      }

      state.finalText = cleanText(raw);
      state.parsed = parseText(state.finalText);

      el.raw.textContent = raw;
      el.clean.textContent = state.finalText;
      el.json.textContent = JSON.stringify(state.parsed, null, 2);

      setStatus("Done ✓");
      debug(`Done. Text length: ${state.finalText.length}`);

    } catch (e) {
      debug(e.message || "Unknown error", "error");
      setStatus("Failed", true);
    }
  }

  /* ===============================
     EVENTS
  ============================== */

  if (el.run) el.run.onclick = processFile;

});
       
