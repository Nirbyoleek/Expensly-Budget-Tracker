// Copies the PDF.js worker into /public so statements can be read in the browser.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const src = "node_modules/pdfjs-dist/build/pdf.worker.min.mjs";
if (existsSync(src)) {
  mkdirSync("public", { recursive: true });
  copyFileSync(src, "public/pdf.worker.min.mjs");
  console.log("Copied PDF worker to public/");
} else {
  console.warn("pdfjs-dist not installed yet; PDF import will be unavailable until you run npm install.");
}
