import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const pdfjsLib = require('pdfjs-dist/build/pdf.js');

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node scripts/dump-pdf-lines.mjs <path-to.pdf>');
  process.exit(1);
}

function clusterPdfTextItemsToLines(items, yThreshold = 4) {
  const positioned = [];
  for (const it of items) {
    if (!it.str || it.str.trim() === '') continue;
    const [,, , , x, y] = it.transform;
    positioned.push({ str: it.str, x, y });
  }
  positioned.sort((a, b) => {
    if (Math.abs(a.y - b.y) > yThreshold) return b.y - a.y;
    return a.x - b.x;
  });
  const lines = [];
  let bucket = [];
  let bucketY = null;
  for (const p of positioned) {
    if (bucketY === null || Math.abs(p.y - bucketY) <= yThreshold) {
      bucket.push(p);
      bucketY = bucketY === null ? p.y : bucketY;
    } else {
      bucket.sort((a, b) => a.x - b.x);
      lines.push(bucket.map((b) => b.str).join(' ').replace(/\s+/g, ' ').trim());
      bucket = [p];
      bucketY = p.y;
    }
  }
  if (bucket.length) {
    bucket.sort((a, b) => a.x - b.x);
    lines.push(bucket.map((b) => b.str).join(' ').replace(/\s+/g, ' ').trim());
  }
  return lines;
}

const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
const allLines = [];
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const content = await page.getTextContent();
  const pageLines = clusterPdfTextItemsToLines(content.items, 4);
  console.log(`\n===== PAGE ${p} =====`);
  pageLines.forEach((line, i) => {
    if (line.trim()) console.log(String(i + 1).padStart(4) + '|' + line);
  });
  allLines.push(...pageLines);
}

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pdf-dump.txt');
fs.writeFileSync(outPath, allLines.join('\n'), 'utf8');
console.error(`\nWrote ${allLines.length} lines to ${outPath}`);
