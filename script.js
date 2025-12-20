/* ===============================
   GLOBAL STATE (single owner)
================================ */

const state = {
  rawText: "",
  cleanedText: "",
  analysis: null,
  parsed: null
};

/* ===============================
   DOM HELPERS
================================ */

const el = {
  file: document.getElementById("fileInput"),
  output: document.getElementById("output"),
  status: document.getElementById("status")
};

function setStatus(msg, error = false) {
  el.status.textContent = msg;
  el.status.style.color = error ? "red" : "#6cf";
}

/* ===============================
   OCR (PURE FUNCTION)
================================ */

async function runOCR(file) {
  try {
    const { data } = await Tesseract.recognize(file, "eng", {
      logger: m => {
        if (m.status === "recognizing text") {
          setStatus(`OCR ${Math.round(m.progress * 100)}%`);
        }
      }
    });
    return data.text || "";
  } catch (e) {
    console.warn("OCR failed", e);
    return "";
  }
}

/* ===============================
   PDF / ZIP TEXT EXTRACTION
   (PURE FUNCTION)
================================ */

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
      text += content.items.map(i => i.str).join(" ") + "\n";
    }
    return text;
  }

  return "";
}

/* ===============================
   A — CLEAN TEXT
================================ */

function cleanText(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

/* ===============================
   A.5 — ANALYSIS (NO AI)
================================ */

function analyzeText(text) {
  const result = {
    confidence: 0,
    confidenceBreakdown: {
      hasDate: /\d{2}[-/]\d{2}[-/]\d{4}/.test(text),
      hasAmount: /₹|\btotal\b|\bamount\b/i.test(text),
      hasInvoice: /invoice|bill|receipt/i.test(text),
      textLength: text.length > 300
    }
  };

  Object.values(result.confidenceBreakdown).forEach(v => {
    if (v) result.confidence += 25;
  });

  if (result.confidence > 100) result.confidence = 100;
  return result;
}

/* ===============================
   B — PARSE (BASIC)
================================ */

function parseText(text) {
  const totalMatch = text.match(/total[:\s]*₹?\s?([\d,.]+)/i);

  return {
    total: totalMatch ? totalMatch[1] : null,
    rawPreview: text.slice(0, 400)
  };
}

/* ===============================
   C — UI RENDER
================================ */

function render() {
  el.output.textContent = JSON.stringify(
    {
      cleanedText: state.cleanedText,
      analysis: state.analysis,
      parsed: state.parsed
    },
    null,
    2
  );
}

/* ===============================
   🚀 BOOTSTRAP PIPELINE
   (ONLY OWNER OF STATE)
================================ */

async function processFile(useOCR) {
  try {
    if (!el.file.files[0]) {
      setStatus("No file selected", true);
      return;
    }

    setStatus("Processing...");
    const file = el.file.files[0];

    // RESET STATE (SAFE)
    state.rawText = "";
    state.cleanedText = "";
    state.analysis = null;
    state.parsed = null;

    // 1️⃣ SOURCE TEXT
    if (useOCR && file.type.startsWith("image/")) {
      state.rawText = await runOCR(file);
    } else {
      state.rawText = await extractText(file);
    }

    if (!state.rawText) {
      setStatus("No text extracted", true);
      return;
    }

    // 2️⃣ CLEAN
    state.cleanedText = cleanText(state.rawText);

    // 3️⃣ ANALYZE
    state.analysis = analyzeText(state.cleanedText);

    // 4️⃣ PARSE
    state.parsed = parseText(state.cleanedText);

    // 5️⃣ RENDER
    render();
    setStatus("Done ✓");
  } catch (e) {
    console.error(e);
    setStatus("Processing failed", true);
  }
}

/* ===============================
   BUTTON HOOKS
================================ */

window.runDualOCR = () => processFile(true);
window.runQuickOCR = () => processFile(false);
