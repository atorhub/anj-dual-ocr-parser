# ANJ Dual OCR Invoice Parser  
Advanced client-side invoice OCR, parsing, export, and history system — powered entirely by browser technologies, no backend required.

Live Demo: https://atorhub.github.io/anj-dual-ocr-parser/

---

## 🚀 Features

### 🔍 Dual OCR Engine (Image / PDF)
- **Quick OCR** – fast text extraction for simple bills
- **Enhanced OCR** – high-accuracy deep recognition
- **PDF Support** via pdf.js
- **Automatic merge** of both OCR passes for improved accuracy

### 🧠 Smart Invoice Parsing
Automatically extracts:
- Merchant / Shop name  
- Invoice date  
- Total amount + currency detection  
- Line items: name, qty, price, total  
- Category detection (Food, Shopping, Finance, etc.)
- Auto-corrections (date fixes, currency normalization)
- Issue detection & confidence scoring

### 🖼 Preview Panels
- Extracted fields  
- Items table  
- Raw OCR text  
- Cleaned text  
- JSON structured output  
- Issues & corrections viewer  

### 📦 Export System
Export parsed invoices as:
- **JSON**
- **TXT**
- **CSV**
- **PDF** (with preview capture)
- **ZIP** bundle (JSON + TXT + CSV + Preview PNG)

### 🗃 IndexedDB History
- Save every parsed invoice locally
- Reload instantly from history
- Clear all saved invoices
- 100% offline and persistent

### 🎨 Premium UI Themes
Includes 6 animated / pastel / galaxy themes:
1. **Rose Nebula**
2. **Lilac Glow**
3. **Cotton Candy Sky**
4. **Galaxy Glitter**
5. **Dreamy Blush**
6. **Fairy Dust**

Themes are selectable and saved automatically.

### 📱 100% Client-Side & Offline-Ready
- No servers
- No API keys
- No payments
- No privacy issues  
Runs fully in-browser using:
- pdf.js  
- Tesseract.js  
- IndexedDB  
- html2canvas  
- jsPDF  
- JSZip  

---

## 🧩 How It Works

### 1) OCR Phase
- If PDF → converted to text with pdf.js
- If Image → processed with Tesseract.js
- Quick + Enhanced OCR → combined

### 2) Parsing Phase
Custom rule engine detects:
- Date formats (DD/MM/YYYY, YYYY-MM-DD, etc.)
- Totals (₹, Rs, $, €, £ detection)
- Item rows with qty/price
- Corrects decimals, removes noise, fixes broken lines

### 3) Validation Phase
Checks for:
- Missing totals
- Invalid dates
- Mangled characters (e.g., “₹” → “Rs”)
- Bad line items

### 4) UI Rendering
All preview sections update instantly.

### 5) Export System
Data converts into:
- JSON (structured)
- TXT (raw)
- CSV (Excel friendly)
- PDF (visual snapshot)
- ZIP (bundle)

### 6) History Persistence
Saved via IndexedDB with:
- Merchant
- Date
- Total
- Items
- Raw text
- Corrections

---

## 📁 Project Structure

