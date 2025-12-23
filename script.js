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

  el.theme.addEventListener("change", () => {
    document.body.classList.forEach(c => {
      if (c.startsWith("theme-")) document.body.classList.remove(c);
    });
    document.body.classList.add(`theme-${el.theme.value}`);
  });

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

  /* -------- LEGACY PARSER (UNCHANGED) -------- */
  function parseInvoice(text) {
    const out = { merchant: null, date: null, total: null };
    const total = text.match(/total[:\s]*₹?\s*([\d,.]+)/i);
    const date = text.match(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/);
    if (total) out.total = total[1];
    if (date) out.date = date[0];
    out.merchant = text.split(" ").slice(0, 4).join(" ");
    return out;
  }

  /* -------- NEW ANALYSIS PARSER (ADDED) -------- */
  function analyzeInvoice(text) {
    const result = { merchant: null, date: null, total: null };

    if (!text) return result;

    const normalized = text
      .replace(/₹/g, "Rs ")
      .replace(/\s{2,}/g, " ")
      .trim();

    const lines = normalized
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);

    /* MERCHANT */
    const ignore = /invoice|bill|tax|gst|receipt|total|date/i;
    for (let i = 0; i < Math.min(6, lines.length); i++) {
      const l = lines[i];
      if (!ignore.test(l) && !/[0-9]{3,}/.test(l) && l.length < 60) {
        result.merchant = l;
        break;
      }
    }

    /* DATE */
    const dateRx =
      /\b((0?[1-9]|[12][0-9]|3[01])[\/\-.](0?[1-9]|1[012])[\/\-.]\d{2,4}|\d{4}[\/\-.](0?[1-9]|1[012])[\/\-.](0?[1-9]|[12][0-9]|3[01])|[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})\b/;

    for (const l of lines) {
      const m = l.match(dateRx);
      if (m) {
        result.date = m[0];
        break;
      }
    }

    /* TOTAL */
    let candidates = [];
    lines.forEach(l => {
      if (/total|grand total|amount due|net payable|balance/i.test(l)) {
        const num = l.replace(/[^0-9.,]/g, "").replace(/,+/g, "");
        if (num) candidates.push(num);
      }
    });

    if (candidates.length) {
      result.total = candidates[0];
    } else {
      let max = 0;
      lines.forEach(l => {
        const m = l.match(/([0-9]+[.,][0-9]{2})/g);
        if (m) {
          m.forEach(v => {
            const n = parseFloat(v.replace(/,/g, ""));
            if (n > max) max = n;
          });
        }
      });
      if (max > 0) result.total = String(max);
    }

    return result;
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

    const legacy = parseInvoice(text);
    const analysis = analyzeInvoice(text);

    const finalResult = {
      merchant: analysis.merchant || legacy.merchant,
      date: analysis.date || legacy.date,
      total: analysis.total || legacy.total
    };

    el.raw.textContent = text || "--";
    el.clean.textContent = text || "--";
    el.json.textContent = JSON.stringify(finalResult, null, 2);

    setStatus("Done ✓");
  }

  el.dual.onclick = () => processFile(true);
  el.ocr.onclick = () => processFile(true);
  el.parse.onclick = () => {
    if (!el.clean.textContent || el.clean.textContent === "--") {
      setStatus("Nothing to parse", true);
      return;
    }

    const legacy = parseInvoice(el.clean.textContent);
    const analysis = analyzeInvoice(el.clean.textContent);

    el.json.textContent = JSON.stringify(
      {
        merchant: analysis.merchant || legacy.merchant,
        date: analysis.date || legacy.date,
        total: analysis.total || legacy.total
      },
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
              
