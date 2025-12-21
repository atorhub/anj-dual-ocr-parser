document.addEventListener("DOMContentLoaded", () => {
  /* ===============================
     ELEMENTS (MATCH HTML EXACTLY)
  =============================== */
  const el = {
    file: document.getElementById("fileInput"),
    raw: document.getElementById("rawText"),
    clean: document.getElementById("cleanedText"),
    json: document.getElementById("jsonPreview"),
    status: document.getElementById("statusBar"),
    dual: document.getElementById("dualOCRBtn"),
    ocr: document.getElementById("ocrOnlyBtn"),
    parse: document.getElementById("parseBtn"),
    theme: document.getElementById("themeSelect"),
    layout: document.getElementById("layoutSelect") // ✅ ADDED
  };

  /* ===============================
     STATE (SIMPLE & SAFE)
  =============================== */
  const state = {
    ocrText: "",
    extractedText: "",
    finalText: "",
    parsed: null
  };

  /* ===============================
     STATUS / DEBUG
  =============================== */
  function setStatus(msg, err = false) {
    el.status.textContent = msg;
    el.status.style.color = err ? "#ff4d4d" : "#7CFC98";
    console.log(err ? "[ERROR]" : "[INFO]", msg);
  }

  /* ===============================
     THEME (SAFE, NON-DESTRUCTIVE)
  =============================== */
  el.theme.addEventListener("change", () => {
    const classes = document.body.className.split(" ").filter(
      c => !c.startsWith("theme-")
    );
    classes.push(`theme-${el.theme.value}`);
    document.body.className = classes.join(" ");
  });

  /* ===============================
     LAYOUT (ADDED – SAFE)
  =============================== */
  el.layout.addEventListener("change", () => {
    const classes = document.body.className.split(" ").filter(
      c => !c.startsWith("layout-")
    );
    classes.push(`layout-${el.layout.value}`);
    document.body.className = classes.join(" ");
  });

  /* ===============================
     OCR (IMAGE ONLY)
  =============================== */
  async function runOCR(file) {
    try {
      if (!window.Tesseract) {
        throw new Error("Tesseract not loaded");
      }

      setStatus("OCR running…");

      const res = await Tesseract.recognize(file, "eng", {
        logger: m => {
          if (m.status === "recognizing text") {
            setStatus(`OCR ${Math.round(m.progress * 100)}%`);
          }
        }
      });

      state.ocrText = res.data.text || "";
      return state.ocrText;

    } catch (e) {
      console.error(e);
      setStatus("OCR failed", true);
      return "";
    }
  }

  /* ===============================
     TEXT EXTRACTION (PDF / ZIP)
  =============================== */
  async function extractText(file) {
    const name = file.name.toLowerCase();

    try {
      if (name.endsWith(".zip")) {
        setStatus("Reading ZIP…");
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
        setStatus("Reading PDF…");

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

    } catch (e) {
      console.error(e);
      setStatus("Text extraction failed", true);
      return "";
    }
  }

  /* ===============================
     CLEANER
  =============================== */
  function cleanText(txt) {
    if (!txt) return "";
    return txt
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  /* ===============================
     PARSER
  =============================== */
  function parseInvoice(text) {
    const out = { merchant: null, date: null, total: null };

    const totalMatch = text.match(/total[:\s]*₹?\s*([\d,.]+)/i);
    if (totalMatch) out.total = totalMatch[1];

    const dateMatch = text.match(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/);
    if (dateMatch) out.date = dateMatch[0];

    const lines = text.split("\n").filter(l => l.length > 5);
    if (lines.length) out.merchant = lines[0];

    return out;
  }

  /* ===============================
     MAIN PIPELINE
  =============================== */
  async function processFile(useOCR) {
    if (!el.file.files[0]) {
      setStatus("No file selected", true);
      return;
    }

    const file = el.file.files[0];
    setStatus("Processing…");

    let text = "";

    if (file.type.startsWith("image/") && useOCR) {
      text = await runOCR(file);
    } else {
      text = await extractText(file);
    }

    text = cleanText(text);
    el.raw.textContent = text || "--";
    el.clean.textContent = text || "--";

    const parsed = parseInvoice(text);
    el.json.textContent = JSON.stringify(parsed, null, 2);

    setStatus("Done ✓");
  }

  /* ===============================
     BUTTONS
  =============================== */
  el.dual.onclick = () => processFile(true);
  el.ocr.onclick = () => processFile(true);
  el.parse.onclick = () => {
    if (!el.clean.textContent || el.clean.textContent === "--") {
      setStatus("Nothing to parse", true);
      return;
    }
    const parsed = parseInvoice(el.clean.textContent);
    el.json.textContent = JSON.stringify(parsed, null, 2);
    setStatus("Parsed ✓");
  };

  setStatus("Ready ✓");
});
