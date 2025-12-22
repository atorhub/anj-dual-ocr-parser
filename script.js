document.addEventListener("DOMContentLoaded", () => {

  const el = {
    file: document.getElementById("fileInput"),
    raw: document.getElementById("rawText"),
    clean: document.getElementById("cleanedText"),
    json: document.getElementById("jsonPreview"),
    status: document.getElementById("statusBar"),
    dual: document.getElementById("dualOCRBtn"),
    ocr: document.getElementById("ocrOnlyBtn"),
    parse: document.getElementById("parseBtn"),
    theme: document.getElementById("themeSelect"),
    layout: document.getElementById("layoutSelect")
  };

  function setStatus(msg, err=false){
    el.status.textContent = msg;
    el.status.style.color = err ? "#ff4d4d" : "#7CFC98";
  }

  el.theme.addEventListener("change", () => {
    document.body.className =
      document.body.className.replace(/theme-\S+/g,"") +
      ` theme-${el.theme.value}`;
  });

  el.layout.addEventListener("change", () => {
    document.body.className =
      document.body.className.replace(/layout-\S+/g,"") +
      ` layout-${el.layout.value}`;
  });

  async function runOCR(file){
    setStatus("OCR running…");
    const res = await Tesseract.recognize(file,"eng");
    return res.data.text || "";
  }

  function cleanText(txt){
    return txt
      .replace(/\r/g,"")
      .replace(/[ \t]+/g," ")
      .replace(/\n{2,}/g,"\n")
      .trim();
  }

  function parseInvoice(text){
    const out = { merchant:null, date:null, total:null };
    const t = text.match(/total[:\s]*₹?\s*([\d,.]+)/i);
    const d = text.match(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/);
    if(t) out.total = t[1];
    if(d) out.date = d[0];
    const lines = text.split("\n").filter(l=>l.length>5);
    if(lines.length) out.merchant = lines[0];
    return out;
  }

  async function processFile(){
    if(!el.file.files[0]) return setStatus("No file",true);
    const text = cleanText(await runOCR(el.file.files[0]));
    el.raw.textContent = text || "--";
    el.clean.textContent = text || "--";
    el.json.textContent = JSON.stringify(parseInvoice(text),null,2);
    setStatus("Done ✓");
  }

  el.dual.onclick = processFile;
  el.ocr.onclick = processFile;
  el.parse.onclick = () => {
    el.json.textContent =
      JSON.stringify(parseInvoice(el.clean.textContent),null,2);
  };

  document
    .getElementById("sidebarToggle")
    ?.addEventListener("click",()=> {
      document.body.classList.toggle("sidebar-hidden");
    });

  setStatus("Ready ✓");
});
