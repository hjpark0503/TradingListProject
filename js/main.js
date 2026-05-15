/**
 * trading-dashboard / main.js
 * 탭 전환, PDF 업로드·파싱, Chart.js 시각화
 *
 * 의존성: pdf.js (CDN), Chart.js (CDN)
 */

/* global pdfjsLib, Chart, Tesseract */

// ── pdf.js Worker (CDN 빌드와 동일 버전) ─────────────────────
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/** @typedef {{ date: string, name: string, type: string, unitPrice: number, qty: number, settlement: number, balance: number }} TradeRow */

var chartBalance = null;

/**
 * switchTab
 * @param {string} tab  - 'buy' | 'sell' | 'tax' | 'fx' | 'div'
 */
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(function (panel) {
    panel.classList.toggle('active', panel.id === 'panel-' + tab);
  });
  document.querySelectorAll('.card[data-tab]').forEach(function (card) {
    card.classList.toggle('active', card.dataset.tab === tab);
  });
}

// ═══════════════════════════════════════════════════════════════
// 숫자·날짜 유틸
// ═══════════════════════════════════════════════════════════════

function parseNumberLoose(s) {
  if (s == null) return NaN;
  var t = String(s).replace(/,/g, '').replace(/[^\d.\-+]/g, '').trim();
  if (t === '' || t === '-' || t === '+') return NaN;
  var n = parseFloat(t);
  return n;
}

function formatUsd(n) {
  if (n == null || isNaN(n)) return '—';
  var abs = Math.abs(n);
  var parts = abs.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-' : '') + parts.join('.');
}

function normalizeDateStr(s) {
  if (!s) return '';
  var m = String(s).trim().replace(/\./g, '-').replace(/\//g, '-');
  var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(m);
  if (p) return p[1] + '-' + p[2] + '-' + p[3];
  return m;
}

// ═══════════════════════════════════════════════════════════════
// PDF 텍스트 → 논리적 행 (줄 단위, y-클러스터 보조)
// ═══════════════════════════════════════════════════════════════

/**
 * pdf.js TextItem 배열을 y좌표 기준으로 묶어 한 줄 문자열 배열로 변환
 * @param {import('pdfjs-dist').TextItem[]} items
 * @param {number} yThreshold
 * @returns {string[]}
 */
function clusterPdfTextItemsToLines(items, yThreshold) {
  if (yThreshold == null) yThreshold = 4;
  var positioned = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it.str || it.str.trim() === '') continue;
    var tr = it.transform;
    var x = tr[4];
    var y = tr[5];
    positioned.push({ str: it.str, x: x, y: y });
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
      bucketY = bucketY === null ? p.y : bucketY;
    } else {
      bucket.sort(function (a, b) {
        return a.x - b.x;
      });
      lines.push(bucket.map(function (b) {
        return b.str;
      }).join(' ').replace(/\s+/g, ' ').trim());
      bucket = [p];
      bucketY = p.y;
    }
  }
  if (bucket.length) {
    bucket.sort(function (a, b) {
      return a.x - b.x;
    });
    lines.push(bucket.map(function (b) {
      return b.str;
    }).join(' ').replace(/\s+/g, ' ').trim());
  }
  return lines;
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<string[]>}
 */
function promptForPassword(reason) {
  return new Promise(function (resolve, reject) {
    var modal = document.getElementById('pdf-password-modal');
    var input = document.getElementById('pdf-password-input');
    var submitBtn = document.getElementById('pdf-password-submit');
    var cancelBtn = document.getElementById('pdf-password-cancel');
    var errorEl = document.getElementById('pdf-password-error');

    errorEl.hidden = reason !== 2;
    input.value = '';
    modal.hidden = false;
    setTimeout(function () { input.focus(); }, 50);

    function cleanup() {
      modal.hidden = true;
      submitBtn.onclick = null;
      cancelBtn.onclick = null;
      input.onkeydown = null;
    }

    submitBtn.onclick = function () {
      var pw = input.value;
      cleanup();
      resolve(pw);
    };

    cancelBtn.onclick = function () {
      cleanup();
      reject(new Error('비밀번호 입력이 취소되었습니다.'));
    };

    input.onkeydown = function (e) {
      if (e.key === 'Enter') submitBtn.onclick();
      if (e.key === 'Escape') cancelBtn.onclick();
    };
  });
}

