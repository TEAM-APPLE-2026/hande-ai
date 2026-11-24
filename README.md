# hande-ai

HANDE의 AI 모듈. **피해 글 정리(extract)** · **같은 사건 찾기(match)** · **새 그룹 초안(draftGroup)** · **로펌용 익명 요약(summarize)** 을 담당한다.
서버 비용 없이 **브라우저에서 실행**되고, 프론트엔드가 이 패키지를 설치해서 쓴다.

> 키 · 비밀번호 · 실제 피해자 글은 이 레포에 올리지 않음. 평가 데이터는 직접 만든 예시 문장만.

데이터 모양의 기준: backend 레포 `docs/database/integration-contract.md` (2장 Group, 4장 AI 결과 → report_fields, 5장 익명 집계).

## 구조
```
src/        extract.js · date.js · sensitive.js · match.js · draft.js · summarize.js · analyze.js · index.js (프론트는 index.js만 사용)
test/       단위 테스트 (npm test)
eval/       정확도 평가 데이터 · 스크립트 (npm run eval)
experiments/ 모델 실험 기록 (채택한 것만 src로)
```

## 프론트엔드에서 쓰는 법
```bash
# frontend 폴더에서 (버전 태그로 고정)
npm install github:TEAM-APPLE-2026/hande-ai#v0.3.0
```
```js
import { analyze, extract, match, draftGroup, summarize } from '@team-apple/hande-ai';

// AI 정리 화면(#organize): 20초 제한 + 공통 응답 모양
const r = await analyze(text);                 // { data: { fields, warnings } } | { error: { code, message } }
const r2 = await analyze(text, { groups });    // groups를 주면 data.candidates(같은 사건 후보)도 같이

// 사용자가 고친 뒤 다시 찾기(#match)
const found = match({ fields }, groups);

// 새 그룹 만들기(R-06): create_group 인자 초안. needsCheck의 키는 화면에서 "확인 필요"로 표시
const draft = draftGroup({ fields });           // { name, company, harmType, description, ... } | { error: 'COMPANY_REQUIRED' }
if (!draft.error) {
  const { needsCheck, ...input } = draft;        // needsCheck는 화면용. 보내기 전에 빼고 reportId를 붙인다
  await createGroup({ reportId, ...input });
}

// 로펌 화면: get_group_stats 결과의 숫자만 사용
const lines = summarize(stats);                // "\n"으로 이은 3~4줄
```
레포가 비공개라 설치하는 사람은 이 레포 읽기 권한이 있어야 한다. 배포 CI에서는 읽기 전용 토큰을 Secrets에 넣어 사용.

## 약속(인터페이스) — 바꾸면 버전을 올리고 프론트 담당에게 알리기

### extract(text, { now? }) → `{ fields: ReportField[], warnings: string[] }`
```ts
type FieldKey = 'company' | 'type' | 'notice_date' | 'leaked' | 'secondary' | 'card' | 'secondary_detail';
type FieldValue = string | string[] | { from: string; to: string; precision: 'day' | 'month' | 'year' };
type ReportField = { key: FieldKey; aiValue: FieldValue | null; quote: string | null;
  userValue: FieldValue | null; source: 'ai' | 'user'; needsCheck: boolean };
```
| key | aiValue | 예 |
|---|---|---|
| company | 기업명 string | `"△△ 통신사"` |
| type | `'privacy_leak'` (개인정보 유출이 아니면 null) | `"privacy_leak"` |
| notice_date | `{ from, to, precision }` (아래 규칙) | `{ from:"2026-10-01", to:"2026-10-31", precision:"month" }` |
| leaked | string[] — 이름 · 연락처 · 전화번호 · 주소 · 이메일 · 생년월일 · 주민등록번호 · 계좌 · 아이디 · 비밀번호 | `["이름","연락처","주소"]` |
| secondary | `'yes' \| 'no' \| 'unknown'` (2차 피해) | `"yes"` |
| card | `'yes' \| 'no' \| 'unknown'` (카드 정보 유출) | `null` |
| secondary_detail (선택) | 2차 피해 상세 string, 1~1000자 | `"스미싱 문자 3회"` |

