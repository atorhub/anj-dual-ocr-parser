/*
  script.js — ANJ Dual OCR Parser (combined)
  Option B: Dual OCR + Local WebLLM cleanup + Previews + Exports + IndexedDB history
  Delivered in 10 parts — paste sequentially into script.js
  Part 1: UI refs, IndexedDB wrapper init, status/log helpers, file/image helpers,
          quickOCR + enhancedOCR, extractTextFromFile, basic parser & merge,
          initial parse/ocr-only handlers (store lastExtract/lastMerged).
*/

/* =========================
   UI References
   ========================= */
const fileInput = document.getElementById('fileInput');
const parseBtn = document.getElementById('parseBtn');
const ocrOnlyBtn = document.getElementById('ocrOnlyBtn');
const aiCleanupBtn = document.getElementById('aiCleanupBtn');
const statusEl = document.getElementById('status');
const rawTextEl = document.getElementById('rawText');
const logBox = document.getElementById('logBox');
const previewBox = document.getElementById('previewBox');

const o_date = document.getElementById('o_date');
const o_total = document.getElementById('o_total');
const o_merchant = document.getElementById('o_merchant');
const o_category = document.getElementById('o_category');
const o_items = document.getElementById('o_items');
const o_conf = document.getElementById('o_confidence');

const previewJsonBtn = document.getElementById('previewJsonBtn');
const previewCsvBtn = document.getElementById('previewCsvBtn');
const previewXlsBtn = document.getElementById('previewXlsBtn');
const previewTallyBtn = document.getElementById('previewTallyBtn');
const previewTxtBtn = document.getElementById('previewTxtBtn');

const exportJsonBtn = document.getElementById('exportJsonBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const exportXlsBtn = document.getElementById('exportXlsBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const exportZipBtn = document.getElementById('exportZipBtn');

const saveBtn = document.getElementById('saveBtn');
const historyList = document.getElementById('historyList');
const clearBtn = document.getElementById('clearBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

/* =========================
   Globals for state
   ========================= */
window.lastExtract = null; // {pass1, pass2, image, fileName}
window.lastMerged = null;  // merged heuristic parse result before AI
window.lastFinal = null;   // final cleaned result after AI
window.ocrRawQuick = null;
window.ocrRawEnhanced = null;

/* =========================
   IndexedDB tiny wrapper (for backup/history)
   ========================= */
const DBNAME = 'anj_invoice_db_v1';
const STORE_NAME = 'history';

const DBWrap = {
  db: null,
  init: function() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DBNAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = (e) => {
        DBWrap.db = e.target.result;
        resolve();
      };
      req.onerror = (e) => {
        console.warn('IndexedDB init error', e);
        reject(e);
      };
    });
  },
  save: function(obj) {
    return new Promise((resolve, reject) => {
      if (!DBWrap.db) return reject(new Error('DB not initialized'));
      const tx = DBWrap.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const r = store.add(obj);
      r.onsuccess = () => resolve(r.result);
      r.onerror = (e) => reject(e);
    });
  },
  getAll: function() {
    return new Promise((resolve, reject) => {
      if (!DBWrap.db) return reject(new Error('DB not initialized'));
      const tx = DBWrap.db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const r = store.getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = (e) => reject(e);
    });
  },
  delete: function(id) {
    return new Promise((resolve, reject) => {
      if (!DBWrap.db) return reject(new Error('DB not initialized'));
      const tx = DBWrap.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const r = store.delete(id);
      r.onsuccess = () => resolve();
      r.onerror = (e) => reject(e);
    });
  },
  clear: function() {
    return new Promise((resolve, reject) => {
      if (!DBWrap.db) return reject(new Error('DB not initialized'));
      const tx = DBWrap.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const r = store.clear();
      r.onsuccess = () => resolve();
      r.onerror = (e) => reject(e);
    });
  }
};

/* initialize DB */
DBWrap.init().then(() => {
  console.log('DB initialized');
}).catch(err => {
  console.warn('DB init failed', err);
});

/* =========================
   Status and logging helpers
   ========================= */
function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}
function appendLog(text) {
  if (!logBox) return;
  const t = new Date().toLocaleTimeString();
  logBox.textContent = `${logBox.textContent}\n[${t}] ${text}`;
  logBox.scrollTop = logBox.scrollHeight;
}

/* =========================
   File -> Image helpers
   ========================= */
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = reader.result;
    };
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(file);
  });
}

function urlToImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = dataUrl;
  });
}

/* =========================
   Quick OCR (pass 1) - faster config
   ========================= */
async function quickOCRImage(imgOrUrl) {
  setStatus('OCR pass 1 — quick');
  appendLog('Starting quick OCR');
  const worker = Tesseract.createWorker({
    logger: m => appendLog('t1:' + (m.status || '') + ' ' + (m.progress ? (m.progress*100).toFixed(1) + '%' : ''))
  });
  try {
    await worker.load();
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO });
    const { data } = await worker.recognize(imgOrUrl);
    await worker.terminate();
    appendLog('Quick OCR complete (len=' + ((data && data.text) ? data.text.length : 0) + ')');
    window.ocrRawQuick = data;
    return data;
  } catch (err) {
    try { await worker.terminate(); } catch(e){}
    appendLog('Quick OCR error: ' + (err && err.message || err));
    throw err;
  }
}

/* =========================
   Enhanced OCR (pass 2) - preprocessing
   ========================= */