async function extractLogicalLinesFromPdf(arrayBuffer) {
  var loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    onPassword: function (updatePassword, reason) {
      promptForPassword(reason).then(updatePassword).catch(function () {
        loadingTask.destroy();
      });
    }
  });
  var pdf = await loadingTask.promise;
  var allLines = [];
  for (var p = 1; p <= pdf.numPages; p++) {
    var page = await pdf.getPage(p);
    var content = await page.getTextContent();
    var pageLines = clusterPdfTextItemsToLines(content.items, 4);
    for (var k = 0; k < pageLines.length; k++) {
      allLines.push(pageLines[k]);
    }
  }
  return allLines;
}

/** 텍스트 레이어가 거의 없는 스캔 PDF 여부 */
function isLikelyImageOnlyPdf(lines) {
  var joined = lines.join('').replace(/\s/g, '');
  return joined.length < 40;
}

/**
 * pdf.js로 페이지를 캔버스에 렌더한 뒤 Tesseract OCR (신한 ozdownloader 이미지 PDF용)
 * @param {ArrayBuffer} arrayBuffer
 * @param {(msg: string) => void} [onStatus]
 * @returns {Promise<string[]>}
 */
async function extractLogicalLinesViaOcr(arrayBuffer, onStatus) {
  if (typeof Tesseract === 'undefined') {
    throw new Error('OCR 라이브러리(Tesseract.js)를 불러오지 못했습니다.');
  }
  var loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    onPassword: function (updatePassword, reason) {
      promptForPassword(reason).then(updatePassword).catch(function () {
        loadingTask.destroy();
      });
    }
  });
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
      var viewport = page.getViewport({ scale: 2.2 });
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

/**
 * 줄바꿈 기반 1차 정규화 + 빈 줄 제거
 * @param {string[]} lines
 * @returns {string[]}
 */
