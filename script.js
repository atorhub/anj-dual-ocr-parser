pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.10.177/build/pdf.worker.min.js";

const fileInput = document.getElementById("fileInput");
const parseBtn = document.getElementById("parseBtn");
const ocrOnlyBtn = document.getElementById("ocrOnlyBtn");
const dualOCRBtn = document.getElementById("dualOCRBtn");
const aiCleanupBtn = document.getElementById("aiCleanupBtn");

const merchantEl = document.getElementById("merchantText");
const dateEl = document.getElementById("dateText");
const totalEl = document.getElementById("totalText");
const categoryEl = document.getElementById("categoryText");
const itemsTable = document.getElementById("itemsPreview");

const rawTextEl = document.getElementById("rawTextPreview");
const cleanedTextEl = document.getElementById("cleanedTextPreview");
const jsonPreviewEl = document.getElementById("jsonPreview");
const issuesBoxEl = document.getElementById("issuesBox");

const exportJSONBtn = document.getElementById("exportJSONBtn");
const exportCSVBtn = document.getElementById("exportCSVBtn");
const exportTXTBtn = document.getElementById("exportTXTBtn");
const exportPDFBtn = document.getElementById("exportPDFBtn");
const exportZIPBtn = document.getElementById("exportZIPBtn");

const themeButtons = document.querySelectorAll(".theme-circle");
const themeCarouselLeft = document.getElementById("themeLeft");
const themeCarouselRight = document.getElementById("themeRight");
const statusBar = document.getElementById("statusBar");

let lastOCR = {
    quick: "",
    enhanced: "",
    combined: ""
};

let parsedResult = null;

const DB_VERSION = 3;
const DB_NAME = "anj-ultra-db";

let db = null;

function initDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onerror = () => reject(req.error);

        req.onupgradeneeded = () => {
            const db = req.result;

            if (!db.objectStoreNames.contains("invoices")) {
                const store = db.createObjectStore("invoices", {
                    keyPath: "id",
                    autoIncrement: true
                });

                store.createIndex("merchant", "merchant");
                store.createIndex("date", "date");
                store.createIndex("amount", "total");
                store.createIndex("category", "category");
            }

            if (!db.objectStoreNames.contains("settings")) {
                db.createObjectStore("settings", { keyPath: "key" });
            }
        };

        req.onsuccess = () => {
            db = req.result;
            resolve();
        };
    });
}

async function saveInvoice(data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction("invoices", "readwrite");
        tx.objectStore("invoices").add(data);
        tx.oncomplete = resolve;
        tx.onerror = reject;
    });
}

async function saveSetting(key, value) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction("settings", "readwrite");
        tx.objectStore("settings").put({ key, value });
        tx.oncomplete = resolve;
        tx.onerror = reject;
    });
}

async function loadSetting(key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction("settings", "readonly");
        const req = tx.objectStore("settings").get(key);
        req.onsuccess = () => resolve(req.result?.value);
        req.onerror = reject;
    });
}

function updateStatus(msg, good = true) {
    statusBar.textContent = msg;
    statusBar.style.color = good ? "#14a44d" : "#ff4444";
}

window.addEventListener("DOMContentLoaded", async () => {
    await initDB();
    updateStatus("Ready ✓");

    const savedTheme = await loadSetting("theme");
    if (savedTheme) {
        document.body.className = savedTheme;
    }
});
async function extractTextFromPDF(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        let output = "";
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const strings = textContent.items.map(item => item.str);
            output += strings.join(" ") + "\n";
        }

        return output.trim();
    } catch (err) {
        console.error("PDF extraction error:", err);
        return "";
    }
}

async function quickOCR(imageFile) {
    try {
        const worker = await Tesseract.createWorker();
        await worker.load();
        await worker.loadLanguage("eng");
        await worker.initialize("eng");

        const { data } = await worker.recognize(imageFile);
        await worker.terminate();

        return data.text.trim();
    } catch (err) {
        console.error("Quick OCR error:", err);
        return "";
    }
}

async function enhancedOCR(imageFile) {
    try {
        const worker = await Tesseract.createWorker({
            logger: m => console.debug("Enhanced OCR:", m)
        });
        await worker.load();
        await worker.loadLanguage("eng");
        await worker.initialize("eng");

        await worker.setParameters({
            tessedit_pageseg_mode: Tesseract.PSM.AUTO,
            tessedit_char_whitelist:
                "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789₹$€£().,:;-/% ",
            preserve_interword_spaces: "1"
        });

        const { data } = await worker.recognize(imageFile);
        await worker.terminate();

        return data.text.trim();
    } catch (err) {
        console.error("Enhanced OCR error:", err);
        return "";
    }
}

async function getTextFromFile(file) {
    const name = file.name.toLowerCase();

    if (name.endsWith(".pdf")) {
        return await extractTextFromPDF(file);
    }

    if (name.endsWith(".txt")) {
        return await file.text();
    }

    if (
        name.endsWith(".png") ||
        name.endsWith(".jpg") ||
        name.endsWith(".jpeg") ||
        name.endsWith(".webp")
    ) {
        const quick = await quickOCR(file);
        const enhanced = await enhancedOCR(file);

        return {
            quick,
            enhanced
        };
    }

    return "";
}