async function enhancedOCRImage(img) {
  setStatus('OCR pass 2 — enhanced');
  appendLog('Starting enhanced OCR (preprocess)');

  // Create canvas and upscale
  const maxTargetWidth = Math.min(2600, Math.max(1200, Math.round(img.width * 1.3)));
  const scale = maxTargetWidth / img.width;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // Grayscale + contrast stretch
  let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  let min = 255, max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.round(0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < data.length; i += 4) {
    let v = Math.round(0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]);
    v = Math.round((v - min) * 255 / range);
    data[i] = data[i+1] = data[i+2] = v;
  }

  // Global threshold around mean
  let sum = 0, cnt = 0;
  for (let i = 0; i < data.length; i += 4) { sum += data[i]; cnt++; }
  const mean = sum / cnt;
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i] < mean * 0.98 ? 0 : 255;
    data[i] = data[i+1] = data[i+2] = v;
  }
  ctx.putImageData(imageData, 0, 0);

  // Optional: could add sharpening; omitted for simplicity
  const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
  appendLog('Enhanced image prepared (size=' + dataUrl.length + ')');

  const worker = Tesseract.createWorker({
    logger: m => appendLog('t2:' + (m.status || '') + ' ' + (m.progress ? (m.progress*100).toFixed(1) + '%' : ''))
  });
  try {
    await worker.load();
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    await worker.setParameters({ tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ₹.$,/-: ' });
    const { data } = await worker.recognize(dataUrl);
    await worker.terminate();
    appendLog('Enhanced OCR complete (len=' + ((data && data.text) ? data.text.length : 0) + ')');
    window.ocrRawEnhanced = data;
    return data;
  } catch (err) {
    try { await worker.terminate(); } catch(e){}
    appendLog('Enhanced OCR error: ' + (err && err.message || err));
    throw err;
  }
}

/* =========================
   Extract text from file (TXT / IMAGE / PDF)
   ========================= */
async function extractTextFromFile(file) {
  const name = file.name || 'file';
  const type = file.type || '';
  appendLog('extractTextFromFile: ' + name + ' (' + type + ')');

  // TXT file
  if (type === 'text/plain' || /\.txt$/i.test(name)) {
    const txt = await file.text();
    return { pass1: { text: txt }, pass2: { text: txt }, image: null };
  }

  // Image file
  if (type.startsWith('image/') || /\.(png|jpe?g)$/i.test(name)) {
    const img = await fileToImage(file);
    const pass1 = await quickOCRImage(img);
    const pass2 = await enhancedOCRImage(img);
    return { pass1, pass2, image: img };
  }

  // PDF
  try {
    setStatus('Parsing PDF (pdf.js)');
    appendLog('Using pdf.js to extract text');
    const arr = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: arr }).promise;
    appendLog('PDF loaded — pages: ' + pdf.numPages);

    let whole = '';
    const maxPages = Math.min(pdf.numPages, 8);
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const txtContent = await page.getTextContent();
      const pageText = txtContent.items.map(it => it.str).join(' ');
      whole += pageText + '\n';
    }
    appendLog('pdf.js extracted text length: ' + whole.length);

    // render first page for OCR fallback / supplement
    const page1 = await pdf.getPage(1);
    const viewport = page1.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page1.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const image = await urlToImage(dataUrl);

    let pass1 = { text: whole };
    let pass2 = { text: '' };

    if (!whole || whole.trim().length < 20) {
      appendLog('PDF text minimal — running OCR fallback on page image');
      pass1 = await quickOCRImage(image);
      pass2 = await enhancedOCRImage(image);
    } else {
      try {
        pass2 = await enhancedOCRImage(image);
      } catch(e) {
        appendLog('Enhanced OCR on PDF page failed: ' + (e && e.message || e));
        pass2 = { text: '' };
      }
    }
    return { pass1, pass2, image };
  } catch (err) {
    appendLog('PDF parsing error: ' + (err && err.message || err) + ' — fallback OCR attempt');
    // fallback: try to treat file as image
    try {
      const img = await fileToImage(file);
      const pass1 = await quickOCRImage(img);
      const pass2 = await enhancedOCRImage(img);
      return { pass1, pass2, image: img };
    } catch (e) {
      appendLog('Fallback OCR failed: ' + (e && e.message || e));
      throw e;
    }
  }
}

/* =========================
   Heuristic parser (best-effort)
   ========================= */
function parseText(text) {
  const result = { raw: text || '', date: null, total: null, merchant: null, items: [], category: 'general' };
  const lines = (text || '').split(/\r?\n/).map(l => l.replace(/\|/g, ' ').trim()).filter(Boolean);

  // merchant: first header-like line ignoring typical invoice labels
  for (let i = 0; i < 5 && i < lines.length; i++) {
    const l = lines[i];
    if (!/invoice|receipt|bill|tax|gst|cashier/i.test(l) && /[A-Za-z0-9]/.test(l)) {
      result.merchant = l;
      break;
    }
  }

  // date detection
  const dateRx = /\b((0?[1-9]|[12][0-9]|3[01])[\/\-.](0?[1-9]|1[012])[\/\-.]\d{2,4}|\d{4}[\/\-.](0?[1-9]|1[012])[\/\-.](0?[1-9]|[12][0-9]|3[01])|[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})\b/;
  for (const l of lines) {
    const m = l.match(dateRx);
    if (m) { result.date = m[0]; break; }
  }

  // total detection (search bottom lines)
  const tail = lines.slice(-16);
  let found = null;
  for (const l of tail) {
    if (/grand total|grandtotal|total amount|amount payable|amount due|balance due|net amount|amount in words|subtotal|total/i.test(l) || /₹|\bINR\b|\bRs\b|\$/i.test(l)) {
      const nums = l.replace(/[^0-9.,]/g, '').replace(/,+/g, '').match(/([0-9]+[.,][0-9]{2,})|([0-9]+)/g);
      if (nums && nums.length) { found = nums[nums.length - 1]; break; }
    }
  }
  if (!found) {
    const allNums = (text.match(/([0-9]+[.,][0-9]{2,})|([0-9]{3,})/g) || []).map(s => s.replace(/,/g, ''));
    let max = 0, best = null;
    allNums.forEach(n => { const v = parseFloat(n); if (!isNaN(v) && v > max) { max = v; best = n; } });
    if (best) found = best;
  }
  result.total = found ? String(found) : null;

  // items detection (simple patterns)
  const itemRx = /^(.{2,80})\s+(\d+)\s+([0-9.,]+)\s+([0-9.,]+)$/;
  for (const l of lines) {
    const m = l.match(itemRx);
    if (m) result.items.push({ name: m[1].trim(), qty: m[2], price: m[3], total: m[4] });
  }
  if (result.items.length === 0) {
    for (const l of lines) {
      const m = l.match(/^(.{2,80})\s+([0-9.,]+)$/);
      if (m && /[A-Za-z]/.test(m[1])) result.items.push({ name: m[1].trim(), price: m[2] });
    }
  }

  // category by keywords
  const keywordMap = {
    food: ['restaurant','cafe','dining','food','grocery','mart','hotel','canteen'],
    shopping: ['store','shop','mall','boutique','supermarket','apparel'],
    finance: ['bank','payment','transaction','upi','invoice','tax','insurance']
  };
  const low = text.toLowerCase();
  for (const [cat, keys] of Object.entries(keywordMap)) {
    for (const k of keys) if (low.includes(k)) { result.category = cat; break; }
  }

  return result;
}

/* =========================
   Merge heuristics for pass1/pass2
   ========================= */