function normalizeRawLines(lines) {
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var L = lines[i].replace(/\r/g, '').trim();
    if (!L) continue;
    out.push(L);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════
// 신한투자증권 거래 행 파싱 (정규식 + 줄 병합)
// ═══════════════════════════════════════════════════════════════

var ShinhanTradeParser = {
  /** 해외주식 매수/매도 한 줄 패턴 (날짜, 종목명, 유형, 단가, 수량, 정산, 예수금) */
  ROW_REGEX: /^(\d{4}[-./]\d{2}[-./]\d{2})\s+(.+?)\s+(해외주식매수|해외주식매도)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s*$/,
  ROW_REGEX_LOOSE:
    /(\d{4})[.\-/](\d{2})[.\-/](\d{2})\s+(.+?)\s+(해외\s*주식\s*매[수도])\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)/,

  /**
   * @param {string[]} logicalLines
   * @returns {TradeRow[]}
   */
  parseFromLines: function (logicalLines) {
    var rows = [];
    var merged = this.mergeWrappedRows(normalizeRawLines(logicalLines));
    for (var i = 0; i < merged.length; i++) {
      var parsed = this.tryParseSingleLine(merged[i]);
      if (parsed) rows.push(parsed);
    }
    if (rows.length === 0) {
      rows = this.parseFromBlob(merged.join('\n'));
    }
    return rows;
  },

  /** OCR·줄바꿈이 깨진 전체 텍스트에서 거래 행 재탐색 */
  parseFromBlob: function (blob) {
    var text = this.normalizeOcrText(blob);
    var rows = [];
    var re = this.ROW_REGEX_LOOSE;
    var m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      var row = this.rowFromMatchGroups(
        m[1] + '-' + m[2] + '-' + m[3],
        m[4],
        m[5],
        m[6],
        m[7],
        m[8],
        m[9]
      );
      if (row) rows.push(row);
    }
    return rows;
  },

  normalizeOcrText: function (s) {
    return String(s)
      .replace(/\u00a0/g, ' ')
      .replace(/해외\s*주식\s*매\s*수/g, '해외주식매수')
      .replace(/해외\s*주식\s*매\s*도/g, '해외주식매도')
      .replace(/해외주식\s*매수/g, '해외주식매수')
      .replace(/해외주식\s*매도/g, '해외주식매도')
      .replace(/\s+/g, ' ')
      .trim();
  },

  normalizeTradeType: function (raw) {
    var t = String(raw).replace(/\s+/g, '');
    if (/매도/.test(t)) return '해외주식매도';
    if (/매수/.test(t)) return '해외주식매수';
    return '';
  },

  rowFromMatchGroups: function (dateRaw, name, typeRaw, u, q, settle, bal) {
    var type = this.normalizeTradeType(typeRaw);
    if (!type) return null;
    var date = normalizeDateStr(dateRaw);
    var row = {
      date: date,
      name: String(name).trim().replace(/\s+/g, ' '),
      type: type,
      unitPrice: parseNumberLoose(u),
      qty: parseNumberLoose(q),
      settlement: parseNumberLoose(settle),
      balance: parseNumberLoose(bal)
    };
    if (!row.date || !row.name || isNaN(row.unitPrice) || isNaN(row.qty) || isNaN(row.settlement) || isNaN(row.balance)) {
      return null;
    }
    return row;
  },

  /**
   * PDF에서 종목명 등이 다음 줄로 넘어간 경우 공백으로 이어붙임
   * @param {string[]} lines
   * @returns {string[]}
   */
  mergeWrappedRows: function (lines) {
    var out = [];
    var buf = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^\d{4}[-./\s]?\d{2}[-./\s]?\d{2}\b/.test(line)) {
        if (buf) out.push(buf);
        buf = line;
      } else if (buf) {
        buf = buf + ' ' + line;
      } else {
        out.push(line);
      }
    }
    if (buf) out.push(buf);
    return out;
  },

  /**
   * @param {string} line
   * @returns {TradeRow|null}
   */
  tryParseSingleLine: function (line) {
    var trimmed = line.trim();
    var m = this.ROW_REGEX.exec(trimmed);
    if (m) {
      return this.rowFromMatchGroups(m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
    }
    m = this.ROW_REGEX_LOOSE.exec(trimmed);
    if (m) {
      return this.rowFromMatchGroups(
        m[1] + '-' + m[2] + '-' + m[3],
        m[4],
        m[5],
        m[6],
        m[7],
        m[8],
        m[9]
      );
    }
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════
// DOM 테이블 ↔ TradeRow (초기 시드용)
// ═══════════════════════════════════════════════════════════════

/**
 * @param {HTMLTableSectionElement} tbody
 * @param {'buy'|'sell'} side
 * @returns {TradeRow[]}
 */
function readTradesFromTbody(tbody, side) {
  var typeLabel = side === 'buy' ? '해외주식매수' : '해외주식매도';
  var rows = [];
  var trs = tbody.querySelectorAll('tr');
  for (var i = 0; i < trs.length; i++) {
    var tds = trs[i].querySelectorAll('td');
    if (tds.length < 7) continue;
    var date = normalizeDateStr(tds[0].textContent);
    var name = tds[1].textContent.trim();
    var unit = parseNumberLoose(tds[3].textContent);
    var qty = parseNumberLoose(tds[4].textContent);
    var settlement = parseNumberLoose(tds[5].textContent);
    var balance = parseNumberLoose(tds[6].textContent);
    if (!date || !name) continue;
    rows.push({
      date: date,
      name: name,
      type: typeLabel,
      unitPrice: unit,
      qty: qty,
      settlement: settlement,
      balance: balance
    });
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════
// UI: 카드·테이블·차트
// ═══════════════════════════════════════════════════════════════

/**
 * @param {TradeRow[]} buys
 * @param {TradeRow[]} sells
 */
function updateSummaryCards(buys, sells) {
  var buyTotal = buys.reduce(function (s, r) {
    return s + Math.abs(r.settlement);
  }, 0);
  var sellTotal = sells.reduce(function (s, r) {
    return s + Math.abs(r.settlement);
  }, 0);
  var elBuyCount = document.getElementById('card-buy-count');
  var elBuyTotal = document.getElementById('card-buy-total');
  var elSellCount = document.getElementById('card-sell-count');
  var elSellTotal = document.getElementById('card-sell-total');
  if (elBuyCount) elBuyCount.textContent = buys.length + '건';
  if (elBuyTotal) elBuyTotal.textContent = '총 $' + formatUsd(buyTotal);
  if (elSellCount) elSellCount.textContent = sells.length + '건';
  if (elSellTotal) elSellTotal.textContent = '총 $' + formatUsd(sellTotal);
}

/**
 * @param {TradeRow[]} rows
 * @param {HTMLElement} tbody
 */
function renderTradeTbody(rows, tbody) {
  tbody.innerHTML = '';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var isBuy = r.type.indexOf('매수') !== -1;
    var badgeClass = isBuy ? 'b-buy' : 'b-sell';
    var amtClass = isBuy ? 'red' : 'blue';
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="date-c">' + escapeHtml(r.date) + '</td>' +
      '<td class="ticker">' + escapeHtml(r.name) + '</td>' +
      '<td><span class="badge ' + badgeClass + '">' + escapeHtml(r.type) + '</span></td>' +
      '<td class="r">' + escapeHtml(formatUsd(r.unitPrice)) + '</td>' +
      '<td class="r">' + escapeHtml(String(r.qty)) + '</td>' +
      '<td class="r ' + amtClass + '">' + escapeHtml(formatUsd(Math.abs(r.settlement))) + '</td>' +
      '<td class="r">' + escapeHtml(formatUsd(r.balance)) + '</td>';
    tbody.appendChild(tr);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {TradeRow[]} buys
 * @param {TradeRow[]} sells
 */
function updateBuySellTables(buys, sells) {
  var tbBuy = document.getElementById('tbody-buy');
  var tbSell = document.getElementById('tbody-sell');
  if (tbBuy) renderTradeTbody(buys, tbBuy);
  if (tbSell) renderTradeTbody(sells, tbSell);

  var buyTotal = buys.reduce(function (s, r) {
    return s + Math.abs(r.settlement);
  }, 0);
  var sellTotal = sells.reduce(function (s, r) {
    return s + Math.abs(r.settlement);
  }, 0);

  var lbBuy = document.getElementById('tfoot-buy-label');
  var lbSell = document.getElementById('tfoot-sell-label');
  var totBuy = document.getElementById('tfoot-buy-total');
  var totSell = document.getElementById('tfoot-sell-total');
  if (lbBuy) lbBuy.textContent = '합계 (' + buys.length + '건)';
  if (lbSell) lbSell.textContent = '합계 (' + sells.length + '건)';
  if (totBuy) {
    totBuy.textContent = '$' + formatUsd(buyTotal);
    totBuy.className = 'r red';
  }
  if (totSell) {
    totSell.textContent = '$' + formatUsd(sellTotal);
    totSell.className = 'r blue';
  }
}

/**
 * 거래일 오름차순 정렬 (같은 날짜는 입력 순서 유지)
 * @param {TradeRow[]} rows
 * @returns {TradeRow[]}
 */
function sortRowsByDateStable(rows) {
  return rows
    .map(function (r, i) {
      return { r: r, i: i };
    })
    .sort(function (a, b) {
      if (a.r.date !== b.r.date) return a.r.date < b.r.date ? -1 : 1;
      return a.i - b.i;
    })
    .map(function (x) {
      return x.r;
    });
}

/**
 * 거래일별 말잔 예수금 (해당 일 마지막 거래의 잔고)
 * @param {TradeRow[]} rows
 * @returns {{ labels: string[], data: number[], tradeCounts: number[] }}
 */
function aggregateBalanceByDate(rows) {
  var sorted = sortRowsByDateStable(rows);
  var labels = [];
  var data = [];
  var tradeCounts = [];
  var lastByDate = {};
  for (var i = 0; i < sorted.length; i++) {
    var r = sorted[i];
    if (!lastByDate[r.date]) {
      lastByDate[r.date] = { balance: r.balance, count: 0 };
      labels.push(r.date);
    }
    lastByDate[r.date].balance = r.balance;
    lastByDate[r.date].count += 1;
  }
  for (var j = 0; j < labels.length; j++) {
    var d = labels[j];
    data.push(lastByDate[d].balance);
    tradeCounts.push(lastByDate[d].count);
  }
  return { labels: labels, data: data, tradeCounts: tradeCounts };
}

/**
 * 예수금 흐름 — 거래일 기준 일별 말잔
 * @param {TradeRow[]} rows  매수·매도 행
 */
function renderOrUpdateBalanceLineChart(rows) {
  var canvas = document.getElementById('chartBalanceFlow');
  if (!canvas || typeof Chart === 'undefined') return;
  var merged = rows && rows.length ? rows.slice() : [];
  var series = aggregateBalanceByDate(merged);
  var labels = series.labels;
  var data = series.data;
  var tradeCounts = series.tradeCounts;
  var hint = document.getElementById('chartLineHint');
  if (hint) {
    hint.textContent =
      labels.length === 0
        ? '예수금 잔고를 표시할 거래가 없습니다.'
        : labels.length + '개 거래일 기준 일별 말잔 예수금입니다.';
  }
  if (chartBalance) {
    chartBalance.destroy();
    chartBalance = null;
  }
  chartBalance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: '예수금잔고 (USD)',
          data: data,
          borderColor: '#1e3a6e',
          backgroundColor: 'rgba(30, 58, 110, 0.06)',
          tension: 0.25,
          fill: true,
          pointRadius: 5,
          pointBackgroundColor: '#1e3a6e',
          pointBorderColor: '#fff',
          pointBorderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: function (items) {
              return items[0] && items[0].label ? items[0].label : '';
            },
            label: function (ctx) {
              var idx = ctx.dataIndex;
              var n = tradeCounts[idx] || 0;
              return [
                '말잔 USD ' + formatUsd(ctx.parsed.y),
                n > 0 ? '당일 거래 ' + n + '건' : ''
              ].filter(Boolean);
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            maxRotation: 45,
            minRotation: 35,
            autoSkip: true,
            maxTicksLimit: 16,
            font: { size: 10 }
          },
          grid: { display: false }
        },
        y: {
          ticks: {
            callback: function (val) {
              return formatUsd(Number(val));
            }
          },
          grid: { color: '#f0f3fa' }
        }
      }
    }
  });
}

