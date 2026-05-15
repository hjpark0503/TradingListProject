# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

신한투자증권 해외주식 거래내역 대시보드. 빌드 도구 없는 순수 HTML/CSS/Vanilla JS 정적 앱이며, PDF 업로드 → 파싱 → 차트 시각화의 전체 파이프라인을 브라우저 안에서 처리한다.

## 실행

```bash
# 빌드 불필요 — 바로 브라우저에서 열기
open index.html

# 또는 로컬 서버 (PDF.js Worker CORS 문제 회피 시 유용)
npx serve .
python3 -m http.server 8080
```

## 디버그 스크립트 (Node.js)

```bash
# PDF 텍스트 추출 결과를 scripts/pdf-dump.txt로 저장
node scripts/dump-pdf-lines.mjs <path-to.pdf>

# 특정 페이지 OCR 테스트 (기본: 2페이지, scale 2.5)
node scripts/ocr-pdf-page.mjs <path-to.pdf> [page] [scale]

# 거래 요약 텍스트 파일 생성 (dump 결과를 파싱 → Shinhan_Trade_Summary.txt)
node scripts/parse-trades.js scripts/pdf-dump.txt
```

스크립트 실행에는 `pdfjs-dist`, `canvas`, `tesseract.js`가 `node_modules`에 설치되어 있어야 한다 (project root에 `package.json` 없음 — 스크립트 디렉터리 기준으로 별도 설치 필요).

## 아키텍처

### 데이터 흐름

```
index.html <tbody> (정적 시드)
    └─ initDashboardFromStaticTables()  ← DOMContentLoaded
           └─ readTradesFromTbody()     DOM → TradeRow[]
           └─ refreshDashboardFromTrades()

PDF 업로드 버튼
    └─ handlePdfFile(file)
           ├─ extractLogicalLinesFromPdf()  pdf.js 텍스트 추출
           │       └─ clusterPdfTextItemsToLines()  y좌표 클러스터링 → 논리 행
           ├─ (텍스트 <40자이면 OCR로 폴백)
           │   └─ extractLogicalLinesViaOcr()  Tesseract.js, kor+eng
           ├─ ShinhanTradeParser.parseFromLines()
           │       ├─ mergeWrappedRows()   종목명 줄바꿈 보정
           │       ├─ tryParseSingleLine() ROW_REGEX → TradeRow
           │       └─ parseFromBlob()      ROW_REGEX_LOOSE (최후 수단)
           └─ refreshDashboardFromTrades(buys, sells)
                   ├─ updateSummaryCards()
                   ├─ updateBuySellTables()  → renderTradeTbody()
                   └─ renderOrUpdateBalanceLineChart()
```

### 핵심 타입

```js
/** @typedef {{ date: string, name: string, type: string, unitPrice: number, qty: number, settlement: number, balance: number }} TradeRow */
```

`type` 값은 `'해외주식매수'` 또는 `'해외주식매도'`만 허용. 세금·환전·배당 탭은 정적 HTML로만 관리되며 JS 파싱 대상이 아니다.

### 탭 시스템

카드(`.card[data-tab]`), 탭 버튼(`.tab-btn[data-tab]`), 패널(`#panel-{id}`) 세 요소가 동일한 `data-tab` 값으로 연결된다. `switchTab(tab)` 하나가 세 군데 `.active` 클래스를 모두 동기화한다.

탭 ID와 색상 매핑:

| 탭 ID | 의미 | accent 색상 |
|-------|------|------------|
| `buy` | 매수 | `#d63031` |
| `sell` | 매도 | `#2d5fa6` |
| `tax` | 세금 | `#6c3483` |
| `fx` | 환전 | `#00838f` |
| `div` | 배당금 | `#27ae60` |

새 탭 추가 시 HTML(카드·버튼·패널) + CSS(`.card[data-tab].active`, `.tab-btn[data-tab].active`) 네 곳을 모두 수정해야 한다.

### PDF 파서 상세

`ShinhanTradeParser`는 신한투자증권 해외주식 거래내역서 형식 전용이다.

- **ROW_REGEX**: 날짜·종목명·유형·단가·수량·정산·예수금잔고가 한 줄에 있는 경우
- **ROW_REGEX_LOOSE**: OCR 오인식으로 공백이 흐트러진 경우 (전체 텍스트 blob에 `g` 플래그로 적용)
- `mergeWrappedRows()`: 날짜로 시작하지 않는 줄을 앞 줄에 이어붙여 종목명 줄바꿈을 복원
- `normalizeOcrText()`: `해외 주식 매 수` 같이 OCR이 띄어쓴 키워드를 정규화

### 차트

`chartBalance` (전역 변수)는 Chart.js 인스턴스를 보관한다. `renderOrUpdateBalanceLineChart()` 호출 시 기존 인스턴스를 `.destroy()` 후 재생성한다 (Chart.js 4.x에서 같은 canvas 재사용 필요).

`aggregateBalanceByDate()`는 매수+매도 전체 행을 날짜 오름차순으로 정렬한 뒤 당일 마지막 거래의 `balance`를 말잔으로 취한다.

## 외부 라이브러리 (CDN 버전 고정)

| 라이브러리 | 버전 | 용도 |
|-----------|------|------|
| pdf.js | 3.11.174 | PDF 텍스트/렌더링 |
| Chart.js | 4.4.1 | 예수금 흐름 선 차트 |
| Tesseract.js | 5.1.1 | 이미지 PDF OCR |

버전을 변경하면 `pdfjsLib.GlobalWorkerOptions.workerSrc` URL도 함께 맞춰야 한다 (`main.js` 상단).

## 데이터 교체 방법

`index.html` 각 `<tbody>` 의 `<tr>` 행을 직접 수정한다. 페이지 로드 시 `initDashboardFromStaticTables()`가 DOM을 읽어 카드·차트를 자동 갱신한다. `<tfoot>` 합계는 정적이므로 수동으로 맞춰야 한다.
