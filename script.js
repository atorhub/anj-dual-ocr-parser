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

function setStatus(text) {
  if (statusBar) statusBar.textContent = text;
}
async function runOCR(blobOrImage) {
  setStatus("Running OCR…");

  try {
    const result = await Tesseract.recognize(
      blobOrImage,
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

    if (!text) {
      throw new Error("OCR completed but returned empty text");
    }

    // ✅ ALWAYS SHOW RAW OCR
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

function applyTheme(name) {
  document.body.className = `theme-${name}`;
}

themeSelect?.addEventListener("change", e => {
  applyTheme(e.target.value);
});

/* File input */
fileInput?.addEventListener("change", e => {
  currentFile = e.target.files[0];
  setStatus(currentFile ? "File loaded ✓" : "No file");
});
function parseText(text) {
  if (!text) {
    setStatus("No text to parse ❌");
    return;
  }

  setStatus("Parsing…");

  // Very simple baseline parser (your logic can expand)
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  let merchant = lines[0] || "-";
  let total = lines.find(l => /total/i.test(l)) || "-";

  merchantEl.textContent = merchant;
  totalEl.textContent = total;
  dateEl.textContent = "-";
  confidenceEl.textContent = "Medium";

  jsonPreview.textContent = JSON.stringify({
    merchant,
    total,
    rawText: text
  }, null, 2);

  setStatus("Parsing done ✓");
        }
ocrOnlyBtn?.addEventListener("click", async () => {
  if (!currentFile) return setStatus("No file selected ❌");
  const text = await runOCR(currentFile);
});

dualOCRBtn?.addEventListener("click", async () => {
  if (!currentFile) return setStatus("No file selected ❌");
  const text = await runOCR(currentFile);
  if (text) parseText(text);
});

parseBtn?.addEventListener("click", () => {
  parseText(ocrTextCache);
});

document.addEventListener("DOMContentLoaded", () => {
  setStatus("App ready ✓");
});
