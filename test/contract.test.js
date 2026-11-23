// 백엔드 save_report의 값 검증을 그대로 옮긴 검사 (backend: docs/development/report-storage.md "키별 값 검증")
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract, FIELD_KEYS, OPTIONAL_FIELD_KEYS } from '../src/index.js';

const NOW = new Date(2026, 10, 11);
const ALLOWED_KEYS = new Set([...FIELD_KEYS, ...OPTIONAL_FIELD_KEYS]);
const FIELD_PROPS = ['aiValue', 'key', 'needsCheck', 'quote', 'source', 'userValue'];

// PostgreSQL char_length처럼 문자 단위로 세고, btrim처럼 앞뒤 공백을 뺀다
const len = (s) => [...s.replace(/^ +| +$/g, '')].length;
const isText = (v, max) => typeof v === 'string' && len(v) >= 1 && len(v) <= max;
const pad = (n) => String(n).padStart(2, '0');

function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function validNoticeDate(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (Object.keys(v).sort().join() !== 'from,precision,to') return false;
  if (!validDate(v.from) || !validDate(v.to) || v.from > v.to) return false;
  const [y, m] = v.from.split('-').map(Number);
  if (v.precision === 'day') return v.from === v.to;
  if (v.precision === 'month') {
    const end = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return v.from === `${y}-${pad(m)}-01` && v.to === `${y}-${pad(m)}-${pad(end)}`;
  }
  if (v.precision === 'year') return v.from === `${y}-01-01` && v.to === `${y}-12-31`;
  return false; // extract는 unknown 객체를 만들지 않는다
}

function validValue(key, v) {
  if (v === null) return true;
  if (key === 'company') return isText(v, 200);
  if (key === 'type') return v === 'privacy_leak';
  if (key === 'notice_date') return validNoticeDate(v);
  if (key === 'leaked') return Array.isArray(v) && v.length <= 30 && v.every((x) => isText(x, 100));
  if (key === 'secondary' || key === 'card') return ['yes', 'no', 'unknown'].includes(v);
  if (key === 'secondary_detail') return isText(v, 1000);
  return false;
}

function assertSavable(text, { fields }) {
  assert.ok(fields.length <= 7, text);
  assert.equal(new Set(fields.map((f) => f.key)).size, fields.length, `중복 key: ${text}`);
  for (const k of FIELD_KEYS) assert.ok(fields.some((f) => f.key === k), `${k} 누락: ${text}`);
  for (const f of fields) {
    const at = `${f.key}: ${text}`;
    assert.deepEqual(Object.keys(f).sort(), FIELD_PROPS, at);
    assert.ok(ALLOWED_KEYS.has(f.key), at);
    assert.equal(f.source, 'ai', at);
    assert.equal(f.userValue, null, at);
    assert.equal(typeof f.needsCheck, 'boolean', at);
    assert.ok(validValue(f.key, f.aiValue), `값 오류 ${JSON.stringify(f.aiValue)} — ${at}`);
    if (f.aiValue === null) assert.equal(f.needsCheck, true, at);
    if (f.quote !== null) {
      assert.ok(isText(f.quote, 2000), at);
      assert.ok(text.includes(f.quote), `quote가 원문에 없음 — ${at}`);
    }
  }
  assert.ok(!fields.some((f) => f.key === 'secondary_detail' && f.aiValue === null), text);
}

const SAMPLES = [
  '10월 초에 △△ 통신사에서 고객정보가 유출됐다는 문자를 받았어요. 이름, 연락처, 주소가 유출됐다고 했어요. 10월 초부터 택배 사칭 스미싱 문자가 세 번 왔어요.',
  '10월 중순에 □□ 카드사 유출 안내를 받았어요. 카드 정보는 유출되지 않았대요. 2차 피해는 아직 없어요.',
  '2월 말에 ○○ 쇼핑몰 해킹 공지를 봤어요. 카드번호가 유출됐어요. 보이스피싱 전화를 2회 받았어요.',
  '2024년 2월 말에 유출 메일을 받았어요.',
  '2025년에 유출 안내를 받았어요.',
  '작년에 유출 공지를 봤어요.',
  '지난달에 유출 안내 문자를 받았어요.',
  '어제 유출 안내 문자가 왔어요.',
  '2월 30일에 유출 문자를 받았어요.',
  '△△ 은행에서 이름과 계좌번호 110-123-456789 가 유출됐어요. 스미싱 문자 110-123-456789 도 왔어요.',
  '오늘 날씨가 좋네요.',
  '가'.repeat(2000)
];

test('다양한 글의 결과가 저장 함수의 검증을 모두 통과', () => {
  for (const text of SAMPLES) assertSavable(text, extract(text, { now: NOW }));
});

test('모든 달의 초·중순·말·하순·상순은 그 달 1일~말일 (윤년 포함)', () => {
  for (const [y, end2] of [[2024, 29], [2026, 28]]) {
    for (let m = 1; m <= 12; m++) {
      for (const part of ['', ' 초', ' 상순', ' 중순', ' 하순', ' 말']) {
        const expr = `${y}년 ${m}월${part}`;
        const text = `${expr}에 유출 안내 문자를 받았어요.`;
        const r = extract(text, { now: NOW });
        assertSavable(text, r);
        const f = r.fields.find((x) => x.key === 'notice_date');
        const end = m === 2 ? end2 : new Date(Date.UTC(y, m, 0)).getUTCDate();
        assert.deepEqual(f.aiValue, { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(end)}`, precision: 'month' }, text);
        assert.equal(f.quote, expr, text); // 세부 표현은 원문 그대로
      }
    }
  }
});

test('날짜를 못 찾으면 aiValue=null, needsCheck=true (unknown 객체 없음)', () => {
  const f = extract('△△ 통신사에서 이름이 유출됐어요.', { now: NOW }).fields.find((x) => x.key === 'notice_date');
  assert.equal(f.aiValue, null);
  assert.equal(f.quote, null);
  assert.equal(f.needsCheck, true);
});

test('secondary_detail은 없으면 빠지고, 있으면 1~1000자이며 민감 번호가 없다', () => {
  const none = extract('△△ 통신사에서 이름이 유출됐어요.', { now: NOW });
  assert.ok(!none.fields.some((f) => f.key === 'secondary_detail'));

  const text = '△△ 은행 유출이요. 스미싱 문자 110-123-456789 를 3회 받았어요.';
  const r = extract(text, { now: NOW });
  const d = r.fields.find((f) => f.key === 'secondary_detail');
  assert.equal(d.aiValue, '스미싱 문자 3회');
  assert.ok(!JSON.stringify(r).includes('456789'));
  assertSavable(text, r);
});

test('검사기 자체가 잘못된 값을 거른다', () => {
  assert.equal(validNoticeDate({ from: '2026-10-01', to: '2026-10-10', precision: 'month' }), false);
  assert.equal(validNoticeDate({ from: '2026-01-01', to: '2026-12-30', precision: 'year' }), false);
  assert.equal(validNoticeDate({ from: '2026-10-01', to: '2026-10-02', precision: 'day' }), false);
  assert.equal(validNoticeDate({ from: null, to: null, precision: 'unknown' }), false);
  assert.equal(validValue('company', ' '), false);
  assert.equal(validValue('company', '가'.repeat(201)), false);
  assert.equal(validValue('leaked', Array(31).fill('이름')), false);
  assert.equal(validValue('leaked', ['가'.repeat(101)]), false);
  assert.equal(validValue('secondary_detail', '가'.repeat(1001)), false);
});
