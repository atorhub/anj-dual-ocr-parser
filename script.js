(function(){
  'use strict';

  const lastOCR = { quick:'', enhanced:'', combined:'' };

  // small helpers
  const wait = ms => new Promise(r=>setTimeout(r, ms||0));
  function escapeRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

  // currency map
  const CURRENCY_MAP = [
    { code:'INR', symbols:['₹','INR','Rs','Rs.'], out:'₹' },
    { code:'USD', symbols:['$','USD','US$'], out:'$' },
    { code:'EUR', symbols:['€','EUR'], out:'€' },
    { code:'GBP', symbols:['£','GBP'], out:'£' },
    { code:'AED', symbols:['د.إ','AED'], out:'د.إ' },
    { code:'JPY', symbols:['¥','JPY'], out:'¥' },
    { code:'CNY', symbols:['元','CNY'], out:'¥' },
    { code:'SGD', symbols:['S$','SGD'], out:'S$' },
    { code:'AUD', symbols:['A$','AUD'], out:'A$' },
    { code:'CAD', symbols:['C$','CAD'], out:'C$' }
  ];
  function detectCurrencyFromText(s){
    if(!s) return null;
    for(const c of CURRENCY_MAP){
      for(const sym of c.symbols){
        if(new RegExp(escapeRegex(sym),'i').test(s)) return c;
      }
    }
    return null;
  }
  function detectCurrencyPreferContext(raw, contextLine){
    const tryLine = v => { const c = detectCurrencyFromText(v); if(c) return c; return null; };
    if(contextLine){ const c = tryLine(contextLine); if(c) return c; }
    const lines = (''+raw).split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    for(const l of lines.slice(-15)) { const c = tryLine(l); if(c) return c; }
    for(const l of lines.slice(0,8)) { const c = tryLine(l); if(c) return c; }
    return CURRENCY_MAP[0];
  }
  function formatCents(cents, currency){
    const curr = (typeof currency === 'string') ? (CURRENCY_MAP.find(x=>x.code===currency)||CURRENCY_MAP[0]) : (currency||CURRENCY_MAP[0]);
    const sym = curr.out||curr.code||'';
    if(cents===null||cents===undefined) return '-';
    const neg = cents<0?'-':'';
    const v = Math.abs(Math.floor(cents));
    const intPart = Math.floor(v/100);
    const dec = String(v%100).padStart(2,'0');
    const intStr = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${neg}${sym}${intStr}.${dec}`;
  }

  // OCR text normalization
  function normalizeOCRText(txt){
    if(!txt) return '';
    let s = String(txt);
    s = s.replace(/\r\n?/g,'\n');
    s = s.replace(/O(?=\d{2,})/g,'0');
    s = s.replace(/\bI\b/g,'1');
    s = s.replace(/[^\S\r\n]+/g,' ');
    s = s.replace(/([^\w\s\.\,₹\$€£]+)/g,'');
    s = s.split('\n').map(l=>l.trim()).filter(Boolean).join('\n');
    return s;
  }

  // Canvas helpers
  function canvasToBlob(canvas, type='image/png', quality=0.95){
    return new Promise(res=>{
      if(canvas.toBlob) return canvas.toBlob(b=>res(b), type, quality);
      try{
        const dataURL = canvas.toDataURL(type, quality);
        const bin = atob(dataURL.split(',')[1]);
        const arr = new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
        res(new Blob([arr], {type}));
      }catch(e){ res(null); }
    });
  }
  function createCanvas(w,h){ const c=document.createElement('canvas'); c.width=w; c.height=h; return c; }

  // Preprocessing: grayscale, contrast stretch, unsharp mask (sharpen), binarize optional
  async function preprocessToCanvas(blobOrFile, opts={ widthLimit:2500, enhanceContrast:true, toGray:true, sharpen:true }){
    return new Promise((res, rej)=>{
      const img = new Image();
      img.crossOrigin='Anonymous';
      if(blobOrFile instanceof Blob || blobOrFile instanceof File) img.src = URL.createObjectURL(blobOrFile);
      else if(typeof blobOrFile === 'string') img.src = blobOrFile;
      else if(blobOrFile && blobOrFile.tagName==='IMG') img.src = blobOrFile.src;
      else return rej(new Error('Unsupported image input'));
      img.onload = ()=>{
        try{
          const ratio = opts.widthLimit ? Math.min(1, opts.widthLimit / img.width) : 1;
          const w = Math.max(1, Math.round(img.width * ratio));
          const h = Math.max(1, Math.round(img.height * ratio));
          const canvas = createCanvas(w,h);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img,0,0,w,h);
          if(opts.enhanceContrast || opts.toGray || opts.sharpen){
            try{
              const id = ctx.getImageData(0,0,w,h);
              const d = id.data;
              // contrast stretch
              let min=255,max=0;
              for(let i=0;i<d.length;i+=4){
                const lum = 0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2];
                if(lum<min) min=lum;
                if(lum>max) max=lum;
              }
              const range = Math.max(1, max-min);
              for(let i=0;i<d.length;i+=4){
                let r=d[i],g=d[i+1],b=d[i+2];
                if(opts.toGray){
                  const gray = Math.round(0.2126*r+0.7152*g+0.0722*b);
                  r=g=b=gray;
                }
                // stretch
                r = ((r - min) * 255 / range);
                g = ((g - min) * 255 / range);
                b = ((b - min) * 255 / range);
                d[i]=Math.max(0,Math.min(255,Math.round(r)));
                d[i+1]=Math.max(0,Math.min(255,Math.round(g)));
                d[i+2]=Math.max(0,Math.min(255,Math.round(b)));
              }
              ctx.putImageData(id,0,0);
            }catch(e){}
            // optional sharpen convolution
            if(opts.sharpen){
              try{
                const kernel = [0,-1,0,-1,5,-1,0,-1,0];
                const id2 = ctx.getImageData(0,0,canvas.width, canvas.height);
                const out = ctx.createImageData(canvas.width, canvas.height);
                const w0 = canvas.width;
                const h0 = canvas.height;
                for(let y=1;y<h0-1;y++){
                  for(let x=1;x<w0-1;x++){
                    for(let c=0;c<3;c++){
                      let v=0, k=0;
                      for(let ky=-1; ky<=1; ky++){
                        for(let kx=-1; kx<=1; kx++){
                          const px = x+kx;
                          const py = y+ky;
                          const idx = (py*w0+px)*4 + c;
                          v += id2.data[idx] * kernel[k++];
                        }
                      }
                      const idxOut = (y*w0+x)*4 + c;
                      out.data[idxOut] = Math.max(0, Math.min(255, v));
                    }
                    out.data[(y*w0+x)*4+3] = 255;
                  }
                }
                ctx.putImageData(out,0,0);
              }catch(e){}
            }
          }
          try{ if(blobOrFile instanceof Blob) URL.revokeObjectURL(img.src); }catch(e){}
          res(canvas);
        }catch(err){ rej(err); }
      };
      img.onerror = e => rej(new Error('Image load failed'));
    });
  }

  // perform Tesseract recognition (convenience API or worker)
  async function recognizeWithTesseract(blob, opts={ lang:'eng', logger:null }){
    try{
      if(typeof Tesseract === 'undefined') return '';
      if(typeof Tesseract.recognize === 'function'){
        const r = await Tesseract.recognize(blob, opts.lang || 'eng', { logger: opts.logger || (()=>{}) });
        const raw = (r && (r.data && r.data.text || r.text)) || '';
        return normalizeOCRText(raw);
      }
      if(Tesseract && typeof Tesseract.createWorker === 'function'){
        const worker = Tesseract.createWorker({ logger: opts.logger || (()=>{}) });
        await worker.load();
        await worker.loadLanguage(opts.lang || 'eng');
        await worker.initialize(opts.lang || 'eng');
        const { data } = await worker.recognize(blob);
        await worker.terminate();
        return normalizeOCRText(data && data.text || '');
      }
      return '';
    }catch(err){ return ''; }
  }

  // triple-pass OCR: raw, enhanced, highRes
  async function recognizeEnhanced(blobOrFile, opts={ lang:'eng', logger:null }){
    try{
      let best = '';
      try {
        // pass 1: normal (fast)
        const t1 = await recognizeWithTesseract(blobOrFile, opts);
        if(t1 && t1.length>best.length) best = t1;
      } catch(e){}
      try {
        // pass 2: enhanced preprocessing
        const canvas = await preprocessToCanvas(blobOrFile, { widthLimit:2500, enhanceContrast:true, toGray:true, sharpen:true });
        if(canvas){
          const b = await canvasToBlob(canvas,'image/png',0.95);
          const t2 = await recognizeWithTesseract(b, opts);
          if(t2 && t2.length>best.length) best = t2;
        }
      } catch(e){}
      try {
        // pass 3: high-res larger preprocess
        const canvas2 = await preprocessToCanvas(blobOrFile, { widthLimit:3500, enhanceContrast:true, toGray:true, sharpen:true });
        if(canvas2){
          const b2 = await canvasToBlob(canvas2,'image/png',0.95);
          const t3 = await recognizeWithTesseract(b2, opts);
          if(t3 && t3.length>best.length) best = t3;
        }
      } catch(e){}
      return normalizeOCRText(best);
    }catch(e){
      return await recognizeWithTesseract(blobOrFile, opts);
    }
  }

  // combine multiple OCR outputs (simple line-by-line pick longest)
  function mergeOCRResults(...texts){
    const lines = {};
    for(const t of texts){
      if(!t) continue;
      const arr = t.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
      arr.forEach((l,i)=>{
        if(!lines[i] || l.length > lines[i].length) lines[i]=l;
      });
    }
    return Object.keys(lines).sort((a,b)=>a-b).map(i=>lines[i]).join('\n');
  }

  // file -> image blob: if pdf and pdfjsLib available, render first page, else return file
  async function fileToImageBlob(file){
    try{
      if(!file) return null;
      if(file.type && file.type.startsWith('image/')) return file;
      const name = (file.name||'').toLowerCase();
      if(name.endsWith('.pdf') && typeof pdfjsLib !== 'undefined'){
        try{
          const arr = new Uint8Array(await file.arrayBuffer());
          const pdf = await pdfjsLib.getDocument({data:arr}).promise;
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({scale:2});
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          const ctx = canvas.getContext('2d');
          await page.render({canvasContext:ctx, viewport}).promise;
          return await canvasToBlob(canvas,'image/png',0.95);
        }catch(e){ return file; }
      }
      return file;
    }catch(e){ return file; }
  }

  // public flows
  async function runDualOCR(file, opts={ lang:'eng' }){
    try{
      lastOCR.quick=''; lastOCR.enhanced=''; lastOCR.combined='';
      let pdfText = '';
      if(file && (file.name||'').toLowerCase().endsWith('.pdf') && typeof pdfjsLib !== 'undefined'){
        // try text extraction quickly
        try{
          const arr = new Uint8Array(await file.arrayBuffer());
          const pdf = await pdfjsLib.getDocument({data:arr}).promise;
          const page = await pdf.getPage(1);
          const content = await page.getTextContent();
          pdfText = (content.items||[]).map(it=>it.str||'').join(' ');
          pdfText = normalizeOCRText(pdfText);
        }catch(e){}
      }
      const imageBlob = await fileToImageBlob(file);
      if(imageBlob){
        lastOCR.quick = await recognizeWithTesseract(imageBlob, opts);
        lastOCR.enhanced = await recognizeEnhanced(imageBlob, opts);
      } else {
        lastOCR.quick = pdfText;
        lastOCR.enhanced = '';
      }
      lastOCR.combined = mergeOCRResults(pdfText, lastOCR.enhanced, lastOCR.quick);
      lastOCR.combined = normalizeOCRText(lastOCR.combined);
      return { ...lastOCR };
    }catch(e){
      return { ...lastOCR };
    }
  }

  async function runQuickOCROnly(file, opts={ lang:'eng' }){
    try{
      const imageBlob = await fileToImageBlob(file);
      const txt = await recognizeWithTesseract(imageBlob||file, opts);
      lastOCR.quick = txt || '';
      lastOCR.enhanced = '';
      lastOCR.combined = lastOCR.quick;
      lastOCR.combined = normalizeOCRText(lastOCR.combined);
      return { ...lastOCR };
    }catch(e){
      return { ...lastOCR };
    }
  }

  window.OCR = {
    runDualOCR,
    runQuickOCROnly,
    lastOCR,
    normalizeOCRText,
    detectCurrencyPreferContext,
    formatCents
  };

})();
/* js/parser.js
   Universal invoice + medical parser.
   Exposes window.Parser.parseRawInvoiceText(raw).
*/

(function(){
  'use strict';

  // helpers
  function normalize(s){ return (s||'').replace(/\r/g,'').replace(/\t/g,' ').replace(/[ \u00A0]{2,}/g,' ').trim(); }
  function toLines(s){ return normalize(s).split(/\n/).map(l=>l.trim()).filter(Boolean); }

  function parseNumberString(s){
    if(!s) return null;
    let t = String(s).trim().replace(/[^\d,.\-]/g,'');
    t = t.replace(/\s(?=\d{3}\b)/g,''); // spaces thousands
    const hasDot = t.indexOf('.')!==-1, hasComma = t.indexOf(',')!==-1;
    if(hasDot && hasComma){
      if(t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g,'').replace(',', '.');
      else t = t.replace(/,/g,'');
    } else if(hasComma && !hasDot){
      const parts = t.split(',');
      if(parts[parts.length-1].length===2) t = t.replace(/\./g,'').replace(',', '.');
      else t = t.replace(/,/g,'');
    } else { t = t.replace(/,/g,''); }
    const m = t.match(/-?\d+(\.\d+)?/);
    if(!m) return null;
    const n = parseFloat(m[0]);
    if(isNaN(n)) return null;
    return Math.round(n*100);
  }

  function detectCurrency(text){
    if(!text) return 'INR';
    if(/₹|\bINR\b|\bRs\b/i.test(text)) return 'INR';
    if(/\$/.test(text)) return 'USD';
    if(/€/.test(text)) return 'EUR';
    if(/£/.test(text)) return 'GBP';
    return 'INR';
  }

  function formatCents(cents, currSymbol='₹'){
    if(cents===null||cents===undefined) return '-';
    const neg = cents<0?'-':'';
    const v = Math.abs(Math.floor(cents));
    const intPart = Math.floor(v/100);
    const dec = String(v%100).padStart(2,'0');
    const intStr = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${neg}${currSymbol}${intStr}.${dec}`;
  }

  function tryParseDate(s){
    if(!s) return null;
    s = s.replace(/\./g,'/').replace(/(st|nd|rd|th)/gi,'');
    const rx1 = /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/;
    const rx2 = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;
    const rx3 = /([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})/;
    let m;
    if((m=s.match(rx1))){ const d=new Date(+m[1],+m[2]-1,+m[3]); return d.toISOString().slice(0,10); }
    if((m=s.match(rx2))){ let y=+m[3]; if(y<100) y += (y>=50?1900:2000); const d=new Date(y, +m[2]-1, +m[1]); return d.toISOString().slice(0,10); }
    if((m=s.match(rx3))){ const mon=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].slice(0,3).toLowerCase()); const d=new Date(+m[3], mon, +m[2]); return d.toISOString().slice(0,10); }
    const p = Date.parse(s); if(!isNaN(p)) return new Date(p).toISOString().slice(0,10);
    return null;
  }

  // merchant detection
  function extractMerchant(lines){
    const blacklist = /\b(invoice|bill|receipt|gst|tax|phone|tel|address|qty|item|email|www)\b/i;
    for(let i=0;i<Math.min(6,lines.length);i++){
      const l=lines[i].replace(/\|/g,' ').trim();
      if(!l) continue;
      if(blacklist.test(l)) continue;
      if(/^\d+$/.test(l)) continue;
      if(l.length<2) continue;
      return l.replace(/[^A-Za-z0-9 &\-\.\,\/\(\)\:]/g,'').trim();
    }
    for(const l of lines) if(l.length>10 && !blacklist.test(l)) return l;
    return 'UNKNOWN';
  }

  // detect if medical bill
  function isMedical(lines, raw){
    const k = /(hospital|clinic|patient|consultant|ip no|uhid|room|ward|discharge|admit|admission|bed|doctor|nursing)/i;
    return lines.some(l=>k.test(l)) || k.test(raw);
  }

  // detect total from bottom region
  function extractTotalFromText(raw){
    const lines = toLines(raw);
    const tail = lines.slice(Math.max(0,lines.length-20));
    const candidates = [];
    let totalLine = null;
    for(const l of tail){
      if(/total|grand total|amount due|balance|payable|net amount|round off/i.test(l) || /₹|\$|€|£|Rs\b|INR\b/i.test(l)){
        const nums = l.match(/-?[\d,.\s]{2,}/g)||[];
        nums.forEach(n=>{ const p=parseNumberString(n); if(p!==null) candidates.push({cents:p,line:l}); });
        if(nums.length && !totalLine) totalLine = l;
      }
    }
    if(candidates.length) return { cents: candidates[candidates.length-1].cents, currency: detectCurrency(totalLine||raw), line: totalLine };
    const all = (raw.match(/-?[\d,.\s]{2,}/g)||[]).map(n=>parseNumberString(n)).filter(n=>n!==null);
    if(all.length) return { cents: Math.max(...all), currency: detectCurrency(raw), line: null };
    return null;
  }

  function computeItemsSum(items){
    let s=0; for(const it of items) { if(it.total) s+=it.total; else if(it.price) s+=it.price * (it.qty||1); } return s;
  }

  // map line -> item
  function mapRowToItem(line, raw){
    if(!line || !/[0-9]/.test(line) || !/[A-Za-z]/.test(line)) return null;
    // exclude metadata
    if(/\b(gstin|ifsc|pan|a\/c|account no|cheque|receipt no|bill no|invoice no|uhid|ip no)\b/i.test(line)) return null;
    const nums = (line.match(/-?[\d,.]+(?:\.\d{1,2})?/g)||[]).map(s=>parseNumberString(s)).filter(n=>n!==null);
    const currency = detectCurrency(line||raw);
    let name = line.replace(/([₹$€£]?[-]?\d{1,3}(?:[0-9,\.]*)(?:\.\d{1,2})?)/g,' ').replace(/\s{2,}/g,' ').trim();
    if(name.length>120) name = name.slice(0,120);
    const item = { name: name||'-', qty:null, price:null, total:null, currency };
    if(nums.length>=3){
      const last = nums[nums.length-1]; item.total = last;
      for(let i=nums.length-2;i>=0;i--){ const cand=nums[i]; if(Math.abs(cand) < Math.max(10000000, Math.abs(last*2))){ item.price=cand; break; } }
      if(item.price && item.total){ const q=Math.round(item.total / item.price); if(q>=1 && q<=500) item.qty=q; }
    } else if(nums.length===2){
      const a=nums[0], b=nums[1];
      if(b > a*1.1){ item.price=a; item.total=b; const q=Math.round(item.total/item.price); if(q>=1 && q<=500) item.qty=q; }
      else { if(a%100===0 && Math.round(a/100)>=1 && Math.round(a/100)<=500){ item.qty=Math.round(a/100); item.price=b; item.total=item.price*item.qty; } else { item.price=a; item.total=b; } }
    } else if(nums.length===1){ item.total=nums[0]; }
    if(item.qty!==null) item.qty = Number(item.qty);
    if(item.price!==null) item.price = Number(item.price);
    if(item.total!==null) item.total = Number(item.total);
    if(item.price && !item.total) item.total = item.price * (item.qty || 1);
    if(item.total && !item.price && item.qty) item.price = Math.floor(item.total / (item.qty || 1));
    if(item.qty===null) item.qty = item.price ? Math.max(1, Math.round((item.total||item.price)/(item.price||1))) : 1;
    if(item.total && Math.abs(item.total) > 1000000000) return null;
    return item;
  }

  function mergeBrokenLines(lines){
    const merged=[];
    for(let i=0;i<lines.length;i++){
      const cur=lines[i], next=lines[i+1]||'';
      const curHasNum = /[0-9]/.test(cur), nextHasNum = /[0-9]/.test(next);
      if(!curHasNum && nextHasNum){ merged.push((cur+' '+next).trim()); i++; }
      else if(/-$/.test(cur.trim()) && next){ merged.push((cur.replace(/-+$/,'')+next).trim()); i++; }
      else merged.push(cur);
    }
    return merged.map(l=>l.trim()).filter(Boolean);
  }

  function parseMedical(lines, raw){
    const res = { patient:null, billNo:null, ipNo:null, items:[], payments:[], notes:[] };
    for(const l of lines){
      const v = l.toLowerCase();
      if(!res.billNo && /bill\s*no[:\s]+([A-Z0-9\-]+)/i.test(l)){ res.billNo = l.match(/bill\s*no[:\s]*([A-Z0-9\-]+)/i)[1]; }
      if(!res.ipNo && /\b(ip|uhid|ip no|uhid no)[:\s]*([A-Z0-9\-]+)/i.test(l)){ const m=l.match(/\b(ip|uhid|ip no|uhid no)[:\s]*([A-Z0-9\-]+)/i); res.ipNo=m[2]; }
      if(!res.patient && /\b(patient|name)[:\s]*([A-Za-z ]{2,80})/i.test(l)){ const m=l.match(/\b(patient|name)[:\s]*([A-Za-z ]{2,80})/i); res.patient=m[2].trim(); }
      if(/\b(cheque|received cheque|cheque no)/i.test(l)) res.payments.push(l);
      if(/\b(room|ward|nursing|doctor|consult|lab|pharmacy|service)\b/i.test(l) && /[\d,\.]{2,}/.test(l)) {
        const it = mapRowToItem(l, raw); if(it) res.items.push(it);
      }
      if(/\b(total|grand total|amount payable|balance due|amount due)\b/i.test(l)) res.notes.push(l);
    }
    return res;
  }

  function parseRawInvoiceText(raw){
    raw = raw || '';
    const parsed = { id:'bill-'+Date.now(), merchant:null, date:null, total:null, items:[], raw, issues:[], confidence:0, created:Date.now(), display:{} };
    const lines = toLines(raw);
    if(lines.length===0){ parsed.issues.push({field:'raw',problem:'empty'}); parsed.display={merchant:'-',date:'-',total:'-',items:[]}; return parsed; }
    parsed.merchant = extractMerchant(lines);
    let foundDate = null;
    const dateCandidates = (raw.match(/(\d{1,2}[\/\-\.\s]\d{1,2}[\/\-\.\s]\d{2,4}|\d{4}[\/\-\.\s]\d{1,2}[\/\-\.\s]\d{1,2}|[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})/g) || []);
    for(const c of dateCandidates){ const d=tryParseDate(c); if(d){ foundDate=d; break; } }
    if(!foundDate){ for(const l of lines){ const d=tryParseDate(l); if(d){ foundDate=d; break; } } }
    parsed.date = foundDate;
    const totalGuess = extractTotalFromText(raw);
    if(totalGuess) parsed.total = { cents: totalGuess.cents, currency: totalGuess.currency, totalLine: totalGuess.line };
    const merged = mergeBrokenLines(lines);
    // medical detection
    const medical = isMedical(merged, raw);
    const items = [];
    if(medical){
      const m = parseMedical(merged, raw);
      if(m.items && m.items.length) items.push(...m.items);
      if(m.billNo) parsed.billNo = m.billNo;
      if(m.patient) parsed.patient = m.patient;
      parsed.payments = m.payments;
      parsed.notes = m.notes;
    }
    // generic extraction when not enough medical items
    for(const row of merged){
      const mapped = mapRowToItem(row, raw);
      if(mapped) items.push(mapped);
    }
    // dedupe
    const seen = new Set();
    const cleaned = [];
    for(const it of items){
      const key = ((it.name||'').slice(0,40))+'|'+(it.total||'')+'|'+(it.price||'');
      if(seen.has(key)) continue;
      seen.add(key);
      if(!it.total && !it.price) continue;
      cleaned.push(it);
    }
    parsed.items = cleaned;
    const sumItems = computeItemsSum(parsed.items);
    if(!parsed.total && sumItems>0) parsed.total = { cents: sumItems, currency: detectCurrency(raw), inferred:true };
    if(parsed.total && sumItems>0){
      if(Math.abs(parsed.total.cents - sumItems) > Math.max(200, Math.round(parsed.total.cents * 0.05))) parsed.mismatch = { total: parsed.total.cents, itemsSum: sumItems };
    }
    if(!parsed.merchant || parsed.merchant==='UNKNOWN') parsed.issues.push({field:'merchant',problem:'missing'});
    if(!parsed.date) parsed.issues.push({field:'date',problem:'missing'});
    if(!parsed.total) parsed.issues.push({field:'total',problem:'missing'});
    if(!parsed.items || parsed.items.length===0) parsed.issues.push({field:'items',problem:'no_items'});
    let score=10;
    if(parsed.merchant && parsed.merchant!=='UNKNOWN') score+=20;
    if(parsed.date) score+=15;
    if(parsed.total) score+=30;
    score += Math.min(25, (parsed.items? parsed.items.length*5 : 0));
    if(parsed.mismatch) score = Math.max(30, score-20);
    parsed.confidence = Math.min(100, score);
    parsed.display = {
      merchant: parsed.merchant || '-',
      date: parsed.date || '-',
      total: parsed.total ? formatCents(parsed.total.cents, parsed.total.currency==='INR'?'₹':(parsed.total.currency==='USD'?'$': parsed.total.currency+' ')) : '-',
      items: (parsed.items || []).map(it=>({ name: it.name||'-', qty: it.qty||1, price: it.price?formatCents(it.price,it.currency||'INR'):'-', total: it.total?formatCents(it.total,it.currency||'INR'):'-' }))
    };
    return parsed;
  }

  window.Parser = { parseRawInvoiceText };
})();
/* js/storage.js
   IndexedDB storage (ES module exports)
*/