function mergeResults(pass1, pass2) {
  const t1 = (pass1 && pass1.text) ? pass1.text : (typeof pass1 === 'string' ? pass1 : '');
  const t2 = (pass2 && pass2.text) ? pass2.text : (typeof pass2 === 'string' ? pass2 : '');
  const combined = (t1 + '\n\n' + t2).trim();

  const p1 = parseText(t1);
  const p2 = parseText(t2);

  let score1 = 0, score2 = 0;
  if (p1.total) score1 += 40; if (p1.date) score1 += 20; if (p1.merchant) score1 += 20; score1 += Math.min(20, (p1.items||[]).length * 5);
  if (p2.total) score2 += 40; if (p2.date) score2 += 20; if (p2.merchant) score2 += 20; score2 += Math.min(20, (p2.items||[]).length * 5);

  const chosen = { raw: combined, confidence: Math.round(Math.max(score1, score2)) };
  const winner = score2 >= score1 ? p2 : p1;
  chosen.date = winner.date || p1.date || p2.date;
  chosen.total = winner.total || p1.total || p2.total;
  chosen.merchant = winner.merchant || p1.merchant || p2.merchant;
  chosen.items = (winner.items && winner.items.length) ? winner.items : (p1.items.length ? p1.items : p2.items);
  chosen.category = winner.category || p1.category || p2.category || 'general';
  chosen.score1 = score1; chosen.score2 = score2;
  return chosen;
}

/* =========================
   Initial handlers: parse and ocrOnly
   (these set global lastExtract / lastMerged & show provisional)
   ========================= */
parseBtn && parseBtn.addEventListener('click', async () => {
  const f = fileInput.files[0];
  if (!f) { alert('Choose a file first'); return; }
  try {
    setStatus('Extracting file...');
    appendLog('Parsing request for ' + f.name);
    const { pass1, pass2, image } = await extractTextFromFile(f);
    window.lastExtract = { pass1, pass2, image, fileName: f.name };
    const merged = mergeResults(pass1, pass2);
    window.lastMerged = merged;
    // show provisional
    rawTextEl.textContent = (merged.raw || '').slice(0, 15000);
    previewBox.textContent = JSON.stringify(merged, null, 2).slice(0, 8000);
    o_date.textContent = merged.date || '-';
    o_total.textContent = merged.total || '-';
    o_merchant.textContent = merged.merchant || '-';
    o_category.textContent = merged.category || '-';
    o_items.textContent = (merged.items && merged.items.length) ? JSON.stringify(merged.items, null, 2) : 'None detected';
    o_conf.textContent = (merged.confidence || 0) + '%';
    setStatus('Merged — run AI Cleanup for final result');
    appendLog('Merged ready; confidence ' + (merged.confidence || 0));
  } catch (err) {
    console.error(err);
    setStatus('Parse failed');
    appendLog('Parse failed: ' + (err && err.message || err));
    alert('Parse failed: ' + (err && err.message || err));
  }
});

ocrOnlyBtn && ocrOnlyBtn.addEventListener('click', async () => {
  const f = fileInput.files[0];
  if (!f) { alert('Choose a file first'); return; }
  try {
    setStatus('OCR only: extracting...');
    appendLog('OCR-only requested for ' + f.name);
    const { pass1, pass2 } = await extractTextFromFile(f);
    window.lastExtract = { pass1, pass2, image: null, fileName: f.name };
    const a = (pass1 && pass1.text) ? pass1.text : JSON.stringify(pass1).slice(0,2000);
    const b = (pass2 && pass2.text) ? pass2.text : JSON.stringify(pass2).slice(0,2000);
    rawTextEl.textContent = '--- PASS 1 (quick) ---\n' + a + '\n\n--- PASS 2 (enhanced) ---\n' + b;
    previewBox.textContent = rawTextEl.textContent.slice(0,5000);
    setStatus('OCR done');
    appendLog('OCR-only done');
  } catch (err) {
    console.error(err);
    setStatus('OCR failed');
    appendLog('OCR-only failed: ' + (err && err.message || err));
    alert('OCR failed: ' + (err && err.message || err));
  }
});
// WebLLM global engine
let webllmEngine = null;
let webllmReady = false;

/* =========================================================
   Initialize WebLLM (Local AI model)
   Lightweight model: Llama-3.2-1B
   Runs fully client-side, no server, no API keys
   ========================================================= */

async function initWebLLM() {
  if (webllmReady) return true;

  try {
    setStatus("Loading local AI model…");
    appendLog("Initializing WebLLM engine…");

    webllmEngine = await webllm.createEngine(
      webllm.getDefaultEngineConfig("Llama-3.2-1B-Instruct-Q4f16_1")
    );

    webllmReady = true;
    setStatus("Local AI ready ✓");
    appendLog("WebLLM loaded successfully");
    return true;
  } catch (err) {
    console.error("WebLLM load error:", err);
    appendLog("WebLLM failed: " + (err.message || err));
    setStatus("AI load failed");
    return false;
  }
}

/* =========================================================
   AI Cleanup function
   Takes merged heuristic result + raw OCR → produces structured JSON
   ========================================================= */

async function aiCleanup(merged) {
  if (!merged) throw new Error("No merged result to clean");

  // Ensure model loaded
  if (!webllmReady) {
    const ok = await initWebLLM();
    if (!ok) throw new Error("AI could not load");
  }

  setStatus("AI cleanup running…");
  appendLog("AI cleanup started");

  const prompt = `
You are an OCR cleanup AI. Clean and structure the bill/invoice data.
Extract:

- merchant
- date
- total
- category (food | shopping | finance | general)
- items: [{name, qty?, price?, total?}]
- confidence (0-100)

Return ONLY valid JSON.

OCR Raw:
${merged.raw.slice(0, 5000)}

Heuristic Guess:
${JSON.stringify(merged, null, 2)}
`;

  try {
    const reply = await webllmEngine.chat.completions.create({
      messages: [
        { role: "system", content: "You clean and fix bill data into JSON only." },
        { role: "user", content: prompt }
      ],
      max_tokens: 800
    });

    const text = reply.choices[0].message.content.trim();

    // Attempt to parse JSON
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (err) {
      // attempt to extract JSON block
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        json = JSON.parse(match[0]);
      } else {
        throw new Error("AI response not valid JSON");
      }
    }

    appendLog("AI cleanup complete ✓");
    setStatus("AI cleanup complete ✓");

    return json;
  } catch (err) {
    console.error("AI cleanup error:", err);
    appendLog("AI error: " + err.message);
    setStatus("AI cleanup failed");
    throw err;
  }
}

/* =========================================================
   Attach AI Cleanup Button
   ========================================================= */
