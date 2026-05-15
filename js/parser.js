'use strict';

var ShinhanTradeParser = {

  cleanName: function (raw) {
    return raw.trim()
      // [N] 숫자 [N] 숫자 해외증권 suffix 제거
      .replace(/\s+\[\S*\]\s+\d+\s+\[\S*\]\s+\d+\s*해외증권\s*$/, '')
      // 잔류 해외증권
      .replace(/\s*해외증권\s*$/, '')
      // OCR italic/list 마커 제거: [i], [ul [i], [ul...] 등 소문자 bracket
      .replace(/\s*\[[a-z][^\]]*\]?/g, '')
      // 한글 시작 bracket 토큰 제거
      .replace(/\s+\[[가-힣][^\]]*(?:\]|$)/g, '')
      // 한글 포함 bracket 아티팩트 제거
      .replace(/\[[^\]]*[가-힣][^\]]*\]/g, '')
      // 뒤쪽에 붙은 독립 숫자·한글 단어(OCR 컬럼 유출) 제거
      .replace(/(\s+(?:[\d.,]+|[가-힣]+))+\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  },

  ROW_REGEX: /^(\d{4}[-./]\d{2}[-./]\d{2})\s+(.+?)\s+(?:해외증권\s+)?(해외주식매수|해외주식매도)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s*$/,
  ROW_REGEX_LOOSE:
    /(\d{4})[.\-/](\d{2})[.\-/](\d{2})\s+(.+?)\s+(?:해외\s*증권\s+)?(해외\s*주식\s*매[수도])\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)/,

  parseFromLines: function (logicalLines) {
    var rows = [];
    var merged = this.mergeWrappedRows(normalizeRawLines(logicalLines));
    for (var i = 0; i < merged.length; i++) {
      // normalizeOcrText를 라인별로 먼저 적용해 공백 분산 키워드를 정규화
      var normalized = this.normalizeOcrText(merged[i]);
      var parsed = this.tryParseSingleLine(normalized);
      if (parsed) rows.push(parsed);
    }
    if (rows.length === 0) {
      rows = this.parseFromBlob(merged.join('\n'));
    }
    return rows;
  },

  parseFromBlob: function (blob) {
    var text = this.normalizeOcrText(blob);
    var rows = [];
    var re = this.ROW_REGEX_LOOSE;
    var m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      var row = this.rowFromMatchGroups(
        m[1] + '-' + m[2] + '-' + m[3], m[4], m[5], m[6], m[7], m[8], m[9]
      );
      if (row) rows.push(row);
    }
    return rows;
  },

  normalizeOcrText: function (s) {
    return String(s)
      .replace(/ /g, ' ')
      // 글자 사이 공백이 어떻게 분산되어 있어도 처리 (한 글자씩 \s* 허용)
      .replace(/해\s*외\s*주\s*식\s*매\s*수/g, '해외주식매수')
      .replace(/해\s*외\s*주\s*식\s*매\s*도/g, '해외주식매도')
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
      name: ShinhanTradeParser.cleanName(String(name)),
      type: type,
      unitPrice:  parseNumberLoose(u),
      qty:        parseNumberLoose(q),
      settlement: parseNumberLoose(settle),
      balance:    parseNumberLoose(bal)
    };
    if (!row.date || !row.name || isNaN(row.unitPrice) || isNaN(row.qty) || isNaN(row.settlement) || isNaN(row.balance)) {
      return null;
    }
    return row;
  },

  mergeWrappedRows: function (lines) {
    // 한 줄에 여러 날짜가 붙어 있으면 먼저 분리 (clusterPdfTextItemsToLines 오합산 대응)
    var expanded = [];
    for (var i = 0; i < lines.length; i++) {
      var parts = lines[i].split(/(?=\d{4}[-./]\d{2}[-./]\d{2})/);
      for (var s = 0; s < parts.length; s++) {
        if (parts[s].trim()) expanded.push(parts[s].trim());
      }
    }

    var out = [];
    var buf = '';
    for (var j = 0; j < expanded.length; j++) {
      var line = expanded[j];
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

  tryParseSingleLine: function (line) {
    var trimmed = line.trim();
    var m = this.ROW_REGEX.exec(trimmed);
    if (m) {
      return this.rowFromMatchGroups(m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
    }
    m = this.ROW_REGEX_LOOSE.exec(trimmed);
    if (m) {
      return this.rowFromMatchGroups(
        m[1] + '-' + m[2] + '-' + m[3], m[4], m[5], m[6], m[7], m[8], m[9]
      );
    }
    return null;
  }
};