/**
 * @param {TradeRow[]} buys
 * @param {TradeRow[]} sells
 */
function refreshDashboardFromTrades(buys, sells) {
  updateSummaryCards(buys, sells);
  updateBuySellTables(buys, sells);
  renderOrUpdateBalanceLineChart(buys.concat(sells));
}

// ═══════════════════════════════════════════════════════════════
// PDF 업로드 핸들러
// ═══════════════════════════════════════════════════════════════

function setLoading(isLoading, message) {
  var el = document.getElementById('pdfLoadingState');
  var btn = document.getElementById('pdfUploadBtn');
  if (el) {
    el.hidden = !isLoading;
    if (isLoading && message) el.textContent = message;
    else if (!isLoading) el.textContent = '데이터 분석 중...';
  }
  if (btn) btn.disabled = !!isLoading;
}

/**
 * @param {File} file
 */
async function handlePdfFile(file) {
  if (!file || !/\.pdf$/i.test(file.name)) {
    alert('PDF 파일만 업로드할 수 있습니다.');
    return;
  }
  if (typeof pdfjsLib === 'undefined') {
    alert('PDF 라이브러리를 불러오지 못했습니다. 네트워크를 확인해 주세요.');
    return;
  }
  setLoading(true, 'PDF 읽는 중…');
  try {
    var buf = await file.arrayBuffer();
    var bufForOcr = buf.slice(0);
    var lines = await extractLogicalLinesFromPdf(buf);
    var extractMode = 'text';
    var trades = ShinhanTradeParser.parseFromLines(lines);

    if (trades.length === 0 && (isLikelyImageOnlyPdf(lines) || !lines.some(function (l) {
      return /해외주식매[수도]/.test(l);
    }))) {
      setLoading(true, '스캔 PDF 감지 — OCR 준비 중… (1~2분 소요)');
      lines = await extractLogicalLinesViaOcr(bufForOcr, function (msg) {
        setLoading(true, msg);
      });
      extractMode = 'ocr';
      trades = ShinhanTradeParser.parseFromLines(lines);
    }

    var buys = trades.filter(function (t) {
      return t.type === '해외주식매수';
    });
    var sells = trades.filter(function (t) {
      return t.type === '해외주식매도';
    });
    if (trades.length === 0) {
      alert(
        extractMode === 'ocr'
          ? 'OCR 후에도 거래 행을 찾지 못했습니다. PDF 해상도·표 형식을 확인하거나, 증권사에서 텍스트 포함 PDF로 다시 발급해 보세요.'
          : '거래 행을 찾지 못했습니다. 신한투자증권 해외주식 매수·매도 형식이 다르거나, 스캔 PDF일 수 있습니다.'
      );
    }
    refreshDashboardFromTrades(buys, sells);
    updateHeaderMetaFromPdf(file, lines, trades.length, extractMode);
  } catch (e) {
    console.error(e);
    alert('PDF 분석 중 오류가 발생했습니다: ' + (e && e.message ? e.message : String(e)));
  } finally {
    setLoading(false);
  }
}