aiCleanupBtn && aiCleanupBtn.addEventListener("click", async () => {
  try {
    if (!window.lastMerged) {
      alert("Run Parse first");
      return;
    }

    setStatus("Preparing AI cleanup…");
    appendLog("AI cleanup requested");

    const cleaned = await aiCleanup(window.lastMerged);
    window.lastFinal = cleaned;

    // Update UI
    o_date.textContent = cleaned.date || "-";
    o_total.textContent = cleaned.total || "-";
    o_merchant.textContent = cleaned.merchant || "-";
    o_category.textContent = cleaned.category || "-";
    o_items.textContent = JSON.stringify(cleaned.items || [], null, 2);
    o_conf.textContent = (cleaned.confidence || 0) + "%";

    rawTextEl.textContent = cleaned.raw || window.lastMerged.raw || "—";
    previewBox.textContent = JSON.stringify(cleaned, null, 2).slice(0, 8000);

    setStatus("AI Cleanup done ✓");
  } catch (err) {
    console.error(err);
    alert("AI cleanup failed: " + (err.message || err));
  }
});
function getFinalOrMerged() {
  return window.lastFinal || window.lastMerged;
}

/* =========================================================
   PREVIEW: JSON
   ========================================================= */
previewJsonBtn &&
  previewJsonBtn.addEventListener("click", () => {
    const d = getFinalOrMerged();
    if (!d) return alert("Parse first");
    previewBox.textContent = JSON.stringify(d, null, 2);
    setStatus("Preview: JSON");
  });

/* =========================================================
   PREVIEW: CSV
   CSV Columns:
     merchant, date, total, category, items(JSON)
   ========================================================= */
function toCSV(data) {
  const esc = (s) => `"${String(s || "").replace(/"/g, '""')}"`;
  return [
    "merchant,date,total,category,items",
    [
      esc(data.merchant),
      esc(data.date),
      esc(data.total),
      esc(data.category),
      esc(JSON.stringify(data.items || [])),
    ].join(","),
  ].join("\n");
}

previewCsvBtn &&
  previewCsvBtn.addEventListener("click", () => {
    const d = getFinalOrMerged();
    if (!d) return alert("Parse first");
    previewBox.textContent = toCSV(d);
    setStatus("Preview: CSV");
  });

/* =========================================================
   PREVIEW: XLSX
   Uses SheetJS (xlsx.full.min.js)
   ========================================================= */
function toXlsxWorkbook(data) {
  return XLSX.utils.book_new();
}

previewXlsBtn &&
  previewXlsBtn.addEventListener("click", () => {
    const d = getFinalOrMerged();
    if (!d) return alert("Parse first");

    const wsData = [
      ["Field", "Value"],
      ["Merchant", d.merchant || "-"],
      ["Date", d.date || "-"],
      ["Total", d.total || "-"],
      ["Category", d.category || "-"],
      ["Items", JSON.stringify(d.items || [])],
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Invoice");

    const csvPreview = XLSX.utils.sheet_to_csv(ws);
    previewBox.textContent = csvPreview;
    setStatus("Preview: XLSX (CSV View)");
  });

/* =========================================================
   PREVIEW: TXT
   Simple readable invoice format
   ========================================================= */
function toTxt(d) {
  return (
    `Merchant : ${d.merchant || "-"}\n` +
    `Date     : ${d.date || "-"}\n` +
    `Total    : ${d.total || "-"}\n` +
    `Category : ${d.category || "-"}\n\n` +
    `Items:\n${(d.items || [])
      .map(
        (i) =>
          ` - ${i.name || "item"}  | qty:${i.qty || "-"} | price:${
            i.price || "-"
          } | total:${i.total || "-"}`
      )
      .join("\n")}`
  );
}

previewTxtBtn &&
  previewTxtBtn.addEventListener("click", () => {
    const d = getFinalOrMerged();
    if (!d) return alert("Parse first");
    previewBox.textContent = toTxt(d);
    setStatus("Preview: TXT");
  });

/* =========================================================
   PREVIEW: Tally XML
   Tally-compatible minimal VOL voucher
   ========================================================= */
function toTallyXML(d) {
  const safe = (s) => (s ? String(s).replace(/&/g, "&amp;") : "");

  return `<?xml version="1.0" encoding="UTF-8"?>
<TALLYMESSAGE xmlns:UDF="TallyUDF">
  <VOUCHER VCHTYPE="Purchase" ACTION="Create">
    <DATE>${safe(d.date || "")}</DATE>
    <NARRATION>${safe(d.merchant || "")}</NARRATION>
    <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
    <PARTYNAME>${safe(d.merchant || "")}</PARTYNAME>
    <AMOUNT>${safe(d.total || "0")}</AMOUNT>
    <CATEGORY>${safe(d.category || "general")}</CATEGORY>
  </VOUCHER>
</TALLYMESSAGE>`;
}

previewTallyBtn &&
  previewTallyBtn.addEventListener("click", () => {
    const d = getFinalOrMerged();
    if (!d) return alert("Parse first");
    previewBox.textContent = toTallyXML(d);
    setStatus("Preview: Tally XML");
  });
function getExportData() {
  return window.lastFinal || window.lastMerged;
}

/* =========================================================
   EXPORT: JSON
   ========================================================= */
function exportJSON(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, "invoice.json");
}

/* =========================================================
   EXPORT: CSV
   ========================================================= */
function exportCSV(data) {
  const csv = toCSV(data);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, "invoice.csv");
}

/* =========================================================
   EXPORT: XLSX
   ========================================================= */
function exportXLSX(data) {
  const wsData = [
    ["Field", "Value"],
    ["Merchant", data.merchant || "-"],
    ["Date", data.date || "-"],
    ["Total", data.total || "-"],
    ["Category", data.category || "-"],
    ["Items", JSON.stringify(data.items || [])],
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Invoice");

  const xlsBlob = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([xlsBlob], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, "invoice.xlsx");
}

/* =========================================================
   EXPORT: TXT
   ========================================================= */
function exportTXT(data) {
  const text = toTxt(data);
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, "invoice.txt");
}

/* =========================================================
   EXPORT: PDF (visual screenshot)
   Using html2canvas + jsPDF
   ========================================================= */
async function exportPDF() {
  try {
    setStatus("Exporting PDF…");
    const el = document.querySelector(".container");
    const canvas = await html2canvas(el, { scale: 2 });
    const img = canvas.toDataURL("image/jpeg", 0.95);

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: "a4" });
    const w = pdf.internal.pageSize.getWidth();
    const h = (canvas.height * w) / canvas.width;

    pdf.addImage(img, "JPEG", 0, 0, w, h);
    pdf.save("invoice.pdf");

    setStatus("PDF exported ✓");
  } catch (err) {
    console.error(err);
    alert("PDF export failed: " + err.message);
  }
}

/* =========================================================
   EXPORT: ZIP (JSON + TXT + PDF)
   ========================================================= */
