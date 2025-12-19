/* =========================================================
   ANJ Dual OCR — Script.js
    — Core + Safety + Themes
   ========================================================= */

(() => {
  "use strict";

  /* ---------- SAFE DOM READY ---------- */
  const ready = (fn) =>
    document.readyState !== "loading"
      ? fn()
      : document.addEventListener("DOMContentLoaded", fn);

  ready(() => {

    /* ---------- GLOBAL STATE ---------- */
    const state = {
      file: null,
      rawText: "",
      cleanedText: "",
      parsed: null,
      issues: [],
      confidence: "Low"
    };

    /* ---------- SAFE SELECTOR ---------- */
    const $ = (id) => document.getElementById(id);

    /* ---------- ELEMENTS ---------- */
    const el = {
  fileInput: $("fileInput"),
  statusBar: $("statusBar"),
  themeSelect: $("themeSelect"),

  dualOCRBtn: $("dualOCRBtn"),
  ocrOnlyBtn: $("ocrOnlyBtn"),
  parseBtn: $("parseBtn"),

  rawText: $("rawText"),
  cleanedText: $("cleanedText"),
  itemsTable: $("itemsTable"),

  merchant: $("merchant"),
  date: $("date"),
  total: $("total"),
  confidence: $("confidence"),

  issuesBox: $("issuesBox"),
  jsonPreview: $("jsonPreview"),

  historyList: $("historyList"),
  loadHistoryBtn: $("loadHistoryBtn"),
  clearHistoryBtn: $("clearHistoryBtn"),

  exportJsonBtn: $("exportJsonBtn"),
  exportTxtBtn: $("exportTxtBtn"),
  exportCsvBtn: $("exportCsvBtn"),
  exportPdfBtn: $("exportPdfBtn"),
  exportZipBtn: $("exportZipBtn"),
};

    /* ---------- STATUS ---------- */
    const setStatus = (msg, error = false) => {
      if (!el.statusBar) return;
      el.statusBar.textContent = msg;
      el.statusBar.style.color = error ? "#b42318" : "#117a46";
    };

    setStatus("Ready ✓");

    /* ---------- THEME SWITCH (CRASH-PROOF) ---------- */
    if (el.themeSelect) {
      el.themeSelect.addEventListener("change", (e) => {
        document.body.className = `theme-${e.target.value}`;
        localStorage.setItem("anj-theme", e.target.value);
      });

      const savedTheme = localStorage.getItem("anj-theme");
      if (savedTheme) {
        document.body.className = `theme-${savedTheme}`;
        el.themeSelect.value = savedTheme;
      }
    }

    /* ---------- FILE INPUT ---------- */
    if (el.fileInput) {
      el.fileInput.addEventListener("change", (e) => {
        state.file = e.target.files[0] || null;
        setStatus(state.file ? "File loaded ✓" : "No file selected");
      });
    }

    /* ---------- EXPOSE STATE (for next chunks) ---------- */
    window.__ANJ__ = { state, el, setStatus };

  });
})();
/* =========================================================
   — OCR ENGINE (IMAGE + PDF)
   ========================================================= */

