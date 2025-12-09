# ANJ Invoice — AI-Enhanced OCR + Bill Parser + Export Suite  
**Version:** 1.0  
**Author:** ANJ Creator Hub  

ANJ Invoice is a **free, offline-first, client-side invoice reader** that supports:

✅ Dual OCR (Tesseract + PDF.js)  
✅ Smart Parsing (merchant, date, GST, totals, UPI, items)  
✅ Multi-Format Exports (JSON, TXT, Excel TSV, Tally, PDF, ZIP)  
✅ Full Preview System  
✅ History via IndexedDB  
✅ Zero-Backend — runs 100% in browser  
✅ PWA Ready  

---

## 🚀 Features

### 🔍 **1. Dual OCR Engine**
- **Primary OCR:** Tesseract.js  
- **Enhanced OCR:** extra cleanup + formatting  
- **PDF Extractor:** PDF.js text extraction (multi-page)

Supports:  
📄 PDF • 🖼 PNG • JPG • WEBP • TXT  

---

### 📦 **2. Smart Invoice Parsing**
Extracts automatically:

- Merchant  
- Date (multiple formats)  
- Total amount  
- GSTIN  
- UPI ID  
- Phone number  
- Line items  
- Category (food/shopping/finance/general)  
- Notes  

Works even with imperfect bills.

---

### 🖥 **3. Full Preview System**
The UI renders:

- Summary  
- Raw OCR text  
- Items table  
- Excel preview (TSV)  
- Tally preview  
- JSON output  
- TXT output  
- ZIP contents preview  

---

### 📤 **4. Export Everything**
Create real downloadable files:

- `invoice.json`  
- `invoice.txt`  
- `invoice.tsv`  
- `invoice_tally.txt`  
- `invoice.pdf`  
- `invoice.zip` (contains all above)

---

### 🗂 **5. History System**
Invoices can be saved to local IndexedDB.

Persistent across refresh/browser restarts.

---

### 🧱 **6. Offline-Ready**
No server. No backend.  
Runs **100% in browser** using:

- Tesseract.js  
- PDF.js  
- JSZip  
- html2canvas  
- jsPDF  

---

## 📁 Project Structure

