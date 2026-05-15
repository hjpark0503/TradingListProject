/* global pdfjsLib */
'use strict';

if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ── 전역 상태 ────────────────────────────────────────────────────
var currentExchangeRate = 1350;
var _lastBuys  = null;
var _lastSells = null;
var _currentMarket = 'overseas';
var _tradesByMarket = { overseas: { buys: [], sells: [] }, domestic: { buys: [], sells: [] } };

// ── 탭 전환 ──────────────────────────────────────────────────────
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

// ── 대시보드 갱신 ────────────────────────────────────────────────
function refreshDashboardFromTrades(buys, sells) {
  _lastBuys  = buys;
  _lastSells = sells;
  showDashboard();
  var plRows  = calcRealizedPLRows(buys, sells);
  var totals  = calcTotalRealizedPL(plRows);
  var taxUsd  = calcEstimatedTax(totals.totalPL, currentExchangeRate);
  updateSummaryCards(buys, sells);
  updateBuySellTables(buys, sells, plRows);
  updateRealizedPLCard(totals.totalPL, totals.plPct, totals.hasSomeData);
  updateEstimatedTaxCard(taxUsd, currentExchangeRate);
  renderOrUpdateBalanceLineChart(buys.concat(sells));
}

function showDashboard() {
  document.getElementById('dashboard-content').style.display = 'block';
}

// ── 로딩 상태 ────────────────────────────────────────────────────
function setLoading(isLoading, message) {
  var el  = document.getElementById('pdfLoadingState');
  var btn = document.getElementById('pdfUploadBtn');
  if (el) {
    el.hidden = !isLoading;
    if (isLoading && message) el.textContent = message;
    else if (!isLoading) el.textContent = '데이터 분석 중...';
  }
  if (btn) btn.disabled = !!isLoading;
}

// ── PDF 업로드 핸들러 ─────────────────────────────────────────────
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
    var buf      = await file.arrayBuffer();
    var bufForOcr = buf.slice(0);
    var lines    = await extractLogicalLinesFromPdf(buf);
    var extractMode = 'text';
    var trades   = ShinhanTradeParser.parseFromLines(lines);

    if (trades.length === 0 && (isLikelyImageOnlyPdf(lines) || !lines.some(function (l) {
      return /해외주식매[수도]/.test(l);
    }))) {
      setLoading(true, '스캔 PDF 감지 — OCR 준비 중… (1~2분 소요)');
      lines = await extractLogicalLinesViaOcr(bufForOcr, function (msg) {
        setLoading(true, msg);
      });
      extractMode = 'ocr';
      window._lastOcrLines = lines;
      trades = ShinhanTradeParser.parseFromLines(lines);
    }

    var buys  = trades.filter(function (t) { return t.type === '해외주식매수'; });
    var sells = trades.filter(function (t) { return t.type === '해외주식매도'; });

    if (trades.length === 0) {
      alert(extractMode === 'ocr'
        ? 'OCR 후에도 거래 행을 찾지 못했습니다. PDF 해상도·표 형식을 확인하거나, 텍스트 포함 PDF로 다시 발급해 보세요.'
        : '거래 행을 찾지 못했습니다. 신한투자증권 해외주식 매수·매도 형식이 다르거나, 스캔 PDF일 수 있습니다.');
    }

    _tradesByMarket[_currentMarket] = { buys: buys, sells: sells };
    refreshDashboardFromTrades(buys, sells);
    updateHeaderMetaFromPdf(file, trades, extractMode);
  } catch (e) {
    console.error(e);
    alert('PDF 분석 중 오류가 발생했습니다: ' + (e && e.message ? e.message : String(e)));
  } finally {
    setLoading(false);
  }
}

function updateHeaderMetaFromPdf(file, trades, extractMode) {
  if (trades.length > 0) {
    var dates = trades.map(function (t) { return t.date; }).filter(Boolean).sort();
    var sub = document.getElementById('header-sub');
    if (sub) sub.textContent = '📅 ' + dates[0] + ' ~ ' + dates[dates.length - 1] + ' · 해외주식 전체';
  }
  var meta = document.getElementById('header-meta');
  if (!meta) return;
  var now   = new Date();
  var today = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');
  var modeLabel = extractMode === 'ocr' ? 'OCR(이미지 PDF)' : '텍스트';
  meta.innerHTML =
    '파일: ' + escapeHtml(file.name) +
    '<br>분석 시각: ' + today +
    '<br>추출 방식: ' + modeLabel +
    '<br>추출된 매매 행: ' + trades.length + '건';
}

// ── DOM 테이블 → TradeRow (초기 시드용) ─────────────────────────
function readTradesFromTbody(tbody, side) {
  var typeLabel = side === 'buy' ? '해외주식매수' : '해외주식매도';
  var rows = [];
  var trs  = tbody.querySelectorAll('tr');
  for (var i = 0; i < trs.length; i++) {
    var tds = trs[i].querySelectorAll('td');
    if (tds.length < 7) continue;
    var date  = normalizeDateStr(tds[0].textContent);
    var name  = tds[1].textContent.trim();
    var unit  = parseNumberLoose(tds[3].textContent);
    var qty   = parseNumberLoose(tds[4].textContent);
    var sett  = parseNumberLoose(tds[5].textContent);
    var bal   = parseNumberLoose(tds[6].textContent);
    if (!date || !name) continue;
    rows.push({ date: date, name: name, type: typeLabel, unitPrice: unit, qty: qty, settlement: sett, balance: bal });
  }
  return rows;
}

function initDashboardFromStaticTables() {
  var tbBuy  = document.getElementById('tbody-buy');
  var tbSell = document.getElementById('tbody-sell');
  if (!tbBuy || !tbSell) return;
  var buys  = readTradesFromTbody(tbBuy,  'buy');
  var sells = readTradesFromTbody(tbSell, 'sell');
  refreshDashboardFromTrades(buys, sells);
}

// ── 와이어링 ─────────────────────────────────────────────────────
function wirePdfUpload() {
  var input = document.getElementById('pdfUploadInput');
  var btn   = document.getElementById('pdfUploadBtn');
  if (!input || !btn) return;
  btn.addEventListener('click', function () { input.click(); });
  input.addEventListener('change', function () {
    var f = input.files && input.files[0];
    if (f) { handlePdfFile(f); input.value = ''; }
  });
}

function wireExchangeRateInput() {
  var input = document.getElementById('exchangeRateInput');
  if (!input) return;
  input.addEventListener('change', function () {
    var v = parseFloat(input.value);
    if (!isNaN(v) && v >= 100 && _lastBuys && _lastSells) {
      currentExchangeRate = v;
      var plRows = calcRealizedPLRows(_lastBuys, _lastSells);
      var totals = calcTotalRealizedPL(plRows);
      updateEstimatedTaxCard(calcEstimatedTax(totals.totalPL, currentExchangeRate), currentExchangeRate);
    }
  });
}

function wireMarketToggle() {
  document.querySelectorAll('.market-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var market = btn.dataset.market;
      _currentMarket = market;
      document.body.setAttribute('data-market', market);
      document.querySelectorAll('.market-btn').forEach(function (b) {
        b.classList.toggle('active', b.dataset.market === market);
      });
      var d = _tradesByMarket[market];
      refreshDashboardFromTrades(d.buys, d.sells);
    });
  });
}

document.addEventListener('DOMContentLoaded', function () {
  wirePdfUpload();
  wireExchangeRateInput();
  wireMarketToggle();
});
