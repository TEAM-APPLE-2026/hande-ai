import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, withTimeout, AI_TIMEOUT_MS } from '../src/index.js';

test('기본 시간 제한은 20초', () => { assert.equal(AI_TIMEOUT_MS, 20000); });

test('성공은 { data }만', async () => {
  const r = await analyze('10월 초에 △△ 통신사 유출 문자를 받았어요.', { now: new Date(2026, 10, 11) });
  assert.deepEqual(Object.keys(r), ['data']);
  assert.equal(r.data.fields.length, 6);
  assert.deepEqual(r.data.warnings, []);
});

test('groups를 주면 같은 사건 후보(candidates)도 같이', async () => {
  const groups = [{ id: 'g1', name: '', company: '△△ 통신사', harmType: 'privacy_leak', status: 'recruiting',
    description: '', conditions: '', periodStart: null, periodEnd: null }];
  const r = await analyze('△△ 통신사에서 이름이 유출됐어요.', { groups });
  assert.equal(r.data.candidates[0].groupId, 'g1');
});

test('시간 초과는 AI_TIMEOUT', async () => {
  const slow = () => new Promise((resolve) => setTimeout(() => resolve('늦음'), 200));
  const r = await withTimeout(slow, 20);
  assert.equal(r.error.code, 'AI_TIMEOUT');
  assert.equal(typeof r.error.message, 'string');
  assert.ok(!('data' in r));
});

test('예외는 AI_FAILED', async () => {
  const r = await withTimeout(() => { throw new Error('model crashed'); });
  assert.deepEqual(Object.keys(r), ['error']);
  assert.equal(r.error.code, 'AI_FAILED');
  assert.ok(!r.error.message.includes('model crashed')); // 내부 오류 내용은 노출하지 않음
});

test('빈 글은 INVALID_INPUT', async () => {
  assert.equal((await analyze('   ')).error.code, 'INVALID_INPUT');
  assert.equal((await analyze('가'.repeat(2001))).error.code, 'INVALID_INPUT');
});