const DB_NAME = "anj_invoice_db";
const STORE_NAME = "invoices";
const DB_VERSION = 1;
let db = null;

export async function openDB(){
  if(db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if(!d.objectStoreNames.contains(STORE_NAME)) d.createObjectStore(STORE_NAME, { keyPath:'id' });
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e);
  });
}

export async function saveInvoice(inv){
  const database = await openDB();
  return new Promise((resolve, reject) => {
    try{
      const tx = database.transaction(STORE_NAME, 'readwrite');
      const st = tx.objectStore(STORE_NAME);
      st.put(inv);
      tx.oncomplete = () => resolve(true);
      tx.onerror = e => reject(e);
    }catch(e){ reject(e); }
  });
}

export async function loadInvoices(){
  const database = await openDB();
  return new Promise((resolve,reject)=>{
    try{
      const tx = database.transaction(STORE_NAME,'readonly');
      const st = tx.objectStore(STORE_NAME);
      const rq = st.getAll();
      rq.onsuccess = ()=> resolve(rq.result || []);
      rq.onerror = e => reject(e);
    }catch(e){ reject(e); }
  });
}

export async function clearInvoices(){
  const database = await openDB();
  return new Promise((resolve,reject)=>{
    try{
      const tx = database.transaction(STORE_NAME,'readwrite');
      const st = tx.objectStore(STORE_NAME);
      const rq = st.clear();
      rq.onsuccess = ()=> resolve(true);
      rq.onerror = e => reject(e);
    }catch(e){ reject(e); }
  });
}

