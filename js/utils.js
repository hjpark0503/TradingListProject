/* global */
'use strict';

/** @typedef {{ date: string, name: string, type: string, unitPrice: number, qty: number, settlement: number, balance: number }} TradeRow */

function parseNumberLoose(s) {
  if (s == null) return NaN;
  var t = String(s).replace(/,/g, '').replace(/[^\d.\-+]/g, '').trim();
  if (t === '' || t === '-' || t === '+') return NaN;
  return parseFloat(t);
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function animateCount(el, target, duration, formatter) {
  if (duration <= 0) { el.textContent = formatter(target); return; }
  var start = performance.now();
  var sign = target < 0 ? -1 : 1;
  var absTarget = Math.abs(target);
  function step(now) {
    var t = Math.min((now - start) / duration, 1);
    var eased = 1 - Math.pow(1 - t, 3);
    el.textContent = formatter(sign * eased * absTarget);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = formatter(target);
  }
  requestAnimationFrame(step);
}

function sortRowsByDateStable(rows) {
  return rows
    .map(function (r, i) { return { r: r, i: i }; })
    .sort(function (a, b) {
      if (a.r.date !== b.r.date) return a.r.date < b.r.date ? -1 : 1;
      return a.i - b.i;
    })
    .map(function (x) { return x.r; });
}