async function exportZIP(data) {
  const zip = new JSZip();

  // JSON
  zip.file("invoice.json", JSON.stringify(data, null, 2));

  // TXT
  zip.file("invoice.txt", toTxt(data));

  // PDF (as image screenshot)
  const el = document.querySelector(".container");
  const canvas = await html2canvas(el, { scale: 2 });
  const img = canvas.toDataURL("image/jpeg", 0.95);
  zip.file("invoice.jpg", img.split(",")[1], { base64: true });

  // Generate ZIP
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, "invoice_bundle.zip");
}

/* =========================================================
   Helper: Trigger download
   ========================================================= */
function triggerDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* =========================================================
   Bind Export Buttons
   ========================================================= */

exportJsonBtn &&
  exportJsonBtn.addEventListener("click", () => {
    const d = getExportData();
    if (!d) return alert("Parse first");
    exportJSON(d);
  });

exportCsvBtn &&
  exportCsvBtn.addEventListener("click", () => {
    const d = getExportData();
    if (!d) return alert("Parse first");
    exportCSV(d);
  });

exportXlsBtn &&
  exportXlsBtn.addEventListener("click", () => {
    const d = getExportData();
    if (!d) return alert("Parse first");
    exportXLSX(d);
  });

exportTxtBtn &&
  exportTxtBtn.addEventListener("click", () => {
    const d = getExportData();
    if (!d) return alert("Parse first");
    exportTXT(d);
  });

exportPdfBtn &&
  exportPdfBtn.addEventListener("click", async () => {
    const d = getExportData();
    if (!d) return alert("Parse first");
    await exportPDF(d);
  });

exportZipBtn &&
  exportZipBtn.addEventListener("click", async () => {
    const d = getExportData();
    if (!d) return alert("Parse first");
    await exportZIP(d);
  });
// Global DB reference
let db = null;
const DB_NAME = "anj_expense_ai_db";
const STORE_NAME = "history";

/* =========================================================
   Open IndexedDB
   ========================================================= */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    req.onsuccess = (e) => {
      db = e.target.result;
      resolve(true);
    };

    req.onerror = (e) => reject(e);
  });
}

/* =========================================================
   Save entry to history
   ========================================================= */
async function saveToHistory(entry) {
  if (!db) await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    store.put(entry);

    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e);
  });
}

/* =========================================================
   Load all history
   ========================================================= */
async function getAllHistory() {
  if (!db) await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e);
  });
}

/* =========================================================
   Delete a single entry
   ========================================================= */
async function deleteHistory(id) {
  if (!db) await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);

    req.onsuccess = () => resolve(true);
    req.onerror = (e) => reject(e);
  });
}

/* =========================================================
   Clear entire history
   ========================================================= */
async function clearHistory() {
  if (!db) await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();

    req.onsuccess = () => resolve(true);
    req.onerror = (e) => reject(e);
  });
}

/* =========================================================
   Update History UI Dropdown
   ========================================================= */
async function refreshHistoryUI() {
  if (!historyList) return;

  const all = await getAllHistory();
  historyList.innerHTML = "";

  all.forEach((h) => {
    const btn = document.createElement("button");
    btn.className = "history-item";
    btn.textContent = `${h.merchant || "Invoice"} | ${h.date || ""} | ₹${
      h.total || ""
    }`;

    btn.addEventListener("click", () => {
      loadHistoryEntry(h.id);
    });

    const del = document.createElement("span");
    del.className = "delete-history";
    del.textContent = "✕";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteHistory(h.id);
      await refreshHistoryUI();
    });

    btn.appendChild(del);
    historyList.appendChild(btn);
  });
}

/* =========================================================
   Load a history entry
   ========================================================= */
async function loadHistoryEntry(id) {
  const all = await getAllHistory();
  const found = all.find((h) => h.id === id);
  if (!found) return alert("Entry not found");

  window.lastFinal = found;

  o_date.textContent = found.date || "-";
  o_total.textContent = found.total || "-";
  o_merchant.textContent = found.merchant || "-";
  o_category.textContent = found.category || "-";
  o_items.textContent = JSON.stringify(found.items || [], null, 2);
  o_conf.textContent = (found.confidence || 0) + "%";

  rawTextEl.textContent = found.raw || "—";
  previewBox.textContent = JSON.stringify(found, null, 2);

  setStatus("Loaded from history ✓");
}

/* =========================================================
   Bind History Buttons
   ========================================================= */
saveBtn &&
  saveBtn.addEventListener("click", async () => {
    const d = getExportData();
    if (!d) return alert("Parse first");

    const entry = {
      id: crypto.randomUUID(),
      ...d,
      savedTime: Date.now(),
    };

    await saveToHistory(entry);
    await refreshHistoryUI();
    setStatus("Saved to history ✓");
  });

clearHistoryBtn &&
  clearHistoryBtn.addEventListener("click", async () => {
    const ok = confirm("Clear ALL history?");
    if (!ok) return;

    await clearHistory();
    await refreshHistoryUI();
    setStatus("History cleared");
  });
let lastRawText = "";

/* =========================================================
   Tesseract Primary OCR
   ========================================================= */
async function runOCR_primary(fileOrDataURL) {
  setStatus("Primary OCR running…");
  appendLog("Tesseract primary OCR started");

  const result = await Tesseract.recognize(fileOrDataURL, "eng", {
    logger: (m) => appendLog("Tess: " + m.status + " " + (m.progress || "")),
  });

  appendLog("Primary OCR complete");
  return result.data.text || "";
}

/* =========================================================
   Enhanced OCR (secondary cleaner)
   Simply cleans garbage, normalizes spacing
   ========================================================= */
function runOCR_enhanced(raw) {
  setStatus("Enhanced OCR running…");
  appendLog("Enhanced OCR start");

  let text = raw;

  // collapse multiple newlines
  text = text.replace(/\n{3,}/g, "\n\n");

  // collapse multiple spaces
  text = text.replace(/ {3,}/g, " ");

  // remove noisy characters
  text = text.replace(/[•▪●□■]+/g, " ");

  // numeric cleanup
  text = text.replace(/Rs[\s:]+/gi, "₹");

  appendLog("Enhanced OCR complete");
  return text.trim();
}

/* =========================================================
   PDF Extraction using PDF.js
   Supports multi-page PDF → returns extracted text
   ========================================================= */
async function extractPDF(file) {
  appendLog("PDF detected — running PDF.js extract");

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let text = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    const strings = content.items.map((it) => it.str);
    text += strings.join("\n") + "\n\n";

    appendLog(`Extracted PDF page ${i}/${pdf.numPages}`);
  }

  return text.trim();
}

