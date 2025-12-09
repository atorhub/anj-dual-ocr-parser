/* script.js - Dual OCR (two-pass Tesseract) + Parser + Exports
   - Pass 1: quick OCR (default settings)
   - Pass 2: enhanced OCR after image preprocessing (grayscale/contrast/threshold/resize)
   - Merge strategy: prefer fields extracted from the pass with higher numeric/key hits and length
   - Exports: JSON, CSV, XLSX (SheetJS), PDF (html2canvas + jsPDF), ZIP (JSZip)
*/

(async function(){
  // UI refs
  const fileInput = document.getElementById('fileInput');
  const parseBtn = document.getElementById('parseBtn');
  const ocrOnlyBtn = document.getElementById('ocrOnlyBtn');
  const status = document.getElementById('status');
  const rawTextEl = document.getElementById('rawText');
  const previewEl = document.getElementById('preview');
  const o_date = document.getElementById('o_date');
  const o_total = document.getElementById('o_total');
  const o_merchant = document.getElementById('o_merchant');
  const o_category = document.getElementById('o_category');
  const o_items = document.getElementById('o_items');
  const o_conf = document.getElementById('o_confidence');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const exportXlsBtn = document.getElementById('exportXlsBtn');
  const exportPdfBtn = document.getElementById('exportPdfBtn');
  const exportZipBtn = document.getElementById('exportZipBtn');
  const saveBtn = document.getElementById('saveBtn');
  const historyList = document.getElementById('historyList');
  const clearBtn = document.getElementById('clearBtn');

  // IndexedDB simple wrapper for history
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

  // Utility: update status
  function setStatus(t){ status.textContent = t; }

  // ---------- OCR helpers ----------
  async function extractTextFromFile(file){
    const name = file.name||'file';
    const type = file.type || '';
    if(type === 'text/plain' || name.endsWith('.txt')) return file.text();
    if(type.startsWith('image/') || /\.(png|jpg|jpeg)$/i.test(name)){
      // image file - do both passes
      const img = await fileToImage(file);
      const pass1 = await quickOCRImage(img);
      const pass2 = await enhancedOCRImage(img);
      return {pass1, pass2, image: img};
    }
    // assume PDF
    try{
      const arr = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({data:arr}).promise;
      let whole = '';
      const maxPages = Math.min(pdf.numPages, 8);
      for(let i=1;i<=maxPages;i++){
        const page = await pdf.getPage(i);
        const txtContent = await page.getTextContent();
        const pageText = txtContent.items.map(it=>it.str).join(' ');
        whole += pageText + '\n';
      }
      // For PDFs, also create a canvas image of page 1 to allow enhanced OCR
      const page1 = await pdf.getPage(1);
      const viewport = page1.getViewport({scale:1.5});
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page1.render({canvasContext: ctx, viewport}).promise;
      const dataUrl = canvas.toDataURL('image/jpeg',0.9);
      const img = await urlToImage(dataUrl);
      const pass1 = {text: whole, words: []};
      const pass2 = await enhancedOCRImage(img);
      return {pass1, pass2, image: img};
    }catch(err){
      console.warn('PDF parse fallback to OCR image', err);
      // fallback: convert to blob image and do OCR (not implemented here)
      return {pass1:{text:''}, pass2:{text:''}};
    }
  }

  function fileToImage(file){
    return new Promise((res,rej)=>{
      const r = new FileReader();
      r.onload = ()=> urlToImage(r.result).then(res).catch(rej);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function urlToImage(url){
    return new Promise((res,rej)=>{
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = ()=>res(img);
      img.onerror = rej;
      img.src = url;
    });
  }

  // Quick OCR (pass1) - faster configuration
  async function quickOCRImage(img){
    setStatus('OCR pass 1 (quick) ...');
    const worker = Tesseract.createWorker({logger: m=>console.debug('t1',m)});
    await worker.load();
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    // speed over quality
    const { data } = await worker.recognize(img, { tessjs_create_pdf: '0' });
    await worker.terminate();
    return data; // {text, words, lines, paragraphs, confidence?}
  }

  // Enhanced OCR (pass2) - preprocess image then run with higher settings
  async function enhancedOCRImage(img){
    setStatus('OCR pass 2 (enhanced) ...');
    // preprocess: canvas grayscale, contrast, resize, binarize
    const canvas = document.createElement('canvas');
    const targetW = Math.min(2200, Math.max(1000, img.width * 1.2)); // upscale to improve OCR
    const scale = targetW / img.width;
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    // draw image then get data
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let imageData = ctx.getImageData(0,0,canvas.width,canvas.height);
    // simple contrast & grayscale & threshold
    const data = imageData.data;
    // auto contrast stretch
    let min = 255, max = 0;
    for(let i=0;i<data.length;i+=4){
      const v = Math.round(0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]);
      if(v < min) min = v;
      if(v > max) max = v;
    }
    const range = Math.max(1, max - min);
    for(let i=0;i<data.length;i+=4){
      let v = Math.round(0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]);
      // stretch contrast
      v = Math.round((v - min) * 255 / range);
      // slight sharpening by mapping
      data[i]=data[i+1]=data[i+2]=v;
      // simple binarize adaptive-ish threshold
      // keep as is but later do global threshold
    }
    // global threshold
    // compute mean
    let sum=0, cnt=0;
    for(let i=0;i<data.length;i+=4){ sum += data[i]; cnt++; }
    const mean = sum/cnt;
    for(let i=0;i<data.length;i+=4){
      const v = data[i] < mean*0.95 ? 0 : 255;
      data[i] = data[i+1] = data[i+2] = v;
    }
    ctx.putImageData(imageData,0,0);
    // optional: add slight blur/sharpen? skip for now

    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const worker = Tesseract.createWorker({logger: m=>console.debug('t2',m)});
    await worker.load();
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    // give Tesseract some OEM/PSM tweaks via tessedit_char_whitelist or config if needed
    const config = {
      tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ₹.$,-/:% '
    };
    const { data: res } = await worker.recognize(dataUrl, config);
    await worker.terminate();
    return res;
  }

  // ---------- Parse helpers ----------
  function parseText(text){
    const result = { date: null, total: null, merchant: null, items: [], category: 'general', raw: text };
    const lines = (text||'').split(/\r?\n/).map(l=>l.replace(/\|/g,' ').trim()).filter(Boolean);

    // merchant: first line that is not invoice/bill title (look at top 4)
    for(let i=0;i<4 && i<lines.length;i++){
      const l = lines[i];
      if(!/invoice|bill|tax|receipt|gst/i.test(l) && /[A-Za-z0-9]/.test(l)) { result.merchant = l; break; }
    }

    // date detection
    const dateRx = /\b((0?[1-9]|[12][0-9]|3[01])[\/\-.](0?[1-9]|1[012])[\/\-.]\d{2,4}|\d{4}[\/\-.](0?[1-9]|1[012])[\/\-.](0?[1-9]|[12][0-9]|3[01])|[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})\b/;
    for(const l of lines){ const m = l.match(dateRx); if(m){ result.date = m[0]; break; } }

    // total detection: search last 10 lines for keywords or currency
    const tail = lines.slice(-12);
    let found = null;
    for(const l of tail){
      if(/grand total|total amount|amount payable|amount|balance due|net amount|amount in words/i.test(l) || /₹|\bINR\b|\bRs\b|\$/i.test(l)){
        const nums = l.replace(/[^0-9.,]/g,'').replace(/,+/g,'').match(/([0-9]+[.,][0-9]{2,})|([0-9]+)/g);
        if(nums && nums.length){
          found = nums[nums.length-1];
          break;
        }
      }
    }
    if(!found){
      // fallback: pick the largest numeric token in whole text
      const allNums = (text.match(/([0-9]+[.,][0-9]{2,})|([0-9]{3,})/g) || []).map(s=>s.replace(/,/g,''));
      let max=0, best=null;
      allNums.forEach(n=>{ const v = parseFloat(n); if(!isNaN(v) && v>max){ max=v; best=n; }});
      if(best) found = best;
    }
    result.total = found ? String(found) : null;

    // items: lines that look like "name qty price total" or "name ..... price"
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

    // category keywords
    const keywordMap = { food: ['restaurant','cafe','dining','food','grocery','grocery','mart','canteen','hotel'], shopping: ['store','shop','mall','boutique','shopping','apparel'], finance: ['bank','payment','transaction','upi','invoice','tax'] };
    const low = text.toLowerCase();
    for(const [cat,keys] of Object.entries(keywordMap)){
      for(const k of keys) if(low.includes(k)) { result.category = cat; break; }
    }

    return result;
  }

  // Merge logic between pass1 & pass2
  function mergeResults(pass1, pass2){
    // passX: object from Tesseract data (with text property)
    const t1 = (pass1 && pass1.text) ? pass1.text : (typeof pass1 === 'string' ? pass1 : '');
    const t2 = (pass2 && pass2.text) ? pass2.text : (typeof pass2 === 'string' ? pass2 : '');
    // choose longer & richer text as combined
    const combined = (t2 && t2.length > t1.length*0.9) ? (t1 + '\n' + t2) : (t1 + '\n' + t2);
    // parse both separately too
    const p1 = parseText(t1);
    const p2 = parseText(t2);
    // confidence heuristic:
    // - +1 for each detected field (date,total,merchant) per pass
    // - item count weight
    let score1 = 0, score2 = 0;
    if(p1.total) score1 += 40; if(p1.date) score1 += 20; if(p1.merchant) score1 += 20; score1 += Math.min(20, (p1.items||[]).length*5);
    if(p2.total) score2 += 40; if(p2.date) score2 += 20; if(p2.merchant) score2 += 20; score2 += Math.min(20, (p2.items||[]).length*5);
    // pick fields from higher-scoring parse; fallback to combined parse
    const chosen = { raw: combined, confidence: Math.round(Math.max(score1,score2)) };
    const winner = score2 >= score1 ? p2 : p1;
    chosen.date = winner.date || (p1.date||p2.date);
    chosen.total = winner.total || (p1.total||p2.total);
    chosen.merchant = winner.merchant || (p1.merchant||p2.merchant);
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
      const {pass1, pass2, image} = await extractTextFromFile(f);
      setStatus('Merging results...');
      const merged = mergeResults(pass1, pass2);
      showParsed(merged);
      window.lastParsed = merged;
      setStatus('Done');
    }catch(err){
      console.error(err);
      setStatus('Parse failed: ' + (err && err.message || err));
      alert('Parse failed: ' + err);
    }
  });

  ocrOnlyBtn.addEventListener('click', async ()=>{
    const f = fileInput.files[0];
    if(!f){ alert('Choose a file first'); return; }
    try{
      setStatus('OCR only: extracting quick pass...');
      const {pass1, pass2} = await extractTextFromFile(f);
      const combined = (pass1 && pass1.text?pass1.text:'') + '\n\n=== PASS2 ===\n\n' + (pass2 && pass2.text?pass2.text:'');
      rawTextEl.textContent = combined;
      previewEl.textContent = combined.slice(0,4000);
      setStatus('OCR done');
    }catch(err){ console.error(err); setStatus('OCR failed'); alert('OCR failed: '+err); }
  });

  function showParsed(obj){
    rawTextEl.textContent = (obj.raw||'').slice(0,8000);
    previewEl.textContent = JSON.stringify(obj,null,2).slice(0,5000);
    o_date.textContent = obj.date || '-';
    o_total.textContent = obj.total || '-';
    o_merchant.textContent = obj.merchant || '-';
    o_category.textContent = obj.category || '-';
    o_items.textContent = (obj.items && obj.items.length) ? JSON.stringify(obj.items,null,2) : 'None detected';
    o_conf.textContent = (obj.confidence || 0) + '%';
  }

  // ---------- Export functions ----------
  function downloadBlob(blob, name){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  exportJsonBtn.addEventListener('click', ()=>{
    if(!window.lastParsed) return alert('No parsed data');
    const blob = new Blob([JSON.stringify(window.lastParsed,null,2)], {type:'application/json'});
    downloadBlob(blob, 'anj-parsed.json');
  });

  exportCsvBtn.addEventListener('click', ()=>{
    if(!window.lastParsed) return alert('No parsed data');
    // simple CSV: merchant,date,total,category + items flattened
    const p = window.lastParsed;
    const rows = [['merchant','date','total','category']];
    rows.push([p.merchant||'', p.date||'', p.total||'', p.category||'']);
    const csv = rows.map(r=>r.map(c=>`"${String(c||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    downloadBlob(new Blob([csv],{type:'text/csv'}),'anj-parsed.csv');
  });

  exportXlsBtn.addEventListener('click', ()=>{
    if(!window.lastParsed) return alert('No parsed data');
    const p = window.lastParsed;
    const wb = XLSX.utils.book_new();
    // summary sheet
    const summary = [
      ["Field","Value"],
      ["Merchant", p.merchant||""],
      ["Date", p.date||""],
      ["Total", p.total||""],
      ["Category", p.category||""],
      ["Confidence", p.confidence||""]
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(summary);
    XLSX.utils.book_append_sheet(wb, ws1, 'Summary');

    // items sheet
    let items = p.items && p.items.length ? p.items : [];
    const itemsRows = [Object.keys(items[0]||{name:'name',price:'price'})];
    items.forEach(it=>{
      itemsRows.push([it.name||'', it.qty||'', it.price||'', it.total||'']);
    });
    const ws2 = XLSX.utils.aoa_to_sheet(itemsRows);
    XLSX.utils.book_append_sheet(wb, ws2, 'Items');

    const wbout = XLSX.write(wb, {bookType:'xlsx', type:'array'});
    downloadBlob(new Blob([wbout],{type:'application/octet-stream'}),'anj-parsed.xlsx');
  });

  exportPdfBtn.addEventListener('click', async ()=>{
    if(!window.lastParsed) return alert('No parsed data');
    // capture the structured area and preview as PDF
    setStatus('Generating PDF...');
    const target = document.querySelector('#structured');
    const canvas = await html2canvas(target, {scale:2});
    const img = canvas.toDataURL('image/jpeg',0.9);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({orientation:'portrait', unit:'px', format:[canvas.width, canvas.height]});
    pdf.addImage(img,'JPEG',0,0,canvas.width, canvas.height);
    pdf.save('anj-parsed.pdf');
    setStatus('PDF ready');
  });

  exportZipBtn.addEventListener('click', async ()=>{
    if(!window.lastParsed) return alert('No parsed data');
    setStatus('Preparing ZIP...');
    const zip = new JSZip();
    const json = JSON.stringify(window.lastParsed,null,2);
    zip.file('anj-parsed.json', json);

    // add PDF snapshot
    const target = document.querySelector('#structured');
    const canvas = await html2canvas(target, {scale:2});
    const dataUrl = canvas.toDataURL('image/jpeg',0.9);
    // convert dataURL to blob
    const blob = await (await fetch(dataUrl)).blob();
    zip.file('anj-parsed-visual.jpg', blob);
    const content = await zip.generateAsync({type:'blob'});
    downloadBlob(content, 'anj-parsed.zip');
    setStatus('ZIP ready');
  });

  // save JSON to local IndexedDB history
  saveBtn.addEventListener('click', async ()=>{
    if(!window.lastParsed) return alert('No parsed data');
    const obj = Object.assign({}, window.lastParsed);
    obj.id = 'bill-' + Date.now();
    obj.savedAt = new Date().toISOString();
    try{
      await DB.save(obj);
      refreshHistory();
      alert('Saved locally');
    }catch(err){ console.error(err); alert('Save failed'); }
  });

  clearBtn.addEventListener('click', async ()=>{
    if(!confirm('Clear local history?')) return;
    await DB.clear();
    refreshHistory();
  });

  // ---------- history UI ----------
  async function refreshHistory(){
    const all = await DB.all();
    if(!all.length){ historyList.innerHTML = 'No saved records'; return; }
    historyList.innerHTML = '';
    all.sort((a,b)=> new Date(b.savedAt)-new Date(a.savedAt));
    all.forEach(item=>{
      const div = document.createElement('div');
      div.style.padding='8px'; div.style.borderBottom='1px solid rgba(255,255,255,0.03)';
      div.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <strong>${item.merchant||item.fileName||'Bill'}</strong>
          <div style="color:var(--muted);font-size:12px">${(item.savedAt||'')}</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700">${item.total||'-'}</div>
          <button class="btn small" data-id="${item.id}">Load</button>
        </div>
      </div>`;
      historyList.appendChild(div);
      div.querySelector('button').addEventListener('click', ()=>{
        window.lastParsed = item;
        showParsed(item);
        window.scrollTo({top:0,behavior:'smooth'});
      });
    });
  }

})();
          
