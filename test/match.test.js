import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract, match } from '../src/index.js';

const NOW = new Date(2026, 10, 11);

// 계약 2장 Group 모양 (필요한 필드만 채운 [예시])
const group = (o) => ({
  name: '', company: '', harmType: 'privacy_leak', status: 'recruiting', subStatus: 'recruiting',
  memberCount: 0, description: '', conditions: '', periodStart: null, periodEnd: null,
  requiredEvidence: [], goal: null, deadline: null, proposalDeadline: null, method: null, selectedFirmName: null,
  ...o
});
const GROUPS = [
  group({ id: 'telecom', name: '[예시] △△ 통신사 고객정보 유출', company: '[예시] △△ 통신사',
    description: '이름, 연락처, 주소 유출', conditions: '유출 안내 문자를 받은 사람. 스미싱 등 2차 피해 포함',
    periodStart: '2026-09-20', periodEnd: '2026-09-30' }),
  group({ id: 'shop', name: '[예시] ○○ 쇼핑몰 회원정보 유출', company: '[예시] ○○ 쇼핑몰',
    description: '이메일 비밀번호 유출', periodStart: '2026-10-01', periodEnd: '2026-10-31' })
];
const report = (t) => extract(t, { now: NOW });

test('같은 회사 그룹만 남고 same, 결과 모양', () => {
  const r = match(report('10월 초에 △△ 통신사에서 이름, 연락처가 유출됐다는 문자를 받았어요. 스미싱 문자가 세 번 왔어요.'), GROUPS);
  assert.equal(r.length, 1);
  assert.equal(r[0].groupId, 'telecom');
  assert.equal(r[0].level, 'same');
  assert.ok(r[0].score >= 70);
  assert.deepEqual(Object.keys(r[0]).sort(), ['diffs', 'groupId', 'level', 'matches', 'score']);
});

test('시기가 많이 다르면 diffs에 적고 similar로 내려감', () => {
  const r = match(report('2026년 5월 1일에 △△ 통신사 유출 안내 문자를 받았어요. 이름이 유출됐대요.'), GROUPS);
  assert.equal(r[0].groupId, 'telecom');
  assert.equal(r[0].level, 'similar');
  assert.ok(r[0].diffs.some((d) => d.startsWith('시기')));
});

test('사용자가 고친 값(userValue)을 쓴다', () => {
  const rep = report('○○ 쇼핑몰에서 이메일이 유출됐어요.');
  const company = rep.fields.find((f) => f.key === 'company');
  company.userValue = '△△ 통신사';
  company.source = 'user';
  assert.equal(match(rep, GROUPS)[0].groupId, 'telecom');
});

test('마감(closed) 그룹, 다른 피해 유형은 제외', () => {
  const groups = [group({ ...GROUPS[0], status: 'closed' }), group({ ...GROUPS[0], id: 'other', harmType: 'other' })];
  assert.deepEqual(match(report('10월 초에 △△ 통신사 유출 문자를 받았어요.'), groups), []);
});

test('맞는 그룹이 없으면 빈 배열 (화면: 추천 결과 없음)', () => {
  assert.deepEqual(match(report('□□ 카드사에서 정보가 유출됐어요.'), GROUPS), []);
  assert.deepEqual(match(report('오늘 날씨가 좋네요.'), GROUPS), []);
  assert.deepEqual(match(report('△△ 통신사 유출'), []), []);
});