- fields는 기본 6개가 항상 위 순서로 오고, 2차 피해 상세를 찾은 경우에만 맨 뒤에 `secondary_detail`이 붙는다. 상세가 없으면 이 필드는 결과에 없다(저장 함수는 null이면서 needsCheck=false인 필드를 거부한다). extract는 `userValue=null`, `source='ai'`로 채운다. 사용자가 고치면 화면에서 userValue와 source='user'만 바꾸고 aiValue · quote는 그대로 둔다.
- **못 찾으면 aiValue=null, quote=null, needsCheck=true** (화면: "확인 필요"). `unknown`으로 찾은 값, 근거(quote)를 붙이지 못한 값도 needsCheck=true.
- **secondary · card의 부정 판단**: 키워드와 같은 절의 가까운 부정 표현(안 왔 · 없었 · 않았 · 아니 · 못 받 · 괜찮 등)이 있으면 `no`. 다른 문장의 부정은 보지 않는다. 같은 글에 긍정과 부정이 함께 있으면 `unknown`, needsCheck=true. `yes`가 아니면 secondary_detail을 만들지 않는다.
- **quote는 원문 안에 그대로 있는 문자열**(대개 근거 문장, 날짜·회사는 그 표현). 외부 공개하지 않음.
- **warnings**: 주민등록번호 · 카드번호 · 계좌번호 모양의 숫자가 있으면 `['SENSITIVE_NUMBER']`. 번호 자체는 결과(aiValue · quote) 어디에도 넣지 않는다 — 번호가 섞인 문장은 quote를 짧은 표현으로 바꾸거나 null로 둔다. 전화번호(010-…, 02-…)와 날짜는 해당 없음.
- 빈 글이면 `Error('EMPTY_TEXT')`, 2000자 넘으면 `Error('TEXT_TOO_LONG')` (analyze에서는 INVALID_INPUT).

### notice_date 규칙
연도가 없으면 **올해**(`now`, 기본: 오늘) 기준. 백엔드 저장 함수 규칙에 따라 day는 from=to, month는 그 달 1일~말일, year는 1/1~12/31만 쓴다.

| 원문 | from ~ to | precision |
|---|---|---|
| `2026년 10월 3일`, `2025.3.14`, `2025-12-01`, `9월 5일` | 그날 ~ 그날 | day |
| `10월 초` · `상순` · `중순` · `하순` · `말` | 10/1 ~ 10/31 (세부 표현은 quote에 원문 그대로) | month |
| `8월`, `2024년 2월` | 그달 1일 ~ 말일 | month |
| `2025년`, `작년` | 1/1 ~ 12/31 | year |
| `지난달` · `저번 달`, `이번 달` | 그달 1일 ~ 말일 | month |
| `오늘` · `어제` · `그제` | 그날 | day — 통지 문장 안에서만 |

- 날짜가 여러 개면 **통지 문장**(안내 · 문자 · 메일 · 공지 · 통지 등이 있는 문장)의 날짜를 먼저 고르고, 스미싱 등 2차 피해 문장의 날짜는 뒤로 미룬다. 통지 문장이 아닌 곳에서 고른 날짜는 needsCheck=true.
- 없는 날짜(2월 30일)는 날짜로 쓰지 않는다.
- 날짜를 전혀 못 찾으면 `aiValue=null`, `needsCheck=true`. `{ precision:'unknown' }` 객체는 만들지 않는다.
- notice_date는 실제 유출일이 아니라 **통지받은 시점**이다(백엔드 report-storage 문서).

### match(report, groups) → `[{ groupId, score, level, matches, diffs }]`
- report: `{ fields: ReportField[] }`(또는 fields 배열). 값은 source='user'면 userValue, 아니면 aiValue.
- groups: 계약 2장 `Group` (company, harmType, status, periodStart, periodEnd, description, conditions 등).
- 1단계 거르기: 회사 이름이 같고(공백 · `[예시]` · `(주)` 무시) harmType이 type과 같은 그룹만. status='closed' 그룹은 제외.
- 2단계 점수(최대 100): 회사 40 + 유형 20 + 시기 ±20 + 유출 정보 겹침 15 + 2차 피해 언급 5
  - 시기: notice_date가 그룹 기간(앞뒤 60일 여유)과 겹치면 +20, 확실히 어긋나면 −20(diffs에 기록), 어느 쪽이든 모르면 0
- **70점 이상 same(같은 사건), 45~69 similar, 45 미만 제외.** 점수 높은 순.
- 빈 배열이면 화면: "비슷한 사건을 찾지 못했어요 → 새 그룹 만들기"
- 점수는 참여 자격 · 권한의 근거가 아님(계약 4장).

