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

  let extractedText = "";

  const setStatus = (msg, err = false) => {
    el.status.textContent = msg;
    el.status.style.color = err ? "red" : "green";
  };

  /* ---------------- THEME ---------------- */
  el.theme.addEventListener("change", () => {
    document.body.className = "theme-" + el.theme.value;
  });

  /* ---------------- FILE HANDLER ---------------- */
  async function extractText(file) {
    const name = file.name.toLowerCase();

    /* ZIP */
    if (name.endsWith(".zip")) {
      const zip = await JSZip.loadAsync(file);
      let text = "";
      for (const f of Object.values(zip.files)) {
        if (!f.dir && f.name.endsWith(".txt")) {
          text += await f.async("string") + "\n";
        }
      }
      return { text, source: "zip" };
    }

    /* PDF (NO OCR) */
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
      return { text, source: "pdf" };
    }

    /* IMAGE OCR */
    if (file.type.startsWith("image/")) {
      const OCR = window.Tesseract || window.TesseractJS;
      const result = await OCR.recognize(file, "eng", {
        logger: m => {
          if (m.status === "recognizing text") {
            setStatus(`OCR ${Math.round(m.progress * 100)}%`);
          }
        }
      });
      return { text: result.data.text, source: "image" };
    }

    throw new Error("Unsupported file type");
  }

  /* ---------------- BUTTONS ---------------- */
  async function run() {
    try {
      const file = el.file.files[0];
      if (!file) return setStatus("No file selected", true);

      setStatus("Processing…");
      const result = await extractText(file);

      extractedText = result.text.trim();
      el.raw.textContent = extractedText || "-";
      el.clean.textContent = extractedText || "-";

      setStatus(`Done ✓ (${result.source})`);
    } catch (e) {
      console.error(e);
      setStatus("Failed ❌", true);
    }
  }

  el.dual.onclick = run;
  el.ocr.onclick = run;

  el.parse.onclick = () => {
    if (!extractedText) {
      setStatus("OCR / PDF first", true);
      return;
    }
    el.json.textContent = JSON.stringify(
      { length: extractedText.length, preview: extractedText.slice(0, 200) },
      null,
      2
    );
    setStatus("Parsed ✓");
  };
});
        
