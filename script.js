(function(){
  'use strict';

  // small util
  const wait = (ms=0) => new Promise(r=>setTimeout(r, ms));

  function canvasToBlob(canvas, type='image/png', quality=0.95){
    return new Promise((res)=>{
      if(canvas.toBlob) return canvas.toBlob(b => res(b), type, quality);
      try{
        const dataURL = canvas.toDataURL(type, quality);
        const bin = atob(dataURL.split(',')[1]);
        const arr = new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
        res(new Blob([arr], {type}));
      }catch(e){ res(null); }
    });
  }

  async function readPDFFile(file, maxPages=20){
    try{
      const arr = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({data:arr}).promise;
      const pages = Math.min(maxPages, pdf.numPages || 0);
      let out = '';
      for(let i=1;i<=pages;i++){
        try{
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          out += content.items.map(it=>it.str || '').join(' ') + '\n';
        }catch(e){
          console.warn('pdf page extract fail', e);
        }
      }
      return out.trim();
    }catch(err){
      console.warn('readPDFFile failed', err);
      return '';
    }
  }

  async function pdfPageToImageBlob(file, pageNumber=1, scale=2){
    try{
      const arr = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({data:arr}).promise;
      const page = await pdf.getPage(Math.min(pageNumber, pdf.numPages));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await canvasToBlob(canvas, 'image/png', 0.95);
      return blob;
    }catch(err){
      console.warn('pdfPageToImageBlob failed', err);
      return null;
    }
  }

  async function fileToImageBlob(file){
    try{
      if(!file) return null;
      if(file.type && file.type.startsWith('image/')) return file;
      const name = (file.name||'').toLowerCase();
      if(name.endsWith('.pdf') || file.type === 'application/pdf'){
        const b = await pdfPageToImageBlob(file, 1, 2);
        if(b) return b;
      }
      return file;
    }catch(e){
      console.warn('fileToImageBlob error', e);
      return file;
    }
  }

  async function preprocessImageToCanvas(imgOrBlob, opts={ widthLimit:2000, enhanceContrast:true, toGray:true }){
    return new Promise(async (res, rej)=>{
      try{
        const img = new Image();
        img.crossOrigin = 'anonymous';
        if(imgOrBlob instanceof Blob || imgOrBlob instanceof File) img.src = URL.createObjectURL(imgOrBlob);
        else if(typeof imgOrBlob === 'string') img.src = imgOrBlob;
        else if(imgOrBlob && imgOrBlob.tagName === 'IMG') img.src = imgOrBlob.src;
        else return rej(new Error('Unsupported image input'));

        img.onload = () => {
          try{
            const ratio = Math.min(1, opts.widthLimit ? opts.widthLimit / img.width : 1);
            const w = Math.round(img.width * ratio);
            const h = Math.round(img.height * ratio);
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);

            if(opts.enhanceContrast || opts.toGray){
              try{
                const id = ctx.getImageData(0,0,w,h);
                const d = id.data;
                let sum = 0;
                for(let i=0;i<d.length;i+=4) sum += (0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]);
                const mean = sum / (w*h);
                const contrast = opts.enhanceContrast ? 1.12 : 1.0;
                const brighten = (128 - mean) * 0.03;
                for(let i=0;i<d.length;i+=4){
                  let r=d[i], g=d[i+1], b=d[i+2];
                  if(opts.toGray){
                    const gray = Math.round(0.2126*r + 0.7152*g + 0.0722*b);
                    r=g=b=gray;
                  }
                  r = (r-128)*contrast + 128 + brighten;
                  g = (g-128)*contrast + 128 + brighten;
                  b = (b-128)*contrast + 128 + brighten;
                  d[i] = Math.max(0, Math.min(255, Math.round(r)));
                  d[i+1] = Math.max(0, Math.min(255, Math.round(g)));
                  d[i+2] = Math.max(0, Math.min(255, Math.round(b)));
                }
                ctx.putImageData(id, 0, 0);
              }catch(pxErr){
                console.warn('image preprocessing pixel ops failed', pxErr);
              }
            }

            try{ if(imgOrBlob instanceof Blob) URL.revokeObjectURL(img.src); }catch(e){}
            res(canvas);
          }catch(inner){ rej(inner); }
        };

        img.onerror = ()=> rej(new Error('Image load failed'));
      }catch(err){ rej(err); }
    });
  }

  async function recognizeWithTesseract(blobOrFile, opts={ lang:'eng', logger: null }){
    try{
      if(typeof Tesseract === 'undefined' || !Tesseract.recognize) {
        console.warn('Tesseract not available');
        return '';
      }
      const res = await Tesseract.recognize(blobOrFile, opts.lang, { logger: opts.logger || (()=>{}) });
      return (res && (res.data && res.data.text || res.text) || '') + '';
    }catch(err){
      console.warn('recognizeWithTesseract failed', err);
      return '';
    }
  }

  async function recognizeEnhanced(blobOrFile, opts={ lang:'eng', logger: null }){
    try{
      let canvas = null;
      try{ canvas = await preprocessImageToCanvas(blobOrFile, { enhanceContrast:true, toGray:true, widthLimit:2500 }); }catch(e){}
      if(canvas){
        const b1 = await canvasToBlob(canvas, 'image/png', 0.95);
        const t1 = await recognizeWithTesseract(b1, opts);
        if(t1 && t1.trim().length > 30) return t1;
        let canvas2 = null;
        try{ canvas2 = await preprocessImageToCanvas(blobOrFile, { enhanceContrast:true, toGray:true, widthLimit:3500 }); }catch(e){}
        if(canvas2){
          const b2 = await canvasToBlob(canvas2, 'image/png', 0.95);
          const t2 = await recognizeWithTesseract(b2, opts);
          return (t2 && t2.length>t1.length) ? t2 : t1;
        }
        return t1;
      } else {
        return await recognizeWithTesseract(blobOrFile, opts);
      }
    }catch(err){
      console.warn('recognizeEnhanced failed', err);
      return await recognizeWithTesseract(blobOrFile, opts);
    }
  }

  const lastOCR = { quick:'', enhanced:'', combined:'' };

  async function runDualOCR(file, opts={ lang:'eng', logger:null }){
    try{
      lastOCR.quick = ''; lastOCR.enhanced = ''; lastOCR.combined = '';
      let pdfText = '';
      if(file && file.name && file.name.toLowerCase().endsWith('.pdf')) pdfText = await readPDFFile(file, 20);
      const imageBlob = await fileToImageBlob(file);
      if(imageBlob) lastOCR.quick = await recognizeWithTesseract(imageBlob, { lang: opts.lang, logger: opts.logger });
      else lastOCR.quick = '';
      if(imageBlob) lastOCR.enhanced = await recognizeEnhanced(imageBlob, { lang: opts.lang, logger: opts.logger });
      else lastOCR.enhanced = '';
      const parts = [];
      if(pdfText && pdfText.trim().length > 30) parts.push(pdfText.trim());
      if(lastOCR.enhanced && lastOCR.enhanced.trim().length) parts.push(lastOCR.enhanced.trim());
      if(lastOCR.quick && lastOCR.quick.trim().length) parts.push(lastOCR.quick.trim());
      lastOCR.combined = parts.join('\n\n');
      return { ...lastOCR };
    }catch(err){
      console.warn('runDualOCR failed', err);
      return { ...lastOCR };
    }
  }

  async function runQuickOCROnly(file, opts={ lang:'eng', logger:null }){
    try{
      const imageBlob = await fileToImageBlob(file);
      const txt = await recognizeWithTesseract(imageBlob || file, { lang: opts.lang, logger: opts.logger });
      lastOCR.quick = txt || '';
      lastOCR.enhanced = '';
      lastOCR.combined = lastOCR.quick;
      return { ...lastOCR };
    }catch(err){
      console.warn('runQuickOCROnly failed', err);
      return { ...lastOCR };
    }
  }

  window.OCR = {
    readPDFFile,
    pdfPageToImageBlob,
    fileToImageBlob,
    recognizeWithTesseract,
    recognizeEnhanced,
    runDualOCR,
    runQuickOCROnly,
    lastOCR
  };

})();
(function(){
  'use strict';

  function normalize(s){ return (s||'').replace(/\r/g,'').replace(/\t/g,' ').replace(/[ \u00A0]{2,}/g,' ').trim(); }
  function toLines(s){ return normalize(s).split(/\n/).map(l=>l.trim()).filter(Boolean); }

  function parseNumberString(s){
    if(!s) return null;
    let t = String(s).replace(/[^0-9,.\-]/g,'').trim();
    if(!t) return null;
    const lastDot = t.lastIndexOf('.'), lastComma = t.lastIndexOf(',');
    if(lastDot>-1 && lastComma>-1){
      if(lastDot>lastComma) t = t.replace(/,/g,'');
      else t = t.replace(/\./g,'').replace(',', '.');
    } else {
      t = t.replace(/,/g,'');
    }
    const m = t.match(/-?\d+(\.\d+)?/);
    if(!m) return null;
    const n = parseFloat(m[0]);
    if(isNaN(n)) return null;
    return Math.round(n*100);
  }

  function detectCurrency(text){
    if(!text) return 'INR';
    if(/[₹]/.test(text) || /\bINR\b/i.test(text) || /\bRs\.?\b/i.test(text)) return 'INR';
    if(/\$/.test(text)) return 'USD';
    if(/€/.test(text)) return 'EUR';
    if(/£/.test(text)) return 'GBP';
    return 'INR';
  }

  function formatCents(cents, currSymbol='₹'){
    if(cents===null||cents===undefined) return '-';
    const neg = cents<0;
    const v = Math.abs(Math.floor(cents));
    const intPart = Math.floor(v/100);
    const dec = String(v%100).padStart(2,'0');
    const intStr = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg?'-':'') + currSymbol + intStr + '.' + dec;
  }

  function tryParseDate(s){
    if(!s) return null;
    s = s.replace(/\./g,'/').replace(/(st|nd|rd|th)/gi,'');
    const rx1 = /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/;
    const rx2 = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;
    const rx3 = /([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})/;
    let m;
    if((m=s.match(rx1))){ const d=new Date(+m[1], +m[2]-1, +m[3]); return d.toISOString().slice(0,10); }
    if((m=s.match(rx2))){ let y=+m[3]; if(y<100) y += (y>=50?1900:2000); const d=new Date(y, +m[2]-1, +m[1]); return d.toISOString().slice(0,10); }
    if((m=s.match(rx3))){ const mon = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].slice(0,3).toLowerCase()); const d=new Date(+m[3], mon, +m[2]); return d.toISOString().slice(0,10); }
    const p = Date.parse(s); if(!isNaN(p)) return new Date(p).toISOString().slice(0,10);
    return null;
  }

  function extractMerchant(lines){
    for(let i=0;i<Math.min(lines.length,6);i++){
      const l = lines[i].replace(/\|/g,' ').trim();
      if(!l) continue;
      if(/invoice|bill|receipt|gst|tax|phone|tel|address|qty|item/i.test(l)) continue;
      if(/^[0-9\W]+$/.test(l)) continue;
      if(l.length < 2) continue;
      return l.replace(/[^A-Za-z0-9 &\-\.\,\/\(\)]/g,'').trim();
    }
    let best = '';
    for(const l of lines){ if(l.length > best.length && /[A-Za-z]/.test(l) && !/invoice|bill|receipt/i.test(l)) best = l; }
    return best || 'UNKNOWN';
  }

  function extractTotalFromText(raw){
    const lines = toLines(raw);
    const cand = [];
    for(let i=lines.length-1;i>=0 && i>lines.length-20;i--){
      const l = lines[i];
      if(/total|grand total|amount due|balance due|net amount|amount payable|invoice total/i.test(l) || /₹|\$|€|£|Rs\b|INR\b/i.test(l)){
        const nums = l.match(/-?[\d.,]+/g) || [];
        nums.forEach(n=>{ const p = parseNumberString(n); if(p!==null) cand.push(p); });
      }
    }
    if(cand.length) return { cents: Math.max(...cand), currency: detectCurrency(raw) };
    const all = (raw.match(/-?[\d,.]{2,}/g)||[]).map(n=>parseNumberString(n)).filter(Boolean);
    if(all.length) return { cents: Math.max(...all), currency: detectCurrency(raw) };
    return null;
  }

  function computeItemsSum(items){
    let s = 0;
    for(const it of items){
      if(it.total) s += it.total;
      else if(it.price) s += it.price * (it.qty||1);
    }
    return s;
  }

  function mapRowToItem(line, rawTextForCurrency){
    const numTokens = (line.match(/-?[\d.,]+(?:\.\d{1,2})?/g) || []).map(s=>parseNumberString(s)).filter(n=>n!==null);
    const currency = detectCurrency(line || rawTextForCurrency);
    let name = line.replace(/([₹$€£]?[-]?\d{1,3}(?:[0-9,]*)(?:\.\d{1,2})?)/g,' ').replace(/\s{2,}/g,' ').trim();
    if(name.length > 120) name = name.slice(0,120);
    const item = { name: name || '-', qty: null, price: null, total: null, currency };

    if(numTokens.length >= 3){
      let qtyIdx = -1;
      for(let i=0;i<numTokens.length;i++){
        const v = numTokens[i];
        if(Math.abs(v) < 10000 && v % 100 === 0){
          const units = Math.round(v/100);
          if(units>=1 && units<=200){ qtyIdx = i; break; }
        }
      }
      const last = numTokens[numTokens.length-1];
      item.total = last;
      for(let i=numTokens.length-2;i>=0;i--){
        const cand = numTokens[i];
        if(Math.abs(cand) < Math.max(10000000, Math.abs(last*2))){ item.price = cand; break; }
      }
      if(qtyIdx>=0) item.qty = Math.max(1, Math.round(numTokens[qtyIdx]/100));
      else if(item.price && item.total){
        const q = Math.round(item.total / item.price);
        if(q >= 1 && q <= 500) item.qty = q;
      }
    } else if(numTokens.length === 2){
      const a = numTokens[0], b = numTokens[1];
      if(b > a*1.1){
        item.price = a; item.total = b;
        if(item.price && item.price>0){
          const q = Math.round(item.total / item.price);
          if(q>=1 && q<=500) item.qty = q;
        }
      } else {
        if(a % 100 === 0 && Math.round(a/100) >= 1 && Math.round(a/100) <= 500){
          item.qty = Math.round(a/100);
          item.price = b;
          item.total = item.price * (item.qty || 1);
        } else {
          item.price = a; item.total = b;
        }
      }
    } else if(numTokens.length === 1){
      item.total = numTokens[0];
    } else {
      return null;
    }

    if(item.qty !== null) item.qty = Number(item.qty);
    if(item.price !== null) item.price = Number(item.price);
    if(item.total !== null) item.total = Number(item.total);
    if(item.price && !item.total) item.total = item.price * (item.qty || 1);
    if(item.total && !item.price && item.qty) item.price = Math.floor(item.total / (item.qty || 1));
    if(item.qty === null) item.qty = item.price ? Math.max(1, Math.round((item.total || item.price)/(item.price||1))) : 1;

    return item;
  }

  function mergeBrokenLines(lines){
    const merged = [];
    for(let i=0;i<lines.length;i++){
      const cur = lines[i];
      const next = lines[i+1] || '';
      const curHasNum = /[0-9]/.test(cur);
      const nextHasNum = /[0-9]/.test(next);
      if(!curHasNum && nextHasNum){
        merged.push((cur + ' ' + next).trim());
        i++;
      } else merged.push(cur);
    }
    const final = [];
    for(let i=0;i<merged.length;i++){
      const l = merged[i];
      if(i<merged.length-1 && /-$/.test(l.trim())){
        final.push((l.replace(/-+$/,'') + ' ' + merged[i+1]).trim());
        i++;
      } else final.push(l);
    }
    return final;
  }

  function parseRawInvoiceText(raw){
    raw = raw || '';
    const parsed = {
      id: 'bill-' + Date.now(),
      merchant: null,
      date: null,
      total: null,
      items: [],
      raw: raw,
      cleaned: null,
      issues: [],
      confidence: 0,
      created: Date.now(),
      display: {}
    };

    const lines = toLines(raw);
    if(lines.length === 0){
      parsed.issues.push({field:'raw', problem:'empty_text'});
      parsed.confidence = 0;
      parsed.display = { merchant:'-', date:'-', total:'-', items:[] };
      return parsed;
    }

    parsed.merchant = extractMerchant(lines);

    let foundDate = null;
    const dateCandidates = (raw.match(/(\d{1,2}[\/\-\.\s]\d{1,2}[\/\-\.\s]\d{2,4}|\d{4}[\/\-\.\s]\d{1,2}[\/\-\.\s]\d{1,2}|[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})/g) || []);
    for(const c of dateCandidates){ const d = tryParseDate(c); if(d){ foundDate = d; break; } }
    if(!foundDate){
      for(const l of lines){ const d = tryParseDate(l); if(d){ foundDate = d; break; } }
    }
    parsed.date = foundDate;

    const totalGuess = extractTotalFromText(raw);
    if(totalGuess) parsed.total = { cents: totalGuess.cents, currency: detectCurrency(raw) };
    else parsed.total = null;

    const merged = mergeBrokenLines(lines);
    const candidateRows = merged.map(l=>l.trim()).filter(l=> /[A-Za-z]/.test(l) && /[0-9]/.test(l));
    const items = [];
    for(const row of candidateRows){
      const it = mapRowToItem(row, raw);
      if(it) items.push(it);
    }

    if(items.length === 0){
      for(const l of merged){
        const nums = (l.match(/-?[\d.,]+(?:\.\d{1,2})?/g)||[]).map(s=>parseNumberString(s)).filter(n=>n!==null);
        if(nums.length >= 2 && /[A-Za-z]/.test(l)){
          const it = mapRowToItem(l, raw);
          if(it) items.push(it);
        }
      }
    }

    const cleaned = [];
    const seen = new Set();
    for(const it of items){
      const key = ((it.name||'').slice(0,40)) + '|' + (it.total||'') + '|' + (it.price||'');
      if(seen.has(key)) continue;
      seen.add(key);
      if(!it.total && !it.price) continue;
      cleaned.push(it);
    }
    parsed.items = cleaned;

    const sumItems = computeItemsSum(parsed.items);
    if(!parsed.total && sumItems>0) parsed.total = { cents: sumItems, currency: detectCurrency(raw), inferred:true };
    if(parsed.total && sumItems>0){
      if(Math.abs(parsed.total.cents - sumItems) > Math.max(200, Math.round(parsed.total.cents * 0.05))){
        parsed.mismatch = { total: parsed.total.cents, itemsSum: sumItems };
      }
    }

    if(!parsed.merchant || parsed.merchant==='UNKNOWN') parsed.issues.push({field:'merchant', problem:'missing'});
    if(!parsed.date) parsed.issues.push({field:'date', problem:'missing'});
    if(!parsed.total) parsed.issues.push({field:'total', problem:'missing'});
    if(!parsed.items || parsed.items.length===0) parsed.issues.push({field:'items', problem:'no_items'});

    let score = 10;
    if(parsed.merchant && parsed.merchant!=='UNKNOWN') score += 20;
    if(parsed.date) score += 15;
    if(parsed.total) score += 30;
    score += Math.min(25, (parsed.items? parsed.items.length*5 : 0));
    if(parsed.mismatch) score = Math.max(30, score - 20);
    parsed.confidence = Math.min(100, score);

    parsed.display = {
      merchant: parsed.merchant || '-',
      date: parsed.date || '-',
      total: parsed.total ? formatCents(parsed.total.cents, parsed.total.currency==='INR' ? '₹' : (parsed.total.currency==='USD' ? '$' : parsed.total.currency+' ')) : '-',
      items: (parsed.items || []).map(it=>({
        name: it.name || '-',
        qty: it.qty || 1,
        price: it.price ? formatCents(it.price, it.currency==='INR' ? '₹' : '$') : '-',
        total: it.total ? formatCents(it.total, it.currency==='INR' ? '₹' : '$') : '-'
      }))
    };

    parsed.cleaned = normalize(raw);

    return parsed;
  }

  window.Parser = {
    parseRawInvoiceText,
    _helpers: { normalize, toLines, parseNumberString, detectCurrency, formatCents, tryParseDate, mergeBrokenLines }
  };

})();
(function(){
  'use strict';

  const DB_NAME = 'anj_invoice_db';
  const STORE = 'invoices';
  const VERSION = 1;
  let db = null;

  function openDB(){
    return new Promise((res, rej)=>{
      if(db) return res(db);
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = e=>{
        const d = e.target.result;
        if(!d.objectStoreNames.contains(STORE)){
          const s = d.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('date', 'date', { unique:false });
          s.createIndex('merchant', 'merchant', { unique:false });
        }
      };
      req.onsuccess = e=>{ db = e.target.result; res(db); };
      req.onerror = e=> rej(e);
    });
  }

  function saveInvoice(inv){
    return new Promise(async (res, rej)=>{
      try{
        await openDB();
        const tx = db.transaction(STORE, 'readwrite');
        const st = tx.objectStore(STORE);
        const copy = JSON.parse(JSON.stringify(inv));
        if(!copy.id) copy.id = 'bill-' + Date.now();
        const putReq = st.put(copy);
        putReq.onsuccess = ()=> res(copy);
        putReq.onerror = e=> rej(e);
      }catch(e){ rej(e); }
    });
  }

  function loadAll(){
    return new Promise(async (res, rej)=>{
      try{
        await openDB();
        const tx = db.transaction(STORE, 'readonly');
        const st = tx.objectStore(STORE);
        const rq = st.getAll();
        rq.onsuccess = ()=> res(rq.result || []);
        rq.onerror = e=> rej(e);
      }catch(e){ rej(e); }
    });
  }

  function clearAll(){
    return new Promise(async (res, rej)=>{
      try{
        await openDB();
        const tx = db.transaction(STORE, 'readwrite');
        const st = tx.objectStore(STORE);
        const rq = st.clear();
        rq.onsuccess = ()=> res(true);
        rq.onerror = e=> rej(e);
      }catch(e){ rej(e); }
    });
  }

  async function renderHistory(container){
    if(!container) return;
    try{
      const list = await loadAll();
      if(!list || !list.length){ container.innerHTML = 'No history yet.'; return; }
      list.sort((a,b)=> (b.created||0) - (a.created||0));
      container.innerHTML = '';
      list.forEach(inv=>{
        const row = document.createElement('div');
        row.className = 'history-row';
        const left = document.createElement('div');
        left.innerHTML = `<strong>${inv.display?.merchant || inv.merchant || 'Invoice'}</strong><div class="muted">${inv.date || '-'}</div>`;
        const right = document.createElement('div');
        right.innerHTML = `${inv.display?.total || '-'}`;
        row.appendChild(left); row.appendChild(right);
        row.addEventListener('click', ()=>{
          try{ window.UI.loadFromHistory(inv); }catch(e){ console.warn(e); }
        });
        container.appendChild(row);
      });
    }catch(e){
      container.innerHTML = 'History load failed';
      console.warn(e);
    }
  }

  window.Storage = {
    openDB,
    saveInvoice,
    loadAll,
    clearAll,
    renderHistory
  };

})();
(function(){
  'use strict';

  // DOM refs (safe-get)
  const $ = id => document.getElementById(id);
  const fileInput = $('fileInput');
  const dualOCRBtn = $('dualOCRBtn');
  const ocrOnlyBtn = $('ocrOnlyBtn');
  const parseBtn = $('parseBtn');
  const statusBar = $('statusBar');
  const themeSelect = $('themeSelect');

  const merchantEl = $('merchant');
  const dateEl = $('date');
  const totalEl = $('total');
  const confidenceEl = $('confidence');
  const itemsTable = $('itemsTable');

  const rawTextEl = $('rawText');
  const cleanedTextEl = $('cleanedText');
  const issuesBox = $('issuesBox');
  const jsonPreviewEl = $('jsonPreview');

  const exportJsonBtn = $('exportJsonBtn');
  const exportTxtBtn = $('exportTxtBtn');
  const exportCsvBtn = $('exportCsvBtn');
  const exportPdfBtn = $('exportPdfBtn');
  const exportZipBtn = $('exportZipBtn');

  const loadHistoryBtn = $('loadHistoryBtn');
  const clearHistoryBtn = $('clearHistoryBtn');
  const historyList = $('historyList');
  const previewContainer = $('previewContainer');

  // state
  let current = null;
  let lastOCRtext = '';

  // helpers
  function setStatus(msg, ok=true){
    if(statusBar){ statusBar.textContent = msg; statusBar.style.color = ok ? '#117a46' : '#d02121'; }
    console.info('[ANJ]', msg);
  }

  function escapeHtml(s){ return String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function clearTable(el){ while(el && el.firstChild) el.removeChild(el.firstChild); }

  // render
  function renderInvoice(parsed){
    if(!parsed) return;
    current = parsed;
    window._ANJ = window._ANJ || {};
    window._ANJ.setCurrent = (inv)=>{ current = inv; };

    merchantEl && (merchantEl.textContent = parsed.display?.merchant || '-');
    dateEl && (dateEl.textContent = parsed.display?.date || '-');
    totalEl && (totalEl.textContent = parsed.display?.total || '-');
    confidenceEl && (confidenceEl.textContent = ((parsed.confidence||0) + '%'));

    if(itemsTable){
      clearTable(itemsTable);
      (parsed.display?.items || []).forEach(it=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(it.name)}</td><td>${escapeHtml(String(it.qty||''))}</td><td>${escapeHtml(it.price||'-')}</td><td>${escapeHtml(it.total||'-')}</td>`;
        itemsTable.appendChild(tr);
      });
    }

    rawTextEl && (rawTextEl.textContent = parsed.raw || lastOCRtext || '-');
    cleanedTextEl && (cleanedTextEl.textContent = parsed.cleaned || parsed.raw || '-');
    jsonPreviewEl && (jsonPreviewEl.textContent = JSON.stringify(parsed, null, 2));

    // issues
    if(issuesBox){
      issuesBox.innerHTML = '';
      if(parsed.issues && parsed.issues.length){
        parsed.issues.forEach(i=>{
          const d = document.createElement('div'); d.textContent = `${i.field} — ${i.problem}`; issuesBox.appendChild(d);
        });
      } else {
        if(parsed.mismatch){
          const d = document.createElement('div'); d.textContent = `Total mismatch: parsed ${parsed.mismatch.total} vs items ${parsed.mismatch.itemsSum}`; issuesBox.appendChild(d);
        } else issuesBox.textContent = 'No issues detected.';
      }
    }
  }

  // public loader when user clicks a history entry
  function loadFromHistory(inv){
    if(!inv) return;
    current = inv;
    lastOCRtext = inv.raw || '';
    renderInvoice(current);
    setStatus('Loaded from history', true);
  }

  // exporters
  function downloadFile(name, blob){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 3000);
  }

  function exportJSON(){
    if(!current) return setStatus('Nothing to export', false);
    const blob = new Blob([JSON.stringify(current, null, 2)], {type:'application/json'});
    downloadFile((current.display?.merchant||'invoice') + '_' + Date.now() + '.json', blob);
    setStatus('Exported JSON', true);
  }

  function exportTXT(){
    if(!current) return setStatus('Nothing to export', false);
    let txt = `Merchant: ${current.display?.merchant||'-'}\nDate: ${current.display?.date||'-'}\nTotal: ${current.display?.total||'-'}\n\nItems:\n`;
    (current.display?.items||[]).forEach(it=> txt += `- ${it.name} | Qty: ${it.qty} | ${it.price} | ${it.total}\n`);
    downloadFile((current.display?.merchant||'invoice') + '_' + Date.now() + '.txt', new Blob([txt], {type:'text/plain'}));
    setStatus('Exported TXT', true);
  }

  function exportCSV(){
    if(!current) return setStatus('Nothing to export', false);
    let csv = 'name,qty,price,total\n';
    (current.display?.items||[]).forEach(it=> csv += `"${(it.name||'').replace(/"/g,'""')}",${it.qty||''},"${(it.price||'').replace(/"/g,'""')}","${(it.total||'').replace(/"/g,'""')}"\n`);
    downloadFile((current.display?.merchant||'invoice') + '_' + Date.now() + '.csv', new Blob([csv], {type:'text/csv'}));
    setStatus('Exported CSV', true);
  }

  async function exportPDF(){
    if(!current) return setStatus('Nothing to export', false);
    if(typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') return setStatus('html2canvas/jsPDF required', false);
    const area = previewContainer || document.body;
    const canvas = await html2canvas(area, {scale:2});
    const img = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p','mm','a4');
    const w = pdf.internal.pageSize.getWidth();
    const h = (canvas.height / canvas.width) * w;
    pdf.addImage(img, 'PNG', 0, 0, w, h);
    pdf.save((current.display?.merchant||'invoice') + '_' + Date.now() + '.pdf');
    setStatus('Exported PDF', true);
  }

  async function exportZIP(){
    if(!current) return setStatus('Nothing to export', false);
    if(typeof JSZip === 'undefined') return setStatus('JSZip required', false);
    const zip = new JSZip();
    const base = (current.display?.merchant||'invoice') + '_' + Date.now();
    zip.file(base + '.json', JSON.stringify(current, null, 2));
    zip.file(base + '.txt', current.raw || '');
    zip.file(base + '.cleaned.txt', current.cleaned || '');
    let csv = 'name,qty,price,total\n';
    (current.display?.items || []).forEach(it => csv += `"${(it.name||'').replace(/"/g,'""')}",${it.qty||''},"${(it.price||'').replace(/"/g,'""')}","${(it.total||'').replace(/"/g,'""')}"\n`);
    zip.file(base + '.csv', csv);
    zip.file(base + '.tally.xml', generateTallyXML(current));
    const blob = await zip.generateAsync({type:'blob'});
    downloadFile(base + '.zip', blob);
    setStatus('Exported ZIP', true);
  }

  function generateTallyXML(inv){
    const company = (inv.display?.merchant || 'Company').replace(/&/g,'&amp;');
    const date = (inv.date || new Date().toISOString().slice(0,10)).replace(/-/g,'');
    const voucherNumber = inv.id || ('V' + Date.now());
    const total = inv.total ? (inv.total.cents/100).toFixed(2) : '0.00';
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<TALLYMESSAGE>
  <VOUCHER>
    <DATE>${date}</DATE>
    <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
    <PARTYNAME>${company}</PARTYNAME>
    <VOUCHERNUMBER>${voucherNumber}</VOUCHERNUMBER>
    <AMOUNT>${total}</AMOUNT>
    <ALLLEDGERS>`;
    (inv.items || inv.display?.items || []).forEach((it, idx)=>{
      const name = (it.name||`Item${idx+1}`).replace(/&/g,'&amp;');
      const amt = it.total ? (it.total/100).toFixed(2) : '0.00';
      xml += `<LEDGER><NAME>${name}</NAME><AMOUNT>${amt}</AMOUNT></LEDGER>`;
    });
    xml += `</ALLLEDGERS></VOUCHER></TALLYMESSAGE>`;
    return xml;
  }

  // UI wiring
  async function handleDualOCR(){
    const f = fileInput && fileInput.files && fileInput.files[0];
    if(!f) return setStatus('Choose a file first', false);
    try{
      setStatus('Running Dual OCR…');
      const res = await (window.OCR && window.OCR.runDualOCR ? window.OCR.runDualOCR(f) : Promise.reject('OCR missing'));
      lastOCRtext = (res && res.combined) || '';
      setStatus('OCR finished', true);
    }catch(e){
      console.error(e);
      setStatus('Dual OCR failed', false);
    }
  }

  async function handleQuickOCR(){
    const f = fileInput && fileInput.files && fileInput.files[0];
    if(!f) return setStatus('Choose a file first', false);
    try{
      setStatus('Running quick OCR…');
      const res = await (window.OCR && window.OCR.runQuickOCROnly ? window.OCR.runQuickOCROnly(f) : Promise.reject('OCR missing'));
      lastOCRtext = (res && res.combined) || '';
      setStatus('Quick OCR finished', true);
    }catch(e){
      console.error(e);
      setStatus('Quick OCR failed', false);
    }
  }

  async function handleParse(){
    const text = lastOCRtext || (fileInput && fileInput.files && fileInput.files[0] && await (window.OCR && window.OCR.readPDFFile ? window.OCR.readPDFFile(fileInput.files[0]) : ''));
    if(!text) return setStatus('No OCR text to parse — run OCR first', false);
    try{
      setStatus('Parsing invoice…');
      const parsed = window.Parser.parseRawInvoiceText(text);
      parsed.raw = text;
      parsed.created = Date.now();
      current = parsed;
      renderInvoice(parsed);
      // save to DB
      try{ await window.Storage.saveInvoice(parsed); }catch(e){ console.warn('save failed', e); }
      setStatus('Parsed and saved ✓', true);
    }catch(e){
      console.error(e);
      setStatus('Parse failed', false);
    }
  }

  // attach events
  function attach(){
    if(dualOCRBtn) dualOCRBtn.addEventListener('click', handleDualOCR);
    if(ocrOnlyBtn) ocrOnlyBtn.addEventListener('click', handleQuickOCR);
    if(parseBtn) parseBtn.addEventListener('click', handleParse);

    if(exportJsonBtn) exportJsonBtn.addEventListener('click', exportJSON);
    if(exportTxtBtn) exportTxtBtn.addEventListener('click', exportTXT);
    if(exportCsvBtn) exportCsvBtn.addEventListener('click', exportCSV);
    if(exportPdfBtn) exportPdfBtn.addEventListener('click', exportPDF);
    if(exportZipBtn) exportZipBtn.addEventListener('click', exportZIP);

    if(loadHistoryBtn) loadHistoryBtn.addEventListener('click', ()=> window.Storage.renderHistory(historyList));
    if(clearHistoryBtn) clearHistoryBtn.addEventListener('click', async ()=>{ await window.Storage.clearAll(); window.Storage.renderHistory(historyList); setStatus('History cleared', true); });

    if(themeSelect) themeSelect.addEventListener('change', ()=>{ const v = themeSelect.value; document.body.className = ''; document.body.classList.add('theme-' + v); try{ localStorage.setItem('anj_theme', v); }catch(e){} });
  }

  // public init
  async function init(){
    try{
      await window.Storage.openDB();
    }catch(e){ console.warn('DB init failed', e); }
    attach();
    try{ window.Storage.renderHistory(historyList); }catch(e){}
    setStatus('App ready ✓', true);
  }

  window.UI = {
    init,
    loadFromHistory
  };

})();
(function(){
  'use strict';
  function ready(fn){
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  ready(()=>{
    try{
      if(window.UI && typeof window.UI.init === 'function') window.UI.init();
      else console.warn('UI.init missing');
    }catch(e){ console.error(e); }
  });
})();
