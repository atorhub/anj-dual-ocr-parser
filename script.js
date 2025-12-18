/****************************************************
 *  — CONFIG + GLOBAL STATE
 ****************************************************/

const TESSERACT_CONFIG = {
  workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@4.1.4/dist/worker.min.js",
  corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@4.0.4/tesseract-core.wasm.js",
  langPath: "https://cdn.jsdelivr.net/npm/tesseract.js@4.1.4/langs/"
};

let currentFile = null;
let ocrTextCache = "";

/* DOM ELEMENTS */
const fileInput = document.getElementById("fileInput");
const dualOCRBtn = document.getElementById("dualOCRBtn");
const ocrOnlyBtn = document.getElementById("ocrOnlyBtn");
const parseBtn = document.getElementById("parseBtn");

const rawText = document.getElementById("rawText");
const cleanedText = document.getElementById("cleanedText");
const jsonPreview = document.getElementById("jsonPreview");
const itemsTable = document.getElementById("itemsTable");

const merchantEl = document.getElementById("merchant");
const dateEl = document.getElementById("date");
const totalEl = document.getElementById("total");
const confidenceEl = document.getElementById("confidence");

const statusBar = document.getElementById("statusBar");
const themeSelect = document.getElementById("themeSelect");
/****************************************************
 *  — UI HELPERS + THEMES
 ****************************************************/

function setStatus(text) {
  if (statusBar) statusBar.textContent = text;
}

function applyTheme(name) {
  document.body.className = `theme-${name}`;
}

themeSelect?.addEventListener("change", e => {
  applyTheme(e.target.value);
});

fileInput?.addEventListener("change", e => {
  currentFile = e.target.files[0];
  setStatus(currentFile ? "File loaded ✓" : "No file selected");
});
/****************************************************
 *  — OCR ENGINE (IMAGES)
 *
 * FIXED:
 * - Explicit worker paths
 * - No silent failures
 ****************************************************/

async function runOCR(imageSource) {
  setStatus("Running OCR…");

  try {
    const result = await Tesseract.recognize(
      imageSource,
      "eng",
      {
        ...TESSERACT_CONFIG,
        logger: m => {
          if (m.status === "recognizing text") {
            setStatus(`OCR ${Math.round(m.progress * 100)}%`);
          }
        }
      }
    );

    const text = result?.data?.text?.trim() || "";
    if (!text) throw new Error("OCR returned empty text");

    rawText.textContent = text;
    cleanedText.textContent = text;
    ocrTextCache = text;

    setStatus("OCR completed ✓");
    return text;

  } catch (err) {
    console.error("OCR ERROR:", err);
    rawText.textContent = "❌ OCR failed. Check console.";
    cleanedText.textContent = "";
    setStatus("OCR failed ❌");
    return "";
  }
  }
/****************************************************
 *  — PDF HYBRID EXTRACTION
 *
 * NEW:
 * - Text-based PDF → extract directly
 * - Scanned PDF → render → OCR
 ****************************************************/

async function extractTextFromPDF(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.map(item => item.str).join(" ") + "\n";
  }

  return fullText.trim();
}

async function ocrScannedPDF(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  let finalText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    setStatus(`OCR page ${i}/${pdf.numPages}`);

    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const pageText = await runOCR(canvas);
    finalText += pageText + "\n";
  }

  return finalText.trim();
}

async function handlePDF(file) {
  setStatus("Reading PDF…");

  const text = await extractTextFromPDF(file);

  if (text && text.length > 50) {
    rawText.textContent = text;
    cleanedText.textContent = text;
    ocrTextCache = text;
    setStatus("PDF text extracted ✓");
    return text;
  }

  setStatus("Scanned PDF detected — running OCR…");
  return await ocrScannedPDF(file);
}
/****************************************************
 * — EVENTS + PARSER
 ****************************************************/

function parseText(text) {
  if (!text) return setStatus("No text to parse ❌");

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  merchantEl.textContent = lines[0] || "-";

  const totalLine = lines.find(l => /total/i.test(l));
  totalEl.textContent = totalLine || "-";

  confidenceEl.textContent = "Medium";

  jsonPreview.textContent = JSON.stringify({
    merchant: merchantEl.textContent,
    total: totalEl.textContent,
    rawText: text
  }, null, 2);

  setStatus("Parsing done ✓");
}

ocrOnlyBtn?.addEventListener("click", async () => {
  if (!currentFile) return setStatus("No file ❌");
  if (currentFile.type === "application/pdf") {
    await handlePDF(currentFile);
  } else {
    await runOCR(currentFile);
  }
});

dualOCRBtn?.addEventListener("click", async () => {
  if (!currentFile) return setStatus("No file ❌");

  let text = "";
  if (currentFile.type === "application/pdf") {
    text = await handlePDF(currentFile);
  } else {
    text = await runOCR(currentFile);
  }

  if (text) parseText(text);
});

parseBtn?.addEventListener("click", () => {
  parseText(ocrTextCache);
});

document.addEventListener("DOMContentLoaded", () => {
  setStatus("App ready ✓");
});
