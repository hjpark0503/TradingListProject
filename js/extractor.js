/* global pdfjsLib, Tesseract */
'use strict';

// 컬럼 간 gap 판단 기준 (px) — 이 이상이면 탭으로 구분
var COL_GAP_THRESHOLD = 15;

/**
 * pdf.js TextItem 배열을 y좌표 기준으로 묶어 한 줄 문자열 배열로 변환.
 * 아이템 간 x 좌표 gap이 COL_GAP_THRESHOLD 이상이면 탭(\t)을 삽입해
 * 컬럼 경계를 보존한다. ROW_REGEX의 \s+는 탭도 매칭하므로 하위 호환.
 */
function clusterPdfTextItemsToLines(items, yThreshold) {
  if (yThreshold == null) yThreshold = 8;
  var positioned = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it.str || it.str.trim() === '') continue;
    var tr = it.transform;
    positioned.push({ str: it.str, x: tr[4], y: tr[5], width: it.width || 0 });
  }
  positioned.sort(function (a, b) {
    if (Math.abs(a.y - b.y) > yThreshold) return b.y - a.y;
    return a.x - b.x;
  });

  var lines = [];
  var bucket = [];
  var bucketY = null;

  function bucketToLine(bkt) {
    bkt.sort(function (a, b) { return a.x - b.x; });
    var result = '';
    for (var k = 0; k < bkt.length; k++) {
      if (k === 0) {
        result += bkt[k].str;
      } else {
        var gap = bkt[k].x - (bkt[k - 1].x + bkt[k - 1].width);
        result += (gap > COL_GAP_THRESHOLD ? '\t' : ' ') + bkt[k].str;
      }
    }
    // 연속 공백은 하나로, 탭은 유지
    return result.replace(/ {2,}/g, ' ').trim();
  }

  for (var j = 0; j < positioned.length; j++) {
    var p = positioned[j];
    if (bucketY === null || Math.abs(p.y - bucketY) <= yThreshold) {
      bucket.push(p);
      if (bucketY === null) bucketY = p.y;
    } else {
      lines.push(bucketToLine(bucket));
      bucket = [p];
      bucketY = p.y;
    }
  }
  if (bucket.length) lines.push(bucketToLine(bucket));
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

/**
 * 이미지 전용 PDF 판별.
 * ① 공백 제외 40자 미만 — 텍스트 레이어 거의 없음
 * ② 읽을 수 없는 문자 비율 35% 초과 — 보안 PDF·깨진 폰트로 외계어 추출된 경우
 */
function isLikelyImageOnlyPdf(lines) {
  var joined = lines.join('').replace(/\s/g, '');
  if (joined.length < 40) return true;

  // 한글·영문·숫자·금융 문서 빈출 기호 외 문자를 "읽을 수 없음"으로 간주
  var unreadable = joined.replace(/[a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ.,\-+()%$/\\]/g, '');
  return unreadable.length / joined.length > 0.35;
}

/**
 * 스캔 PDF를 페이지별로 캔버스에 렌더링한 뒤 Tesseract OCR 수행.
 * - scale 2.5: 잡음 확대 억제 + 처리 속도 균형
 * - PSM 6 (단일 블록): 표 레이아웃에서 인식률 향상
 * - preserve_interword_spaces: 컬럼 간 공백 정보 보존
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
    await worker.setParameters({
      tessedit_pageseg_mode: '6',    // PSM_SINGLE_BLOCK — 표 형식 문서에 적합
      preserve_interword_spaces: '1' // 컬럼 간 공백 유지 → 파서가 컬럼 경계 인식
    });
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