export async function renderHistory(container){
  const list = await loadInvoices();
  if(!list.length){ container.innerHTML = 'No history yet.'; return; }
  list.sort((a,b)=> b.created - a.created);
  container.innerHTML = '';
  for(const inv of list){
    const row = document.createElement('div');
    row.className = 'history-row';
    const left = document.createElement('div'); left.textContent = (inv.display?.merchant || 'Unknown') + ' — ' + (inv.date || 'No Date');
    const right = document.createElement('div'); right.textContent = inv.total ? (inv.total.currency || '') + ' ' + (inv.total.cents? (inv.total.cents/100).toLocaleString() : '-') : '-';
    row.appendChild(left); row.appendChild(right);
    row.addEventListener('click', ()=> { window.uiRender && window.uiRender(inv); });
    container.appendChild(row);
  }
}
/* js/ui.js (module)
   UI controller, exporters including Tally XML, event wiring.
*/

import { openDB, saveInvoice, loadInvoices, clearInvoices, renderHistory } from './storage.js';

const { runDualOCR, runQuickOCROnly, lastOCR, normalizeOCRText, detectCurrencyPreferContext, formatCents } = window.OCR || {};
const { parseRawInvoiceText } = window.Parser || {};

const fileInput = document.getElementById('fileInput');
const dualOCRBtn = document.getElementById('dualOCRBtn');
const ocrOnlyBtn = document.getElementById('ocrOnlyBtn');
const parseBtn = document.getElementById('parseBtn');
const statusBar = document.getElementById('statusBar');
const themeSelect = document.getElementById('themeSelect');

