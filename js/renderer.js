/* global Chart */
'use strict';

// ── 실현 손익 계산 ──────────────────────────────────────────────

function calcWeightedAvgCosts(buys) {
  var map = {};
  for (var i = 0; i < buys.length; i++) {
    var b = buys[i];
    var key = b.name.trim();
    if (!map[key]) map[key] = { totalCost: 0, totalQty: 0 };
    map[key].totalCost += Math.abs(b.settlement);
    map[key].totalQty  += b.qty;
  }
  var result = {};
  for (var name in map) {
    if (map[name].totalQty > 0) result[name] = map[name].totalCost / map[name].totalQty;
  }
  return result;
}

function calcRealizedPLRows(buys, sells) {
  var avgCosts = calcWeightedAvgCosts(buys);
  return sells.map(function (s) {
    var key = s.name.trim();
    if (avgCosts[key] !== undefined) {
      var buyCost = avgCosts[key] * s.qty;
      var pl = Math.abs(s.settlement) - buyCost;
      var plPct = buyCost > 0 ? (pl / buyCost * 100) : null;
      return { sell: s, buyCost: buyCost, pl: pl, plPct: plPct, hasBuyData: true };
    }
    return { sell: s, buyCost: null, pl: null, plPct: null, hasBuyData: false };
  });
}

function calcTotalRealizedPL(plRows) {
  var totalPL = 0, totalBuyCost = 0, hasSomeData = false;
  for (var i = 0; i < plRows.length; i++) {
    if (plRows[i].hasBuyData) {
      totalPL      += plRows[i].pl;
      totalBuyCost += plRows[i].buyCost;
      hasSomeData   = true;
    }
  }
  return {
    totalPL: totalPL,
    totalBuyCost: totalBuyCost,
    plPct: totalBuyCost > 0 ? (totalPL / totalBuyCost * 100) : null,
    hasSomeData: hasSomeData
  };
}

function calcEstimatedTax(totalPLUsd, exchangeRate) {
  if (totalPLUsd <= 0 || exchangeRate <= 0) return 0;
  var taxable = totalPLUsd - (2500000 / exchangeRate);
  return taxable > 0 ? taxable * 0.22 : 0;
}

function aggregateBalanceByDate(rows) {
  var sorted = sortRowsByDateStable(rows);
  var labels = [], data = [], tradeCounts = [];
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
    data.push(lastByDate[labels[j]].balance);
    tradeCounts.push(lastByDate[labels[j]].count);
  }
  return { labels: labels, data: data, tradeCounts: tradeCounts };
}

// ── 테이블 렌더링 ───────────────────────────────────────────────

function renderTradeTbody(rows, tbody) {
  tbody.innerHTML = '';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var isBuy = r.type.indexOf('매수') !== -1;
    var badgeClass = isBuy ? 'badge-buy' : 'badge-sell';
    var amtClass   = isBuy ? 'red' : 'blue';
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="date-c">' + escapeHtml(r.date) + '</td>' +
      '<td class="ticker">' + escapeHtml(r.name) + '</td>' +
      '<td><span class="badge ' + badgeClass + '">' + escapeHtml(r.type) + '</span></td>' +
      '<td class="r">'  + escapeHtml(formatUsd(r.unitPrice)) + '</td>' +
      '<td class="r">'  + escapeHtml(String(r.qty)) + '</td>' +
      '<td class="r ' + amtClass + '">' + escapeHtml(formatUsd(Math.abs(r.settlement))) + '</td>' +
      '<td class="r">'  + escapeHtml(formatUsd(r.balance)) + '</td>';
    tbody.appendChild(tr);
  }
}

function renderSellTbodyWithPL(sells, plRows, tbody) {
  tbody.innerHTML = '';
  for (var i = 0; i < sells.length; i++) {
    var r = sells[i];
    var plData = plRows[i];
    var plCell;
    if (plData && plData.hasBuyData) {
      var pl = plData.pl;
      var plClass = pl >= 0 ? 'pl-pos' : 'pl-neg';
      var plSign  = pl >= 0 ? '+' : '-';
      var pctText = plData.plPct !== null
        ? ' <span class="pl-pct">(' + escapeHtml((pl >= 0 ? '+' : '') + plData.plPct.toFixed(1) + '%)') + '</span>'
        : '';
      plCell = '<td class="r ' + plClass + '">' + plSign + escapeHtml(formatUsd(Math.abs(pl))) + pctText + '</td>';
    } else {
      plCell = '<td class="r pl-na">—</td>';
    }
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="date-c">' + escapeHtml(r.date) + '</td>' +
      '<td class="ticker">' + escapeHtml(r.name) + '</td>' +
      '<td><span class="badge badge-sell">해외주식매도</span></td>' +
      '<td class="r">' + escapeHtml(formatUsd(r.unitPrice)) + '</td>' +
      '<td class="r">' + escapeHtml(String(r.qty)) + '</td>' +
      '<td class="r blue">' + escapeHtml(formatUsd(Math.abs(r.settlement))) + '</td>' +
      plCell +
      '<td class="r">' + escapeHtml(formatUsd(r.balance)) + '</td>';
    tbody.appendChild(tr);
  }
}

// ── 카드·tfoot 갱신 ─────────────────────────────────────────────

