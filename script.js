document.addEventListener("DOMContentLoaded", () => {

  /* =======================
     ELEMENT REFERENCES
  ======================= */

  const el = {
    file: document.getElementById("fileInput"),
    raw: document.getElementById("rawText"),
    clean: document.getElementById("cleanedText"),
    json: document.getElementById("jsonPreview"),
    status: document.getElementById("statusBar"),

    dual: document.getElementById("dualOCRBtn"),
    ocr: document.getElementById("ocrOnlyBtn"),
    parse: document.getElementById("parseBtn"),

    saveBtn: document.getElementById("saveBtn"),
    editMerchant: document.getElementById("editMerchant"),
    editDate: document.getElementById("editDate"),
    editTotal: document.getElementById("editTotal"),

    exportJSON: document.getElementById("exportJSON"),
    exportTXT: document.getElementById("exportTXT"),
    exportCSV: document.getElementById("exportCSV"),

    theme: document.getElementById("themeSelect"),
    layout: document.getElementById("layoutSelect"),

    sidebarToggle: document.getElementById("sidebarToggle"),

    historyList: document.getElementById("historyList"),
    historyPageList: document.getElementById("historyPageList"),
    historySearch: document.getElementById("historySearch"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn")
  };

  let db = null;
  let hasParsedData = false;
  let selectedHistoryItem = null;

  /* ✅ ADDED (REQUIRED FOR EXPORT – DOES NOT TOUCH EXISTING LOGIC) */
  let currentParsedData = null;

  /* ✅ MINIMAL PATCH — REQUIRED */
  let lastSavedId = null;

  /* =======================
     STATUS
  ======================= */

  function setStatus(msg, err = false) {
    el.status.textContent = msg;
    el.status.style.color = err ? "#ff4d4d" : "#7CFC98";
  }

  /* =======================
     SIDEBAR TOGGLE
  ======================= */

  el.sidebarToggle?.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-hidden");
  });

  const sidebarCloseBtn = document.getElementById("sidebarCloseBtn");

  sidebarCloseBtn?.addEventListener("click", () => {
    document.body.classList.add("sidebar-hidden");
  });

  /* =======================
     THEMES
  ======================= */

  el.theme?.addEventListener("change", () => {
    document.body.classList.forEach(c => {
      if (c.startsWith("theme-")) document.body.classList.remove(c);
    });
    document.body.classList.add("theme-" + el.theme.value);
    localStorage.setItem("anj-theme", el.theme.value);
  });

  const savedTheme = localStorage.getItem("anj-theme");
  if (savedTheme) {
    el.theme.value = savedTheme;
    document.body.classList.add("theme-" + savedTheme);
  }

  /* =======================
     LAYOUTS
  ======================= */

  el.layout?.addEventListener("change", () => {
    document.body.classList.forEach(c => {
      if (c.startsWith("layout-")) document.body.classList.remove(c);
    });
    document.body.classList.add("layout-" + el.layout.value);
    localStorage.setItem("anj-layout", el.layout.value);
  });

  const savedLayout = localStorage.getItem("anj-layout");
  if (savedLayout) {
    el.layout.value = savedLayout;
    document.body.classList.add("layout-" + savedLayout);
  }

  /* =======================
     PARSED UI STATE
  ======================= */

  function updateParsedUI(enabled) {
    [
      el.saveBtn,
      el.exportJSON,
      el.exportTXT,
      el.exportCSV,
      el.editMerchant,
      el.editDate,
      el.editTotal
    ].forEach(x => {
      if (!x) return;
      x.disabled = !enabled;
      x.style.opacity = enabled ? "1" : "0.5";
      x.style.pointerEvents = enabled ? "auto" : "none";
    });
  }

  updateParsedUI(false);

  /* =======================
     PDF → CANVAS
  ======================= */

  async function pdfToCanvas(file) {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const page = await pdf.getPage(1);

    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  }

  /* =======================
     OCR
  ======================= */

  async function runOCR(file) {
    setStatus("OCR running...");

    let source = file;
    if (file.type === "application/pdf") {
      source = await pdfToCanvas(file);
    }

    const result = await Tesseract.recognize(source, "eng", {
      logger: m => {
        if (m.status === "recognizing text") {
          setStatus(`OCR ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    return result.data.text || "";
  }

  async function processFile() {
    if (!el.file.files[0]) {
      setStatus("No file selected", true);
      return;
    }

    const file = el.file.files[0];
    const text = await runOCR(file);

    el.raw.textContent = text || "--";
    el.clean.textContent = text || "--";
    setStatus("OCR done ✓");
  }

  el.dual?.addEventListener("click", processFile);
  el.ocr?.addEventListener("click", processFile);

  /* =======================
     PARSE
  ======================= */

  function parseInvoice(text) {
    const out = { merchant: "", date: "", total: "" };
    const total = text.match(/total[:\s]*₹?\s*([\d,.]+)/i);
    const date = text.match(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/);

    if (total) out.total = total[1];
    if (date) out.date = date[0];
    out.merchant = text.split(" ").slice(0, 4).join(" ");
    return out;
  }

  el.parse?.addEventListener("click", () => {
    if (!el.clean.textContent || el.clean.textContent === "--") {
      setStatus("Nothing to parse", true);
      return;
    }

    const parsed = parseInvoice(el.clean.textContent);
    currentParsedData = parsed;

    hasParsedData = true;
    selectedHistoryItem = null;

    el.json.textContent = JSON.stringify(parsed, null, 2);
    el.editMerchant.value = parsed.merchant;
    el.editDate.value = parsed.date;
    el.editTotal.value = parsed.total;

    updateParsedUI(true);
    setStatus("Parsed ✓");

    document.querySelector('[data-page="parsed"]')?.click();
  });

  /* =======================
     EXPORT
  ======================= */

  function downloadFile(name, content, type = "text/plain") {
    const blob = new Blob([content], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  el.exportJSON?.addEventListener("click", () => {
    if (!currentParsedData) return;
    downloadFile("invoice.json", JSON.stringify(currentParsedData, null, 2), "application/json");
  });

  el.exportTXT?.addEventListener("click", () => {
    if (!currentParsedData) return;
    downloadFile("invoice.txt", JSON.stringify(currentParsedData, null, 2));
  });

  el.exportCSV?.addEventListener("click", () => {
    if (!currentParsedData) return;
    const csv =
      "merchant,date,total\n" +
      `"${currentParsedData.merchant}","${currentParsedData.date}","${currentParsedData.total}"`;
    downloadFile("invoice.csv", csv, "text/csv");
  });

  /* =======================
     HISTORY
  ======================= */

  function initDB() {
    const req = indexedDB.open("anj-dual-ocr", 1);

    req.onupgradeneeded = e => {
      const db = e.target.result;
      db.createObjectStore("history", { keyPath: "id", autoIncrement: true });
    };

    req.onsuccess = e => {
      db = e.target.result;
      setTimeout(() => loadHistory(), 0);
    };
  }

  function renderHistoryItem(item, list) {
    const li = document.createElement("li");

    li.textContent =
      (item.merchant || "Unknown") +
      " • " +
      new Date(item.timestamp).toLocaleString();

    if (item.id === lastSavedId) {
      li.classList.add("history-active");
      li.scrollIntoView({ block: "nearest" });
    }

    li.addEventListener("click", () => {
      hasParsedData = true;
      selectedHistoryItem = item;

      if (item.id === lastSavedId) {
        lastSavedId = null;
        li.classList.remove("history-active");
      }

      el.editMerchant.value = item.merchant;
      el.editDate.value = item.date;
      el.editTotal.value = item.total;
      el.json.textContent = JSON.stringify(item, null, 2);

      updateParsedUI(true);
      document.querySelector('[data-page="parsed"]')?.click();
    });

    list.appendChild(li);
  }

  function loadHistory(filter = "") {
    if (!db) return;

    el.historyList.innerHTML = "";
    el.historyPageList && (el.historyPageList.innerHTML = "");

    const tx = db.transaction("history", "readonly");
    tx.objectStore("history").openCursor(null, "prev").onsuccess = e => {
      const c = e.target.result;
      if (!c) return;

      const item = c.value;
      const text = `${item.merchant} ${item.date} ${item.total}`.toLowerCase();
      if (!filter || text.includes(filter)) {
        renderHistoryItem(item, el.historyList);
        el.historyPageList && renderHistoryItem(item, el.historyPageList);
      }
      c.continue();
    };
  }

  el.historySearch?.addEventListener("input", e =>
    loadHistory(e.target.value.toLowerCase())
  );

  el.saveBtn?.addEventListener("click", () => {
    if (!hasParsedData || !db) return;

    const tx = db.transaction("history", "readwrite");
    const store = tx.objectStore("history");

    const request = store.add({
      merchant: el.editMerchant.value,
      date: el.editDate.value,
      total: el.editTotal.value,
      timestamp: Date.now()
    });

    request.onsuccess = e => {
      lastSavedId = e.target.result;
    };

    tx.oncomplete = () => {
      setTimeout(() => {
        if (el.historyList) el.historyList.innerHTML = "";
        if (el.historyPageList) el.historyPageList.innerHTML = "";
        loadHistory();
        setStatus("Saved ✓");
      }, 0);
    };

    tx.onerror = () => {
      setStatus("Save failed", true);
    };
  });

  el.clearHistoryBtn?.addEventListener("click", () => {
    if (!confirm("Clear all history?")) return;
    const tx = db.transaction("history", "readwrite");
    tx.objectStore("history").clear();
    tx.oncomplete = loadHistory;
  });

  initDB();
  setStatus("Ready ✓");
});

/* =======================
   PAGE NAVIGATION
======================= */

document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("click", () => {
    const page = item.dataset.page;

    document.querySelectorAll(".nav-item").forEach(n =>
      n.classList.remove("active")
    );
    item.classList.add("active");

    document.querySelectorAll(".page").forEach(p =>
      p.classList.remove("active")
    );
    document.querySelector(".page-" + page)?.classList.add("active");

    if (window.innerWidth <= 768) {
      document.body.classList.add("sidebar-hidden");
    }
  });
});
                                     