const merchantEl = document.getElementById('merchant');
const dateEl = document.getElementById('date');
const totalEl = document.getElementById('total');
const categoryEl = document.getElementById('category');
const itemsTable = document.getElementById('itemsTable');
const confidenceEl = document.getElementById('confidence');

const rawTextEl = document.getElementById('rawText');
const cleanedTextEl = document.getElementById('cleanedText');
const issuesBox = document.getElementById('issuesBox');
const jsonPreviewEl = document.getElementById('jsonPreview');

const exportJsonBtn = document.getElementById('exportJsonBtn');
const exportTxtBtn = document.getElementById('exportTxtBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const exportZipBtn = document.getElementById('exportZipBtn');

const loadHistoryBtn = document.getElementById('loadHistoryBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const historyList = document.getElementById('historyList');

let currentInvoice = null;

function setStatus(msg, ok=true){ if(statusBar){ statusBar.textContent = msg; statusBar.style.color = ok ? '#1f8b4c' : '#d82121'; } console.log('[status]', msg); }

function downloadFile(name, data, type){ const blob = (data instanceof Blob)? data : new Blob([data], {type}); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),4000); }

function applyTheme(name){ const root=document.documentElement; root.className=''; root.classList.add('theme-'+name); }
if(themeSelect){ themeSelect.value = themeSelect.value || 'rose'; applyTheme(themeSelect.value); themeSelect.addEventListener('change', ()=> applyTheme(themeSelect.value)); }

