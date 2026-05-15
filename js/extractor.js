/* global pdfjsLib, Tesseract */
'use strict';

/**
 * pdf.js TextItem 배열을 y좌표 기준으로 묶어 한 줄 문자열 배열로 변환
 * yThreshold: 같은 행으로 판단할 y좌표 허용 오차(px) — 8로 상향해 컬럼 분리 오류 감소
 */
function clusterPdfTextItemsToLines(items, yThreshold) {
  if (yThreshold == null) yThreshold = 8;
  var positioned = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it.str || it.str.trim() === '') continue;
    var tr = it.transform;
    positioned.push({ str: it.str, x: tr[4], y: tr[5] });
  }
  positioned.sort(function (a, b) {
    if (Math.abs(a.y - b.y) > yThreshold) return b.y - a.y;
    return a.x - b.x;
  });
  var lines = [];
  var bucket = [];
  var bucketY = null;
  for (var j = 0; j < positioned.length; j++) {
    var p = positioned[j];
    if (bucketY === null || Math.abs(p.y - bucketY) <= yThreshold) {
      bucket.push(p);
      if (bucketY === null) bucketY = p.y;
    } else {
      bucket.sort(function (a, b) { return a.x - b.x; });
      lines.push(bucket.map(function (b) { return b.str; }).join(' ').replace(/\s+/g, ' ').trim());
      bucket = [p];
      bucketY = p.y;
    }
  }
  if (bucket.length) {
    bucket.sort(function (a, b) { return a.x - b.x; });
    lines.push(bucket.map(function (b) { return b.str; }).join(' ').replace(/\s+/g, ' ').trim());
  }
  return lines;
}

async function extractLogicalLinesFromPdf(arrayBuffer) {
  var loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  var pdf = await loadingTask.promise;
  var allLines = [];
  for (var p = 1; p <= pdf.numPages; p++) {
    var page = await pdf.getPage(p);
    var content = await page.getTextContent();
    var pageLines = clusterPdfTextItemsToLines(content.items, 8);
    for (var k = 0; k < pageLines.length; k++) {
      allLines.push(pageLines[k]);
    }
  }
  return allLines;
}

function isLikelyImageOnlyPdf(lines) {
  var joined = lines.join('').replace(/\s/g, '');
  return joined.length < 40;
}

/**
 * 스캔 PDF를 페이지별로 캔버스에 렌더링한 뒤 Tesseract OCR 수행
 * scale 2.5로 조정해 잡음 확대 억제 및 처리 속도 개선
 */
async function extractLogicalLinesViaOcr(arrayBuffer, onStatus) {
  if (typeof Tesseract === 'undefined') {
    throw new Error('OCR 라이브러리(Tesseract.js)를 불러오지 못했습니다.');
  }
  var loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  var pdf = await loadingTask.promise;
  var allLines = [];
  var worker = await Tesseract.createWorker('kor+eng', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0_best',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
    logger: function (m) {
      if (!onStatus || !m.status) return;
      if (m.status === 'recognizing text' && m.progress != null) {
        onStatus('글자 인식 중… ' + Math.round(m.progress * 100) + '%');
      }
    }
  });
  try {
    for (var p = 1; p <= pdf.numPages; p++) {
      if (onStatus) onStatus('페이지 ' + p + ' / ' + pdf.numPages + ' OCR 중…');
      var page = await pdf.getPage(p);
      var viewport = page.getViewport({ scale: 2.5 });
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      var result = await worker.recognize(canvas);
      var text = (result.data && result.data.text) || '';
      text.split(/\r?\n/).forEach(function (line) {
        line = line.trim();
        if (line) allLines.push(line);
      });
    }
  } finally {
    await worker.terminate();
  }
  return allLines;
}

function normalizeRawLines(lines) {
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var L = lines[i].replace(/\r/g, '').trim();
    if (L) out.push(L);
  }
  return out;
}