(() => {
  const { state, el, setStatus } = window.__ANJ__;

  /* ---------- IMAGE OCR ---------- */
  async function runImageOCR(source) {
  try {
    setStatus("OCR started…");

    const OCR = window.Tesseract || window.TesseractJS;
    if (!OCR) throw new Error("Tesseract not loaded");

    const result = await OCR.recognize(
      source,
      "eng",
      {
        logger: m => {
          if (m.status === "recognizing text") {
            setStatus(`OCR ${Math.round(m.progress * 100)}%`);
          }
        }
      }
    );

    const text = result.data.text.trim();
    if (!text) throw new Error("Empty OCR result");

    state.rawText = text;
    state.cleanedText = text;

    el.rawText.textContent = text;
    el.cleanedText.textContent = text;

    setStatus("OCR completed ✓");
    return text;

  } catch (err) {
    console.error(err);
    setStatus("Image OCR failed ❌", true);
    throw err;
  }
  }
   
  /* ---------- PDF TEXT EXTRACTION ---------- */
  async function extractPDFText(file) {
    try {
      setStatus("Reading PDF…");

      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

      let fullText = "";

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        fullText += content.items.map(i => i.str).join(" ") + "\n";
      }

      fullText = fullText.trim();
      return fullText;

    } catch (err) {
      console.error(err);
      setStatus("PDF read failed ❌", true);
      throw err;
    }
  }

  /* ---------- DUAL OCR HANDLER ---------- */
  async function handleDualOCR() {
    if (!state.file) {
      setStatus("No file selected", true);
      return;
    }

    try {
      const file = state.file;

      // TXT files
      if (file.type === "text/plain") {
        const text = await file.text();
        state.rawText = text;
        state.cleanedText = text;
        el.rawText.textContent = text;
        el.cleanedText.textContent = text;
        setStatus("Text loaded ✓");
        return;
      }

      // PDF
      if (file.type === "application/pdf") {
        const pdfText = await extractPDFText(file);

        if (pdfText.length > 40) {
          state.rawText = pdfText;
          state.cleanedText = pdfText;
          el.rawText.textContent = pdfText;
          el.cleanedText.textContent = pdfText;
          setStatus("PDF text extracted ✓");
        } else {
          await runImageOCR(URL.createObjectURL(file));
        }
        return;
      }

      // Image
      await runImageOCR(file);

    } catch (err) {
      setStatus("Dual OCR failed ❌", true);
    }
  }

  /* ---------- QUICK OCR ---------- */
  async function handleQuickOCR() {
    if (!state.file) {
      setStatus("No file selected", true);
      return;
    }
    await runImageOCR(state.file);
  }

  /* ---------- BUTTON WIRES ---------- */
  if (el.dualOCRBtn) {
    el.dualOCRBtn.addEventListener("click", handleDualOCR);
  }

  if (el.ocrOnlyBtn) {
    el.ocrOnlyBtn.addEventListener("click", handleQuickOCR);
  }

})();
 /* =========================================================
   — CLEANING + PARSING ENGINE
   ========================================================= */