function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]); }

export function uiRender(parsed){
  currentInvoice = parsed;
  merchantEl.textContent = parsed.display?.merchant || '-';
  dateEl.textContent = parsed.display?.date || '-';
  totalEl.textContent = parsed.display?.total || '-';
  categoryEl.textContent = parsed.category || '-';
  confidenceEl.textContent = (parsed.confidence||0) + '%';
  itemsTable.innerHTML = '';
  (parsed.display?.items || []).forEach(it=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(it.name)}</td><td>${escapeHtml(String(it.qty||''))}</td><td>${escapeHtml(it.price||'-')}</td><td>${escapeHtml(it.total||'-')}</td>`;
    itemsTable.appendChild(tr);
  });
  rawTextEl.textContent = parsed.raw || lastOCR.combined || '-';
  cleanedTextEl.textContent = parsed.cleaned || normalizeOCRText(parsed.raw || lastOCR.combined || '');
  jsonPreviewEl.textContent = JSON.stringify(parsed, null, 2);
  issuesBox.innerHTML = '';
  if(parsed.issues && parsed.issues.length){ parsed.issues.forEach(i=>{ const d=document.createElement('div'); d.textContent = `${i.field} — ${i.problem}`; issuesBox.appendChild(d); }); }
  else { issuesBox.textContent = (parsed.mismatch ? `Total mismatch: parsed ${parsed.mismatch.total} vs items ${parsed.mismatch.itemsSum}` : 'No issues detected.'); }
}
window.uiRender = uiRender;

dualOCRBtn?.addEventListener('click', async ()=>{
  const f = fileInput.files?.[0];
  if(!f){ setStatus('Choose a file', false); return; }
  if(typeof runDualOCR!=='function'){ setStatus('OCR engine not loaded', false); return; }
  try{ setStatus('Running Dual OCR...'); const r = await runDualOCR(f, { lang:'eng' }); setStatus('OCR finished — ready to parse'); rawTextEl.textContent = r.combined || ''; cleanedTextEl.textContent = r.combined ? normalizeOCRText(r.combined) : ''; } catch(e){ console.error(e); setStatus('OCR failed', false); }
});

ocrOnlyBtn?.addEventListener('click', async ()=>{
  const f = fileInput.files?.[0];
  if(!f){ setStatus('Choose a file', false); return; }
  if(typeof runQuickOCROnly!=='function'){ setStatus('OCR engine not loaded', false); return; }
  try{ setStatus('Running quick OCR...'); const r = await runQuickOCROnly(f, { lang:'eng' }); setStatus('Quick OCR complete'); rawTextEl.textContent = r.combined || r.quick || ''; cleanedTextEl.textContent = normalizeOCRText(r.combined || r.quick || ''); }catch(e){ console.error(e); setStatus('Quick OCR failed', false); }
});

parseBtn?.addEventListener('click', async ()=>{
  const text = lastOCR?.combined || rawTextEl.textContent || cleanedTextEl.textContent;
  if(!text || !text.trim()){ setStatus('Run OCR first', false); return; }
  if(typeof parseRawInvoiceText!=='function'){ setStatus('Parser not loaded', false); return; }
  try{ setStatus('Parsing...'); const parsed = parseRawInvoiceText(text); parsed.cleaned = normalizeOCRText(text); uiRender(parsed); try{ await saveInvoice(parsed); }catch(e){ console.warn('saveInvoice failed', e); } setStatus('Parsed successfully'); }catch(e){ console.error(e); setStatus('Parse failed', false); }
});

// exporters: JSON, TXT, CSV, PDF, ZIP, TALLY XML
function exportJSON(){ if(!currentInvoice){ setStatus('Nothing to export', false); return; } const name=(currentInvoice.merchant||'invoice').replace(/\s+/g,'_')+'_'+Date.now()+'.json'; downloadFile(name, JSON.stringify(currentInvoice,null,2),'application/json'); setStatus('Exported JSON'); }
function exportTXT(){ if(!currentInvoice){ setStatus('Nothing to export', false); return; } let txt=`Merchant: ${currentInvoice.display?.merchant||'-'}\nDate: ${currentInvoice.display?.date||'-'}\nTotal: ${currentInvoice.display?.total||'-'}\n\nItems:\n`; (currentInvoice.display?.items||[]).forEach(it=> txt+=`- ${it.name} | Qty: ${it.qty} | ${it.price} | ${it.total}\n`); const name=(currentInvoice.merchant||'invoice').replace(/\s+/g,'_')+'_'+Date.now()+'.txt'; downloadFile(name, txt, 'text/plain'); setStatus('Exported TXT'); }
function exportCSV(){ if(!currentInvoice){ setStatus('Nothing to export', false); return; } let csv='name,qty,price,total\n'; (currentInvoice.display?.items||[]).forEach(it=> csv+=`"${(it.name||'').replace(/"/g,'""')}",${it.qty||''},"${(it.price||'').replace(/"/g,'""')}","${(it.total||'').replace(/"/g,'""')}"\n`); const name=(currentInvoice.merchant||'invoice').replace(/\s+/g,'_')+'_'+Date.now()+'.csv'; downloadFile(name, csv, 'text/csv'); setStatus('Exported CSV'); }

