import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract, FIELD_KEYS } from '../src/index.js';

const NOW = new Date(2026, 10, 11); // 2026-11-11, 연도 없는 날짜의 기준
const TEXT = '10월 초에 △△ 통신사에서 고객정보가 유출됐다는 문자를 받았어요. 이름, 연락처, 주소가 유출됐다고 했어요. 10월 초부터 택배 사칭 스미싱 문자가 세 번 왔어요.';

const fieldsOf = (text) => {
  const r = extract(text, { now: NOW });
  return Object.fromEntries(r.fields.map((f) => [f.key, f]));
};
const dateOf = (text) => fieldsOf(text).notice_date.aiValue;

test('ReportField 모양: key 6개, userValue=null, source=ai', () => {
  const r = extract(TEXT, { now: NOW });
  assert.deepEqual(r.fields.map((f) => f.key), FIELD_KEYS);
  for (const f of r.fields) {
    assert.deepEqual(Object.keys(f).sort(), ['aiValue', 'key', 'needsCheck', 'quote', 'source', 'userValue']);
    assert.equal(f.userValue, null);
    assert.equal(f.source, 'ai');
  }
  assert.deepEqual(r.warnings, []);
});

test('예시 글에서 5개 정리, 카드 정보는 확인 필요', () => {
  const f = fieldsOf(TEXT);
  assert.equal(f.company.aiValue, '△△ 통신사');
  assert.equal(f.type.aiValue, 'privacy_leak');
  assert.deepEqual(f.notice_date.aiValue, { from: '2026-10-01', to: '2026-10-10', precision: 'month' });
  assert.deepEqual(f.leaked.aiValue, ['이름', '연락처', '주소']);
  assert.equal(f.secondary.aiValue, 'yes');
  assert.equal(f.card.aiValue, null);
  assert.equal(f.card.needsCheck, true);
  assert.equal(Object.values(f).filter((x) => !x.needsCheck).length, 5);
});

test('quote는 원문 안에 그대로 있다', () => {
  for (const f of extract(TEXT, { now: NOW }).fields) if (f.quote) assert.ok(TEXT.includes(f.quote), f.key);
});

test('날짜: 여러 형식', () => {
  const cases = [
    ['2026년 10월 3일에 유출 안내 문자를 받았어요.', { from: '2026-10-03', to: '2026-10-03', precision: 'day' }],
    ['2025.3.14 해킹 안내 메일을 받았어요.', { from: '2025-03-14', to: '2025-03-14', precision: 'day' }],
    ['2025-12-01 유출 공지가 올라왔어요.', { from: '2025-12-01', to: '2025-12-01', precision: 'day' }],
    ['9월 5일에 유출 통지를 받았어요.', { from: '2026-09-05', to: '2026-09-05', precision: 'day' }],
    ['10월 초에 유출 문자를 받았어요.', { from: '2026-10-01', to: '2026-10-10', precision: 'month' }],
    ['10월 중순에 유출 문자를 받았어요.', { from: '2026-10-11', to: '2026-10-20', precision: 'month' }],
    ['2월 말에 유출 문자를 받았어요.', { from: '2026-02-21', to: '2026-02-28', precision: 'month' }],
    ['8월에 유출 안내를 받았어요.', { from: '2026-08-01', to: '2026-08-31', precision: 'month' }],
    ['2024년 2월에 유출 안내를 받았어요.', { from: '2024-02-01', to: '2024-02-29', precision: 'month' }],
    ['2025년에 유출 안내를 받았어요.', { from: '2025-01-01', to: '2025-12-31', precision: 'year' }],
    ['지난달에 유출 안내 문자를 받았어요.', { from: '2026-10-01', to: '2026-10-31', precision: 'month' }],
    ['작년에 유출 공지를 봤어요.', { from: '2025-01-01', to: '2025-12-31', precision: 'year' }],
    ['어제 유출 안내 문자가 왔어요.', { from: '2026-11-10', to: '2026-11-10', precision: 'day' }]
  ];
  for (const [text, want] of cases) assert.deepEqual(dateOf(text), want, text);
});

test('날짜: 없는 날짜(2월 30일)는 쓰지 않고, 흔한 말 "오늘"은 통지 문장이 아니면 무시', () => {
  assert.equal(dateOf('2월 30일에 유출 문자를 받았어요.').from, '2026-02-01'); // "2월"만 월 단위로
  assert.equal(dateOf('오늘 기분이 안 좋아요. 개인정보가 유출됐대요.'), null);
});

