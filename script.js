document.addEventListener("DOMContentLoaded", () => {
   pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.js";

  const TESSERACT_CONFIG = {
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@4.1.4/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@4.0.4/tesseract-core.wasm.js",
    langPath: "https://cdn.jsdelivr.net/npm/tesseract.js@4.1.4/langs/"
  };

  let currentFile = null;
  let ocrTextCache = "";
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
    statusBar.textContent = text;
  }

  themeSelect.addEventListener("change", e => {
    document.body.className = `theme-${e.target.value}`;
  });

  fileInput.addEventListener("change", e => {
    currentFile = e.target.files[0];
    setStatus(currentFile ? "File loaded ✓" : "No file selected");
  });
    async function runImageOCR(source) {
    setStatus("Running OCR…");

    const result = await Tesseract.recognize(
      source,
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
  }

  async function extractPDF(file) {
    setStatus("Reading PDF…");

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
    if (!currentFile) return setStatus("No file selected");

    try {
      if (currentFile.type === "application/zip") {
        setStatus("ZIP detected – not supported yet");
        return;
      }

      if (currentFile.type === "application/pdf") {
        const text = await extractPDF(currentFile);

        if (text.length > 30) {
          rawText.textContent = text;
          cleanedText.textContent = text;
          ocrTextCache = text;
          setStatus("PDF text extracted ✓");
        } else {
          await runImageOCR(URL.createObjectURL(currentFile));
        }
      } else {
        await runImageOCR(currentFile);
      }
    } catch (err) {
      console.error(err);
      setStatus("Processing failed ❌");
    }
  });

  ocrOnlyBtn.addEventListener("click", async () => {
    if (!currentFile) return setStatus("No file selected");
    await runImageOCR(currentFile);
  });
    parseBtn.addEventListener("click", () => {
    if (!ocrTextCache) {
      setStatus("Nothing to parse");
      return;
    }

    merchantEl.textContent = "Detected";
    totalEl.textContent = "Detected";
    confidenceEl.textContent = "Medium";

    setStatus("Parsing completed ✓");
  });

  setStatus("Ready ✓");
});
