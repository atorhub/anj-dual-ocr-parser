document.addEventListener("DOMContentLoaded", () => {
  const el = {
    file: document.getElementById("fileInput"),
    dual: document.getElementById("dualOCRBtn"),
    ocr: document.getElementById("ocrOnlyBtn"),
    parse: document.getElementById("parseBtn"),
    raw: document.getElementById("rawText"),
    clean: document.getElementById("cleanedText"),
    json: document.getElementById("jsonPreview"),
    status: document.getElementById("statusBar"),
    theme: document.getElementById("themeSelect")
  };

  let state = {
    ocrText: "",
    extractedText: "",
    finalText: ""
  };

  const setStatus = (msg, err = false) => {
    el.status.textContent = msg;
    el.status.style.color = err ? "red" : "green";
  };

  /* THEME */
  el.theme.addEventListener("change", () => {
    document.body.className = "theme-" + el.theme.value;
  });

  /* OCR (UNCHANGED, DOES ITS OWN JOB) */
  async function runOCR(file) {
    try {
      const OCR = window.Tesseract || window.TesseractJS;
      if (!OCR) throw new Error("OCR engine missing");

      const res = await OCR.recognize(file, "eng", {
        logger: m => {
          if (m.status === "recognizing text") {
            setStatus(`OCR ${Math.round(m.progress * 100)}%`);
          }
        }
      });

      state.ocrText = res.data.text || "";
      return state.ocrText;
    } catch (e) {
      console.warn("OCR failed", e);
      return "";
    }
  }

  /* TEXT EXTRACTION (PDF / ZIP) */
  async function extractText(file) {
    const name = file.name.toLowerCase();

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

  /* ORCHESTRATION (THIS WAS MISSING BEFORE) */
  async function processFile(useOCR) {
    try {
      const file = el.file.files[0];
      if (!file) return setStatus("No file selected", true);

      setStatus("Processing…");

      state.ocrText = "";
      state.extractedText = "";

      // Run independently
      if (useOCR && file.type.startsWith("image/")) {
        await runOCR(file);
      }

      state.extractedText = await extractText(file);

      // Choose best available text
      state.finalText =
        state.extractedText.trim() ||
        state.ocrText.trim();

      el.raw.textContent = state.finalText || "-";
      el.clean.textContent = state.finalText || "-";

      setStatus("Text ready ✓");
    } catch (e) {
      console.error(e);
      setStatus("Processing failed ❌", true);
    }
  }

  el.dual.onclick = () => processFile(true);
  el.ocr.onclick = () => processFile(true);

  el.parse.onclick = () => {
    if (!state.finalText) {
      return setStatus("No text to parse", true);
    }

    el.json.textContent = JSON.stringify(
      {
        length: state.finalText.length,
        preview: state.finalText.slice(0, 300)
      },
      null,
      2
    );

    setStatus("Parsed ✓");
  };
});
                          