test('날짜: 통지 문장의 날짜를 2차 피해 문장보다 먼저 고른다', () => {
  const f = fieldsOf('9월 말부터 스미싱 문자가 왔어요. 10월 5일에 △△ 통신사 유출 안내 문자를 받았어요.');
  assert.deepEqual(f.notice_date.aiValue, { from: '2026-10-05', to: '2026-10-05', precision: 'day' });
  assert.equal(f.notice_date.quote, '10월 5일');
  assert.equal(f.notice_date.needsCheck, false);
});

test('날짜: 통지 문장이 아닌 곳에서 찾으면 확인 필요', () => {
  const f = fieldsOf('10월에 △△ 쇼핑몰 개인정보가 유출됐어요.');
  assert.equal(f.notice_date.aiValue.precision, 'month');
  assert.equal(f.notice_date.needsCheck, true);
});

test('2차 피해 · 카드: yes / no / unknown', () => {
  const no = fieldsOf('□□ 카드사에서 이메일 주소와 생년월일이 유출됐대요. 카드 정보는 유출되지 않았대요. 2차 피해는 아직 없어요.');
  assert.equal(no.secondary.aiValue, 'no');
  assert.equal(no.card.aiValue, 'no');
  assert.deepEqual(no.leaked.aiValue, ['이메일', '생년월일']); // "이메일 주소"를 '주소'로 세지 않음

  const yes = fieldsOf('○○ 쇼핑몰에서 카드번호가 유출됐어요. 보이스피싱 전화를 받았어요.');
  assert.equal(yes.card.aiValue, 'yes');
  assert.equal(yes.secondary.aiValue, 'yes');

  const unk = fieldsOf('△△ 통신사 정보가 유출됐어요. 2차 피해가 있는지는 잘 모르겠어요.');
  assert.equal(unk.secondary.aiValue, 'unknown');
  assert.equal(unk.secondary.needsCheck, true);
});

test('개인정보 유출이 아니면 type=null, 확인 필요', () => {
  const f = fieldsOf('△△ 쇼핑몰에서 산 물건이 불량이에요.');
  assert.equal(f.type.aiValue, null);
  assert.equal(f.type.needsCheck, true);
});

test('민감 번호: 감지하면 SENSITIVE_NUMBER, 값은 결과 어디에도 없음', () => {
  const nums = ['900101-1234567', '1234-5678-9012-3456', '110-123-456789', '3333-01-1234567', '9001011234567'];
  for (const n of nums) {
    const text = `○○ 쇼핑몰에서 유출됐어요. 제 번호 ${n} 도 유출됐대요.`;
    const r = extract(text, { now: NOW });
    assert.deepEqual(r.warnings, ['SENSITIVE_NUMBER'], n);
    assert.ok(!JSON.stringify(r).includes(n), `결과에 ${n}이 들어감`);
    for (const f of r.fields) if (f.quote) assert.ok(text.includes(f.quote), f.key);
  }
});

test('민감 번호: 문장에 섞여 있으면 문장 대신 짧은 근거를 쓴다', () => {
  const text = '△△ 은행에서 이름과 계좌번호 110-123-456789 가 유출됐어요.';
  const r = extract(text, { now: NOW });
  const leaked = r.fields.find((f) => f.key === 'leaked');
  assert.deepEqual(leaked.aiValue, ['이름', '계좌']);
  assert.equal(leaked.quote, '이름');
  assert.ok(!JSON.stringify(r).includes('456789'));
});

test('민감 번호: 전화번호 · 날짜는 민감 번호로 보지 않음', () => {
  for (const text of ['010-1234-5678로 유출 안내 문자가 왔어요.', '02-123-4567로 연락이 왔어요.', '2026-10-01에 유출 안내를 받았어요.']) {
    assert.deepEqual(extract(text, { now: NOW }).warnings, [], text);
  }
});

test('결과 없음: 모든 값이 null, 모두 확인 필요', () => {
  const r = extract('오늘 날씨가 좋네요.', { now: NOW });
  for (const f of r.fields) {
    assert.equal(f.aiValue, null, f.key);
    assert.equal(f.quote, null, f.key);
    assert.equal(f.needsCheck, true, f.key);
  }
  assert.deepEqual(r.warnings, []);
});

test('빈 글 · 2000자 넘는 글은 오류', () => {
  assert.throws(() => extract('  '), /EMPTY_TEXT/);
  assert.throws(() => extract('가'.repeat(2001)), /TEXT_TOO_LONG/);
});
