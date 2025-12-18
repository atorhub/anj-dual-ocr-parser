/****************************************************
 * CONFIG + GLOBAL STATE
 ****************************************************/

const TESSERACT_CONFIG = {
  workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@4.1.4/dist/worker.min.js",
  corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@4.0.4/tesseract-core.wasm.js",
  langPath: "https://cdn.jsdelivr.net/npm/tesseract.js@4.1.4/langs/"
};

let currentFile = null;
let ocrTextCache = "";

/****************************************************
 * DOM ELEMENTS
 ****************************************************/

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
 * UI HELPERS
 ****************************************************/

function setStatus(text) {
  if (statusBar) statusBar.textContent = text;
}

themeSelect?.addEventListener("change", e => {
  document.body.className = `theme-${e.target.value}`;
});

fileInput?.addEventListener("change", e => {
  currentFile = e.target.files[0];
  setStatus(currentFile ? "File loaded ✓" : "No file selected");
});

/****************************************************
 * OCR ENGINE (IMAGES)
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
    console.error(err);
    setStatus("OCR failed ❌");
    return "";
  }
}

/****************************************************
 * PDF HANDLING (USES PDF.JS FROM INDEX.HTML)
 ****************************************************/

async function extractTextFromPDF(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.map(i => i.str).join(" ") + "\n";
  }

  return fullText.trim();
}

async function ocrScannedPDF(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  let text = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    setStatus(`OCR page ${i}/${pdf.numPages}`);

    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;

    text += (await runOCR(canvas)) + "\n";
  }

  return text.trim();
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
 * ITEM TABLE DETECTION (STEP 1)
 ****************************************************/

function extractItems(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const items = [];

  for (const line of lines) {
    // Example: Bread 2 40 80
    const match = line.match(
      /^(.+?)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/
    );

    if (match) {
      items.push({
        name: match[1],
        qty: match[2],
        price: match[3],
        total: match[4]
      });
    }
  }

  return items;
}

function renderItems(items) {
  itemsTable.innerHTML = "";

  if (!items.length) {
    itemsTable.innerHTML = "<tr><td colspan='4'>No items detected</td></tr>";
    return;
  }

  for (const item of items) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.name}</td>
      <td>${item.qty}</td>
      <td>${item.price}</td>
      <td>${item.total}</td>
    `;
    itemsTable.appendChild(row);
  }
}

/****************************************************
 * PARSER
 ****************************************************/

function parseText(text) {
  if (!text) return setStatus("No text to parse ❌");

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  merchantEl.textContent = lines[0] || "-";

  const totalLine = lines.find(l => /total/i.test(l));
  totalEl.textContent = totalLine || "-";

  const items = extractItems(text);
  renderItems(items);

  confidenceEl.textContent = items.length ? "Medium" : "Low";

  jsonPreview.textContent = JSON.stringify(
    {
      merchant: merchantEl.textContent,
      total: totalEl.textContent,
      items
    },
    null,
    2
  );

  setStatus("Parsing completed ✓");
}

/****************************************************
 * EVENTS (MANUAL MODE)
 ****************************************************/

ocrOnlyBtn?.addEventListener("click", async () => {
  if (!currentFile) return setStatus("No file ❌");
  await runOCR(currentFile);
});

dualOCRBtn?.addEventListener("click", async () => {
  if (!currentFile) return setStatus("No file ❌");

  let text = "";

  if (currentFile.type === "application/pdf") {
    text = await handlePDF(currentFile);
  } else {
    text = await runOCR(currentFile);
  }

  ocrTextCache = text;
});

parseBtn?.addEventListener("click", () => {
  parseText(ocrTextCache);
});

document.addEventListener("DOMContentLoaded", () => {
  setStatus("Ready ✓");
});
      
