/**
 * 신한투자증권 거래내역 PDF 추출 텍스트를 분석하여
 * 핵심 거래 정보(날짜, 종목명, 거래구분, 수량, 단가, 정산금액)를 정리하고
 * 텍스트 파일로 저장하는 스크립트
 *
 * 사용법:
 *   node scripts/parse-trades.js <dump-file>
 *
 * dump-file: dump-pdf-lines.mjs 로 생성한 pdf-dump.txt 경로
 * 출력: Shinhan_Trade_Summary.txt (스크립트 실행 디렉터리 기준)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('사용법: node scripts/parse-trades.js <dump-file>');
  console.error('  예시: node scripts/parse-trades.js scripts/pdf-dump.txt');
  process.exit(1);
}

const content = fs.readFileSync(path.resolve(inputPath), 'utf8');

function extractTradeDetails(content) {
  const datePattern = /\d{4}-\d{2}-\d{2}/g;
  const lines = content.split('\n');

  // 계좌번호·조회기간을 텍스트에서 동적으로 추출
  let accountNo = '';
  let periodLine = '';
  for (const line of lines) {
    if (!accountNo) {
      const m = line.match(/(\d{3}-\d{2}-\d{6})/);
      if (m) accountNo = m[1];
    }
    if (!periodLine) {
      const m = line.match(/(\d{4}-\d{2}-\d{2})\s*[~～]\s*(\d{4}-\d{2}-\d{2})/);
      if (m) periodLine = m[1] + ' ~ ' + m[2];
    }
  }

  let report = '=== 신한투자증권 거래내역 요약 ===\n';
  if (accountNo)  report += `계좌번호: ${accountNo}\n`;
  if (periodLine) report += `조회기간: ${periodLine}\n`;
  report += '------------------------------------------\n';
  report += '거래일자 | 거래구분 | 종목명 | 수량 | 단가 | 정산금액\n';
  report += '------------------------------------------\n';

  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line.match(/^\d{4}-\d{2}-\d{2}/)) continue;

    const date      = line.match(datePattern)[0];
    const name      = lines[i + 1] ? lines[i + 1].replace(/"/g, '').trim() : '정보없음';
    const price     = lines[i + 3] ? lines[i + 3].replace(/"/g, '').trim() : '0';
    const typeLine  = lines[i + 6] ? lines[i + 6].replace(/"/g, '').trim() : '';
    const amountLine    = lines[i + 7]  ? lines[i + 7].replace(/"/g, '').trim()  : '0';
    const settlementLine = lines[i + 10] ? lines[i + 10].replace(/"/g, '').trim() : '0';

    if (name === '정보없음' || name.includes('출력일자')) continue;

    report += `${date} | ${typeLine} | ${name} | ${amountLine} | ${price} | ${settlementLine} USD\n`;
    count++;
  }

  report += '------------------------------------------\n';
  report += `총 ${count}건\n`;

  const outPath = path.join(process.cwd(), 'Shinhan_Trade_Summary.txt');
  fs.writeFileSync(outPath, report, 'utf8');
  console.log(`추출 완료 (${count}건) → ${outPath}`);
}

extractTradeDetails(content);