function updateSummaryCards(buys, sells) {
  var buyTotal  = buys.reduce(function (s, r)  { return s + Math.abs(r.settlement); }, 0);
  var sellTotal = sells.reduce(function (s, r) { return s + Math.abs(r.settlement); }, 0);
  var elBuyCount  = document.getElementById('card-buy-count');
  var elBuyTotal  = document.getElementById('card-buy-total');
  var elSellCount = document.getElementById('card-sell-count');
  var elSellTotal = document.getElementById('card-sell-total');
  if (elBuyCount)  animateCount(elBuyCount,  buys.length,  600, function (v) { return Math.round(v) + '건'; });
  if (elBuyTotal)  animateCount(elBuyTotal,  buyTotal,     800, function (v) { return '총 $' + formatUsd(v); });
  if (elSellCount) animateCount(elSellCount, sells.length, 600, function (v) { return Math.round(v) + '건'; });
  if (elSellTotal) animateCount(elSellTotal, sellTotal,    800, function (v) { return '총 $' + formatUsd(v); });
}

function updateBuySellTables(buys, sells, sellPlRows) {
  var tbBuy  = document.getElementById('tbody-buy');
  var tbSell = document.getElementById('tbody-sell');
  if (tbBuy)  renderTradeTbody(buys, tbBuy);
  if (tbSell) {
    if (sellPlRows) renderSellTbodyWithPL(sells, sellPlRows, tbSell);
    else            renderTradeTbody(sells, tbSell);
  }

  var buyTotal  = buys.reduce(function (s, r)  { return s + Math.abs(r.settlement); }, 0);
  var sellTotal = sells.reduce(function (s, r) { return s + Math.abs(r.settlement); }, 0);

  var lbBuy    = document.getElementById('tfoot-buy-label');
  var lbSell   = document.getElementById('tfoot-sell-label');
  var totBuy   = document.getElementById('tfoot-buy-total');
  var totSell  = document.getElementById('tfoot-sell-total');
  var totSellPL = document.getElementById('tfoot-sell-pl');
  if (lbBuy)  lbBuy.textContent  = '합계 (' + buys.length + '건)';
  if (lbSell) lbSell.textContent = '합계 (' + sells.length + '건)';
  if (totBuy)  { totBuy.textContent  = '$' + formatUsd(buyTotal);  totBuy.className  = 'r red'; }
  if (totSell) { totSell.textContent = '$' + formatUsd(sellTotal); totSell.className = 'r blue'; }
  if (totSellPL && sellPlRows) {
    var plTotals = calcTotalRealizedPL(sellPlRows);
    if (plTotals.hasSomeData) {
      var plSign = plTotals.totalPL >= 0 ? '+' : '';
      totSellPL.textContent = plSign + '$' + formatUsd(plTotals.totalPL);
      totSellPL.className   = 'r ' + (plTotals.totalPL >= 0 ? 'red' : 'blue');
    } else {
      totSellPL.textContent = '—';
      totSellPL.className   = 'r pl-na';
    }
  }
}

function updateRealizedPLCard(totalPL, plPct, hasSomeData) {
  var valEl  = document.getElementById('card-pl-value');
  var noteEl = document.getElementById('card-pl-note');
  if (!valEl) return;
  if (!hasSomeData) {
    valEl.textContent = '—';
    valEl.className   = 'value';
    if (noteEl) noteEl.textContent = '데이터 로드 후 표시';
    return;
  }
  valEl.className = 'value ' + (totalPL >= 0 ? 'red' : 'blue');
  var finalPL = totalPL;
  animateCount(valEl, totalPL, 900, function (v) {
    return (finalPL >= 0 ? '+$' : '-$') + formatUsd(Math.abs(v));
  });
  if (noteEl) {
    noteEl.textContent = plPct !== null ? (plPct >= 0 ? '+' : '') + plPct.toFixed(2) + '% 수익률' : '';
  }
}

function updateEstimatedTaxCard(taxUsd, exchangeRate) {
  var valEl  = document.getElementById('card-etax-value');
  var noteEl = document.getElementById('card-etax-note');
  if (!valEl) return;
  valEl.className = 'value orange';
  if (taxUsd <= 0) {
    valEl.textContent = '$0.00';
    if (noteEl) noteEl.textContent = '과세 대상 이익 없음';
    return;
  }
  animateCount(valEl, taxUsd, 900, function (v) { return '$' + formatUsd(v); });
  if (noteEl) {
    noteEl.textContent = '≈ ₩' + Math.round(taxUsd * exchangeRate).toLocaleString();
  }
}

// ── 차트 ────────────────────────────────────────────────────────

var chartBalance = null;

function renderOrUpdateBalanceLineChart(rows) {
  var canvas = document.getElementById('chartBalanceFlow');
  if (!canvas || typeof Chart === 'undefined') return;
  var series = aggregateBalanceByDate(rows && rows.length ? rows : []);
  var labels = series.labels, data = series.data, tradeCounts = series.tradeCounts;
  var hint = document.getElementById('chartLineHint');
  if (hint) {
    hint.textContent = labels.length === 0
      ? '예수금 잔고를 표시할 거래가 없습니다.'
      : labels.length + '개 거래일 기준 일별 말잔 예수금입니다.';
  }
  if (chartBalance) { chartBalance.destroy(); chartBalance = null; }
  chartBalance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
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
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: function (items) { return items[0] && items[0].label ? items[0].label : ''; },
            label: function (ctx) {
              var n = tradeCounts[ctx.dataIndex] || 0;
              return ['말잔 USD ' + formatUsd(ctx.parsed.y), n > 0 ? '당일 거래 ' + n + '건' : ''].filter(Boolean);
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { maxRotation: 45, minRotation: 35, autoSkip: true, maxTicksLimit: 16, font: { size: 10 } },
          grid: { display: false }
        },
        y: {
          ticks: { callback: function (val) { return formatUsd(Number(val)); } },
          grid: { color: '#f0f3fa' }
        }
      }
    }
  });
}
