import fs from 'fs';
import { createRequire } from 'module';
import { createCanvas } from 'canvas';
import Tesseract from 'tesseract.js';

const require = createRequire(import.meta.url);
const pdfjsLib = require('pdfjs-dist/build/pdf.js');

const pdfPath = process.argv[2];
const pageNum = parseInt(process.argv[3] || '2', 10);
const scale = parseFloat(process.argv[4] || '2.5');

const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data }).promise;
const page = await pdf.getPage(pageNum);
const viewport = page.getViewport({ scale });
const canvas = createCanvas(viewport.width, viewport.height);
const ctx = canvas.getContext('2d');
await page.render({ canvasContext: ctx, viewport }).promise;

const pngPath = '/Users/parkhyunjin/MyProjects/TradingListProject/scripts/page-ocr.png';
fs.writeFileSync(pngPath, canvas.toBuffer('image/png'));
console.error('Rendered', pngPath, viewport.width, 'x', viewport.height);

const { data: ocr } = await Tesseract.recognize(pngPath, 'kor+eng', {
  logger: (m) => {
    if (m.status === 'recognizing text') process.stderr.write('\r' + Math.round(m.progress * 100) + '%');
  }
});
process.stderr.write('\n');
console.log(ocr.text);
