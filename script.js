document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("fileInput");
  const dualOCRBtn = document.getElementById("dualOCRBtn");
  const ocrOnlyBtn = document.getElementById("ocrOnlyBtn");
  const parseBtn = document.getElementById("parseBtn");

  const rawText = document.getElementById("rawText");
  const cleanedText = document.getElementById("cleanedText");
  const statusBar = document.getElementById("statusBar");

  function setStatus(msg) {
    statusBar.textContent = msg;
  }

  let currentFile = null;

  fileInput.addEventListener("change", e => {
    currentFile = e.target.files[0];
    setStatus(currentFile ? "File loaded ✓" : "No file");
  });

  async function runOCR(file) {
    try {
      setStatus("OCR started…");

      const OCR = window.Tesseract || window.TesseractJS;
      if (!OCR) {
        setStatus("Tesseract not loaded ❌");
        return;
      }

      const result = await OCR.recognize(file, "eng", {
        logger: m => {
          if (m.status === "recognizing text") {
            setStatus(`OCR ${Math.round(m.progress * 100)}%`);
          }
        }
      });

      const text = result.data.text.trim();
      rawText.textContent = text;
      cleanedText.textContent = text;

      setStatus("OCR completed ✓");
    } catch (e) {
      console.error(e);
      setStatus("OCR failed ❌");
    }
  }

  dualOCRBtn.addEventListener("click", () => {
    if (!currentFile) {
      setStatus("No file selected");
      return;
    }
    runOCR(currentFile);
  });

  ocrOnlyBtn.addEventListener("click", () => {
    if (!currentFile) {
      setStatus("No file selected");
      return;
    }
    runOCR(currentFile);
  });

  parseBtn.addEventListener("click", () => {
    setStatus("Parse clicked ✓ (OCR first)");
  });

  setStatus("Ready ✓");
});
       
