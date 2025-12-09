/* script.js - ANJ Dual OCR Parser
   - Dual OCR:
     pass1 = quick Tesseract (default)
     pass2 = enhanced (canvas preprocess -> Tesseract)
   - PDF.js used for textual PDF extraction, with OCR fallback using pass2 image
   - Parser extracts date, total, merchant, items (best-effort), category, and confidence scoring
   - Preview generation: JSON, CSV, XLSX (table preview), Tally XML (preview), TXT
   - Exports: download JSON/CSV/XLSX/PDF/ZIP/TXT
   - IndexedDB history storage
*/

(async function(){
  // UI refs
  const fileInput = document.getElementById('fileInput');
  const parseBtn = document.getElementById('parseBtn');
  const ocrOnlyBtn = document.getElementById('ocrOnlyBtn');
  const status = document.getElementById('status');
  const rawTextEl = document.getElementById('rawText');
  const logBox = document.getElementById('logBox');
  const previewBox = document.getElementById('previewBox');
  const o_date = document.getElementById('o_date');
  const o_total = document.getElementById('o_total');
  const o_merchant = document.getElementById('o_merchant');
  const o_category = document.getElementById('o_category');
  const o_items = document.getElementById('o_items');
  const o_conf = document.getElementById('o_confidence');

  // export/preview buttons
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

  // IndexedDB wrapper
  const DB = {
    db: null,
    init: function(){
      return new Promise((res,rej)=>{
        const r = indexedDB.open('anj-invoice-db',1);
        r.onupgradeneeded = e=>{
          const d = e.target.result;
          if(!d.objectStoreNames.contains('bills')) d.createObjectStore('bills',{keyPath:'id'});
        };
        r.onsuccess = e=>{DB.db = e.target.result; res();};
        r.onerror = e=>rej(e);
      });
    },
    save: function(obj){
      return new Promise((res,rej)=>{
        const tx = DB.db.transaction('bills','readwrite');
        const store = tx.objectStore('bills');
        store.put(obj);
        tx.oncomplete = ()=>res();
        tx.onerror = e=>rej(e);
      });
    },
    all: function(){ return new Promise((res,rej)=>{ const tx = DB.db.transaction('bills','readonly'); const store = tx.objectStore('bills'); const req = store.getAll(); req.onsuccess = ()=>res(req.result); req.onerror = rej; }); },
    clear: function(){ return new Promise((res,rej)=>{ const tx = DB.db.transaction('bills','readwrite'); const store = tx.objectStore('bills'); const req = store.clear(); req.onsuccess = ()=>res(); req.onerror = rej; }); }
  };

  await DB.init(); refreshHistory();

  function setStatus(t){ status.textContent = t; }
  function log(msg){ logBox.textContent = (logBox.textContent + '\n' + msg).slice(-8000); }

  // ---------- OCR helpers ----------
  // convert file -> Image element (for enhanced pass)
  function fileToImage(file){
    return new Promise((res,rej)=>{
      const r = new FileReader();
      r.onload = ()=> {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = ()=> res(img);
        img.onerror = rej;
        img.src = r.result;
      };
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function urlToImage(dataUrl){
    return new Promise((res,rej)=>{
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = ()=>res(img);
      img.onerror = rej;
      img.src = dataUrl;
    });
  }

  // Quick OCR pass (fast)
  async function quickOCRImage(imgOrUrl){
    setStatus('OCR pass 1 (quick) ...');
    log('Starting quick OCR');
    const worker = Tesseract.createWorker({ logger: m => log('t1: ' + JSON.stringify(m).slice(0,120)) });
    try{
      await worker.load();
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      const { data } = await worker.recognize(imgOrUrl);
      await worker.terminate();
      log('Quick OCR done.');
      return data;
    }catch(e){
      try{ await worker.terminate(); }catch(_){}
      log('Quick OCR error: ' + (e && e.message||e));
      throw e;
    }
  }

  // Enhanced OCR pass: preprocess then OCR
  async function enhancedOCRImage(img){
    setStatus('OCR pass 2 (enhanced) ...');
    log('Starting enhanced OCR: preprocessing image');

    // canvas preprocessing: upscale, grayscale, contrast stretch, threshold
    const targetW = Math.min(2500, Math.max(1200, Math.round(img.width * 1.3)));
    const scale = targetW / img.width;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // get image data & convert to grayscale + contrast stretch
    let imageData = ctx.getImageData(0,0,canvas.width,canvas.height);
    const data = imageData.data;
    let min = 255, max = 0;
    for(let i=0;i<data.length;i+=4){
      const v = Math.round(0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]);
      if(v < min) min = v;
      if(v > max) max = v;
    }
    const range = Math.max(1, max - min);
    for(let i=0;i<data.length;i+=4){
      let v = Math.round(0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]);
      v = Math.round((v - min) * 255 / range);
      data[i] = data[i+1] = data[i+2] = v;
    }
    // simple global threshold using mean
    let sum=0, cnt=0;
    for(let i=0;i<data.length;i+=4){ sum+=data[i]; cnt++; }
    const mean = sum/cnt;
    for(let i=0;i<data.length;i+=4){
      const v = data[i] < mean*0.98 ? 0 : 255;
      data[i]=data[i+1]=data[i+2]=v;
    }
    ctx.putImageData(imageData,0,0);

    // optional second pass: slight unsharp mask / sharpen (omitted for simplicity)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    log('Enhanced image prepared. Running Tesseract on enhanced image.');

    const worker = Tesseract.createWorker({ logger: m => log('t2: ' + JSON.stringify(m).slice(0,120)) });
    try{
      await worker.load();
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      // configure char whitelist loosely (keeps numbers/symbols)
      const config = { tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ₹.$,/-: ' };
      const { data } = await worker.recognize(dataUrl, config);
      await worker.terminate();
      log('Enhanced OCR done.');
      return data;
    }catch(e){
      try{ await worker.terminate(); }catch(_){}
      log('Enhanced OCR error: ' + (e && e.message||e));
      throw e;
    }
  }

  // Extract from file: supports TXT, image, PDF (text) with OCR fallback
  async function extractTextFromFile(file){
    const name = file.name || 'file';
    const type = file.type || '';
    log('extractTextFromFile: ' + name + ' ('+type+')');
    if(type === 'text/plain' || name.endsWith('.txt')) {
      const txt = await file.text();
      return { pass1: { text: txt }, pass2: { text: txt }, image: null };
    }

    if(type.startsWith('image/') || /\.(png|jpg|jpeg)$/i.test(name)){
      const img = await fileToImage(file);
      const pass1 = await quickOCRImage(img);
      const pass2 = await enhancedOCRImage(img);
      return { pass1, pass2, image: img };
    }

    // PDF: try PDF.js text extraction first
    try{
      setStatus('Parsing PDF text (pdf.js) ...');
      const arr = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({data:arr}).promise;
      let whole = '';
      const maxPages = Math.min(pdf.numPages, 12);
      for(let i=1;i<=maxPages;i++){
        const page = await pdf.getPage(i);
        const txtContent = await page.getTextContent();
        const pageText = txtContent.items.map(it=>it.str).join(' ');
        whole += pageText + '\n';
      }
      log('PDF.js extracted text length: ' + whole.length);
      // create image of page1 for enhanced OCR fallback
      const page1 = await pdf.getPage(1);
      const viewport = page1.getViewport({scale:1.5});
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page1.render({canvasContext: ctx, viewport}).promise;
      const dataUrl = canvas.toDataURL('image/jpeg',0.9);
      const image = await urlToImage(dataUrl);

      // If pdf.js returned very little text, still run OCR passes (to capture scanned PDFs)
      let pass1 = { text: whole };
      let pass2 = { text: '' };
      if(!whole || whole.trim().length < 20){
        log('PDF has little text — running OCR fallback on page image.');
        pass1 = await quickOCRImage(image);
        pass2 = await enhancedOCRImage(image);
      } else {
        // still run enhanced OCR so we can merge text (useful when text is present but layout odd)
        try{
          pass2 = await enhancedOCRImage(image);
        }catch(e){ pass2 = { text: '' }; }
      }

      return { pass1, pass2, image };
    }catch(err){
      log('PDF parse error: ' + (err && err.message||err));
      // fallback: convert to image and OCR
      try{
        const img = await fileToImage(file);
        const pass1 = await quickOCRImage(img);
        const pass2 = await enhancedOCRImage(img);
        return { pass1, pass2, image: img };
      }catch(e){
        log('Final fallback failed: ' + (e && e.message||e));
        throw e;
      }
    }
  }

  // ---------- Parsing logic ----------
  function parseText(text){
    const result = { raw: text || '', date: null, total: null, merchant: null, items: [], category: 'general' };
    const lines = (text||'').split(/\r?\n/).map(l=>l.replace(/\|/g,' ').trim()).filter(Boolean);

    // merchant: first header-like line
    for(let i=0;i<5 && i<lines.length;i++){
      const l = lines[i];
      if(!/invoice|bill|tax|receipt|gst|cashier/i.test(l) && /[A-Za-z0-9]/.test(l)) { result.merchant = l; break; }
    }

    // date detection
    const dateRx = /\b((0?[1-9]|[12][0-9]|3[01])[\/\-.](0?[1-9]|1[012])[\/\-.]\d{2,4}|\d{4}[\/\-.](0?[1-9]|1[012])[\/\-.](0?[1-9]|[12][0-9]|3[01])|[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})\b/;
    for(const l of lines){ const m = l.match(dateRx); if(m){ result.date = m[0]; break; } }

    // total detection: search bottom lines for keywords/currency
    const tail = lines.slice(-16);
    let found = null;
    for(const l of tail){
      if(/grand total|grandtotal|total amount|amount payable|amount due|balance due|net amount|amount in words|grand total/i.test(l) || /₹|\bINR\b|\bRs\b|\$/i.test(l)){
        const nums = l.replace(/[^0-9.,]/g,'').replace(/,+/g,'').match(/([0-9]+[.,][0-9]{2,})|([0-9]+)/g);
        if(nums && nums.length){
          found = nums[nums.length-1];
          break;
        }
      }
    }
    if(!found){
      const allNums = (text.match(/([0-9]+[.,][0-9]{2,})|([0-9]{3,})/g) || []).map(s=>s.replace(/,/g,''));
      let max=0, best=null;
      allNums.forEach(n=>{ const v = parseFloat(n); if(!isNaN(v) && v>max){ max=v; best=n; }});
      if(best) found = best;
    }
    result.total = found ? String(found) : null;

    // items: detect table-like rows
    const itemRx = /^(.{2,80})\s+(\d+)\s+([0-9.,]+)\s+([0-9.,]+)$/;
    for(const l of lines){
      const m = l.match(itemRx);
      if(m) result.items.push({name:m[1].trim(), qty:m[2], price:m[3], total:m[4]});
    }
    if(result.items.length===0){
      for(const l of lines){
        const m = l.match(/^(.{2,80})\s+([0-9.,]+)$/);
        if(m && /[A-Za-z]/.test(m[1])) result.items.push({name:m[1].trim(), price:m[2]});
      }
    }

    // category by keywords
    const keywordMap = { food: ['restaurant','cafe','dining','food','grocery','mart','hotel'], shopping: ['store','shop','mall','boutique','shopping','supermarket'], finance: ['bank','payment','transaction','upi','invoice','tax'] };
    const low = text.toLowerCase();
    for(const [cat,keys] of Object.entries(keywordMap)){
      for(const k of keys) if(low.includes(k)) { result.category = cat; break; }
    }

    return result;
  }

  // Merge pass1 & pass2 results
  function mergeResults(pass1, pass2){
    const t1 = (pass1 && pass1.text) ? pass1.text : (typeof pass1 === 'string' ? pass1 : '');
    const t2 = (pass2 && pass2.text) ? pass2.text : (typeof pass2 === 'string' ? pass2 : '');
    const combined = (t1 + '\n\n' + t2).trim();

    const p1 = parseText(t1);
    const p2 = parseText(t2);
    // score heuristics
    let score1 = 0, score2 = 0;
    if(p1.total) score1 += 40; if(p1.date) score1 += 20; if(p1.merchant) score1 += 20; score1 += Math.min(20, (p1.items||[]).length*5);
    if(p2.total) score2 += 40; if(p2.date) score2 += 20; if(p2.merchant) score2 += 20; score2 += Math.min(20, (p2.items||[]).length*5);

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

  // ---------- UI actions ----------
  parseBtn.addEventListener('click', async ()=>{
    const f = fileInput.files[0];
    if(!f){ alert('Choose a file first'); return; }
    try{
      setStatus('Extracting file...');
      const { pass1, pass2, image } = await extractTextFromFile(f);
      setStatus('Merging results...');
      const merged = mergeResults(pass1, pass2);
      showParsed(merged);
      window.lastParsed = merged;
      setStatus('Done');
    }catch(err){
      console.error(err);
      setStatus('Parse failed: ' + (err && err.message || err));
      alert('Parse failed: ' + (err && err.message || err));
    }
  });

  // OCR only: show both pass outputs side-by-side in rawText
  ocrOnlyBtn.addEventListener('click', async ()=>{
    const f = fileInput.files[0];
    if(!f){ alert('Choose a file first'); return; }
    try{
      setStatus('OCR only: extracting...');
      const { pass1, pass2 } = await extractTextFromFile(f);
      const a = (pass1 && pass1.text) ? pass1.text : JSON.stringify(pass1).slice(0,2000);
      const b = (pass2 && pass2.text) ? pass2.text : JSON.stringify(pass2).slice(0,2000);
      rawTextEl.textContent = '--- PASS 1 (quick) ---\n' + a + '\n\n--- PASS 2 (enhanced) ---\n' + b;
      previewBox.textContent = rawTextEl.textContent.slice(0,5000);
      setStatus('OCR done');
    }catch(err){
      console.error(err);
      setStatus('OCR failed: ' + (err && err.message || err));
      alert('OCR failed: ' + (err && err.message || err));
    }
  });

  function showParsed(obj){
    rawTextEl.textContent = (obj.raw||'').slice(0,12000);
    previewBox.textContent = JSON.stringify(obj,null,2).slice(0,10000);
    o_date.textContent = obj.date || '-';
    o_total.textContent = obj.total || '-';
    o_merchant.textContent = obj.merchant || '-';
    o_category.textContent = obj.category || '-';
    o_items.textContent = (obj.items && obj.items.length) ? JSON.stringify(obj.items,null,2) : 'None detected';
    o_conf.textContent = (obj.confidence || 0) + '%';
  }

  // ---------- Previews ----------
  function previewJSON(){
    if(!window.lastParsed) return alert('No parsed data');
    previewBox.textContent = JSON.stringify(window.lastParsed, null, 2);
  }

  function previewCSV(){
    if(!window.lastParsed) return alert('No parsed data');
    const p = window.lastParsed;
    const rows = [['merchant','date','total','category']];
    rows.push([p.merchant||'', p.date||'', p.total||'', p.category||'']);
    let csv = rows.map(r=>r.map(c=>`"${String(c||'').replace(/"/g,'""')}"`).join(',')).join('\n') + '\n\n';
    csv += 'Items:\n';
    csv += (p.items && p.items.length) ? p.items.map(it=>`${it.name || ''},${it.qty||''},${it.price||''},${it.total||''}`).join('\n') : 'None';
    previewBox.textContent = csv;
  }

  function previewXLSX(){
    if(!window.lastParsed) return alert('No parsed data');
    // show HTML table preview for Excel
    const p = window.lastParsed;
    let html = '<table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>';
    html += `<tr><td>Merchant</td><td>${escapeHtml(p.merchant||'')}</td></tr>`;
    html += `<tr><td>Date</td><td>${escapeHtml(p.date||'')}</td></tr>`;
    html += `<tr><td>Total</td><td>${escapeHtml(p.total||'')}</td></tr>`;
    html += `<tr><td>Category</td><td>${escapeHtml(p.category||'')}</td></tr>`;
    html += `<tr><td>Confidence</td><td>${escapeHtml(p.confidence||'')}</td></tr>`;
    html += '</tbody></table>';
    html += '<h4>Items</h4>';
    if(p.items && p.items.length){
      html += '<table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Name</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>';
      p.items.forEach(it=>{
        html += `<tr><td>${escapeHtml(it.name||'')}</td><td>${escapeHtml(it.qty||'')}</td><td>${escapeHtml(it.price||'')}</td><td>${escapeHtml(it.total||'')}</td></tr>`;
      });
      html += '</tbody></table>';
    } else html += '<div>None</div>';
    previewBox.textContent = htmlToPlainText(html);
  }

  function previewTally(){
    if(!window.lastParsed) return alert('No parsed data');
    const p = window.lastParsed;
    // generate a basic Tally-like XML structure (example, not full Tally spec)
    const tidy = (s)=>escapeXml(String(s||''));
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY>
    <VOUCHER>
      <DATE>${tidy(p.date||'')}</DATE>
      <PARTYNAME>${tidy(p.merchant||'')}</PARTYNAME>
      <TOTALAMOUNT>${tidy(p.total||'')}</TOTALAMOUNT>
      <CATEGORY>${tidy(p.category||'')}</CATEGORY>
      <ITEMS>
${(p.items||[]).map(it=>`        <ITEM><NAME>${tidy(it.name)}</NAME><QTY>${tidy(it.qty||'')}</QTY><PRICE>${tidy(it.price||'')}</PRICE><TOTAL>${tidy(it.total||'')}</TOTAL></ITEM>`).join('\n')}
      </ITEMS>
    </VOUCHER>
  </BODY>
</ENVELOPE>`;
    previewBox.textContent = xml;
  }

  function previewTXT(){
    if(!window.lastParsed) return alert('No parsed data');
    const p = window.lastParsed;
    let txt = `Merchant: ${p.merchant||''}\nDate: ${p.date||''}\nTotal: ${p.total||''}\nCategory: ${p.category||''}\n\nItems:\n`;
    txt += (p.items && p.items.length) ? p.items.map(it=>`- ${it.name} | qty:${it.qty||''} | price:${it.price||''} | total:${it.total||''}`).join('\n') : 'None';
    previewBox.textContent = txt;
  }

  previewJsonBtn.addEventListener('click', previewJSON);
  previewCsvBtn.addEventListener('click', previewCSV);
  previewXlsBtn.addEventListener('click', previewXLSX);
  previewTallyBtn.addEventListener('click', previewTally);
  previewTxtBtn.addEventListener('click', previewTXT);

  // ---------- Exports ----------
  function downloadBlob(blob, name){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