/* =========================================================
   Detect if file is PDF or Image
   ========================================================= */
function isPDF(file) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

/* =========================================================
   Main OCR Handler
   - Detect PDF → use PDF.js extract
   - Else run dual OCR
   - Save to UI
   ========================================================= */
async function handleOCR(file) {
  rawTextEl.textContent = "";
  previewBox.textContent = "";
  window.lastMerged = null;
  window.lastFinal = null;

  try {
    let raw = "";

    if (isPDF(file)) {
      // extract text using PDF.js
      raw = await extractPDF(file);
    } else {
      // convert file to dataURL
      const dataURL = await fileToDataURL(file);

      // run Tesseract OCR
      const primary = await runOCR_primary(dataURL);

      // enhanced cleanup
      const enhanced = runOCR_enhanced(primary);

      raw = enhanced;
    }

    lastRawText = raw || "";
    rawTextEl.textContent = lastRawText || "—";

    window.lastExtracted = {
      raw: lastRawText,
      filename: file.name,
      time: Date.now(),
    };

    setStatus("OCR complete ✓");
    appendLog("OCR output length: " + lastRawText.length);

    return lastRawText;
  } catch (err) {
    console.error(err);
    setStatus("OCR failed");
    alert("OCR failed: " + err.message);
    return "";
  }
}

/* =========================================================
   Convert File → DataURL
   ========================================================= */
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
/* =========================================================
   MASTER PARSE FUNCTION
   ========================================================= */
function parseExtractedText(raw) {
  setStatus("Parsing text…");
  appendLog("Parser started");

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const lower = raw.toLowerCase();

  const parsed = {
    merchant: extractMerchant(lines),
    date: extractDate(raw),
    total: extractTotal(raw),
    gstin: extractGST(raw),
    upi: extractUPI(raw),
    phone: extractPhone(raw),
    items: extractItems(lines),
    category: detectCategory(raw),
    notes: extractNotes(raw),
    raw: raw,
    time: Date.now(),
  };

  appendLog("Parsed: " + JSON.stringify(parsed, null, 2));
  return parsed;
}

/* =========================================================
   MERCHANT DETECTION
   ========================================================= */
function extractMerchant(lines) {
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const l = lines[i];

    if (
      !/invoice|bill|gst|tax|receipt|upi|payment|total/i.test(l) &&
      l.length >= 3 &&
      !l.match(/^\d+$/)
    ) {
      return l;
    }
  }
  return "Unknown Merchant";
}

/* =========================================================
   DATE DETECTION (India + Global Formats)
   ========================================================= */
function extractDate(text) {
  const datePatterns = [
    /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\b/, // 12/10/2024
    /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2}\b/, // 12/10/24
    /\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/, // 2024-01-10
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s*\d{4}/i,
  ];

  for (const rx of datePatterns) {
    const m = text.match(rx);
    if (m) return m[0];
  }

  return "-";
}

/* =========================================================
   TOTAL DETECTION (₹, Rs, INR, USD)
   ========================================================= */
function extractTotal(text) {
  const totalPatterns = [
    /total[:\s]+₹?\s*([\d,.]+)/i,
    /grand total[:\s]+₹?\s*([\d,.]+)/i,
    /amount[:\s]+₹?\s*([\d,.]+)/i,
    /₹\s*([\d,.]+)/,
    /rs\.?\s*([\d,.]+)/i,
  ];

  for (const rx of totalPatterns) {
    const m = text.match(rx);
    if (m) return m[1];
  }

  // fallback: pick largest number
  const nums = text.match(/[\d,.]+/g) || [];
  let max = 0;
  nums.forEach((n) => {
    const v = parseFloat(n.replace(/,/g, ""));
    if (!isNaN(v) && v > max) max = v;
  });

  return max > 0 ? String(max) : "-";
}

/* =========================================================
   GSTIN DETECTION
   ========================================================= */
function extractGST(text) {
  const m = text.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z]\b/);
  return m ? m[0] : "-";
}

/* =========================================================
   UPI DETECTION
   ========================================================= */
function extractUPI(text) {
  const m = text.match(/\b[\w.-]+@[\w.-]+\b/);
  return m ? m[0] : "-";
}

/* =========================================================
   PHONE DETECTION
   ========================================================= */
function extractPhone(text) {
  const m = text.match(/(?:\+91[-\s]?)?\b[6-9]\d{9}\b/);
  return m ? m[0] : "-";
}

/* =========================================================
   CATEGORY DETECTION
   ========================================================= */
function detectCategory(text) {
  const x = text.toLowerCase();

  if (/food|restaurant|cafe|burger|pizza/i.test(x)) return "food";
  if (/shop|store|mart|shopping|mall/i.test(x)) return "shopping";
  if (/payment|upi|bank|finance|interest/i.test(x)) return "finance";

  return "general";
}

/* =========================================================
   ITEM LINE DETECTION
   ========================================================= */
function extractItems(lines) {
  const items = [];

  const itemRx1 = /^(.{2,40})\s+(\d+)\s+([\d,.]+)\s+([\d,.]+)$/;
  const itemRx2 = /^(.{2,50})\s+([\d,.]+)$/;

  for (const l of lines) {
    let m = l.match(itemRx1);
    if (m) {
      items.push({
        name: m[1].trim(),
        qty: m[2],
        price: m[3],
        total: m[4],
      });
      continue;
    }

    m = l.match(itemRx2);
    if (m) {
      items.push({
        name: m[1].trim(),
        price: m[2],
      });
      continue;
    }
  }

  return items;
}

/* =========================================================
   NOTES (last lines, usually S/C, tax notes, etc.)
   ========================================================= */
function extractNotes(text) {
  const lines = text.split("\n");
  return lines.slice(-5).join("\n");
}
/* Global holder for final bill before exports */
window.lastMerged = null;
window.lastFinal = null;

/* =========================================================
   MERGE PARSED DATA INTO FINAL FORMAT
   ========================================================= */
function mergeParsedData(parsed) {
  setStatus("Merging data…");
  appendLog("Merging parsed data into final object");

  const finalObj = {
    id: "bill-" + Date.now(),
    createdAt: new Date().toISOString(),
    merchant: parsed.merchant || "-",
    date: parsed.date || "-",
    total: parsed.total || "-",
    gstin: parsed.gstin || "-",
    upi: parsed.upi || "-",
    phone: parsed.phone || "-",
    items: parsed.items || [],
    category: parsed.category || "general",
    notes: parsed.notes || "",
    raw: parsed.raw || "",
  };

  window.lastMerged = finalObj;
  appendLog("Merged object ready");

  return finalObj;
}