function detectOCRFailure(text) {
    if (!text) return true;
    if (text.length < 15) return true;
    if (!/[0-9]/.test(text) && !/[A-Za-z]/.test(text)) return true;
    return false;
}
function normalizeWhitespace(s) {
  return s.replace(/\r\n/g, "\n").replace(/\t/g, " ").replace(/[ \u00A0]{2,}/g, " ").trim();
}

function toLines(text) {
  return normalizeWhitespace(text)
    .split(/\n/)
    .map(l => l.trim())
    .filter(Boolean);
}

function parseNumberString(numStr) {
  if (!numStr) return null;
  // remove currency symbols and words
  let s = String(numStr).replace(/[^\d.,\-]/g, "");
  // if multiple dots/commas, normalize: assume last separator is decimal
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let decimalSep = null;
  if (lastDot > lastComma) decimalSep = ".";
  else if (lastComma > lastDot) decimalSep = ",";
  // remove thousands separators (the other one)
  if (decimalSep === ".") {
    s = s.replace(/,/g, "");
  } else if (decimalSep === ",") {
    s = s.replace(/\./g, "");
    s = s.replace(/,/g, ".");
    decimalSep = "."; // convert to dot for parseFloat
  } else {
    s = s.replace(/,/g, "");
  }
  // remove stray multiple dots
  const parts = s.split(".");
  if (parts.length > 2) {
    const last = parts.pop();
    s = parts.join("") + "." + last;
  }
  // now parse as float safely by converting to integer cents
  const m = s.match(/^-?\d+(\.\d+)?$/);
  if (!m) return null;
  const negative = s.startsWith("-");
  const clean = negative ? s.slice(1) : s;
  const idx = clean.indexOf(".");
  let cents = 0;
  if (idx === -1) {
    cents = BigInt(clean) * 100n;
  } else {
    const intPart = clean.slice(0, idx) || "0";
    let dec = clean.slice(idx + 1);
    if (dec.length > 2) dec = dec.slice(0, 2); // truncate extra precision
    while (dec.length < 2) dec += "0";
    cents = BigInt(intPart) * 100n + BigInt(dec);
  }
  if (negative) cents = -cents;
  return cents; // in "cents" i.e., minor units
}

function centsToString(cents, currencySymbol = "₹") {
  const neg = cents < 0n;
  const v = neg ? -cents : cents;
  const intPart = v / 100n;
  const decPart = v % 100n;
  // insert thousands separators
  const intStr = String(intPart);
  let withCommas = "";
  for (let i = 0; i < intStr.length; i++) {
    const pos = intStr.length - i;
    withCommas += intStr[i];
    if (pos > 1 && pos % 3 === 1) withCommas += ",";
  }
  const decStr = String(decPart).padStart(2, "0");
  return (neg ? "-" : "") + currencySymbol + withCommas + "." + decStr;
}

function detectCurrencySymbol(text) {
  if (!text) return "INR";
  if (/[₹]/.test(text)) return "INR";
  if (/\bINR\b/i.test(text) || /\bRs\.?\b/i.test(text)) return "INR";
  if (/\$\s?/.test(text)) return "USD";
  if (/€/.test(text)) return "EUR";
  if (/£/.test(text)) return "GBP";
  if (/¥/.test(text)) return "JPY";
  return "UNKNOWN";
}

function tryParseDateCandidates(s) {
  if (!s) return null;
  s = s.replace(/\./g, "/").replace(/st|nd|rd|th/gi, "");
  const candidates = [];
  // common explicit formats
  const rx1 = /\b(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/;
  const rx2 = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/;
  const rx3 = /\b([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})\b/;
  let m;
  if ((m = s.match(rx1))) {
    const yyyy = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const dd = parseInt(m[3], 10);
    candidates.push({ yyyy, mm, dd });
  }
  if ((m = s.match(rx2))) {
    let d = parseInt(m[1], 10);
    let mo = parseInt(m[2], 10);
    let y = parseInt(m[3], 10);
    if (y < 100) {
      y += y >= 50 ? 1900 : 2000;
    }
    // ambiguous dd/mm or mm/dd: we'll add both interpretations
    candidates.push({ yyyy: y, mm: mo, dd: d });
    candidates.push({ yyyy: y, mm: d, dd: mo });
  }
  if ((m = s.match(rx3))) {
    const moNames = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const mo = moNames.findIndex(x => x === m[1].slice(0,3).toLowerCase()) + 1;
    const dd = parseInt(m[2], 10);
    const yyyy = parseInt(m[3], 10);
    if (mo >= 1) candidates.push({ yyyy, mm: mo, dd });
  }
  // fallback: try Date.parse
  const parsed = Date.parse(s);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    candidates.push({ yyyy: d.getFullYear(), mm: d.getMonth() + 1, dd: d.getDate() });
  }
  // validate candidates
  for (const c of candidates) {
    const { yyyy, mm, dd } = c;
    if (!yyyy || !mm || !dd) continue;
    if (mm < 1 || mm > 12) continue;
    if (dd < 1 || dd > 31) continue;
    try {
      const dt = new Date(yyyy, mm - 1, dd);
      if (dt.getFullYear() === yyyy && dt.getMonth() === mm - 1 && dt.getDate() === dd) {
        return dt.toISOString().slice(0, 10);
      }
    } catch (e) { }
  }
  return null;
}