/**
 * 헤더 보조 정보를 업로드 파일 기준으로 가볍게 갱신
 * @param {File} file
 * @param {string[]} lines
 * @param {number} tradeCount
 */
function updateHeaderMetaFromPdf(file, lines, tradeCount, extractMode) {
  var meta = document.getElementById('header-meta');
  if (!meta) return;
  var now = new Date();
  var y = now.getFullYear();
  var mo = String(now.getMonth() + 1).padStart(2, '0');
  var d = String(now.getDate()).padStart(2, '0');
  var modeLabel = extractMode === 'ocr' ? 'OCR(이미지 PDF)' : '텍스트';
  meta.innerHTML =
    '파일: ' +
    escapeHtml(file.name) +
    '<br>분석 시각: ' +
    y +
    '-' +
    mo +
    '-' +
    d +
    '<br>추출 방식: ' +
    modeLabel +
    '<br>추출된 매매 행: ' +
    tradeCount +
    '건';
}

function wirePdfUpload() {
  var input = document.getElementById('pdfUploadInput');
  var btn = document.getElementById('pdfUploadBtn');
  if (!input || !btn) return;
  btn.addEventListener('click', function () {
    input.click();
  });
  input.addEventListener('change', function () {
    var f = input.files && input.files[0];
    if (f) {
      handlePdfFile(f);
      input.value = '';
    }
  });
}

function initDashboardFromStaticTables() {
  var tbBuy = document.getElementById('tbody-buy');
  var tbSell = document.getElementById('tbody-sell');
  if (!tbBuy || !tbSell) return;
  var buys = readTradesFromTbody(tbBuy, 'buy');
  var sells = readTradesFromTbody(tbSell, 'sell');
  refreshDashboardFromTrades(buys, sells);
}

document.addEventListener('DOMContentLoaded', function () {
  wirePdfUpload();
  initDashboardFromStaticTables();
});