/* =========================================================
   RENDER FULL PREVIEW (Tally / Excel / JSON / Text / Summary)
   ========================================================= */
function renderAllPreviews(finalObj) {
  appendLog("Rendering all previews");

  /* ---------- Merchant & Summary ---------- */
  summaryBox.textContent =
    `Merchant: ${finalObj.merchant}\n` +
    `Date: ${finalObj.date}\n` +
    `Total: ${finalObj.total}\n` +
    `Category: ${finalObj.category}`;

  /* ---------- Raw OCR Text ---------- */
  rawTextEl.textContent = finalObj.raw || "—";

  /* ---------- Items Table ---------- */
  if (finalObj.items.length > 0) {
    let table = "Item | Qty | Price | Total\n";
    table += "----------------------------------------\n";
    finalObj.items.forEach((it) => {
      table += `${it.name || "-"} | ${it.qty || "-"} | ${it.price || "-"} | ${
        it.total || "-"
      }\n`;
    });
    itemsTable.textContent = table;
  } else {
    itemsTable.textContent = "No items detected.";
  }

  /* ---------- Excel Preview (TSV) ---------- */
  let excel = "Name\tQty\tPrice\tTotal\n";
  finalObj.items.forEach((it) => {
    excel += `${it.name || ""}\t${it.qty || ""}\t${it.price || ""}\t${
      it.total || ""
    }\n`;
  });
  excelPreview.textContent = excel;

  /* ---------- Tally Preview ---------- */
  let tally = "";
  tally += `*** Tally Import (Voucher) ***\n`;
  tally += `Merchant: ${finalObj.merchant}\n`;
  tally += `Date: ${finalObj.date}\n`;
  tally += `Total: ${finalObj.total}\n`;
  tally += `GSTIN: ${finalObj.gstin}\n\n`;

  finalObj.items.forEach((it) => {
    tally += `Item: ${it.name} | Qty: ${it.qty || "-"} | Amount: ${
      it.total || it.price
    }\n`;
  });

  tallyPreview.textContent = tally;

  /* ---------- JSON Preview ---------- */
  jsonPreview.textContent = JSON.stringify(finalObj, null, 2);

  /* ---------- Text Export Preview ---------- */
  textPreview.textContent =
    `${finalObj.merchant}\nDate: ${finalObj.date}\nTotal: ${finalObj.total}\n\nItems:\n` +
    finalObj.items
      .map((it) => `${it.name} — ${it.qty || ""} × ${it.price || ""}`)
      .join("\n");

  /* ---------- Zip File Listing Preview (virtual) ---------- */
  zipPreview.textContent =
    `zip://export.zip\n` +
    `├── invoice.json\n` +
    `├── invoice.txt\n` +
    `├── invoice.tsv (Excel)\n` +
    `├── invoice_tally.txt\n` +
    `└── invoice.pdf`;

  appendLog("All previews rendered ✓");

  // Save globally
  window.lastFinal = finalObj;
}

/* =========================================================
   SAVE TO HISTORY (LOCAL DB WRAPPER)
   ========================================================= */
async function saveToHistory(finalObj) {
  appendLog("Saving bill to history");

  const entry = {
    id: finalObj.id,
    timestamp: Date.now(),
    merchant: finalObj.merchant,
    total: finalObj.total,
    category: finalObj.category,
    preview: finalObj,
  };

  const tx = historyDB.transaction("bills", "readwrite");
  tx.objectStore("bills").put(entry);

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e);
  });
}
======== */

/* =========================================================
   Export: JSON
   ========================================================= */
function exportJSON(finalObj) {
  const blob = new Blob([JSON.stringify(finalObj, null, 2)], {
    type: "application/json",
  });
  triggerDownload(blob, "invoice.json");
}

/* =========================================================
   Export: Text
   ========================================================= */
function exportText(finalObj) {
  let txt = `${finalObj.merchant}\nDate: ${finalObj.date}\nTotal: ${
    finalObj.total
  }\n\nItems:\n`;

  txt += finalObj.items
    .map((it) => `${it.name} — ${it.qty || ""} × ${it.price || ""}`)
    .join("\n");

  const blob = new Blob([txt], { type: "text/plain" });
  triggerDownload(blob, "invoice.txt");
}

/* =========================================================
   Export: TSV (Excel Compatible)
   ========================================================= */
function exportExcelTSV(finalObj) {
  let tsv = "Name\tQty\tPrice\tTotal\n";

  finalObj.items.forEach((it) => {
    tsv += `${it.name || ""}\t${it.qty || ""}\t${it.price || ""}\t${
      it.total || ""
    }\n`;
  });

  const blob = new Blob([tsv], { type: "text/tab-separated-values" });
  triggerDownload(blob, "invoice.tsv");
}

/* =========================================================
   Export: Tally Format
   ========================================================= */
function exportTally(finalObj) {
  let tally = "";
  tally += `*** Tally Import (Voucher) ***\n`;
  tally += `Merchant: ${finalObj.merchant}\n`;
  tally += `Date: ${finalObj.date}\n`;
  tally += `Total: ${finalObj.total}\n`;
  tally += `GSTIN: ${finalObj.gstin}\n\n`;

  finalObj.items.forEach((it) => {
    tally += `Item: ${it.name} | Qty: ${it.qty || "-"} | Amount: ${
      it.total || it.price
    }\n`;
  });

  const blob = new Blob([tally], { type: "text/plain" });
  triggerDownload(blob, "invoice_tally.txt");
}

/* =========================================================
   Export PDF (html2canvas + jsPDF)
   ========================================================= */
async function exportPDF(finalObj) {
  setStatus("Generating PDF…");

  const element = document.getElementById("preview-container");

  const canvas = await html2canvas(element, { scale: 2 });
  const imgData = canvas.toDataURL("image/jpeg", 0.95);

  const pdf = new jspdf.jsPDF({
    orientation: "portrait",
    unit: "px",
    format: [canvas.width, canvas.height],
  });

  pdf.addImage(imgData, "JPEG", 0, 0, canvas.width, canvas.height);
  pdf.save("invoice.pdf");

  setStatus("PDF exported ✓");
}

/* =========================================================
   Export ZIP (JSZip)
   ========================================================= */
