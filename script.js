document.addEventListener("DOMContentLoaded", () => {
  /* ===============================
     ELEMENTS (UNCHANGED)
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
    layout: document.getElementById("layoutSelect")
  };

  /* ===============================
     STATUS
  =============================== */
  function setStatus(msg, err = false) {
    el.status.textContent = msg;
    el.status.style.color = err ? "#ff4d4d" : "#7CFC98";
  }

  /* ===============================
     BODY CLASS HELPERS
  =============================== */
  function setBodyClass(prefix, value) {
    const classes = document.body.className
      .split(" ")
      .filter(c => !c.startsWith(prefix));
    classes.push(`${prefix}${value}`);
    document.body.className = classes.join(" ");
  }

  function getBodyClass(prefix) {
    return document.body.className
      .split(" ")
      .find(c => c.startsWith(prefix));
  }

  /* ===============================
     LOAD PERSISTED STATE
  =============================== */
  const savedTheme = localStorage.getItem("ui-theme");
  const savedLayout = localStorage.getItem("ui-layout");
  const sidebarHidden = localStorage.getItem("ui-sidebar") === "hidden";

  if (savedTheme) {
    setBodyClass("theme-", savedTheme);
    if (el.theme) el.theme.value = savedTheme;
  }

  if (savedLayout) {
    setBodyClass("layout-", savedLayout);
    if (el.layout) el.layout.value = savedLayout;
  }

  if (sidebarHidden) {
    document.body.classList.add("sidebar-hidden");
  }

  /* ===============================
     THEME CHANGE (PERSISTED)
  =============================== */
  el.theme.addEventListener("change", () => {
    setBodyClass("theme-", el.theme.value);
    localStorage.setItem("ui-theme", el.theme.value);
  });

  /* ===============================
     LAYOUT CHANGE (PERSISTED)
  =============================== */
  el.layout.addEventListener("change", () => {
    setBodyClass("layout-", el.layout.value);
    localStorage.setItem("ui-layout", el.layout.value);
  });

  /* ===============================
     SIDEBAR TOGGLE (PERSISTED)
  =============================== */
  const sidebarToggle = document.getElementById("sidebarToggle");

  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", () => {
      document.body.classList.toggle("sidebar-hidden");
      localStorage.setItem(
        "ui-sidebar",
        document.body.classList.contains("sidebar-hidden") ? "hidden" : "shown"
      );
    });
  }

  /* ===============================
     OCR / PIPELINE (UNCHANGED)
  =============================== */
  async function runOCR(file) {
    try {
      if (!window.Tesseract) throw new Error("Tesseract not loaded");
      setStatus("OCR running…");

      const res = await Tesseract.recognize(file, "eng", {
        logger: m => {
          if (m.status === "recognizing text") {
            setStatus(`OCR ${Math.round(m.progress * 100)}%`);
          }
        }
      });

      return res.data.text || "";
    } catch {
      setStatus("OCR failed", true);
      return "";
    }
  }

  function cleanText(txt) {
    return txt
      ? txt.replace(/\r/g, "")
           .replace(/[ \t]+/g, " ")
           .replace(/\n{2,}/g, "\n")
           .trim()
      : "";
  }

  function parseInvoice(text) {
    const out = { merchant: null, date: null, total: null };
    const total = text.match(/total[:\s]*₹?\s*([\d,.]+)/i);
    const date = text.match(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/);
    if (total) out.total = total[1];
    if (date) out.date = date[0];
    const lines = text.split("\n").filter(l => l.length > 5);
    if (lines.length) out.merchant = lines[0];
    return out;
  }

  async function processFile(useOCR) {
    if (!el.file.files[0]) {
      setStatus("No file selected", true);
      return;
    }

    const file = el.file.files[0];
    let text = "";

    if (file.type.startsWith("image/") && useOCR) {
      text = await runOCR(file);
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

  setStatus("Ready ✓");
});
