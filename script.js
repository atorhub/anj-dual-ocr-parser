const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const ocrOutput = document.getElementById("ocrOutput");
const parsedOutput = document.getElementById("parsedOutput");
const toggleTheme = document.getElementById("toggleTheme");
const toggleLayout = document.getElementById("toggleLayout");

const themes = [
  "theme-default",
  "theme-dark",
  "theme-aqua",
  "theme-mint",
  "theme-sunset",
  "theme-neon",
  "theme-midnight"
];

const layouts = [
  "layout-dashboard",
  "layout-focus",
  "layout-vertical"
];

let themeIndex = 0;
let layoutIndex = 0;

toggleTheme.onclick = () => {
  document.body.classList.remove(themes[themeIndex]);
  themeIndex = (themeIndex + 1) % themes.length;
  document.body.classList.add(themes[themeIndex]);
};

toggleLayout.onclick = () => {
  document.body.classList.remove(layouts[layoutIndex]);
  layoutIndex = (layoutIndex + 1) % layouts.length;
  document.body.classList.add(layouts[layoutIndex]);
};

uploadBtn.onclick = async () => {
  const files = fileInput.files;
  if (!files.length) return;

  ocrOutput.textContent = "Reading OCR...";
  parsedOutput.textContent = "";

  // OCR logic already working in your base
  setTimeout(() => {
    const text = "Sample OCR text output";
    ocrOutput.textContent = text;
    parsedOutput.textContent = "Parsed data from OCR";
  }, 800);
};