function extractMerchant(lines) {
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const l = lines[i];
    if (!/invoice|bill|receipt|gst|tax|total|date|qty|amount|price/i.test(l) && /[A-Za-z0-9]/.test(l) && l.length > 2) {
      return l.replace(/[^A-Za-z0-9 \-&.,']/g, "").trim();
    }
  }
  // fallback: first line with letters
  for (const l of lines) {
    if (/[A-Za-z]/.test(l)) return l;
  }
  return "UNKNOWN";
}

function extractDate(raw) {
  // look for likely date-like tokens
  const dateRx = /(\b(?:\d{1,2}[\/\-\.\s]\d{1,2}[\/\-\.\s]\d{2,4}|\d{4}[\/\-\.\s]\d{1,2}[\/\-\.\s]\d{1,2}|[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})\b)/g;
  const matches = raw.match(dateRx) || [];
  for (const m of matches) {
    const nv = tryParseDateCandidates(m);
    if (nv) return nv;
  }
  // try scanning lines
  const lines = toLines(raw);
  for (const l of lines) {
    const nv = tryParseDateCandidates(l);
    if (nv) return nv;
  }
  return null;
}

function extractTotal(raw) {
  // look for lines with total/grand total/balance due keywords
  const lines = toLines(raw);
  const currencyFound = detectCurrencySymbol(raw);
  const totalCandidates = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (/grand total|total payable|total amount|amount due|balance due|net total|total/i.test(l)) {
      const numMatch = l.match(/([₹₹₹\$\€\£\¥]?\s*[\d.,]+(?:\.\d{1,2})?)/g);
      if (numMatch && numMatch.length) {
        for (const nm of numMatch) {
          const cents = parseNumberString(nm);
          if (cents !== null) totalCandidates.push(cents);
        }
        if (totalCandidates.length) break;
      } else {
        const anyNum = l.match(/[\d.,]{2,}/g);
        if (anyNum) {
          for (const nm of anyNum) {
            const cents = parseNumberString(nm);
            if (cents !== null) totalCandidates.push(cents);
          }
          if (totalCandidates.length) break;
        }
      }
    } else {
      // also collect near-bottom numbers as candidates (last 6 lines)
      if (lines.length - i <= 6) {
        const nums = l.match(/([₹\$\€\£\¥]?\s*[\d.,]+)/g);
        if (nums) {
          for (const nm of nums) {
            const cents = parseNumberString(nm);
            if (cents !== null) totalCandidates.push(cents);
          }
        }
      }
    }
  }
  if (totalCandidates.length) {
    // choose the largest positive candidate
    let best = totalCandidates[0];
    for (const c of totalCandidates) {
      if (c > best) best = c;
    }
    return { cents: best, currency: currencyFound };
  }
  // fallback: largest number in document
  const allNums = (raw.match(/[\d.,]{2,}/g) || []).map(n => parseNumberString(n)).filter(Boolean);
  if (allNums.length) {
    let maxn = allNums[0];
    for (const c of allNums) if (c > maxn) maxn = c;
    return { cents: maxn, currency: currencyFound };
  }
  return null;
}

function extractItems(raw) {
  const lines = toLines(raw);
  const items = [];
  // try to detect a block of lines that look like items (name qty price total)
  const itemRx1 = /^(.{2,70}?)\s+(\d+)\s+([₹\$\€\£\¥]?\s*[\d.,]+)\s+([₹\$\€\£\¥]?\s*[\d.,]+)$/;
  const itemRx2 = /^(.{2,70}?)\s+([₹\$\€\£\¥]?\s*[\d.,]+)\s+([₹\$\€\£\¥]?\s*[\d.,]+)$/;
  const itemRx3 = /^(.{2,70}?)\s+([₹\$\€\£\¥]?\s*[\d.,]+)$/;
  for (const l of lines) {
    let m;
    if ((m = l.match(itemRx1))) {
      const name = m[1].trim();
      const qty = parseInt(m[2], 10) || 1;
      const price = parseNumberString(m[3]) || null;
      const total = parseNumberString(m[4]) || null;
      items.push({ name, qty, price, total });
      continue;
    }
    if ((m = l.match(itemRx2))) {
      const name = m[1].trim();
      const price = parseNumberString(m[2]) || null;
      const total = parseNumberString(m[3]) || null;
      items.push({ name, qty: 1, price, total });
      continue;
    }
    if ((m = l.match(itemRx3))) {
      // only name + one number, treat as price
      const name = m[1].trim();
      const price = parseNumberString(m[2]) || null;
      items.push({ name, qty: 1, price, total: price });
      continue;
    }
  }
  // post-process: merge consecutive lines where item names were wrapped (if next line starts with price)
  const merged = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.name || it.name.length < 2) continue;
    // if next item has same price and single-word name that looks numeric, try merge (skip heavy heuristics)
    merged.push(it);
  }
  return merged;
}

function computeItemsSum(items) {
  let sum = 0n;
  for (const it of items) {
    let line = null;
    if (it.total !== undefined && it.total !== null) line = it.total;
    else if (it.price !== undefined && it.price !== null && it.qty !== undefined) line = it.price * BigInt(it.qty);
    if (line !== null) {
      if (typeof line === "bigint") sum += line;
      else if (typeof line === "number") sum += BigInt(Math.round(line * 100));
      else if (typeof line === "string") {
        const c = parseNumberString(line);
        if (c !== null) sum += c;
      } else if (line instanceof Object && line.cents) {
        sum += line.cents;
      }
    }
  }
  return sum;
}

