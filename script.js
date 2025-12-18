/***********************
 * CONFIG + GLOBAL STATE
 ***********************/
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.js";

const TESSERACT_CONFIG = {
  workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@4.1.4/dist/worker.min.js",
  corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@4.0.4/tesseract-core.wasm.js",
  langPath: "https://cdn.jsdelivr.net/npm/tesseract.js@4.1.4/langs/"
};

let currentFile = null;
let ocrTextCache = "";
/***********************
 * DOM ELEMENTS
 ***********************/
const fileInput = document.getElementById("fileInput");
const dualOCRBtn = document.getElementById("dualOCRBtn");
const ocrOnlyBtn = document.getElementById("ocrOnlyBtn");
const parseBtn = document.getElementById("parseBtn");

const rawText = document.getElementById("rawText");
const cleanedText = document.getElementById("cleanedText");
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

themeSelect.addEventListener("change", e => {
  document.body.className = `theme-${e.target.value}`;
});

fileInput.addEventListener("change", e => {
  currentFile = e.target.files[0];
  setStatus(currentFile ? "File loaded ✓" : "No file selected");
});
async function runImageOCR(imageSource) {
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

  const text = result.data.text.trim();
  if (!text) throw new Error("OCR returned empty text");

  rawText.textContent = text;
  cleanedText.textContent = text;
  ocrTextCache = text;

  setStatus("OCR completed ✓");
  return text;
}

async function extractPDFText(file) {
  setStatus("Extracting PDF text…");

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(i => i.str).join(" ") + "\n";
  }

  return text.trim();
}
dualOCRBtn.addEventListener("click", async () => {
  if (!currentFile) {
    setStatus("No file selected");
    return;
  }

  try {
    if (currentFile.type === "application/pdf") {
      const pdfText = await extractPDFText(currentFile);

      if (pdfText.length > 30) {
        rawText.textContent = pdfText;
        cleanedText.textContent = pdfText;
        ocrTextCache = pdfText;
        setStatus("PDF text extracted ✓");
      } else {
        setStatus("PDF empty → OCR fallback");
        await runImageOCR(URL.createObjectURL(currentFile));
      }
    } else {
      await runImageOCR(currentFile);
    }
  } catch (err) {
    console.error(err);
    setStatus("OCR failed ❌");
  }
});

ocrOnlyBtn.addEventListener("click", async () => {
  if (!currentFile) return setStatus("No file selected");
  await runImageOCR(currentFile);
});