async function exportPDF(){
  if(!currentInvoice){ setStatus('Nothing to export', false); return; }
  if(!window.html2canvas || !window.jspdf){ setStatus('html2canvas & jsPDF required', false); return; }
  try{
    const area=document.getElementById('previewContainer');
    const canvas = await html2canvas(area, { scale: 2 });
    const img = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p','mm','a4');
    const w = pdf.internal.pageSize.getWidth();
    const h = (canvas.height / canvas.width) * w;
    pdf.addImage(img, 'PNG', 0, 0, w, h);
    const name = (currentInvoice.merchant||'invoice')+'_'+Date.now()+'.pdf';
    pdf.save(name);
    setStatus('Exported PDF');
  }catch(e){ console.error(e); setStatus('PDF export failed', false); }
}

async function exportZIP(){
  if(!currentInvoice){ setStatus('Nothing to export', false); return; }
  if(!window.JSZip){ setStatus('JSZip required', false); return; }
  try{
    const zip = new JSZip();
    const base = (currentInvoice.merchant||'invoice').replace(/\s+/g,'_')+'_'+Date.now();
    zip.file(base + '.json', JSON.stringify(currentInvoice,null,2));
    zip.file(base + '.txt', rawTextEl.textContent || '');
    zip.file(base + '.cleaned.txt', cleanedTextEl.textContent || '');
    let csv = 'name,qty,price,total\n';
    (currentInvoice.display?.items || []).forEach(it => csv += `"${(it.name||'').replace(/"/g,'""')}",${it.qty||''},"${(it.price||'').replace(/"/g,'""')}","${(it.total||'').replace(/"/g,'""')}"\n`);
    zip.file(base + '.csv', csv);
    // Tally XML
    zip.file(base + '.tally.xml', generateTallyXML(currentInvoice));
    const blob = await zip.generateAsync({type:'blob'});
    downloadFile(base + '.zip', blob, 'application/zip');
    setStatus('Exported ZIP (includes Tally XML)');
  }catch(e){ console.error(e); setStatus('ZIP export failed', false); }
}