function detectIssuesAndCorrect(parsed, extractedRaw) {
  const issues = [];
  const corrections = [];
  const result = JSON.parse(JSON.stringify(parsed)); // shallow clone
  // currency normalize
  const currency = parsed.total?.currency || detectCurrencySymbol(extractedRaw);
  result.currency = currency || "INR";
  // normalize date
  if (parsed.date) {
    const nd = tryParseDateCandidates(parsed.date);
    if (nd) {
      if (nd !== parsed.date) corrections.push({ field: "date", from: parsed.date, to: nd });
      result.date = nd;
    } else {
      issues.push({ field: "date", problem: "unrecognized_date", raw: parsed.date });
    }
  } else {
    issues.push({ field: "date", problem: "missing_date" });
  }
  // merchant
  if (!parsed.merchant || parsed.merchant === "UNKNOWN") {
    issues.push({ field: "merchant", problem: "missing_merchant" });
  }
  // items
  if (!parsed.items || parsed.items.length === 0) {
    issues.push({ field: "items", problem: "no_items_detected" });
  } else {
    // coerce item numeric fields to cents
    for (const it of parsed.items) {
      if (it.price && typeof it.price !== "bigint") {
        const p = parseNumberString(it.price);
        if (p !== null) it.price = p;
      }
      if (it.total && typeof it.total !== "bigint") {
        const t = parseNumberString(it.total);
        if (t !== null) it.total = t;
      }
      if ((!it.total || it.total === null) && it.price && it.qty) {
        it.total = BigInt(it.qty) * (typeof it.price === "bigint" ? it.price : BigInt(Math.round(Number(it.price))));
      }
    }
  }
  // total
  let documentTotal = null;
  if (parsed.total && parsed.total.cents !== undefined) {
    documentTotal = parsed.total.cents;
  } else {
    issues.push({ field: "total", problem: "missing_total" });
  }
  // compute sum of items
  const itemsSum = computeItemsSum(parsed.items || []);
  // if total exists compare
  if (documentTotal !== null) {
    const diff = documentTotal - itemsSum;
    const absDiff = diff < 0n ? -diff : diff;
    // tolerance: 1% of total or 1.00 minor units, whichever larger
    const threshold = (documentTotal === 0n ? 100n : (documentTotal / 100n)); // 1% approx, in cents
    const minThreshold = 100n; // ₹1.00
    const tol = threshold > minThreshold ? threshold : minThreshold;
    if (absDiff > tol) {
      // significant mismatch
      corrections.push({
        field: "total",
        from: centsToString(documentTotal, ""),
        to: centsToString(itemsSum, ""),
        reason: "items_sum_mismatch"
      });
      result.correctedTotal = itemsSum;
      result.totalDiscrepancy = diff;
    } else if (absDiff > 0n) {
      // minor rounding difference - prefer document total but note
      corrections.push({
        field: "total",
        from: centsToString(documentTotal, ""),
        to: centsToString(itemsSum, ""),
        reason: "minor_rounding_difference"
      });
      result.correctedTotal = documentTotal;
      result.totalDiscrepancy = diff;
    } else {
      // match
      result.correctedTotal = documentTotal;
      result.totalDiscrepancy = 0n;
    }
  } else {
    // no document total -> use itemsSum as total
    corrections.push({ field: "total", from: null, to: centsToString(itemsSum, ""), reason: "inferred_from_items" });
    result.correctedTotal = itemsSum;
    result.totalDiscrepancy = itemsSum;
  }
  // build issue summary
  if (issues.length === 0 && corrections.length === 0) {
    result.status = "valid";
  } else {
    result.status = "issues_detected";
  }
  result.issues = issues;
  result.corrections = corrections;
  return result;
}

function computeConfidence(parsed, ocrConfQuick = 30, ocrConfEnhanced = 30) {
  let score = 0;
  // merchant 20
  if (parsed.merchant && parsed.merchant !== "UNKNOWN") score += 20;
  // date 15
  if (parsed.date) score += 15;
  // total 30
  if (parsed.total && parsed.total.cents !== undefined) score += 30;
  // items up to 25
  if (parsed.items && parsed.items.length > 0) {
    const countScore = Math.min(25, parsed.items.length * 5);
    score += countScore;
  }
  // OCR confidences weight 10
  const ocrAvg = Math.round((ocrConfQuick + ocrConfEnhanced) / 2);
  const ocrScore = Math.round((ocrAvg / 100) * 10);
  score += ocrScore;
  if (score > 100) score = 100;
  return score;
}

