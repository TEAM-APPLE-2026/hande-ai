import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract, match } from '../src/index.js';

const GROUPS = [
  { id: 'telecom', name: '[예시] △△ 통신사 고객정보 유출', company: '[예시] △△ 통신사', type: '개인정보 유출', period: '2026년 10월', keywords: '이름 연락처 주소 스미싱' },
  { id: 'shop', name: '[예시] ○○ 쇼핑몰 회원정보 유출', company: '[예시] ○○ 쇼핑몰', type: '개인정보 유출', period: '2026년 10월', keywords: '이메일 비밀번호' }
];

test('같은 회사 그룹만 남고 점수 순', () => {
  const r = match(extract('10월 초에 △△ 통신사에서 이름, 연락처가 유출됐다고 했어요. 스미싱 문자가 세 번 왔어요.'), GROUPS);
  assert.equal(r[0].groupId, 'telecom');
  assert.ok(r.every((x) => x.score >= 45));
  assert.ok(!r.some((x) => x.groupId === 'shop'));
});

test('맞는 그룹이 없으면 빈 배열 (화면: 추천 결과 없음)', () => {
  assert.deepEqual(match(extract('□□ 카드사에서 정보가 유출됐어요.'), GROUPS), []);
});
