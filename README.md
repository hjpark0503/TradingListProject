# trading-dashboard

신한투자증권 거래내역 대시보드 — 정적 HTML/CSS/JS 패키지

---

## 파일 구조

```
trading-dashboard/
├── index.html          # 메인 페이지 (진입점)
├── css/
│   └── style.css       # 전체 스타일시트
├── js/
│   └── main.js         # 탭 전환 인터랙션
└── README.md
```

---

## 실행 방법

별도 빌드 없이 브라우저에서 바로 열 수 있습니다.

```bash
# 로컬 서버 없이 바로 열기
open index.html

# 또는 간단한 로컬 서버 사용
npx serve .
python3 -m http.server 8080
```

---

## 구성 요소

### Header
- 계좌번호, 이름, 조회 기간, 발급번호 표시

### Summary Cards (5개)
- 매수 / 매도 / 세금 / 환전 / 배당금 건수 및 합계 표시
- 클릭 시 하단 탭과 연동 전환

### Charts Row (2-Column)
- **좌** 종목별 정산금액 바 차트 (인라인 `style` width % 로 표현)
- **우** 예수금 잔고 흐름 리스트

### Tab Section
| 탭 ID  | 내용        | accent 색상 |
|--------|------------|------------|
| `buy`  | 매수 거래    | `#d63031`  |
| `sell` | 매도 거래    | `#2d5fa6`  |
| `tax`  | 세금        | `#6c3483`  |
| `fx`   | 환전        | `#00838f`  |
| `div`  | 배당금       | `#27ae60`  |

---

## 커스터마이징 포인트

### 색상 변경
`css/style.css` 상단 주석의 색상 토큰 섹션 참고.
`data-tab` 값별 accent 색상이 카드·버튼·뱃지에 일괄 적용됩니다.

### 데이터 교체
`index.html` 내 각 `<tbody>` 의 `<tr>` 행을 수정하세요.
tfoot의 합계는 수동으로 맞춰야 합니다 (현재 정적 HTML).

> **참고:** 데이터를 JSON으로 관리하고 싶다면 `main.js`에
> 렌더링 함수를 추가하고 fetch로 불러오는 방식으로 확장하세요.

### 탭 추가
1. `index.html` 요약 카드 `.cards` 에 새 `.card` 추가
2. `.tab-bar` 에 새 `.tab-btn` 추가
3. 새 `#panel-{id}` div 추가
4. `css/style.css` 에 `.card[data-tab="{id}"].active` 및
   `.tab-btn[data-tab="{id}"].active` 색상 규칙 추가

---

## 의존성

없음. 외부 라이브러리·프레임워크 미사용 (Vanilla HTML/CSS/JS).

---

## 브라우저 지원

Chrome / Edge / Firefox / Safari 최신 버전
(CSS Grid, Flexbox 사용)
