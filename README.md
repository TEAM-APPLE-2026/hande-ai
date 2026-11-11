# hande-ai

HANDE의 AI 모듈. **피해 글 정리(extract)** 와 **같은 사건 찾기(match)** 를 담당한다.
서버 비용 없이 **브라우저에서 실행**되고, 프론트엔드가 이 패키지를 설치해서 쓴다.

> 키 · 비밀번호 · 실제 피해자 글은 이 레포에 올리지 않음. 평가 데이터는 직접 만든 예시 문장만.

## 구조
```
src/        extract.js · match.js · index.js (프론트는 index.js만 사용)
test/       단위 테스트 (npm test)
eval/       정확도 평가 데이터 · 스크립트 (npm run eval)
experiments/ 모델 실험 기록 (채택한 것만 src로)
```

## 프론트엔드에서 쓰는 법
```bash
# frontend 폴더에서 (버전 태그로 고정)
npm install github:TEAM-APPLE-2026/hande-ai#v0.1.0
```
```js
import { extract, match } from '@team-apple/hande-ai';

const report = extract(text);          // AI 정리 화면(#organize)
const found = match(report, groups);   // 같은 사건 찾기 화면(#match)
```
레포가 비공개라 설치하는 사람은 이 레포 읽기 권한이 있어야 한다. 배포 CI에서는 읽기 전용 토큰을 Secrets에 넣어 사용.

## 약속(인터페이스) — 바꾸면 버전을 올리고 프론트 담당에게 알리기
**extract(text)** → `{ fields:[{ key, label, value, quote, needsCheck, source }], filled, total }`
- key: company · type · noticeDate · leaked · secondary · card
- 못 찾으면 value=null, needsCheck=true (화면: "확인 필요")
- 빈 글이면 `Error('EMPTY_TEXT')` (화면: 입력 안내)

**match(report, groups)** → `[{ groupId, score, level, matches, diffs }]`
- 회사 · 유형으로 먼저 거르고 점수 계산. 70점 이상 same(같은 사건), 45~69 similar, 45 미만 제외
- 빈 배열이면 화면: "비슷한 사건을 찾지 못했어요 → 새 그룹 만들기"

## 화면 상태와 연결 (기능명세서 v2 4장)
| 화면 상태 | 모듈 쪽 |
|---|---|
| AI 분석 중 | extract/match 실행 중 (프론트가 표시) |
| AI 정리 실패 | 예외 발생 또는 3초 넘게 응답 없음 |
| 추천 결과 없음 | match()가 [] 반환 |

## 버전 올리기
```bash
npm version minor        # 0.1.0 → 0.2.0, 태그 v0.2.0 생성
git push --follow-tags
```
