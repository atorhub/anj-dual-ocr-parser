document.addEventListener("DOMContentLoaded", () => {
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
    layout: document.getElementById("layoutSelect")
  };

  function setStatus(msg, err = false) {
    el.status.textContent = msg;
    el.status.style.color = err ? "#ff4d4d" : "#7CFC98";
  }

  /* THEME SWITCH – SAFE */
  el.theme.addEventListener("change", () => {
    document.body.classList.forEach(c => {
      if (c.startsWith("theme-")) document.body.classList.remove(c);
    });
    document.body.classList.add(`theme-${el.theme.value}`);
  });

  /* LAYOUT SWITCH – SAFE */
  el.layout.addEventListener("change", () => {
    document.body.classList.forEach(c => {
      if (c.startsWith("layout-")) document.body.classList.remove(c);
    });
    document.body.classList.add(`layout-${el.layout.value}`);
  });

  async function runOCR(file) {
    setStatus("OCR running…");
    const res = await Tesseract.recognize(file, "eng", {
      logger: m => {
        if (m.status === "recognizing text") {
          setStatus(`OCR ${Math.round(m.progress * 100)}%`);
        }
      }
    });
    return res.data.text || "";
  }

  async function extractText(file) {
    if (file.name.endsWith(".pdf")) {
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
  }

  function cleanText(txt) {
    return txt.replace(/\s+/g, " ").trim();
  }

  function parseInvoice(text) {
    const out = { merchant: null, date: null, total: null };
    const total = text.match(/total[:\s]*₹?\s*([\d,.]+)/i);
    const date = text.match(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/);
    if (total) out.total = total[1];
    if (date) out.date = date[0];
    out.merchant = text.split(" ").slice(0, 4).join(" ");
    return out;
  }

  async function processFile(useOCR) {
    if (!el.file.files[0]) {
      setStatus("No file selected", true);
      return;
    }

    let text = "";
    const file = el.file.files[0];

    if (file.type.startsWith("image/") && useOCR) {
      text = await runOCR(file);
    } else {
      text = await extractText(file);
    }

    text = cleanText(text);
    el.raw.textContent = text || "--";
    el.clean.textContent = text || "--";
    el.json.textContent = JSON.stringify(parseInvoice(text), null, 2);
    setStatus("Done ✓");
  }

  el.dual.onclick = () => processFile(true);
  el.ocr.onclick = () => processFile(true);
  el.parse.onclick = () => {
    if (!el.clean.textContent || el.clean.textContent === "--") {
      setStatus("Nothing to parse", true);
      return;
    }
    el.json.textContent = JSON.stringify(
      parseInvoice(el.clean.textContent),
      null,
      2
    );
    setStatus("Parsed ✓");
  };

  const sidebarToggle = document.getElementById("sidebarToggle");
  sidebarToggle.onclick = () =>
    document.body.classList.toggle("sidebar-hidden");

  setStatus("Ready ✓");
});
          