### draftGroup(report) → create_group 인자 초안 (R-06)
- report: `{ fields: ReportField[] }`(또는 fields 배열), 사용자 수정 반영본. 값은 match와 같이 finalValue(source='user'면 userValue).
- 결과(camelCase, 계약 3장 createGroup 입력과 같은 이름):
```ts
{ name: string; company: string; harmType: 'privacy_leak'; description: string; conditions: string;
  periodStart: string | null; periodEnd: string | null; requiredEvidence: string[]; needsCheck: string[] }
```
| 키 | 규칙 | 예 |
|---|---|---|
| name | 1~100자. `회사 개인정보 유출 피해 모임 (YYYY.MM)`, 기간을 모르면 괄호 없음, year면 `(YYYY)`. 길면 회사 부분을 줄인다 | `"○○쇼핑 개인정보 유출 피해 모임 (2026.10)"` |
| company | 1~200자. 없으면 초안 없이 `{ error: 'COMPANY_REQUIRED' }` | `"○○쇼핑"` |
| harmType | 항상 `'privacy_leak'` | |
| description | 1~2000자, 3문장: 유출 안내 시점 · 유출 항목(card=yes면 `카드 정보` 추가) · 2차 피해 여부 | |
| conditions | 문자열 0~1000자, 참여 조건 2~4줄(`
`) — 안내 받은 회사 · 시기(있으면) · 유출 항목(있으면) · 확인 자료 | |
| periodStart / periodEnd | notice_date의 from / to. 날짜를 모르거나 형식이 틀리면 둘 다 null | `"2026-10-01"` / `"2026-10-31"` |
| requiredEvidence | 최대 20개, 각 1~100자. `유출 안내 문자·메일 캡처` + secondary=yes면 `스미싱·이상 결제 문자 캡처` + card=yes면 `카드 재발급·결제 내역` | |
| needsCheck | 확인이 필요한 초안 키 목록 (화면: "확인 필요") | `["periodStart","periodEnd"]` |

- **needsCheck**: 값이 없거나 AI가 needsCheck=true로 둔 필드에서 만든 키를 넣는다. 사용자가 고친 필드(source='user')는 확인한 값으로 본다.
  company → name · company · description · conditions / notice_date → name · description · conditions · periodStart · periodEnd / leaked → description · conditions / secondary · card → description · requiredEvidence
- **개인정보를 넣지 않는다**: 원문 · quote · secondary_detail 같은 자유 글은 읽지 않는다. 회사 이름에서는 전화번호 · 이메일 · 민감 번호를 지우고(지웠으면 company 확인 필요), 유출 항목은 정해진 이름(extract의 leaked 목록)만 쓴다. 그 밖의 글자는 빼고 확인 필요로 표시.
- `needsCheck`는 백엔드로 보내지 않는다. reportId · goal · deadline은 프론트가 붙인다.
- fields가 배열이 아니면 `TypeError('INVALID_REPORT')`.

### summarize(stats) → string (3~4줄, `\n`으로 구분)
- stats: 계약 5장 익명 집계. **숫자 항목만 읽는다**: memberCount(필수), secondaryYesCount, secondaryKnownCount, secondaryUnknownCount, secondaryRatio, evidenceHolderCount, evidenceRatio. 다른 키(groupId, asOf, 그 밖의 글자)는 읽지 않으므로 원문 · 이름 · 연락처가 요약에 들어갈 수 없다.
- 숫자 자리에 숫자가 아닌 값, 음수, 1 넘는 비율이 오면 `TypeError('INVALID_STATS: …')`.
- 비율이 null이면 그 줄은 "아직 집계 전".
- 참여자가 5명 미만이면 "개인이 드러날 수 있으니 외부 공유에 주의" 줄을 붙인다(4줄).

### analyze(text, { timeoutMs = 20000, now?, groups? }) → Promise
- 성공 `{ data: { fields, warnings, candidates? } }` / 실패 `{ error: { code, message } }` — 계약 1장의 배타적 응답 모양.

| code | 언제 | 화면 |
|---|---|---|
| AI_TIMEOUT | timeoutMs(기본 20초)를 넘김 | 분석 재시도 · 직접 수정 안내 |
| AI_FAILED | 그 밖의 예외 (내부 오류 내용은 message에 넣지 않음) | 분석 재시도 · 직접 수정 안내 |
| INVALID_INPUT | 빈 글, 2000자 초과 | 입력 안내 |

- `withTimeout(task, timeoutMs)`도 내보낸다. 나중에 모델(비동기)로 바꿔도 같은 응답 모양을 쓰기 위함. 동기 코드는 중간에 끊을 수 없어서 끝난 뒤 시간을 넘겼으면 AI_TIMEOUT으로 본다.
- 재시도는 사용자가 고른다(자동 재시도 없음).

## 화면 상태와 연결 (기능명세서 v2 4장)
| 화면 상태 | 모듈 쪽 |
|---|---|
| AI 분석 중 | analyze 실행 중 (프론트가 표시) |
| AI 정리 실패 | analyze가 `error.code` AI_TIMEOUT(20초 초과) 또는 AI_FAILED 반환 |
| 민감 번호 경고 | `warnings`에 SENSITIVE_NUMBER |
| 확인 필요 | field.needsCheck=true |
| 추천 결과 없음 | match()가 [] 반환 |
| 새 그룹 초안 · 확인 필요 | draftGroup()의 needsCheck에 있는 키 |
| 회사 입력 필요 | draftGroup()이 `{ error: 'COMPANY_REQUIRED' }` 반환 |

## 버전 올리기
```bash
npm version minor        # 0.3.0 → 0.4.0, 태그 v0.4.0 생성
git push --follow-tags
```