(() => {
  const { state, el, setStatus } = window.__ANJ__;

  /* ---------- CLEAN TEXT ---------- */
  function cleanText(text) {
    if (!text) return "";

    return text
      .replace(/[^\S\r\n]+/g, " ")
      .replace(/₹/g, "Rs ")
      .replace(/\bINR\b/gi, "Rs")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  /* ---------- DATE DETECTION ---------- */
  function detectDate(text) {
    const patterns = [
      /\b\d{2}\/\d{2}\/\d{4}\b/,
      /\b\d{4}-\d{2}-\d{2}\b/,
      /\b\d{2}-\d{2}-\d{4}\b/
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[0];
    }
    return null;
  }

  /* ---------- TOTAL DETECTION ---------- */
  function detectTotal(text) {
    const lines = text.split("\n").reverse();
    const totalRegex =
      /(total|grand total|amount payable|net amount)[^\d]{0,10}([₹$€£]?\s?\d+[.,]?\d{0,2})/i;

    for (const line of lines) {
      const m = line.match(totalRegex);
      if (m) return m[2];
    }
    return null;
  }

  /* ---------- MERCHANT DETECTION ---------- */
  function detectMerchant(text) {
    const firstLines = text.split("\n").slice(0, 5);
    for (const l of firstLines) {
      if (l.length > 3 && !/\d/.test(l)) return l.trim();
    }
    return null;
  }

  /* ---------- ITEM EXTRACTION ---------- */
  function extractItems(text) {
    const lines = text.split("\n");
    const items = [];

    lines.forEach(line => {
      const m = line.match(
        /^(.+?)\s+(\d+)\s+([₹$€£]?\d+[.,]?\d*)\s+([₹$€£]?\d+[.,]?\d*)$/
      );
      if (m) {
        items.push({
          name: m[1].trim(),
          qty: Number(m[2]),
          price: m[3],
          total: m[4]
        });
      }
    });

    return items;
  }

  /* ---------- MAIN PARSER ---------- */
  function parseInvoice(text) {
    const issues = [];
    const cleaned = cleanText(text);

    const merchant = detectMerchant(cleaned);
    const date = detectDate(cleaned);
    const total = detectTotal(cleaned);
    const items = extractItems(cleaned);

    if (!merchant) issues.push("Merchant not detected");
    if (!date) issues.push("Date not detected");
    if (!total) issues.push("Total not detected");
    if (!items.length) issues.push("No line items found");

    const confidence =
      issues.length === 0 ? "High" :
      issues.length <= 2 ? "Medium" : "Low";

    return {
      merchant,
      date,
      total,
      items,
      confidence,
      issues,
      cleanedText: cleaned
    };
  }

  /* ---------- PARSE BUTTON ---------- */
  if (el.parseBtn) {
    el.parseBtn.addEventListener("click", () => {
      if (!state.rawText) {
        setStatus("Nothing to parse", true);
        return;
      }

      const result = parseInvoice(state.rawText);

      state.cleanedText = result.cleanedText;
      state.parsed = result;
      state.issues = result.issues;
      state.confidence = result.confidence;

      el.cleanedText.textContent = result.cleanedText;
      setStatus("Parsing completed ✓");
    });
  }

})();
/* =========================================================
    — UI RENDERING
   ========================================================= */

(() => {
  const { state, el } = window.__ANJ__;

  /* ---------- RENDER SUMMARY ---------- */
  function renderSummary(parsed) {
    el.merchant.textContent = parsed.merchant || "-";
    el.date.textContent = parsed.date || "-";
    el.total.textContent = parsed.total || "-";
    el.confidence.textContent = parsed.confidence || "-";
  }

  /* ---------- RENDER ITEMS ---------- */
  function renderItems(items) {
    el.itemsTable.innerHTML = "";

    if (!items || !items.length) {
      el.itemsTable.innerHTML =
        `<tr><td colspan="4">No items detected</td></tr>`;
      return;
    }

    items.forEach(item => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${item.name}</td>
        <td>${item.qty}</td>
        <td>${item.price}</td>
        <td>${item.total}</td>
      `;
      el.itemsTable.appendChild(tr);
    });
  }

  /* ---------- RENDER ISSUES ---------- */
  function renderIssues(issues) {
    if (!issues || !issues.length) {
      el.issuesBox.textContent = "No issues detected ✓";
      return;
    }
    el.issuesBox.innerHTML = issues.map(i => `• ${i}`).join("<br>");
  }

  /* ---------- RENDER JSON ---------- */
  function renderJSON(parsed) {
    el.jsonPreview.textContent =
      JSON.stringify(parsed, null, 2);
  }

  /* ---------- WATCH PARSE RESULT ---------- */
  const originalParseHandler = el.parseBtn?.onclick;

  if (el.parseBtn) {
    el.parseBtn.addEventListener("click", () => {
      if (!state.parsed) return;

      renderSummary(state.parsed);
      renderItems(state.parsed.items);
      renderIssues(state.parsed.issues);
      renderJSON(state.parsed);
    });
  }

})();
/* =========================================================
   — EXPORT SYSTEM
   ========================================================= */

(() => {
  const { state, el, setStatus } = window.__ANJ__;

  /* ---------- HELPERS ---------- */
  function download(filename, content, type = "text/plain") {
    const blob = new Blob([content], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function ensureParsed() {
    if (!state.parsed) {
      setStatus("Nothing to export", true);
      return false;
    }
    return true;
  }

  /* ---------- EXPORT JSON ---------- */
  el.exportJsonBtn?.addEventListener("click", () => {
    if (!ensureParsed()) return;
    download(
      "invoice.json",
      JSON.stringify(state.parsed, null, 2),
      "application/json"
    );
    setStatus("JSON exported ✓");
  });

  /* ---------- EXPORT TXT ---------- */
  el.exportTxtBtn?.addEventListener("click", () => {
    if (!ensureParsed()) return;
    download("invoice.txt", state.cleanedText);
    setStatus("TXT exported ✓");
  });

  /* ---------- EXPORT CSV ---------- */
  el.exportCsvBtn?.addEventListener("click", () => {
    if (!ensureParsed()) return;

    let csv = "Name,Qty,Price,Total\n";
    state.parsed.items.forEach(i => {
      csv += `"${i.name}",${i.qty},${i.price},${i.total}\n`;
    });

    download("invoice.csv", csv, "text/csv");
    setStatus("CSV exported ✓");
  });

  /* ---------- EXPORT PDF ---------- */
  el.exportPdfBtn?.addEventListener("click", async () => {
    if (!ensureParsed()) return;

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();

    pdf.text("Invoice Summary", 10, 10);
    pdf.text(`Merchant: ${state.parsed.merchant || "-"}`, 10, 20);
    pdf.text(`Date: ${state.parsed.date || "-"}`, 10, 30);
    pdf.text(`Total: ${state.parsed.total || "-"}`, 10, 40);

    pdf.text("Items:", 10, 55);
    let y = 65;

    state.parsed.items.forEach(i => {
      pdf.text(
        `${i.name} | ${i.qty} x ${i.price} = ${i.total}`,
        10,
        y
      );
      y += 8;
    });

    pdf.save("invoice.pdf");
    setStatus("PDF exported ✓");
  });

  /* ---------- EXPORT ZIP ---------- */
  el.exportZipBtn?.addEventListener("click", async () => {
    if (!ensureParsed()) return;

    const zip = new JSZip();
    zip.file("invoice.json", JSON.stringify(state.parsed, null, 2));
    zip.file("invoice.txt", state.cleanedText);

    let csv = "Name,Qty,Price,Total\n";
    state.parsed.items.forEach(i => {
      csv += `"${i.name}",${i.qty},${i.price},${i.total}\n`;
    });
    zip.file("invoice.csv", csv);

    const blob = await zip.generateAsync({ type: "blob" });
    download("invoice_bundle.zip", blob, "application/zip");
    setStatus("ZIP downloaded ✓");
  });

})();
/* =========================================================
   CHUNK 6 / 6 — INDEXEDDB HISTORY + FINAL GLUE
   ========================================================= */

(() => {
  const { state, el, setStatus } = window.__ANJ__;

  /* ---------- INDEXEDDB SETUP ---------- */
  const DB_NAME = "anj-invoice-db";
  const STORE = "invoices";
  let db;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);

      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        }
      };

      req.onsuccess = e => {
        db = e.target.result;
        resolve(db);
      };

      req.onerror = () => reject("IndexedDB failed");
    });
  }

  /* ---------- SAVE TO HISTORY ---------- */
  async function saveToHistory(parsed) {
    if (!parsed) return;

    await openDB();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);

    store.add({
      timestamp: Date.now(),
      merchant: parsed.merchant,
      date: parsed.date,
      total: parsed.total,
      currency: detectCurrency(parsed.total),
      data: parsed
    });

    setStatus("Saved to history ✓");
  }

  /* ---------- LOAD HISTORY ---------- */
  async function loadHistory() {
    await openDB();
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);

    const req = store.getAll();

    req.onsuccess = () => {
      const items = req.result;
      if (!items.length) {
        el.historyList.textContent = "No history yet.";
        return;
      }

      el.historyList.innerHTML = "";
      items.reverse().forEach(item => {
        const div = document.createElement("div");
        div.style.cursor = "pointer";
        div.style.padding = "6px 0";
        div.innerHTML = `
          <b>${item.merchant || "Unknown"}</b>
          — ${item.total || "-"}
        `;

        div.onclick = () => {
          state.parsed = item.data;
          el.rawText.textContent = item.data.cleanedText;
          el.cleanedText.textContent = item.data.cleanedText;

          // re-render UI
          document.getElementById("merchant").textContent = item.data.merchant || "-";
          document.getElementById("date").textContent = item.data.date || "-";
          document.getElementById("total").textContent = item.data.total || "-";
          document.getElementById("confidence").textContent = item.data.confidence || "-";

          document.getElementById("jsonPreview").textContent =
            JSON.stringify(item.data, null, 2);

          setStatus("History loaded ✓");
        };

        el.historyList.appendChild(div);
      });
    };
  }

  /* ---------- CLEAR HISTORY ---------- */
  async function clearHistory() {
    await openDB();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    el.historyList.textContent = "History cleared.";
    setStatus("History cleared ✓");
  }

  /* ---------- SIMPLE CURRENCY DETECTOR ---------- */
  function detectCurrency(text = "") {
    if (/₹|rs|inr/i.test(text)) return "INR";
    if (/\$/i.test(text)) return "USD";
    if (/€/i.test(text)) return "EUR";
    if (/£/i.test(text)) return "GBP";
    return "UNKNOWN";
  }

  /* ---------- AUTO SAVE AFTER PARSE ---------- */
  if (el.parseBtn) {
    el.parseBtn.addEventListener("click", () => {
      if (state.parsed) saveToHistory(state.parsed);
    });
  }

  /* ---------- HISTORY BUTTONS ---------- */
  el.loadHistoryBtn?.addEventListener("click", loadHistory);
  el.clearHistoryBtn?.addEventListener("click", clearHistory);

})();
           