async function exportZIP(finalObj) {
  const zip = new JSZip();

  /* JSON */
  zip.file("invoice.json", JSON.stringify(finalObj, null, 2));

  /* TXT */
  zip.file(
    "invoice.txt",
    `${finalObj.merchant}\nDate: ${finalObj.date}\nTotal: ${
      finalObj.total
    }\n\nItems:\n` +
      finalObj.items
        .map((it) => `${it.name} — ${it.qty || ""} × ${it.price || ""}`)
        .join("\n")
  );

  /* TSV (Excel) */
  let tsv = "Name\tQty\tPrice\tTotal\n";
  finalObj.items.forEach((it) => {
    tsv += `${it.name || ""}\t${it.qty || ""}\t${it.price || ""}\t${
      it.total || ""
    }\n`;
  });
  zip.file("invoice.tsv", tsv);

  /* Tally */
  let tally = `*** Tally Import (Voucher) ***\nMerchant: ${
    finalObj.merchant
  }\nDate: ${finalObj.date}\nTotal: ${
    finalObj.total
  }\nGSTIN: ${finalObj.gstin}\n\n`;
  finalObj.items.forEach((it) => {
    tally += `Item: ${it.name} | Qty: ${it.qty || "-"} | Amount: ${
      it.total || it.price
    }\n`;
  });
  zip.file("invoice_tally.txt", tally);

  /* PDF */
  const pdfBlob = await buildPDFblob();
  zip.file("invoice.pdf", pdfBlob);

  /* Generate ZIP */
  const content = await zip.generateAsync({ type: "blob" });

  triggerDownload(content, "invoice.zip");
}

/* =========================================================
   Build PDF blob for ZIP
   ========================================================= */
async function buildPDFblob() {
  const element = document.getElementById("preview-container");
  const canvas = await html2canvas(element, { scale: 2 });
  const img = canvas.toDataURL("image/jpeg", 0.95);

  const pdf = new jspdf.jsPDF({
    orientation: "portrait",
    unit: "px",
    format: [canvas.width, canvas.height],
  });

  pdf.addImage(img, "JPEG", 0, 0, canvas.width, canvas.height);

  return pdf.output("blob");
}

/* =========================================================
   Utility: Trigger File Download
   ========================================================= */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
/* ---------------------------------------------------------
   UI ELEMENT REFERENCES
--------------------------------------------------------- */
const fileInput = document.getElementById("fileInput");
const parseBtn = document.getElementById("parseBtn");
const ocrBtn = document.getElementById("ocrBtn");

const summaryBox = document.getElementById("summaryBox");
const rawTextEl = document.getElementById("rawTextEl");
const itemsTable = document.getElementById("itemsTable");

const excelPreview = document.getElementById("excelPreview");
const tallyPreview = document.getElementById("tallyPreview");
const jsonPreview = document.getElementById("jsonPreview");
const textPreview = document.getElementById("textPreview");
const zipPreview = document.getElementById("zipPreview");

const exportJSONbtn = document.getElementById("exportJSON");
const exportTXTbtn = document.getElementById("exportTXT");
const exportEXCELbtn = document.getElementById("exportEXCEL");
const exportTALLYbtn = document.getElementById("exportTALLY");
const exportPDFbtn = document.getElementById("exportPDF");
const exportZIPbtn = document.getElementById("exportZIP");

const saveHistoryBtn = document.getElementById("saveHistoryBtn");

const statusBar = document.getElementById("statusBar");
const debugLog = document.getElementById("debugLog");

/* ---------------------------------------------------------
   HISTORY DATABASE (IndexedDB)
--------------------------------------------------------- */
let historyDB;

function initHistoryDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("anj-history-db", 1);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("bills")) {
        db.createObjectStore("bills", { keyPath: "id" });
      }
    };

    req.onsuccess = (e) => {
      historyDB = e.target.result;
      resolve();
    };

    req.onerror = (err) => reject(err);
  });
}

/* ---------------------------------------------------------
   STATUS + LOG SYSTEM
--------------------------------------------------------- */
function setStatus(msg) {
  if (statusBar) statusBar.textContent = msg;
}

function appendLog(msg) {
  if (!debugLog) return;
  const t = new Date().toLocaleTimeString();
  debugLog.value += `[${t}] ${msg}\n`;
  debugLog.scrollTop = debugLog.scrollHeight;
}

/* ---------------------------------------------------------
   MAIN FLOW — OCR → PARSE → MERGE → PREVIEW
--------------------------------------------------------- */
async function fullProcess() {
  const file = fileInput.files[0];
  if (!file) {
    alert("Please select a file first.");
    return;
  }

  setStatus("Running OCR…");
  appendLog("Starting full process");

  const raw = await handleOCR(file);

  if (!raw || raw.trim().length < 2) {
    setStatus("OCR failed / no text");
    appendLog("No text extracted");
    alert("Could not extract text from this file.");
    return;
  }

  setStatus("Parsing extracted text…");
  const parsed = parseExtractedText(raw);

  setStatus("Merging data…");
  const finalObj = mergeParsedData(parsed);

  setStatus("Rendering previews…");
  renderAllPreviews(finalObj);

  setStatus("Ready ✓");
  appendLog("Full process complete");

  return finalObj;
}

/* ---------------------------------------------------------
   EVENT HANDLERS
--------------------------------------------------------- */

/* Run OCR only (no parse) */
ocrBtn.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) return alert("Select a file first.");

  setStatus("Running OCR only…");
  await handleOCR(file);
  setStatus("OCR done (raw only)");
});

/* Parse after OCR */
parseBtn.addEventListener("click", async () => {
  await fullProcess();
});

/* Save to history */
saveHistoryBtn.addEventListener("click", async () => {
  if (!window.lastFinal) {
    alert("Run parsing first.");
    return;
  }
  await saveToHistory(window.lastFinal);
  alert("Saved to history");
});

/* Export buttons */
exportJSONbtn.addEventListener("click", () => {
  if (window.lastFinal) exportJSON(window.lastFinal);
});

exportTXTbtn.addEventListener("click", () => {
  if (window.lastFinal) exportText(window.lastFinal);
});

exportEXCELbtn.addEventListener("click", () => {
  if (window.lastFinal) exportExcelTSV(window.lastFinal);
});

exportTALLYbtn.addEventListener("click", () => {
  if (window.lastFinal) exportTally(window.lastFinal);
});

exportPDFbtn.addEventListener("click", () => {
  if (window.lastFinal) exportPDF(window.lastFinal);
});

exportZIPbtn.addEventListener("click", () => {
  if (window.lastFinal) exportZIP(window.lastFinal);
});

/* ---------------------------------------------------------
   INITIALIZE EVERYTHING
--------------------------------------------------------- */
(async function init() {
  setStatus("Initializing…");
  appendLog("App started");

  try {
    await initHistoryDB();
    appendLog("IndexedDB ready");
  } catch (err) {
    appendLog("IndexedDB failed: " + err);
  }

  setStatus("Ready");
})();

 










    