function parseRawInvoiceText(raw, ocrMeta = { quickConf: 30, enhancedConf: 30 }) {
  const lines = toLines(raw);
  const merchant = extractMerchant(lines);
  const date = extractDate(raw) || null;
  const total = extractTotal(raw) || null;
  const items = extractItems(raw) || [];
  // coerce total to object with cents
  const totalObj = total ? { cents: total.cents, currency: total.currency } : null;
  const parsed = {
    merchant,
    date,
    total: totalObj,
    items,
    raw: raw
  };
  const analyzed = detectIssuesAndCorrect(parsed, raw);
  analyzed.confidence = computeConfidence(parsed, ocrMeta.quickConf || 30, ocrMeta.enhancedConf || 30);
  // format display-friendly strings
  analyzed.display = {
    merchant: analyzed.merchant,
    date: analyzed.date || "-",
    total: analyzed.correctedTotal !== undefined ? centsToString(analyzed.correctedTotal, determineSymbol(analyzed.currency)) : "-",
    currency: analyzed.currency || "INR",
    items: (analyzed.items || []).map(it => ({
      name: it.name,
      qty: it.qty || 1,
      price: it.price && typeof it.price === "bigint" ? centsToString(it.price, determineSymbol(analyzed.currency)) : (it.price ? String(it.price) : "-"),
      total: it.total && typeof it.total === "bigint" ? centsToString(it.total, determineSymbol(analyzed.currency)) : (it.total ? String(it.total) : "-")
    }))
  };
  return analyzed;
}

function determineSymbol(currencyCode) {
  if (!currencyCode) return "₹";
  if (currencyCode === "INR") return "₹";
  if (currencyCode === "USD") return "$";
  if (currencyCode === "EUR") return "€";
  if (currencyCode === "GBP") return "£";
  if (currencyCode === "JPY") return "¥";
  return "";
}
function renderInvoicePreview(result) {
  merchantEl.textContent = result.display.merchant || "-";
  dateEl.textContent = result.display.date || "-";
  totalEl.textContent = result.display.total || "-";
  categoryEl.textContent = result.category || "-";

  itemsTable.innerHTML = "";
  if (result.display.items && result.display.items.length) {
    result.display.items.forEach(it => {
      const row = document.createElement("tr");
      const c1 = document.createElement("td");
      const c2 = document.createElement("td");
      const c3 = document.createElement("td");
      const c4 = document.createElement("td");
      c1.textContent = it.name || "-";
      c2.textContent = it.qty || "-";
      c3.textContent = it.price || "-";
      c4.textContent = it.total || "-";
      row.appendChild(c1);
      row.appendChild(c2);
      row.appendChild(c3);
      row.appendChild(c4);
      itemsTable.appendChild(row);
    });
  }

  jsonPreviewEl.textContent = JSON.stringify(result, null, 2);

  rawTextEl.textContent = lastOCR.combined || "";
  cleanedTextEl.textContent = result.raw || "";

  issuesBoxEl.innerHTML = "";

  if (result.issues && result.issues.length === 0 && result.corrections && result.corrections.length === 0) {
    const ok = document.createElement("div");
    ok.textContent = "No issues detected.";
    issuesBoxEl.appendChild(ok);
  } else {
    if (result.issues && result.issues.length > 0) {
      result.issues.forEach(i => {
        const div = document.createElement("div");
        div.textContent = "Issue: " + i.field + " → " + (i.problem || "unknown");
        issuesBoxEl.appendChild(div);
      });
    }
    if (result.corrections && result.corrections.length > 0) {
      result.corrections.forEach(c => {
        const div = document.createElement("div");
        div.textContent = "Corrected: " + c.field + " → " + c.to;
        issuesBoxEl.appendChild(div);
      });
    }
  }
}

function renderAll(raw, parsed) {
  renderInvoicePreview(parsed);
  updateStatus("Parsed Successfully ✓", true);
}

async function saveToHistory(parsed) {
  const record = {
    merchant: parsed.merchant || "UNKNOWN",
    date: parsed.date || null,
    total: parsed.correctedTotal ? parsed.correctedTotal.toString() : null,
    currency: parsed.currency || null,
    items: parsed.items || [],
    issues: parsed.issues || [],
    corrections: parsed.corrections || [],
    confidence: parsed.confidence || 0,
    created: Date.now()
  };
  await saveInvoice(record);
}

dualOCRBtn.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) {
    updateStatus("No file selected", false);
    return;
  }
  updateStatus("Running Dual OCR…");

  const quick = await runQuickOCRInternal(file);
  const enhanced = await runEnhancedOCRInternal(file);

  lastOCR.quick = quick.text;
  lastOCR.enhanced = enhanced.text;
  lastOCR.combined = quick.text + "\n\n" + enhanced.text;

  updateStatus("Dual OCR Done ✓");
});

ocrOnlyBtn.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) {
    updateStatus("No file selected", false);
    return;
  }
  updateStatus("Running Single OCR…");

  const quick = await runQuickOCRInternal(file);
  lastOCR.quick = quick.text;
  lastOCR.enhanced = "";
  lastOCR.combined = quick.text;

  updateStatus("OCR Completed ✓");
});

