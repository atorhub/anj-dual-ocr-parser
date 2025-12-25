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
    layout: document.getElementById("layoutSelect"),
    historyList: document.getElementById("historyList"),
    saveBtn: document.getElementById("saveBtn"),
    editMerchant: document.getElementById("editMerchant"),
    editDate: document.getElementById("editDate"),
    editTotal: document.getElementById("editTotal")
  };

  function setStatus(msg, err = false) {
    el.status.textContent = msg;
    el.status.style.color = err ? "#ff4d4d" : "#7CFC98";
  }

  /* ---------- THEME & LAYOUT ---------- */
  el.theme.addEventListener("change", () => {
    document.body.classList.forEach(c => {
      if (c.startsWith("theme-")) document.body.classList.remove(c);
    });
    document.body.classList.add(`theme-${el.theme.value}`);
    localStorage.setItem("anj-theme", el.theme.value);
  });

  el.layout.addEventListener("change", () => {
    document.body.classList.forEach(c => {
      if (c.startsWith("layout-")) document.body.classList.remove(c);
    });
    document.body.classList.add(`layout-${el.layout.value}`);
    localStorage.setItem("anj-layout", el.layout.value);
  });

  /* ---------- OCR & PDF ---------- */
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

  /* ---------- PARSER ---------- */
  function parseInvoice(text) {
    const out = { merchant: null, date: null, total: null };
    const total = text.match(/total[:\s]*₹?\s*([\d,.]+)/i);
    const date = text.match(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/);
    if (total) out.total = total[1];
    if (date) out.date = date[0];
    out.merchant = text.split(" ").slice(0, 4).join(" ");
    return out;
  }

  /* ---------- PROCESS ---------- */
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
    const parsed = parseInvoice(text);

    window._lastParsed = parsed;

    el.raw.textContent = text || "--";
    el.clean.textContent = text || "--";
    el.json.textContent = JSON.stringify(parsed, null, 2);

    el.editMerchant.value = parsed.merchant || "";
    el.editDate.value = parsed.date || "";
    el.editTotal.value = parsed.total || "";

    setStatus("Done ✓");
  }

  el.dual.onclick = () => processFile(true);
  el.ocr.onclick = () => processFile(true);
  el.parse.onclick = () => {
    if (!el.clean.textContent || el.clean.textContent === "--") {
      setStatus("Nothing to parse", true);
      return;
    }

    const parsed = parseInvoice(el.clean.textContent);
    window._lastParsed = parsed;

    el.json.textContent = JSON.stringify(parsed, null, 2);
    el.editMerchant.value = parsed.merchant || "";
    el.editDate.value = parsed.date || "";
    el.editTotal.value = parsed.total || "";

    setStatus("Parsed ✓");
  };

  /* ---------- SIDEBAR ---------- */
  document.getElementById("sidebarToggle").onclick = () =>
    document.body.classList.toggle("sidebar-hidden");

  /* ---------- INDEXEDDB ---------- */
  let db;

  function initDB() {
    const req = indexedDB.open("anj-dual-ocr", 1);

    req.onupgradeneeded = e => {
      db = e.target.result;
      db.createObjectStore("history", {
        keyPath: "id",
        autoIncrement: true
      });
    };

    req.onsuccess = e => {
      db = e.target.result;
      loadHistory();
    };
  }

  function saveHistory(data) {
    if (!db) return;

    const tx = db.transaction("history", "readwrite");
    tx.objectStore("history").add({
      merchant: data.merchant,
      date: data.date,
      total: data.total,
      timestamp: Date.now()
    });

    tx.oncomplete = loadHistory;
  }

  function loadHistory() {
    if (!db || !el.historyList) return;
    el.historyList.innerHTML = "";

    const tx = db.transaction("history", "readonly");
    const req = tx.objectStore("history").openCursor(null, "prev");

    req.onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) return;

      const item = cursor.value;
      const li = document.createElement("li");
      li.textContent =
        (item.merchant || "Unknown") +
        " • " +
        new Date(item.timestamp).toLocaleString();

      li.onclick = () => {
        el.json.textContent = JSON.stringify(item, null, 2);
      };

      el.historyList.appendChild(li);
      cursor.continue();
    };
  }

  /* ---------- SAVE (MOBILE + DESKTOP) ---------- */
  el.saveBtn.onclick = () => {
    if (!window._lastParsed) {
      setStatus("Nothing to save", true);
      return;
    }

    saveHistory({
      merchant: el.editMerchant.value,
      date: el.editDate.value,
      total: el.editTotal.value
    });

    setStatus("Saved to history ✓");
  };

  /* ---------- RESTORE UI ---------- */
  const savedTheme = localStorage.getItem("anj-theme");
  const savedLayout = localStorage.getItem("anj-layout");
  if (savedTheme) document.body.classList.add(`theme-${savedTheme}`);
  if (savedLayout) document.body.classList.add(`layout-${savedLayout}`);

  initDB();
  setStatus("Ready ✓");
});
      
