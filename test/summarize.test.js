import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/index.js';

// 계약 5장 예시
const STATS = { groupId: '<uuid>', memberCount: 5, secondaryYesCount: 2, secondaryKnownCount: 4, secondaryUnknownCount: 1,
  secondaryRatio: 0.5, evidenceHolderCount: 3, evidenceRatio: 0.6, asOf: '2026-11-13T09:00:00Z' };

test('3~4줄 요약, 비율은 %로', () => {
  const s = summarize(STATS);
  const lines = s.split('\n');
  assert.ok(lines.length >= 3 && lines.length <= 4);
  assert.match(s, /5명/);
  assert.match(s, /50%/);
  assert.match(s, /60%/);
});

test('비율이 null이면 "아직 집계 전"', () => {
  const s = summarize({ memberCount: 0, secondaryRatio: null, evidenceRatio: null });
  assert.equal(s.split('\n').length, 3);
  assert.equal((s.match(/아직 집계 전/g) || []).length, 2);
});

test('참여자가 적으면 재식별 주의 줄 추가', () => {
  const s = summarize({ ...STATS, memberCount: 3 });
  assert.equal(s.split('\n').length, 4);
  assert.match(s, /주의/);
});

test('숫자 항목만 읽는다: 다른 키의 글자는 결과에 안 들어감', () => {
  const s = summarize({ ...STATS, rawText: '홍길동 010-1234-5678', nickname: '홍길동' });
  assert.ok(!s.includes('홍길동') && !s.includes('010') && !s.includes('<uuid>'));
});

test('숫자 자리에 글자가 오면 오류', () => {
  assert.throws(() => summarize({ ...STATS, memberCount: '5명 홍길동' }), /INVALID_STATS/);
  assert.throws(() => summarize({ ...STATS, secondaryRatio: 1.5 }), /INVALID_STATS/);
  assert.throws(() => summarize({ ...STATS, evidenceHolderCount: -1 }), /INVALID_STATS/);
  assert.throws(() => summarize(null), /INVALID_STATS/);
});