parseBtn.addEventListener("click", () => {
  if (!lastOCR.combined) {
    updateStatus("Run OCR first", false);
    return;
  }
  updateStatus("Parsing…");

  const parsed = parseRawInvoiceText(lastOCR.combined);
  parsedResult = parsed;

  renderAll(lastOCR.combined, parsed);

  saveToHistory(parsed);

  updateStatus("Done ✓");
});
function buildFileName(base, ext) {
  const m = parsedResult?.merchant || "invoice";
  const t = Date.now();
  return m.replace(/[^a-z0-9]/gi, "_").toLowerCase() + "_" + t + "." + ext;
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(parsedResult, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildFileName("invoice", "json");
  a.click();
  URL.revokeObjectURL(url);
}

function exportTXT() {
  const txt = parsedResult.raw || lastOCR.combined || "";
  const blob = new Blob([txt], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildFileName("invoice", "txt");
  a.click();
  URL.revokeObjectURL(url);
}

function exportCSV() {
  let csv = "Item,Qty,Price,Total\n";
  if (parsedResult.items && parsedResult.items.length) {
    parsedResult.items.forEach(i => {
      csv +=
        (i.name || "") +
        "," +
        (i.qty || "") +
        "," +
        (i.price || "") +
        "," +
        (i.total || "") +
        "\n";
    });
  }
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildFileName("invoice", "csv");
  a.click();
  URL.revokeObjectURL(url);
}

async function exportPDF() {
  const el = document.getElementById("previewContainer");
  const canvas = await html2canvas(el, { scale: 2 });
  const img = canvas.toDataURL("image/png");
  const { jsPDF } = window.jspdf;

  const pdf = new jsPDF("p", "pt", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const ratio = canvas.width / canvas.height;
  let pdfWidth = pageWidth - 40;
  let pdfHeight = pdfWidth / ratio;
  if (pdfHeight > pageHeight) {
    pdfHeight = pageHeight - 40;
    pdfWidth = pdfHeight * ratio;
  }

  pdf.addImage(img, "PNG", 20, 20, pdfWidth, pdfHeight);
  pdf.save(buildFileName("invoice", "pdf"));
}

async function exportZIP() {
  const zip = new JSZip();

  zip.file(buildFileName("invoice", "json"), JSON.stringify(parsedResult, null, 2));

  const txt = parsedResult.raw || lastOCR.combined || "";
  zip.file(buildFileName("invoice", "txt"), txt);

  let csv = "Item,Qty,Price,Total\n";
  if (parsedResult.items && parsedResult.items.length) {
    parsedResult.items.forEach(i => {
      csv +=
        (i.name || "") +
        "," +
        (i.qty || "") +
        "," +
        (i.price || "") +
        "," +
        (i.total || "") +
        "\n";
    });
  }
  zip.file(buildFileName("invoice", "csv"), csv);

  const el = document.getElementById("previewContainer");
  const canvas = await html2canvas(el, { scale: 2 });
  const img = canvas.toDataURL("image/png");
  zip.file("preview.png", img.split(",")[1], { base64: true });

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildFileName("invoice_bundle", "zip");
  a.click();
  URL.revokeObjectURL(url);
}

exportJsonBtn.addEventListener("click", exportJSON);
exportTxtBtn.addEventListener("click", exportTXT);
exportCsvBtn.addEventListener("click", exportCSV);
exportPdfBtn.addEventListener("click", exportPDF);
exportZipBtn.addEventListener("click", exportZIP);
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("anj_invoice_db_v2", 1);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains("invoices")) {
        d.createObjectStore("invoices", { keyPath: "id" });
      }
    };
    req.onsuccess = e => {
      db = e.target.result;
      resolve();
    };
    req.onerror = e => reject(e);
  });
}

function saveInvoice(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("invoices", "readwrite");
    const store = tx.objectStore("invoices");
    record.id = record.id || "inv_" + Date.now();
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e);
  });
}

function fetchInvoices() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("invoices", "readonly");
    const store = tx.objectStore("invoices");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = e => reject(e);
  });
}

function clearInvoices() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("invoices", "readwrite");
    const store = tx.objectStore("invoices");
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e);
  });
}

async function renderHistory() {
  const list = document.getElementById("historyList");
  const data = await fetchInvoices();

  if (!data.length) {
    list.innerHTML = "<div>No history yet.</div>";
    return;
  }

  list.innerHTML = "";
  data.sort((a, b) => b.created - a.created);

  data.forEach(inv => {
    const row = document.createElement("div");
    row.className = "history-row";

    const left = document.createElement("div");
    const right = document.createElement("div");

    left.className = "history-left";
    right.className = "history-right";

    left.textContent =
      (inv.merchant || "Unknown") +
      " — " +
      (inv.date || "No Date");

    right.textContent = inv.total ? inv.total : "-";

    row.appendChild(left);
    row.appendChild(right);

    row.addEventListener("click", () => {
      parsedResult = inv;
      rawTextEl.textContent = inv.raw || "";
      cleanedTextEl.textContent = inv.raw || "";
      renderInvoicePreview(inv);
      updateStatus("Loaded from history ✓", true);
    });

    list.appendChild(row);
  });
}

document.getElementById("clearHistoryBtn").addEventListener("click", async () => {
  await clearInvoices();
  await renderHistory();
  updateStatus("History cleared", true);
});

document.getElementById("loadHistoryBtn").addEventListener("click", async () => {
  await renderHistory();
  updateStatus("History loaded", true);
});

openDB().then(() => {
  renderHistory();
});
const themeSelect = document.getElementById("themeSelect");

function applyTheme(name) {
  document.body.classList.remove(
    "theme-rose",
    "theme-lilac",
    "theme-cotton",
    "theme-galaxy",
    "theme-blush",
    "theme-fairy"
  );
  document.body.classList.add("theme-" + name);
  localStorage.setItem("anj_theme", name);
}

