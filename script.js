/*************************************************
 * PDF.js WORKER FIX (REQUIRED FOR GITHUB PAGES)
 *************************************************/
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.js";

/*************************************************
 * TESSERACT CONFIG (IMAGES ONLY)
 *************************************************/
const TESSERACT_CONFIG = {
  workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@4.1.4/dist/worker.min.js",
  corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@4.0.4/tesseract-core.wasm.js",
  langPath: "https://cdn.jsdelivr.net/npm/tesseract.js@4.1.4/langs/"
};

/*************************************************
 * GLOBAL STATE
 *************************************************/
let currentFile = null;
let ocrTextCache = "";
/*************************************************
 * DOM ELEMENTS
 *************************************************/
const fileInput   = document.getElementById("fileInput");
const dualOCRBtn  = document.getElementById("dualOCRBtn");
const parseBtn    = document.getElementById("parseBtn");

const rawText     = document.getElementById("rawText");
const cleanedText = document.getElementById("cleanedText");
const jsonPreview = document.getElementById("jsonPreview");

const merchantEl  = document.getElementById("merchant");
const dateEl      = document.getElementById("date");
const totalEl     = document.getElementById("total");
const confidenceEl= document.getElementById("confidence");

const statusBar   = document.getElementById("statusBar");
const themeSelect = document.getElementById("themeSelect");

/*************************************************
 * UI HELPERS
 *************************************************/
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
/*************************************************
 * PDF TEXT EXTRACTION (SAFE + STABLE)
 *************************************************/
async function extractTextFromPDF(file) {
  setStatus("Extracting PDF text…");

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(it => it.str).join(" ");
    fullText += pageText + "\n";
  }

  fullText = fullText.trim();

  rawText.textContent = fullText || "-";
  cleanedText.textContent = fullText || "-";
  ocrTextCache = fullText;

  setStatus("PDF extracted ✓");
  return fullText;
  }
/*************************************************
 * IMAGE OCR ONLY (JPG / PNG)
 *************************************************/
async function runOCR(imageSource) {
  setStatus("Running OCR…");

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

  rawText.textContent = text || "-";
  cleanedText.textContent = text || "-";
  ocrTextCache = text;

  setStatus("OCR completed ✓");
  return text;
}
/*************************************************
 * MAIN BUTTON LOGIC (NO DEADLOCK)
 *************************************************/
dualOCRBtn?.addEventListener("click", async () => {
  if (!currentFile) {
    setStatus("No file selected ❌");
    return;
  }

  try {
    if (currentFile.type === "application/pdf") {
      await extractTextFromPDF(currentFile);
    } else {
      await runOCR(currentFile);
    }
  } catch (err) {
    console.error(err);
    setStatus("Failed to process file ❌");
  }
});
