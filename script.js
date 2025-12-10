/* final script.js - paste entire file to repo (overwrite) */
(function(){
  'use strict';

  /* ======= DOM refs ======= */
  const $ = id => document.getElementById(id);
  const fileInput = $('fileInput');
  const dualOCRBtn = $('dualOCRBtn');
  const ocrOnlyBtn = $('ocrOnlyBtn');
  const parseBtn = $('parseBtn');
  const statusBar = $('statusBar');

  const merchantEl = $('merchant');
  const dateEl = $('date');
  const totalEl = $('total');
  const categoryEl = $('category');
  const itemsTable = $('itemsTable');

  const rawTextEl = $('rawText');
  const cleanedTextEl = $('cleanedText');
  const issuesBox = $('issuesBox');
  const jsonPreview = $('jsonPreview');

  const exportJsonBtn = $('exportJsonBtn');
  const exportTxtBtn = $('exportTxtBtn');
  const exportCsvBtn = $('exportCsvBtn');
  const exportPdfBtn = $('exportPdfBtn');
  const exportZipBtn = $('exportZipBtn');

  const loadHistoryBtn = $('loadHistoryBtn');
  const clearHistoryBtn = $('clearHistoryBtn');
  const historyList = $('historyList');

  const themeSelect = $('themeSelect');

  /* ======= State ======= */
  let lastOCR = { quick: '', enhanced: '', combined: '' };
  let parsedResult = null;

  /* ======= IndexedDB simple wrapper ======= */
  const DB_NAME = 'anj_invoice_db';
  const DB_VER = 1;
  let db = null;
  function openDB(){ return new Promise((res,rej)=> {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = e=>{
      const d = e.target.result;
      if(!d.objectStoreNames.contains('invoices')){
        const s = d.createObjectStore('invoices',{ keyPath:'id' });
        s.createIndex('merchant','merchant',{unique:false});
        s.createIndex('date','date',{unique:false});
      }
    };
    r.onsuccess = e=>{ db = e.target.result; res(); };
    r.onerror = e=> rej(e);
  });}
  function addInvoice(rec){
    return new Promise((res,rej)=>{
      const tx = db.transaction('invoices','readwrite');
      const st = tx.objectStore('invoices');
      st.put(rec);
      tx.oncomplete = ()=>res();
      tx.onerror = e=>rej(e);
    });
  }
  function getAllInvoices(){ return new Promise((res,rej)=>{
    const tx = db.transaction('invoices','readonly');
    const st = tx.objectStore('invoices');
    const rq = st.getAll();
    rq.onsuccess = ()=>res(rq.result);
    rq.onerror = e=>rej(e);
  });}
  function clearInvoices(){ return new Promise((res,rej)=>{
    const tx = db.transaction('invoices','readwrite');
    const st = tx.objectStore('invoices');
    const rq = st.clear();
    rq.onsuccess = ()=>res();
    rq.onerror = e=>rej(e);
  });}

  /* ======= UI helpers ======= */
  function setStatus(msg, ok=true){
    if(!statusBar) return;
    statusBar.textContent = msg;
    statusBar.style.color = ok ? '#2ecc71' : '#e74c3c';
  }
  function downloadBlob(blob, name){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  /* ======= PDF text extraction via pdf.js ======= */
  async function extractTextFromPDF(file){
    try{
      const arr = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({data:arr}).promise;
      let txt = '';
      const maxPages = Math.min(pdf.numPages, 20);
      for(let i=1;i<=maxPages;i++){
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(it=>it.str).join(' ');
        txt += pageText + '\n';
      }
      return txt.trim();
    }catch(e){
      console.warn('PDF extract failed', e);
      return '';
    }
  }

  /* ======= render PDF page to image blob for OCR fallback ======= */
  async function pdfPageToImageBlob(file, pageNumber=1, scale=2){
    try{
      const arr = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({data:arr}).promise;
      const page = await pdf.getPage(Math.min(pageNumber, pdf.numPages));
      const viewport = page.getViewport({ scale: scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      return await new Promise(res=>canvas.toBlob(res, 'image/png'));
    }catch(e){
      console.warn('pdf->image failed', e);
      return null;
    }
  }

  /* ======= Tesseract v4 recognition wrapper (no createWorker) ======= */
  async function recognizeWithTesseract(blobOrFile){
    try{
      // Tesseract.recognize works with File/Blob or URL
      const res = await Tesseract.recognize(blobOrFile, 'eng');
      // v4: result has .data.text or .text depending on build; normalize
      const text = (res && (res.data && res.data.text || res.text)) || '';
      return text;
    }catch(e){
      console.warn('Tesseract recognize failed', e);
      return '';
    }
  }

  /* ======= file to image blob helper ======= */
  async function fileToImageBlob(file){
    if(file.type && file.type.startsWith('image/')) return file;
    // try to render first PDF page
    const b = await pdfPageToImageBlob(file,1,2);
    return b || file;
  }

  /* ======= Generic extraction for file ======= */
  async function extractTextFromFile(file){
    const name = (file.name||'').toLowerCase();
    if(name.endsWith('.txt') || file.type==='text/plain'){
      try{ return await file.text(); }catch(e){ return ''; }
    }
    if(name.endsWith('.pdf')){
      const pdfText = await extractTextFromPDF(file);
      return pdfText || '';
    }
    if(file.type && file.type.startsWith('image/')){
      // we'll run OCR when requested; return empty here
      return '';
    }
    return '';
  }

  /* ======= Parsing utilities ======= */
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
    return Math.round(n*100); // integer cents
  }

  function detectCurrency(text){
    if(!text) return 'INR';
    if(/[₹]/.test(text) || /\bINR\b/i.test(text) || /\bRs\.?\b/i.test(text)) return 'INR';
    if(/\$/.test(text)) return 'USD';
    if(/€/.test(text)) return 'EUR';
    if(/£/.test(text)) return 'GBP';
    return 'INR';
  }

  function formatCents(cents, curr='₹'){
    if(cents===null||cents===undefined) return '-';
    const neg = cents<0;
    const v = Math.abs(Math.floor(cents));
    const intPart = Math.floor(v/100);
    const dec = String(v%100).padStart(2,'0');
    const intStr = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg?'-':'') + curr + intStr + '.' + dec;
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
    for(let i=0;i<Math.min(lines.length,5);i++){
      const l = lines[i];
      if(!/invoice|bill|receipt|gst|tax|total|date|qty|amount|price/i.test(l) && /[A-Za-z0-9]/.test(l) && l.length>2){
        return l.replace(/[^A-Za-z0-9 &.,'\-\/()]/g,'').trim();
      }
    }
    for(const l of lines) if(/[A-Za-z]/.test(l)) return l;
    return 'UNKNOWN';
  }

  function extractTotalFromText(raw){
    const lines = toLines(raw);
    const cand = [];
    for(let i=lines.length-1;i>=0 && i>lines.length-15;i--){
      const l = lines[i];
      if(/total|grand total|amount due|balance due|net amount/i.test(l) || /₹|\$|Rs|INR|GBP|EUR|€|£/.test(l)){
        const nums = l.match(/-?[\d.,]+/g) || [];
        nums.forEach(n=>{ const p = parseNumberString(n); if(p!==null) cand.push(p); });
      }
    }
    if(cand.length) return { cents: Math.max(...cand), currency: detectCurrency(raw) };
    const all = (raw.match(/-?[\d,.]{2,}/g)||[]).map(n=>parseNumberString(n)).filter(Boolean);
    if(all.length) return { cents: Math.max(...all), currency: detectCurrency(raw) };
    return null;
  }

  function extractItemsFromText(raw){
    const lines = toLines(raw);
    const items = [];
    const rxFull = /^(.{2,60}?)\s+(\d+)\s+([₹$\€\£]?\s*[\d.,]+)\s+([₹$\€\£]?\s*[\d.,]+)$/;
    const rxTwo = /^(.{2,60}?)\s+([₹$\€\£]?\s*[\d.,]+)\s+([₹$\€\£]?\s*[\d.,]+)$/;
    const rxOne = /^(.{2,60}?)\s+([₹$\€\£]?\s*[\d.,]+)$/;
    for(const l of lines){
      let m;
      if((m=l.match(rxFull))){
        items.push({ name:m[1].trim(), qty: +m[2], price: parseNumberString(m[3]), total: parseNumberString(m[4]) });
        continue;
      }
      if((m=l.match(rxTwo))){
        items.push({ name:m[1].trim(), qty:1, price: parseNumberString(m[2]), total: parseNumberString(m[3]) });
        continue;
      }
      if((m=l.match(rxOne))){
        items.push({ name:m[1].trim(), qty:1, price: parseNumberString(m[2]), total: parseNumberString(m[2]) });
        continue;
      }
    }
    return items;
  }

  function computeItemsSum(items){
    let s = 0;
    for(const it of items){
      if(it.total) s += it.total;
      else if(it.price) s += it.price * (it.qty||1);
    }
    return s;
  }

  /* ======= Parser orchestration ======= */
  function parseRawInvoiceText(raw){
    const lines = toLines(raw);
    const merchant = extractMerchant(lines);
    // date search from whole text
    const dateMatches = (raw.match(/(\d{1,2}[\/\-\.\s]\d{1,2}[\/\-\.\s]\d{2,4}|\d{4}[\/\-\.\s]\d{1,2}[\/\-\.\s]\d{1,2}|[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})/g) || []);
    let parsedDate = null;
    for(const d of dateMatches){ const t = tryParseDate(d); if(t){ parsedDate = t; break; } }
    if(!parsedDate){
      for(const l of lines){ const t = tryParseDate(l); if(t){ parsedDate = t; break; } }
    }

    const total = extractTotalFromText(raw);
    const items = extractItemsFromText(raw);
    const parsed = { merchant, date: parsedDate, total, items, raw };

    const issues = [];
    if(!parsed.date) issues.push({field:'date',problem:'missing'});
    if(!parsed.merchant || parsed.merchant==='UNKNOWN') issues.push({field:'merchant',problem:'missing'});
    if(!parsed.items || parsed.items.length===0) issues.push({field:'items',problem:'no_items'});
    if(!parsed.total){
      const sum = computeItemsSum(parsed.items);
      if(sum>0) parsed.total = { cents: sum, currency: detectCurrency(raw), inferred:true };
      else issues.push({field:'total',problem:'missing'});
    } else {
      const sum = computeItemsSum(parsed.items);
      if(sum>0 && Math.abs(parsed.total.cents - sum) > Math.max(100, Math.round(parsed.total.cents*0.05))){
        parsed.mismatch = { total: parsed.total.cents, itemsSum: sum };
      }
    }

    parsed.confidence = Math.min(100, 10 + (parsed.merchant && parsed.merchant!=='UNKNOWN'?20:0) + (parsed.date?15:0) + (parsed.total?30:0) + Math.min(25, (parsed.items?parsed.items.length*5:0)));
    parsed.display = {
      merchant: parsed.merchant,
      date: parsed.date || '-',
      total: parsed.total ? formatCents(parsed.total.cents, parsed.total.currency==='INR'?'₹': (parsed.total.currency==='USD'?'$': parsed.total.currency+' ')) : '-',
      items: (parsed.items||[]).map(it=>({
        name: it.name || '-',
        qty: it.qty || 1,
        price: it.price ? formatCents(it.price, detectCurrency(raw)==='INR'?'₹':'$') : '-',
        total: it.total ? formatCents(it.total, detectCurrency(raw)==='INR'?'₹':'$') : '-'
      }))
    };

    parsed.issues = issues;
    parsed.created = Date.now();
    return parsed;
  }

  /* ======= Render functions ======= */
  function renderInvoicePreview(parsed){
    merchantEl.textContent = parsed.display.merchant || '-';
    dateEl.textContent = parsed.display.date || '-';
    totalEl.textContent = parsed.display.total || '-';
    categoryEl.textContent = parsed.category || '-';

    itemsTable.innerHTML = '';
    (parsed.display.items||[]).forEach(it=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(it.name)}</td><td>${escapeHtml(String(it.qty))}</td><td>${escapeHtml(it.price)}</td><td>${escapeHtml(it.total)}</td>`;
      itemsTable.appendChild(tr);
    });

    rawTextEl.textContent = lastOCR.combined || '';
    cleanedTextEl.textContent = parsed.raw || '';
    jsonPreview.textContent = JSON.stringify(parsed, null, 2);

    issuesBox.innerHTML = '';
    if((parsed.issues||[]).length===0 && !parsed.mismatch){
      issuesBox.textContent = 'No issues detected.';
    } else {
      (parsed.issues||[]).forEach(i=>{ const d=document.createElement('div'); d.textContent=`Issue: ${i.field} — ${i.problem}`; issuesBox.appendChild(d); });
      if(parsed.mismatch){ const d=document.createElement('div'); d.textContent=`Total mismatch: parsed total ${parsed.mismatch.total} vs items sum ${parsed.mismatch.itemsSum}`; issuesBox.appendChild(d); }
    }
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]); }

  /* ======= Exporters ======= */
  function filenameBase(){
    const name = parsedResult && parsedResult.merchant ? parsedResult.merchant.replace(/[^a-z0-9]/ig,'_') : 'invoice';
    return `${name}_${Date.now()}`;
  }
  function exportJSON(){ if(!parsedResult){ setStatus('Nothing to export', false); return; } downloadBlob(new Blob([JSON.stringify(parsedResult,null,2)],{type:'application/json'}), filenameBase()+'.json'); }
  function exportTXT(){ if(!parsedResult){ setStatus('Nothing to export', false); return; } downloadBlob(new Blob([parsedResult.raw||lastOCR.combined||''],{type:'text/plain'}), filenameBase()+'.txt'); }
  function exportCSV(){ if(!parsedResult){ setStatus('Nothing to export', false); return; } let csv='Name\tQty\tPrice\tTotal\n'; (parsedResult.display.items||[]).forEach(it=>csv+=`${it.name}\t${it.qty}\t${it.price}\t${it.total}\n`); downloadBlob(new Blob([csv],{type:'text/tab-separated-values'}), filenameBase()+'.tsv'); }
  async function exportPDF(){ if(!parsedResult){ setStatus('Nothing to export', false); return; } try{ const canvas=await html2canvas(document.querySelector('#previewContainer')||document.body,{scale:2}); const img=canvas.toDataURL('image/png'); const { jsPDF } = window.jspdf; const pdf=new jsPDF('p','pt','a4'); const pad=20; const w=pdf.internal.pageSize.getWidth()-pad*2; const h=(canvas.height* w)/canvas.width; pdf.addImage(img,'PNG',pad,pad,w,h); pdf.save(filenameBase()+'.pdf'); }catch(e){ console.error(e); setStatus('PDF export failed', false); } }
  async function exportZIP(){ if(!parsedResult){ setStatus('Nothing to export', false); return; } try{ const zip = new JSZip(); zip.file(filenameBase()+'.json', JSON.stringify(parsedResult,null,2)); zip.file(filenameBase()+'.txt', parsedResult.raw||lastOCR.combined||''); let tsv='Name\tQty\tPrice\tTotal\n'; (parsedResult.display.items||[]).forEach(it=>tsv+=`${it.name}\t${it.qty}\t${it.price}\t${it.total}\n`); zip.file(filenameBase()+'.tsv', tsv); const canvas=await html2canvas(document.querySelector('#previewContainer')||document.body,{scale:2}); const img = canvas.toDataURL('image/png').split(',')[1]; zip.file('preview.png', img, {base64:true}); const blob = await zip.generateAsync({type:'blob'}); downloadBlob(blob, filenameBase()+'_bundle.zip'); }catch(e){ console.error(e); setStatus('ZIP failed', false); } }

  /* ======= History UI ======= */
  async function renderHistory(){
    try{
      const all = await getAllInvoices();
      historyList.innerHTML = '';
      if(!all.length){ historyList.textContent = 'No history yet.'; return; }
      all.sort((a,b)=> b.created - a.created);
      all.forEach(inv=>{
        const row = document.createElement('div'); row.className='history-row';
        const left = document.createElement('div'); left.textContent = (inv.merchant||'Unknown')+' — '+(inv.date||'No Date');
        const right = document.createElement('div'); right.textContent = inv.total ? (inv.total.currency?inv.total.currency:'') : '-';
        row.appendChild(left); row.appendChild(right);
        row.addEventListener('click', ()=>{ parsedResult = inv; lastOCR.combined = inv.raw || ''; rawTextEl.textContent = lastOCR.combined; cleanedTextEl.textContent = inv.raw || ''; renderInvoicePreview(parsedResult); setStatus('Loaded from history', true); });
        historyList.appendChild(row);
      });
    }catch(e){ console.error(e); historyList.textContent='History load failed'; }
  }

  /* ======= Theme engine ======= */
  const themeMap = { rose:'theme-rose', lilac:'theme-lilac', cotton:'theme-cotton', galaxy:'theme-galaxy', blush:'theme-blush', fairy:'theme-fairy' };
  function applyTheme(v){ Object.values(themeMap).forEach(c=>document.body.classList.remove(c)); document.body.classList.add(themeMap[v] || 'theme-rose'); try{ localStorage.setItem('anj_theme', v); }catch(e){} }
  function loadTheme(){ try{ const t = localStorage.getItem('anj_theme') || 'rose'; themeSelect.value = t; applyTheme(t); }catch(e){ applyTheme('rose'); } }

  /* ======= Dual OCR flow (C) ======= */
  async function runDualOCR(file){
    setStatus('Starting Dual OCR...');
    lastOCR = { quick:'', enhanced:'', combined:'' };
    let pdfText = '';
    if(file.name && file.name.toLowerCase().endsWith('.pdf')){
      pdfText = await extractTextFromPDF(file);
    }
    // Quick OCR on image/page
    const imageBlob = await fileToImageBlob(file);
    if(imageBlob){
      setStatus('Running quick OCR...');
      lastOCR.quick = await recognizeWithTesseract(imageBlob);
    } else lastOCR.quick = '';

    // Enhanced OCR (second pass) - here we run again; v4 has no worker options so we run same API
    setStatus('Running enhanced OCR...');
    lastOCR.enhanced = await recognizeWithTesseract(imageBlob || file);

    // Combine: prefer pdfText first, then enhanced, then quick
    lastOCR.combined = [pdfText, lastOCR.enhanced, lastOCR.quick].filter(Boolean).join('\n\n');
    setStatus('Dual OCR complete', true);
    rawTextEl.textContent = lastOCR.combined;
    return lastOCR.combined;
  }

  async function runQuickOCROnly(file){
    setStatus('Running quick OCR...');
    const imageBlob = await fileToImageBlob(file);
    const text = await recognizeWithTesseract(imageBlob || file);
    lastOCR = { quick:text, enhanced:'', combined:text };
    rawTextEl.textContent = text;
    setStatus('Quick OCR complete', true);
    return text;
  }

  /* ======= UI button handlers ======= */
  dualOCRBtn.addEventListener('click', async ()=>{
    const f = fileInput.files[0];
    if(!f){ setStatus('Choose a file first', false); return; }
    try{
      const txt = await runDualOCR(f);
      setStatus('OCR finished — ready to parse', true);
    }catch(e){ 
    console.error(e); 
    setStatus('Dual OCR failed', false); 
  }
});

/* Quick OCR Only */
ocrOnlyBtn.addEventListener('click', async ()=>{
  const f = fileInput.files[0];
  if(!f){ 
    setStatus('Choose a file first', false); 
    return; 
  }
  try{
    await runQuickOCROnly(f);
  }catch(e){
    console.error(e);
    setStatus('Quick OCR failed', false);
  }
});

/* Parse Button */
parseBtn.addEventListener('click', async ()=>{
  if(!lastOCR.combined){
    setStatus('Run OCR first', false);
    return;
  }
  try{
    setStatus('Parsing invoice...');
    const parsed = parseRawInvoiceText(lastOCR.combined);
    parsed.raw = lastOCR.combined;
    parsed.created = Date.now();
    parsedResult = parsed;
    await addInvoice(parsed);
    renderInvoicePreview(parsed);
    await renderHistory();
    setStatus('Parsed and saved ✓', true);
  }catch(e){
    console.error(e);
    setStatus('Parse failed', false);
  }
});

/* Export Buttons */
exportJsonBtn.addEventListener('click', exportJSON);
exportTxtBtn.addEventListener('click', exportTXT);
exportCsvBtn.addEventListener('click', exportCSV);
exportPdfBtn.addEventListener('click', exportPDF);
exportZipBtn.addEventListener('click', exportZIP);

/* History */
loadHistoryBtn.addEventListener('click', async ()=>{
  await renderHistory();
});
clearHistoryBtn.addEventListener('click', async ()=>{
  await clearInvoices(); 
  await renderHistory();
});

/* Theme Change */
themeSelect.addEventListener('change', ()=>{
  applyTheme(themeSelect.value);
  localStorage.setItem('theme_mode', themeSelect.value);
});

/* ======= INIT ======= */
(async function init(){
  try{
    await openDB();
    loadTheme();
    await renderHistory();
    setStatus('Ready ✓', true);
  }catch(e){
    console.error('Init failed', e);
    setStatus('Initialization failed', false);
  }
})();
})();