// Tally XML generator (simple voucher format)
function generateTallyXML(inv){
  const company = (inv.display?.merchant || 'Company');
  const date = inv.date || new Date().toISOString().slice(0,10);
  const voucherNumber = inv.id || ('V' + Date.now());
  const total = inv.total ? (inv.total.cents/100).toFixed(2) : '0.00';
  const items = inv.items || inv.display?.items || [];
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<TALLYMESSAGE>
  <VOUCHER>
    <DATE>${date.replace(/-/g,'')}</DATE>
    <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
    <PARTYNAME>${company}</PARTYNAME>
    <VOUCHERNUMBER>${voucherNumber}</VOUCHERNUMBER>
    <AMOUNT>${total}</AMOUNT>
    <ALLLEDGERS>`;

  items.forEach((it, idx)=>{
    const name = it.name ? it.name.replace(/&/g,'&amp;') : `Item${idx+1}`;
    const amt = it.total ? (it.total/100).toFixed(2) : '0.00';
    xml += `
      <LEDGER>
        <NAME>${name}</NAME>
        <AMOUNT>${amt}</AMOUNT>
      </LEDGER>`;
  });

  xml += `
    </ALLLEDGERS>
  </VOUCHER>
</TALLYMESSAGE>`;
  return xml;
}

// hook buttons
exportJsonBtn?.addEventListener('click', exportJSON);
exportTxtBtn?.addEventListener('click', exportTXT);
exportCsvBtn?.addEventListener('click', exportCSV);
exportPdfBtn?.addEventListener('click', exportPDF);
exportZipBtn?.addEventListener('click', exportZIP);

// history wiring
loadHistoryBtn?.addEventListener('click', async ()=>{ try{ await renderHistory(historyList); setStatus('History loaded'); }catch(e){ console.error(e); setStatus('History load failed', false); } });
clearHistoryBtn?.addEventListener('click', async ()=>{ try{ await clearInvoices(); historyList.innerHTML='History cleared.'; setStatus('History cleared'); }catch(e){ console.error(e); setStatus('Clear failed', false); } });

console.log('UI module ready.');

      