function loadStoredTheme() {
  const t = localStorage.getItem("anj_theme");
  if (t) {
    applyTheme(t);
    themeSelect.value = t;
  }
}

themeSelect.addEventListener("change", () => {
  applyTheme(themeSelect.value);
});

loadStoredTheme();
body {
  transition: background 0.4s ease, color 0.4s ease;
}

/* Rose Nebula */
.theme-rose {
  background: #FDE2E4;
  color: #5D3A66;
  background-image:
    radial-gradient(rgba(255,255,255,0.7) 1px, transparent 1px),
    radial-gradient(rgba(255,255,255,0.4) 1.5px, transparent 1px);
  background-size: 4px 4px, 7px 7px;
  background-position: 0 0, 20px 20px;
}

.theme-rose .card {
  background: rgba(255,255,255,0.6);
  border: 1px solid rgba(93,58,102,0.2);
  box-shadow: 0 0 18px rgba(205,180,219,0.35);
  color: #5D3A66;
}

.theme-rose button {
  background: linear-gradient(135deg,#CDB4DB,#FDE2E4);
  color: #5D3A66;
}

/* Lilac Glow */
.theme-lilac {
  background: #F3E5F5;
  color: #333333;
  background-image: linear-gradient(135deg, rgba(183,110,121,0.18), rgba(203,180,219,0.22));
}

.theme-lilac .card {
  background: rgba(255,255,255,0.55);
  border: 1px solid rgba(183,110,121,0.25);
  color: #333333;
}

.theme-lilac button {
  background: linear-gradient(135deg,#B76E79,#CDB4DB);
  color: #fff;
}

/* Cotton Candy Sky */
.theme-cotton {
  background: linear-gradient(135deg,#FFD6E0,#E0BBE4);
  color: #2C2C54;
  background-image:
    radial-gradient(rgba(255,255,255,0.75) 1.2px, transparent 1px),
    radial-gradient(rgba(255,255,255,0.55) 1.4px, transparent 1px);
  background-size: 9px 9px, 16px 16px;
  background-position: 0 0, 30px 30px;
}

.theme-cotton .card {
  background: rgba(255,255,255,0.5);
  border: 1px solid rgba(160,231,229,0.4);
  box-shadow: 0 0 15px rgba(160,231,229,0.5);
  color: #2C2C54;
}

.theme-cotton button {
  background: linear-gradient(135deg,#A0E7E5,#FFD6E0);
  color: #2C2C54;
}

/* Galaxy Glitter */
.theme-galaxy {
  background: #EDE7F6;
  color: #3F51B5;
  background-image:
    radial-gradient(rgba(0,0,0,0.15) 0.8px, transparent 1px),
    radial-gradient(rgba(0,0,0,0.1) 1px, transparent 1px),
    radial-gradient(rgba(255,111,145,0.3) 2px, transparent 2px);
  background-size: 5px 5px, 9px 9px, 50px 50px;
}

.theme-galaxy .card {
  background: rgba(255,255,255,0.55);
  border: 1px solid rgba(255,111,145,0.28);
  box-shadow: 0 0 20px rgba(255,111,145,0.45);
  color: #3F51B5;
}

.theme-galaxy button {
  background: linear-gradient(90deg,#FF6F91,#CDB4DB);
  color: #fff;
}

/* Dreamy Blush */
.theme-blush {
  background: #FFE5EC;
  color: #8B3A62;
  background-image: linear-gradient(135deg, rgba(218,112,214,0.2), rgba(255,229,236,0.25));
}

.theme-blush .card {
  background: rgba(255,255,255,0.6);
  border: 1px solid rgba(218,112,214,0.25);
  color: #8B3A62;
}

.theme-blush button {
  background: linear-gradient(135deg,#DA70D6,#FFE5EC);
  color: #8B3A62;
}

/* Fairy Dust */
.theme-fairy {
  background: #FFF0F5;
  color: #4A4A4A;
  position: relative;
}

.theme-fairy::before {
  content: "";
  position: fixed;
  top:0; left:0; right:0; bottom:0;
  pointer-events:none;
  background-image:
    radial-gradient(rgba(147,112,219,0.7) 1.2px, transparent 1px),
    radial-gradient(rgba(255,255,255,0.7) 1px, transparent 1px),
    radial-gradient(rgba(255,255,255,0.5) 1.4px, transparent 1px);
  background-size: 6px 6px, 12px 12px, 20px 20px;
  animation: fairyTwinkle 2.6s infinite ease-in-out alternate;
}

@keyframes fairyTwinkle {
  0% { opacity: 0.35; }
  100% { opacity: 1; }
}

.theme-fairy .card {
  background: rgba(255,255,255,0.6);
  border: 1px solid rgba(147,112,219,0.25);
  box-shadow: 0 0 18px rgba(147,112,219,0.35);
  color: #4A4A4A;
}

    radial-gradient(rgba(147,112,219,0.7) 1.2px, transparent 1px),
    radial-gradient(rgba(255,255,255,0.7) 1px, transparent 1px),
    radial-gradient(rgba(255,255,255,0.5) 1.4px, transparent 1px);
  background-size: 6px 6px, 12px 12px, 20px 20px;
  animation: fairyTwinkle 2.6s infinite ease-in-out alternate;
}

@keyframes fairyTwinkle {
  0% { opacity: 0.35; }
  100% { opacity: 1; }
}

.theme-fairy .card {
  background: rgba(255,255,255,0.6);
  border: 1px solid rgba(147,112,219,0.25);
  box-shadow: 0 0 18px rgba(147,112,219,0.35);
  color: #4A4A4A;
}

  pointer-events:none;
  background-image:
    radial-gradient(rgba(147,112,219,0.7) 1.2px, transparent 1px),
    radial-gradient(rgba(255,255,255,0.7) 1px, transparent 1px),
    radial-gradient(rgba(255,255,255,0.5) 1.4px, transparent 1px);
  background-size: 6px 6px, 12px 12px, 20px 20px;
  animation: fairyTwinkle 2.6s infinite ease-in-out alternate;
}

@keyframes fairyTwinkle {
  0% { opacity: 0.35; }
  100% { opacity: 1; }
}

.theme-fairy .card {
  background: rgba(255,255,255,0.6);
  border: 1px solid rgba(147,112,219,0.25);
  box-shadow: 0 0 18px rgba(147,112,219,0.35);
  color: #4A4A4A;
}

.theme-fairy button {
  background: linear-gradient(135deg,#9370DB,#FFF0F5);
  color: #4A4A4A;
}
   
.theme-fairy button {
  background: linear-gradient(135deg,#9370DB,#FFF0F5);
  color: #4A4A4A;
}
 
.theme-galaxy .card {
  background: rgba(255,255,255,0.55);
  border: 1px solid rgba(255,111,145,0.28);
  box-shadow: 0 0 20px rgba(255,111,145,0.45);
  color: #3F51B5;
}

.theme-galaxy button {
  background: linear-gradient(90deg,#FF6F91,#CDB4DB);
  color: #fff;
}

/* Dreamy Blush */
.theme-blush {
  background: #FFE5EC;
  color: #8B3A62;
  background-image: linear-gradient(135deg, rgba(218,112,214,0.2), rgba(255,229,236,0.25));
}

.theme-blush .card {
  background: rgba(255,255,255,0.6);
  border: 1px solid rgba(218,112,214,0.25);
  color: #8B3A62;
}

.theme-blush button {
  background: linear-gradient(135deg,#DA70D6,#FFE5EC);
  color: #8B3A62;
}

/* Fairy Dust */
.theme-fairy {
  background: #FFF0F5;
  color: #4A4A4A;
  position: relative;
}

.theme-fairy::before {
  content: "";
  position: fixed;
  top:0; left:0; right:0; bottom:0;
  pointer-events:none;
  background-image:
    radial-gradient(rgba(147,112,219,0.7) 1.2px, transparent 1px),
    radial-gradient(rgba(255,255,255,0.7) 1px, transparent 1px),
    radial-gradient(rgba(255,255,255,0.5) 1.4px, transparent 1px);
  background-size: 6px 6px, 12px 12px, 20px 20px;
  animation: fairyTwinkle 2.6s infinite ease-in-out alternate;
}

@keyframes fairyTwinkle {
  0% { opacity: 0.35; }
  100% { opacity: 1; }
}

.theme-fairy .card {
  background: rgba(255,255,255,0.6);
  border: 1px solid rgba(147,112,219,0.25);
  box-shadow: 0 0 18px rgba(147,112,219,0.35);
  color: #4A4A4A;
}

.theme-fairy button {
  background: linear-gradient(135deg,#9370DB,#FFF0F5);
  color: #4A4A4A;
}
const fileInput = document.getElementById("fileInput");
const dualOCRBtn = document.getElementById("dualOCRBtn");
const ocrOnlyBtn = document.getElementById("ocrOnlyBtn");
const parseBtn = document.getElementById("parseBtn");

const exportJsonBtn = document.getElementById("exportJsonBtn");
const exportTxtBtn = document.getElementById("exportTxtBtn");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const exportZipBtn = document.getElementById("exportZipBtn");

const merchantEl = document.getElementById("merchant");
const dateEl = document.getElementById("date");
const totalEl = document.getElementById("total");
const categoryEl = document.getElementById("category");

const rawTextEl = document.getElementById("rawText");
const cleanedTextEl = document.getElementById("cleanedText");
const jsonPreviewEl = document.getElementById("jsonPreview");
const issuesBoxEl = document.getElementById("issuesBox");
const itemsTable = document.getElementById("itemsTable");

const historyList = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const loadHistoryBtn = document.getElementById("loadHistoryBtn");

const themeSelect = document.getElementById("themeSelect");

const statusBar = document.getElementById("statusBar");
const previewContainer = document.getElementById("previewContainer");

let lastOCR = { quick: "", enhanced: "", combined: "" };
let parsedResult = null;
function updateStatus(msg, ok) {
  statusBar.textContent = msg;
  statusBar.style.color = ok ? "#2ecc71" : "#e74c3c";
}

function handleError(e) {
  updateStatus("Error: " + (e.message || e), false);
}

function detectFileType(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image";
  return "unknown";
}

function showLoader(active) {
  if (active) {
    statusBar.textContent = "Processing…";
    statusBar.style.color = "#3498db";
  }
}

async function initApp() {
  updateStatus("Ready ✓", true);
  loadStoredTheme();
  await openDB();
  await renderHistory();
}

initApp();
   
