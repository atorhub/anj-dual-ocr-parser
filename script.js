(async function(){
  /* helpers */
  const $ = id => document.getElementById(id);

  /* DOM (matches your index.html) */
  const fileInput = $('fileInput');
  const dualOCRBtn = $('dualOCRBtn');
  const ocrOnlyBtn = $('ocrOnlyBtn');
  const parseBtn = $('parseBtn');
  const statusBar = $('statusBar');

  const previewContainer = $('previewContainer');
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

  /* state */
  let lastOCR = { quick: '', enhanced: '', combined: '' };
  let parsedResult = null;

  /* IndexedDB setup */
  const DB_NAME = 'anj_invoice_db';
  const DB_VER = 1;
  let db = null;
  function openDB(){
    return new Promise((res,rej)=>{
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
    });
  }
  function addInvoice(record){
    return new Promise((res,rej)=>{
      const tx = db.transaction('invoices','readwrite');
      const st = tx.objectStore('invoices');
      st.put(record);
      tx.oncomplete = ()=>res();
      tx.onerror = e=>rej(e);
    });
  }
  function getAllInvoices(){
    return new Promise((res,rej)=>{
      const tx = db.transaction('invoices','readonly');
      const st = tx.objectStore('invoices');
      const rq = st.getAll();
      rq.onsuccess = ()=>res(rq.result);
      rq.onerror = e=>rej(e);
    });
  }
  function clearInvoices(){
    return new Promise((res,rej)=>{
      const tx = db.transaction('invoices','readwrite');
      const st = tx.objectStore('invoices');
      const rq = st.clear();
      rq.onsuccess = ()=>res();
      rq.onerror = e=>rej(e);
    });
  }

  /* status util */
  function setStatus(text, ok=true){
    if(!statusBar) return;
    statusBar.textContent = text;
    statusBar.style.color = ok ? '#2ecc71' : '#e74c3c';
  }

  /* PDF extraction */
  async function extractTextFromPDF(file){
    try{
      const arr = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({data:arr}).promise;
      let txt = '';
      for(let i=1;i<=Math.min(pdf.numPages,20);i++){
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        txt += content.items.map(it=>it.str).join(' ') + '\n';
      }
      return txt.trim();
    }catch(e){
      console.warn('pdf extract failed',e);
      return '';
    }
  }

  /* OCR - robust: tries worker; fallback to Tesseract.recognize if needed */
  async function runTesseractRecognize(file, opts={}){
    try{
      if(typeof Tesseract.createWorker === 'function'){
        const w = Tesseract.createWorker({ logger: m=>{} });
        await w.load();
        await w.loadLanguage('eng');
        await w.initialize('eng');
        if(opts.params) await w.setParameters(opts.params);
        const { data } = await w.recognize(file, 'eng');
        await w.terminate();
        return { text: data.text || '', conf: data.confidence || 0 };
      } else if(typeof Tesseract.recognize === 'function'){
        const { data } = await Tesseract.recognize(file, 'eng');
        return { text: data.text || '', conf: data.confidence || 0 };
      } else {
        return { text: '', conf: 0 };
      }
    }catch(err){
      console.warn('tesseract worker failed, fallback',err);
      try{
        if(typeof Tesseract.recognize === 'function'){
          const { data } = await Tesseract.recognize(file, 'eng');
          return { text: data.text || '', conf: data.confidence || 0 };
        }
      }catch(e2){
        console.error('tesseract fallback failed',e2);
      }
      return { text:'', conf:0 };
    }
  }

  /* image -> blob helper if file is pdf etc */
  async function fileToImageBlob(file){
    // if already image, return as is
    if(file.type && file.type.startsWith('image/')) return file;
    // else render first PDF page to canvas using pdf.js, then blob
    try{
      const arr = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({data:arr}).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      return await new Promise(res=>canvas.toBlob(res,'image/png'));
    }catch(e){
      console.warn('render to image failed',e);
      return file;
    }
  }

  /* extractTextFromFile that handles pdf,txt,image */
  async function extractTextFromFile(file){
    const name = (file.name||'').toLowerCase();
    if(name.endsWith('.txt') || file.type==='text/plain'){
      try{ return await file.text(); }catch(e){return '';}
    }
    if(name.endsWith('.pdf')){
      const pdfText = await extractTextFromPDF(file);
      return pdfText || '';
    }
    // image
    if(file.type && file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(name)){
      // do OCR directly, but we'll let caller choose quick/enhanced
      return '';
    }
    return '';
  }

  /* parsing helpers (clean, lines) */
  function normalizeWhitespace(s){ return (s||'').replace(/\r\n/g,'\n').replace(/\t/g,' ').replace(/[ \u00A0]{2,}/g,' ').trim(); }
  function toLines(text){ return normalizeWhitespace(text).split(/\n/).map(l=>l.trim()).filter(Boolean); }

  /* number parsing => returns bigint cents or null */
  function parseNumberString(numStr){
    if(!numStr) return null;
    let s = String(numStr).replace(/[^\d,.\-]/g,'').trim();
    if(!s) return null;
    // unify separators: if both ',' and '.' present, assume last is decimal
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if(lastDot>-1 && lastComma>-1){
      if(lastDot>lastComma){
        s = s.replace(/,/g,'');
      } else {
        s = s.replace(/\./g,'').replace(',', '.');
      }
    } else {
      s = s.replace(/,/g,'');
    }
    // reduce to numeric
    const m = s.match(/-?\d+(\.\d+)?/);
    if(!m) return null;
    const n = parseFloat(m[0]);
    if(isNaN(n)) return null;
    const cents = BigInt(Math.round(n*100));
    return cents;
  }
  function centsToString(cents, symbol='₹'){
    if(cents===null||cents===undefined) return '-';
    const neg = cents<0n;
    const v = neg ? -cents : cents;
    const intPart = v/100n;
    const dec = v%100n;
    const intStr = String(intPart);
    let withCommas='';
    for(let i=intStr.length-1, c=0;i>=0;i--,c++){
      withCommas = intStr[i]+withCommas;
      if((c+1)%3===0 && i>0) withCommas=','+withCommas;
    }
    return (neg?'-':'') + symbol + withCommas + '.' + String(dec).padStart(2,'0');
  }

  function detectCurrencySymbol(text){
    if(!text) return 'INR';
    if(/[₹]/.test(text) || /\bINR\b/i.test(text) || /\bRs\.?\b/i.test(text)) return 'INR';
    if(/\$/.test(text)) return 'USD';
    if(/€/.test(text)) return 'EUR';
    if(/£/.test(text)) return 'GBP';
    return 'INR';
  }

  /* date parsing (flexible) */
  function tryParseDateCandidates(s){
    if(!s) return null;
    s = s.replace(/\./g,'/').replace(/st|nd|rd|th/gi,'');
    const rx1 = /\b(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/;
    const rx2 = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/;
    const rx3 = /\b([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})\b/;
    let m;
    if((m=s.match(rx1))){
      const yyyy=+m[1], mm=+m[2], dd=+m[3];
      const d=new Date(yyyy,mm-1,dd);
      if(d.getFullYear()===yyyy && d.getMonth()===mm-1) return d.toISOString().slice(0,10);
    }
    if((m=s.match(rx2))){
      let d=+m[1], mo=+m[2], y=+m[3];
      if(y<100) y += (y>=50?1900:2000);
      const d1=new Date(y,mo-1,d);
      const d2=new Date(y,d-1,mo);
      if(d1.getFullYear()===y && d1.getMonth()===mo-1) return d1.toISOString().slice(0,10);
      if(d2.getFullYear()===y && d2.getMonth()===d-1) return d2.toISOString().slice(0,10);
    }
    if((m=s.match(rx3))){
      const moNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      const mo = moNames.indexOf(m[1].slice(0,3).toLowerCase())+1;
      const dd = +m[2], yyyy = +m[3];
      const d = new Date(yyyy,mo-1,dd);
      if(d.getFullYear()===yyyy) return d.toISOString().slice(0,10);
    }
    const parsed = Date.parse(s);
    if(!isNaN(parsed)) return new Date(parsed).toISOString().slice(0,10);
    return null;
  }

  /* extract merchant (first lines) */
  function extractMerchant(lines){
    for(let i=0;i<Math.min(lines.length,5);i++){
      const l = lines[i];
      if(!/invoice|bill|receipt|gst|tax|total|date|qty|amount|price/i.test(l) && /[A-Za-z0-9]/.test(l) && l.length>2){
        return l.replace(/[^A-Za-z0-9 \-&.,']/g,'').trim();
      }
    }
    for(const l of lines) if(/[A-Za-z]/.test(l)) return l;
    return 'UNKNOWN';
  }

  /* extract total */
  function extractTotal(raw){
    const lines = toLines(raw);
    const candidates = [];
    for(let i=lines.length-1;i>=0;i--){
      const l = lines[i];
      if(/grand total|total payable|total amount|amount due|balance due|net total|total/i.test(l) || i>lines.length-6){
        const nums = l.match(/-?[\d.,]{1,}/g);
        if(nums){
          for(const n of nums){
            const c = parseNumberString(n);
            if(c!==null) candidates.push(c);
          }
        }
      }
    }
    if(candidates.length) return { cents: candidates.reduce((a,b)=> a> b? a: b), currency: detectCurrencySymbol(raw) };
    const all = (raw.match(/-?[\d,.]{2,}/g)||[]).map(n=>parseNumberString(n)).filter(Boolean);
    if(all.length) return { cents: all.reduce((a,b)=> a> b? a: b), currency: detectCurrencySymbol(raw) };
    return null;
  }

  /* extract items - best effort */
  function extractItems(raw){
    const lines = toLines(raw);
    const items = [];
    const rxFull = /^(.{2,70}?)\s+(\d+)\s+([₹$\€\£]?\s*[\d.,]+)\s+([₹$\€\£]?\s*[\d.,]+)$/;
    const rxTwo = /^(.{2,70}?)\s+([₹$\€\£]?\s*[\d.,]+)\s+([₹$\€\£]?\s*[\d.,]+)$/;
    const rxOne = /^(.{2,70}?)\s+([₹$\€\£]?\s*[\d.,]+)$/;
    for(const l of lines){
      let m;
      if((m=l.match(rxFull))){
        items.push({ name: m[1].trim(), qty: +m[2], price: parseNumberString(m[3]), total: parseNumberString(m[4]) });
        continue;
      }
      if((m=l.match(rxTwo))){
        items.push({ name: m[1].trim(), qty:1, price: parseNumberString(m[2]), total: parseNumberString(m[3]) });
        continue;
      }
      if((m=l.match(rxOne))){
        items.push({ name: m[1].trim(), qty:1, price: parseNumberString(m[2]), total: parseNumberString(m[2]) });
        continue;
      }
    }
    return items;
  }

  function computeItemsSum(items){
    let sum = 0n;
    for(const it of items){
      if(it.total!==undefined && it.total!==null) sum += BigInt(it.total);
      else if(it.price && it.qty) sum += BigInt(it.price) * BigInt(it.qty);
      else if(it.price) sum += BigInt(it.price);
    }
    return sum;
  }

  /* main parse pipeline */
  function parseRawInvoiceText(raw, meta={quickConf:30,enhancedConf:30}){
    const lines = toLines(raw);
    const merchant = extractMerchant(lines);
    const date = (function(){
      const dateRx = /(\b(?:\d{1,2}[\/\-\.\s]\d{1,2}[\/\-\.\s]\d{2,4}|\d{4}[\/\-\.\s]\d{1,2}[\/\-\.\s]\d{1,2}|[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})\b)/g;
      const m = raw.match(dateRx) || [];
      for(const mm of m){
        const p = tryParseDateCandidates(mm);
        if(p) return p;
      }
      for(const l of lines){
        const p = tryParseDateCandidates(l);
        if(p) return p;
      }
      return null;
    })();
    const total = extractTotal(raw);
    const items = extractItems(raw);
    const parsed = { merchant, date, total, items, raw };
    // basic validation & correction
    const issues = [], corrections = [];
    if(!parsed.date) issues.push({field:'date',problem:'missing_or_unrecognized'});
    if(!parsed.merchant || parsed.merchant==='UNKNOWN') issues.push({field:'merchant',problem:'missing'});
    if(!parsed.items || parsed.items.length===0) issues.push({field:'items',problem:'no_items_detected'});
    if(!parsed.total){
      // infer from items
      const sum = computeItemsSum(parsed.items);
      if(sum>0n){
        parsed.total = { cents: sum, currency: detectCurrencySymbol(raw) };
        corrections.push({ field:'total', from:null, to: String(sum) });
      } else {
        issues.push({ field:'total', problem:'missing_total' });
      }
    } else {
      // compare item sum to total
      const sum = computeItemsSum(parsed.items);
      const diff = parsed.total.cents - sum;
      const absDiff = diff<0n ? -diff : diff;
      const tol = parsed.total.cents/100n > 100n ? parsed.total.cents/100n : 100n;
      if(absDiff > tol){
        corrections.push({ field:'total', from: String(parsed.total.cents), to: String(sum), reason:'items_sum_mismatch' });
        parsed.correctedTotal = sum;
      } else {
        parsed.correctedTotal = parsed.total.cents;
      }
    }
    parsed.issues = issues;
    parsed.corrections = corrections;
    parsed.confidence = Math.min(100, 10 + (parsed.merchant && parsed.merchant!=='UNKNOWN'?20:0) + (parsed.date?15:0) + (parsed.total?30:0) + Math.min(25,(parsed.items?parsed.items.length*5:0)));
    parsed.display = {
      merchant: parsed.merchant,
      date: parsed.date || '-',
      total: parsed.correctedTotal ? centsToString(parsed.correctedTotal, parsed.total? detectCurrencySymbol(raw) : '₹') : '-',
      items: (parsed.items||[]).map(it=>({
        name: it.name||'-',
        qty: it.qty||1,
        price: it.price ? centsToString(BigInt(it.price), detectCurrencySymbol(raw)) : '-',
        total: it.total ? centsToString(BigInt(it.total), detectCurrencySymbol(raw)) : '-'
      }))
    };
    return parsed;
  }

  /* UI renderers */
  function renderInvoicePreview(parsed){
    merchantEl.textContent = parsed.display.merchant || '-';
    dateEl.textContent = parsed.display.date || '-';
    totalEl.textContent = parsed.display.total || '-';
    categoryEl.textContent = parsed.category || '-';

    itemsTable.innerHTML = '';
    for(const it of (parsed.display.items||[])){
      const tr = document.createElement('tr');
      const td1 = document.createElement('td'); td1.textContent = it.name;
      const td2 = document.createElement('td'); td2.textContent = it.qty;
      const td3 = document.createElement('td'); td3.textContent = it.price;
      const td4 = document.createElement('td'); td4.textContent = it.total;
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4);
      itemsTable.appendChild(tr);
    }
    rawTextEl.textContent = lastOCR.combined || '';
    cleanedTextEl.textContent = parsed.raw || '';
    jsonPreview.textContent = JSON.stringify(parsed, null, 2);

    issuesBox.innerHTML = '';
    if((parsed.issues||[]).length===0 && (parsed.corrections||[]).length===0){
      issuesBox.textContent = 'No issues detected.';
    } else {
      for(const i of (parsed.issues||[])){
        const d = document.createElement('div'); d.textContent = `Issue: ${i.field} — ${i.problem||''}`; issuesBox.appendChild(d);
      }
      for(const c of (parsed.corrections||[])){
        const d = document.createElement('div'); d.textContent = `Correction: ${c.field} → ${c.to}`; issuesBox.appendChild(d);
      }
    }
  }

  /* export utilities */
  function filenameBase(){
    const name = (parsedResult && parsedResult.merchant) ? parsedResult.merchant.replace(/[^a-z0-9]/ig,'_') : 'invoice';
    return `${name}_${Date.now()}`;
  }
  function downloadBlob(blob, name){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  function exportJSON(){
    if(!parsedResult) { setStatus('Nothing parsed to export', false); return; }
    const b = new Blob([JSON.stringify(parsedResult,null,2)], {type:'application/json'});
    downloadBlob(b, filenameBase()+'.json');
  }
  function exportTXT(){
    if(!parsedResult) { setStatus('Nothing parsed to export', false); return; }
    const b = new Blob([parsedResult.raw || lastOCR.combined || ''], {type:'text/plain'});
    downloadBlob(b, filenameBase()+'.txt');
  }
  function exportCSV(){
    if(!parsedResult) { setStatus('Nothing parsed to export', false); return; }
    let csv = 'Name\tQty\tPrice\tTotal\n';
    for(const it of parsedResult.display.items || []) csv += `${it.name}\t${it.qty}\t${it.price}\t${it.total}\n`;
    const b = new Blob([csv], {type:'text/tab-separated-values'});
    downloadBlob(b, filenameBase()+'.tsv');
  }
  async function exportPDF(){
    if(!parsedResult) { setStatus('Nothing parsed to export', false); return; }
    try{
      const canvas = await html2canvas(previewContainer, {scale:2});
      const img = canvas.toDataURL('image/png');
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p','pt','a4');
      const pageW = pdf.internal.pageSize.getWidth()-40;
      const ratio = canvas.width / canvas.height;
      let h = pageW / ratio;
      pdf.addImage(img, 'PNG', 20, 20, pageW, h);
      pdf.save(filenameBase()+'.pdf');
    }catch(e){ setStatus('PDF export failed', false); console.error(e); }
  }
  async function exportZIP(){
    if(!parsedResult) { setStatus('Nothing parsed to export', false); return; }
    try{
      const zip = new JSZip();
      zip.file(filenameBase()+'.json', JSON.stringify(parsedResult,null,2));
      zip.file(filenameBase()+'.txt', parsedResult.raw || lastOCR.combined || '');
      let tsv = 'Name\tQty\tPrice\tTotal\n';
      for(const it of parsedResult.display.items || []) tsv += `${it.name}\t${it.qty}\t${it.price}\t${it.total}\n`;
      zip.file(filenameBase()+'.tsv', tsv);
      const canvas = await html2canvas(previewContainer, {scale:2});
      const img = canvas.toDataURL('image/png').split(',')[1];
      zip.file('preview.png', img, {base64:true});
      const blob = await zip.generateAsync({type:'blob'});
      downloadBlob(blob, filenameBase()+'_bundle.zip');
    }catch(e){ setStatus('ZIP export failed', false); console.error(e); }
  }

  /* history rendering */
  async function renderHistory(){
    try{
      const all = await getAllInvoices();
      historyList.innerHTML = '';
      if(!all.length){ historyList.textContent = 'No history yet.'; return; }
      all.sort((a,b)=> b.created - a.created);
      for(const inv of all){
        const row = document.createElement('div'); row.className='history-row';
        const left = document.createElement('div'); left.textContent = (inv.merchant||'Unknown') + ' — ' + (inv.date||'No Date');
        const right = document.createElement('div'); right.textContent = inv.total ? inv.total : '-';
        row.appendChild(left); row.appendChild(right);
        row.addEventListener('click', ()=>{
          parsedResult = inv;
          lastOCR.combined = inv.raw || '';
          
