(function(){
  'use strict';

  // DOM
  const fileInput     = document.getElementById('fileInput');
  const dualOCRBtn    = document.getElementById('dualOCRBtn');
  const ocrOnlyBtn    = document.getElementById('ocrOnlyBtn');
  const parseBtn      = document.getElementById('parseBtn');
  const statusBar     = document.getElementById('statusBar');
  const themeSelect   = document.getElementById('themeSelect');

  const merchantEl    = document.getElementById('merchant');
  const dateEl        = document.getElementById('date');
  const totalEl       = document.getElementById('total');
  const confidenceEl  = document.getElementById('confidence');
  const categoryEl    = document.getElementById('category');
  const itemsTable    = document.getElementById('itemsTable');

  const rawTextEl     = document.getElementById('rawText');
  const cleanedTextEl = document.getElementById('cleanedText');
  const issuesBox     = document.getElementById('issuesBox');
  const jsonPreviewEl = document.getElementById('jsonPreview');

  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const exportTxtBtn  = document.getElementById('exportTxtBtn');
  const exportCsvBtn  = document.getElementById('exportCsvBtn');
  const exportPdfBtn  = document.getElementById('exportPdfBtn');
  const exportZipBtn  = document.getElementById('exportZipBtn');

  const loadHistoryBtn  = document.getElementById('loadHistoryBtn');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const historyList     = document.getElementById('historyList');

  // State
  let currentInvoice = null;
  let lastOCRtext = '';

  // helpers
  function setStatus(msg, ok=true){
    if(statusBar){ statusBar.textContent = msg; statusBar.style.color = ok ? '#1f8b4c' : '#d82121'; }
    console.info('[ANJ]', msg);
  }

  // expose internal for other parts
  window._ANJ = window._ANJ || {};
  window._ANJ.getState = ()=>({ currentInvoice, lastOCRtext });
  window._ANJ.setCurrent = (inv)=>{ currentInvoice = inv; };

  // theme init
  (function(){
    try{
      const saved = localStorage.getItem('anj_theme');
      if(saved){ document.body.classList.remove(...document.body.classList); document.body.classList.add('theme-'+saved); if(themeSelect) themeSelect.value = saved; }
    }catch(e){}
    if(themeSelect){
      themeSelect.addEventListener('change', ()=>{ const v=themeSelect.value; document.body.className=''; document.body.classList.add('theme-'+v); try{ localStorage.setItem('anj_theme', v);}catch(e){} });
    }
  })();

  // make ready for next parts
  window._ANJ.setStatus = setStatus;

})();
(function(){
  'use strict';

  const escapeHtml = s => String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function clearTable(el){ while(el && el.firstChild) el.removeChild(el.firstChild); }
  function formatDisplayAmount(txt){ return String(txt||'-'); }

  function renderInvoice(parsed){
    if(!parsed) return;
    window._ANJ.setCurrent(parsed);
    const merchantEl = document.getElementById('merchant');
    const dateEl = document.getElementById('date');
    const totalEl = document.getElementById('total');
    const confidenceEl = document.getElementById('confidence');
    const itemsTable = document.getElementById('itemsTable');
    const rawTextEl = document.getElementById('rawText');
    const cleanedTextEl = document.getElementById('cleanedText');
    const jsonPreviewEl = document.getElementById('jsonPreview');
    const issuesBox = document.getElementById('issuesBox');

    merchantEl.textContent = parsed.display?.merchant || '-';
    dateEl.textContent     = parsed.display?.date || '-';
    totalEl.textContent    = parsed.display?.total || '-';
    confidenceEl.textContent = (parsed.confidence||0) + '%';

    clearTable(itemsTable);
    (parsed.display?.items || []).forEach(it=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(it.name)}</td><td>${escapeHtml(String(it.qty||''))}</td><td>${escapeHtml(it.price||'-')}</td><td>${escapeHtml(it.total||'-')}</td>`;
      itemsTable.appendChild(tr);
    });

    rawTextEl.textContent = parsed.raw || window._ANJ.lastOCR || '-';
    cleanedTextEl.textContent = parsed.cleaned || (parsed.raw ? parsed.raw : '-');
    jsonPreviewEl.textContent = JSON.stringify(parsed, null, 2);

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

  window.ANJRender = renderInvoice;

})();
(function(){
  'use strict';

  function downloadFile(name, blob){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),4000);
  }

  function exportJSON(inv){
    if(!inv) return window._ANJ.setStatus('Nothing to export', false);
    const b = new Blob([JSON.stringify(inv, null, 2)], {type:'application/json'});
    downloadFile((inv.merchant||'invoice')+'_'+Date.now()+'.json', b);
    window._ANJ.setStatus('Exported JSON');
  }

  function exportTXT(inv){
    if(!inv) return window._ANJ.setStatus('Nothing to export', false);
    let txt = `Merchant: ${inv.display?.merchant||'-'}\nDate: ${inv.display?.date||'-'}\nTotal: ${inv.display?.total||'-'}\n\nItems:\n`;
    (inv.display?.items||[]).forEach(it=> txt += `- ${it.name} | Qty: ${it.qty} | ${it.price} | ${it.total}\n`);
    downloadFile((inv.merchant||'invoice')+'_'+Date.now()+'.txt', new Blob([txt], {type:'text/plain'}));
    window._ANJ.setStatus('Exported TXT');
  }

  function exportCSV(inv){
    if(!inv) return window._ANJ.setStatus('Nothing to export', false);
    let csv = 'name,qty,price,total\n';
    (inv.display?.items||[]).forEach(it=> csv += `"${(it.name||'').replace(/"/g,'""')}",${it.qty||''},"${(it.price||'').replace(/"/g,'""')}","${(it.total||'').replace(/"/g,'""')}"\n`);
    downloadFile((inv.merchant||'invoice')+'_'+Date.now()+'.csv', new Blob([csv], {type:'text/csv'}));
    window._ANJ.setStatus('Exported CSV');
  }

  async function exportPDF(inv){
    if(!inv) return window._ANJ.setStatus('Nothing to export', false);
    if(typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') return window._ANJ.setStatus('html2canvas/jsPDF required', false);
    const area = document.getElementById('previewContainer');
    const canvas = await html2canvas(area, {scale:2});
    const img = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p','mm','a4');
    const w = pdf.internal.pageSize.getWidth();
    const h = (canvas.height / canvas.width) * w;
    pdf.addImage(img, 'PNG', 0, 0, w, h);
    pdf.save((inv.merchant||'invoice')+'_'+Date.now()+'.pdf');
    window._ANJ.setStatus('Exported PDF');
  }

  async function exportZIP(inv){
    if(!inv) return window._ANJ.setStatus('Nothing to export', false);
    if(typeof JSZip === 'undefined') return window._ANJ.setStatus('JSZip required', false);
    const zip = new JSZip();
    const base = (inv.merchant||'invoice')+'_'+Date.now();
    zip.file(base + '.json', JSON.stringify(inv, null, 2));
    zip.file(base + '.txt', inv.raw || '');
    zip.file(base + '.cleaned.txt', inv.cleaned || '');
    let csv = 'name,qty,price,total\n';
    (inv.display?.items || []).forEach(it => csv += `"${(it.name||'').replace(/"/g,'""')}",${it.qty||''},"${(it.price||'').replace(/"/g,'""')}","${(it.total||'').replace(/"/g,'""')}"\n`);
    zip.file(base + '.csv', csv);
    zip.file(base + '.tally.xml', generateTallyXML(inv));
    const blob = await zip.generateAsync({type:'blob'});
    downloadFile(base + '.zip', blob);
    window._ANJ.setStatus('Exported ZIP (includes Tally XML)');
  }

  function generateTallyXML(inv){
    const company = (inv.display?.merchant || 'Company');
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

  // expose
  window._ANJ = window._ANJ || {};
  window._ANJ.exportJSON = exportJSON;
  window._ANJ.exportTXT = exportTXT;
  window._ANJ.exportCSV = exportCSV;
  window._ANJ.exportPDF = exportPDF;
  window._ANJ.exportZIP = exportZIP;

})();
(function(){
  'use strict';

  const setStatus = window._ANJ.setStatus || function(m){console.log(m);};
  const exportJSON = window._ANJ.exportJSON;
  const exportTXT  = window._ANJ.exportTXT;
  const exportCSV  = window._ANJ.exportCSV;
  const exportPDF  = window._ANJ.exportPDF;
  const exportZIP  = window._ANJ.exportZIP;

  async function runDualOCRFlow(file){
    if(!file){ setStatus('Choose a file', false); return ''; }
    if(!window.OCR || typeof window.OCR.runDualOCR !== 'function'){ setStatus('OCR engine not loaded', false); return ''; }
    try{
      setStatus('Running Dual OCR...');
      const res = await window.OCR.runDualOCR(file, { lang:'eng' });
      const combined = res.combined || res.enhanced || res.quick || '';
      window._ANJ.lastOCR = combined;
      setStatus('OCR complete');
      return combined;
    }catch(e){
      console.error(e);
      setStatus('OCR failed', false);
      return '';
    }
  }

  async function runQuickOCRFlow(file){
    if(!file){ setStatus('Choose a file', false); return ''; }
    if(!window.OCR || typeof window.OCR.runQuickOCROnly !== 'function'){ setStatus('OCR engine not loaded', false); return ''; }
    try{
      setStatus('Running quick OCR...');
      const res = await window.OCR.runQuickOCROnly(file, { lang:'eng' });
      const combined = res.combined || res.quick || '';
      window._ANJ.lastOCR = combined;
      setStatus('Quick OCR complete');
      return combined;
    }catch(e){
      console.error(e);
      setStatus('Quick OCR failed', false);
      return '';
    }
  }

  async function parseAndRender(text){
    if(!text || !text.trim()){ setStatus('No OCR text', false); return; }
    if(!window.Parser || typeof window.Parser.parseRawInvoiceText !== 'function'){ setStatus('Parser not loaded', false); return; }
    try{
      setStatus('Parsing...');
      const parsed = window.Parser.parseRawInvoiceText(text);
      parsed.cleaned = text;
      window._ANJ.setCurrent(parsed);
      if(window.ANJRender) window.ANJRender(parsed);
      try{ if(window.Storage && typeof window.Storage.saveInvoice === 'function') await window.Storage.saveInvoice(parsed); else if(window.saveInvoice) await window.saveInvoice(parsed); }catch(e){ console.warn('save failed', e); }
      setStatus('Parsed successfully');
    }catch(e){
      console.error(e);
      setStatus('Parse failed', false);
    }
  }

  // wire buttons
  (function wire(){
    const fileInput = document.getElementById('fileInput');
    const dualOCRBtn = document.getElementById('dualOCRBtn');
    const ocrOnlyBtn = document.getElementById('ocrOnlyBtn');
    const parseBtn = document.getElementById('parseBtn');
    const exportJsonBtn = document.getElementById('exportJsonBtn');
    const exportTxtBtn = document.getElementById('exportTxtBtn');
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const exportPdfBtn = document.getElementById('exportPdfBtn');
    const exportZipBtn = document.getElementById('exportZipBtn');
    const loadHistoryBtn = document.getElementById('loadHistoryBtn');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const historyList = document.getElementById('historyList');

    dualOCRBtn?.addEventListener('click', async ()=>{
      const f = fileInput.files?.[0];
      const txt = await runDualOCRFlow(f);
      document.getElementById('rawText').textContent = txt || '-';
    });

    ocrOnlyBtn?.addEventListener('click', async ()=>{
      const f = fileInput.files?.[0];
      const txt = await runQuickOCRFlow(f);
      document.getElementById('rawText').textContent = txt || '-';
    });

    parseBtn?.addEventListener('click', async ()=>{
      const text = window._ANJ.lastOCR || document.getElementById('rawText').textContent || '';
      if(!text || !text.trim()){ setStatus('Run OCR first', false); return; }
      await parseAndRender(text);
    });

    exportJsonBtn?.addEventListener('click', ()=> exportJSON(window._ANJ.getState().currentInvoice));
    exportTxtBtn?.addEventListener('click', ()=> exportTXT(window._ANJ.getState().currentInvoice));
    exportCsvBtn?.addEventListener('click', ()=> exportCSV(window._ANJ.getState().currentInvoice));
    exportPdfBtn?.addEventListener('click', ()=> exportPDF(window._ANJ.getState().currentInvoice));
    exportZipBtn?.addEventListener('click', ()=> exportZIP(window._ANJ.getState().currentInvoice));

    loadHistoryBtn?.addEventListener('click', async ()=>{
      try{
        if(window.Storage && typeof window.Storage.renderHistory === 'function'){ await window.Storage.renderHistory(historyList); setStatus('History loaded'); }
        else if(window.renderHistory){ await window.renderHistory(historyList); setStatus('History loaded'); }
      }catch(e){ console.error(e); setStatus('History load failed', false); }
    });

    clearHistoryBtn?.addEventListener('click', async ()=>{
      try{
        if(window.Storage && typeof window.Storage.clearInvoices === 'function'){ await window.Storage.clearInvoices(); historyList.innerHTML='History cleared.'; setStatus('History cleared'); }
        else if(window.clearInvoices){ await window.clearInvoices(); historyList.innerHTML='History cleared.'; setStatus('History cleared'); }
      }catch(e){ console.error(e); setStatus('Clear failed', false); }
    });

    // clickable history rows are handled by storage.renderHistory which should call back into window.ANJRender
  })();

  // auto-init: ensure storage available
  (async function initStorage(){
    try{
      if(window.Storage && typeof window.Storage.openDB === 'function'){ await window.Storage.openDB(); }
      else if(window.openDB){ await window.openDB(); }
    }catch(e){ console.warn('storage init failed', e); }
  })();

  window._ANJ.setStatus('Ready');

})();
  
      
