// R-06 새 그룹 만들기 AI 초안. 길이 · 개수 검사는 backend create_group 규칙을 그대로 옮긴 것.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract, draftGroup, GROUP_LIMITS, EVIDENCE } from '../src/index.js';

const NOW = new Date(2026, 10, 11);
const DRAFT_KEYS = ['company', 'conditions', 'description', 'harmType', 'name', 'needsCheck', 'periodEnd', 'periodStart', 'requiredEvidence'];
const NEEDS_CHECK_KEYS = new Set(['name', 'company', 'description', 'conditions', 'periodStart', 'periodEnd', 'requiredEvidence']);

// PostgreSQL char_length처럼 문자 단위, btrim처럼 앞뒤 공백 제외
const len = (s) => [...s.replace(/^\s+|\s+$/g, '')].length;
const isText = (v, min, max) => typeof v === 'string' && len(v) >= min && len(v) <= max;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertCreatable(d, at = '') {
  assert.deepEqual(Object.keys(d).sort(), DRAFT_KEYS, at);
  assert.ok(isText(d.name, 1, GROUP_LIMITS.name), `name 길이 ${len(d.name)} ${at}`);
  assert.ok(isText(d.company, 1, GROUP_LIMITS.company), `company 길이 ${at}`);
  assert.equal(d.harmType, 'privacy_leak', at);
  assert.ok(isText(d.description, 1, GROUP_LIMITS.description), `description 길이 ${at}`);
  assert.equal(typeof d.conditions, 'string', at);
  assert.ok(len(d.conditions) <= GROUP_LIMITS.conditions, `conditions 길이 ${at}`);
  const lines = d.conditions.split('\n');
  assert.ok(lines.length >= 2 && lines.length <= 4, `conditions 줄 수 ${lines.length} ${at}`);
  assert.ok(lines.every((l) => l.trim()), `빈 줄 ${at}`);
  // 2~3문장
  const sents = d.description.split(/(?<=[.다])\s+/).filter(Boolean);
  assert.ok(sents.length >= 2 && sents.length <= 3, `description 문장 수 ${sents.length} ${at}`);
  // 기간: 둘 다 있거나 둘 다 null, start <= end
  assert.equal(d.periodStart === null, d.periodEnd === null, at);
  if (d.periodStart !== null) {
    assert.match(d.periodStart, DATE, at);
    assert.match(d.periodEnd, DATE, at);
    assert.ok(d.periodStart <= d.periodEnd, at);
  }
  assert.ok(Array.isArray(d.requiredEvidence) && d.requiredEvidence.length <= GROUP_LIMITS.requiredEvidence.count, at);
  assert.ok(d.requiredEvidence.every((x) => isText(x, 1, GROUP_LIMITS.requiredEvidence.length)), at);
  assert.ok(d.requiredEvidence.includes(EVIDENCE.base), at);
  assert.ok(Array.isArray(d.needsCheck) && d.needsCheck.every((k) => NEEDS_CHECK_KEYS.has(k)), at);
  assert.equal(new Set(d.needsCheck).size, d.needsCheck.length, at);
}

const SAMPLE = '10월 초에 ○○쇼핑 쇼핑몰에서 고객정보가 유출됐다는 문자를 받았어요. 이름, 연락처, 주소가 유출됐다고 했어요. 10월 초부터 택배 사칭 스미싱 문자가 세 번 왔어요.';

// 사용자 수정 반영본 만들기
function edit(fields, key, userValue) {
  return fields.map((f) => (f.key === key ? { ...f, userValue, source: 'user' } : f));
}
const field = (key, aiValue, needsCheck = false) => ({ key, aiValue, quote: null, userValue: null, source: 'ai', needsCheck });

test('extract 결과로 만든 초안이 create_group 규칙을 통과', () => {
  const { fields } = extract(SAMPLE, { now: NOW });
  const d = draftGroup({ fields });
  assertCreatable(d);
  assert.equal(d.company, '○○쇼핑 쇼핑몰');
  assert.equal(d.name, '○○쇼핑 쇼핑몰 개인정보 유출 피해 모임 (2026.10)');
  assert.equal(d.periodStart, '2026-10-01');
  assert.equal(d.periodEnd, '2026-10-31');
  assert.match(d.description, /2026년 10월/);
  assert.match(d.description, /이름, 연락처, 주소/);
  assert.match(d.description, /2차 피해/);
  assert.deepEqual(d.requiredEvidence, [EVIDENCE.base, EVIDENCE.secondary]);
});

test('배열로 줘도 된다 (match와 같음)', () => {
  const { fields } = extract(SAMPLE, { now: NOW });
  assert.deepEqual(draftGroup(fields), draftGroup({ fields }));
});

test('여러 글의 초안이 모두 규칙을 통과', () => {
  const texts = [
    SAMPLE,
    '10월 중순에 □□ 카드사 유출 안내를 받았어요. 카드 정보는 유출되지 않았대요. 2차 피해는 아직 없어요.',
    '2월 말에 ○○ 쇼핑몰 해킹 공지를 봤어요. 카드번호가 유출됐어요. 보이스피싱 전화를 2회 받았어요.',
    '2025년에 △△ 통신사 유출 안내를 받았어요.',
    '△△ 은행에서 이름과 계좌번호 110-123-456789 가 유출됐어요.'
  ];
  for (const t of texts) {
    const d = draftGroup(extract(t, { now: NOW }));
    assert.ok(!d.error, t);
    assertCreatable(d, t);
  }
});

test('company가 없으면 초안을 만들지 않는다', () => {
  const { fields } = extract('어제 유출 안내 문자가 왔어요.', { now: NOW });
  assert.deepEqual(draftGroup({ fields }), { error: 'COMPANY_REQUIRED' });
  const { fields: f2 } = extract(SAMPLE, { now: NOW });
  assert.deepEqual(draftGroup(edit(f2, 'company', '   ')), { error: 'COMPANY_REQUIRED' });
  assert.deepEqual(draftGroup(edit(f2, 'company', null)), { error: 'COMPANY_REQUIRED' });
  assert.deepEqual(draftGroup(f2.filter((f) => f.key !== 'company')), { error: 'COMPANY_REQUIRED' });
});

test('사용자가 고친 값(finalValue)을 쓴다', () => {
  let { fields } = extract(SAMPLE, { now: NOW });
  fields = edit(fields, 'company', '◇◇마트');
  fields = edit(fields, 'notice_date', { from: '2026-09-05', to: '2026-09-05', precision: 'day' });
  fields = edit(fields, 'secondary', 'no');
  fields = edit(fields, 'card', 'yes');
  const d = draftGroup(fields);
  assertCreatable(d);
  assert.equal(d.company, '◇◇마트');
  assert.equal(d.name, '◇◇마트 개인정보 유출 피해 모임 (2026.09)');
  assert.equal(d.periodStart, '2026-09-05');
  assert.equal(d.periodEnd, '2026-09-05');
  assert.match(d.description, /2026년 9월 5일/);
  assert.match(d.description, /카드 정보/);
  assert.deepEqual(d.requiredEvidence, [EVIDENCE.base, EVIDENCE.card]);
  assert.ok(!d.needsCheck.includes('company'));
  assert.ok(!d.needsCheck.includes('periodStart'));
});

test('notice_date를 모르면 기간은 둘 다 null, 확인 필요', () => {
  const fields = [field('company', '△△ 통신사'), field('type', 'privacy_leak'), field('notice_date', null, true),
    field('leaked', ['이름']), field('secondary', 'no'), field('card', 'no')];
  const d = draftGroup(fields);
  assertCreatable(d);
  assert.equal(d.periodStart, null);
  assert.equal(d.periodEnd, null);
  assert.equal(d.name, '△△ 통신사 개인정보 유출 피해 모임');
  assert.deepEqual(d.needsCheck, ['name', 'description', 'conditions', 'periodStart', 'periodEnd']);
  // unknown 객체나 잘못된 날짜도 null
  const bad = draftGroup(edit(fields, 'notice_date', { precision: 'unknown' }));
  assert.equal(bad.periodStart, null);
  assert.equal(bad.periodEnd, null);
});

test('year 단위 기간과 이름', () => {
  const d = draftGroup([field('company', '△△ 통신사'), field('notice_date', { from: '2025-01-01', to: '2025-12-31', precision: 'year' })]);
  assertCreatable(d);
  assert.equal(d.name, '△△ 통신사 개인정보 유출 피해 모임 (2025)');
  assert.equal(d.periodStart, '2025-01-01');
  assert.equal(d.periodEnd, '2025-12-31');
});

test('증거 목록: 기본 + secondary=yes + card=yes', () => {
  const base = [field('company', '△△ 통신사')];
  assert.deepEqual(draftGroup(base).requiredEvidence, [EVIDENCE.base]);
  assert.deepEqual(draftGroup([...base, field('secondary', 'unknown', true), field('card', 'unknown', true)]).requiredEvidence, [EVIDENCE.base]);
  assert.deepEqual(draftGroup([...base, field('secondary', 'yes'), field('card', 'yes')]).requiredEvidence,
    [EVIDENCE.base, EVIDENCE.secondary, EVIDENCE.card]);
});

test('needsCheck: 확인 필요 필드에서 온 값의 키를 넣는다', () => {
  const fields = [field('company', '△△ 통신사', true), field('type', 'privacy_leak'),
    field('notice_date', { from: '2026-10-01', to: '2026-10-31', precision: 'month' }),
    field('leaked', ['이름'], true), field('secondary', 'unknown', true), field('card', 'no')];
  const d = draftGroup(fields);
  assertCreatable(d);
  assert.deepEqual(d.needsCheck, ['name', 'company', 'description', 'conditions', 'requiredEvidence']);
  // 모두 확실하면 빈 배열
  const sure = fields.map((f) => ({ ...f, needsCheck: false }));
  assert.deepEqual(draftGroup(sure).needsCheck, []);
  // 사용자가 고친 값은 확인한 값
  assert.ok(!draftGroup(edit(fields, 'company', '△△ 통신사')).needsCheck.includes('company'));
});

test('길이 제한: 아주 긴 회사 이름도 잘라서 규칙 안에 넣는다', () => {
  const long = '가'.repeat(500);
  const d = draftGroup([field('company', long), field('notice_date', { from: '2026-10-01', to: '2026-10-31', precision: 'month' }),
    field('leaked', ['이름', '연락처', '전화번호', '주소', '이메일', '생년월일', '주민등록번호', '계좌', '아이디', '비밀번호']),
    field('secondary', 'yes'), field('card', 'yes')]);
  assertCreatable(d);
  assert.equal(len(d.company), GROUP_LIMITS.company);
  assert.equal(len(d.name), GROUP_LIMITS.name);
  assert.ok(d.name.endsWith('개인정보 유출 피해 모임 (2026.10)'));
  assert.ok(d.needsCheck.includes('company'));
  // 이모지·결합 문자도 문자 단위로 센다
  const emoji = draftGroup([field('company', '😀'.repeat(300))]);
  assertCreatable(emoji);
  assert.equal([...emoji.company].length, GROUP_LIMITS.company);
});

test('개인정보는 초안에 넣지 않는다', () => {
  const pii = ['홍길동', '010-1234-5678', '01012345678', 'hong@example.com', '900101-1234567', '1234-5678-9012-3456', '110-123-456789'];
  const text = '10월 3일에 △△ 통신사에서 유출 안내 문자를 받았어요. 저는 홍길동이고 010-1234-5678, hong@example.com 입니다. '
    + '주민번호 900101-1234567 와 카드번호 1234-5678-9012-3456, 계좌 110-123-456789 가 유출됐어요. 스미싱 문자를 받았어요.';
  let { fields } = extract(text, { now: NOW });
  // 사용자가 필드에 개인정보를 적어 넣은 경우
  fields = edit(fields, 'company', '△△ 통신사 홍길동 010-1234-5678 hong@example.com 900101-1234567');
  fields = edit(fields, 'leaked', ['이름', '홍길동', '010-1234-5678']);
  fields = [...fields.filter((f) => f.key !== 'secondary_detail'),
    { key: 'secondary_detail', aiValue: null, quote: '홍길동', userValue: '홍길동 010-1234-5678 로 스미싱', source: 'user', needsCheck: false }];
  const d = draftGroup(fields);
  const out = JSON.stringify(d);
  for (const p of pii.slice(1)) assert.ok(!out.includes(p), `${p} 가 초안에 있음`);
  // 회사 이름 칸에 적은 이름은 회사 이름으로 남지만, 원문 · quote · 상세 · 유출 항목의 자유 글은 쓰지 않는다
  assert.ok(!d.description.replace(d.company, '').includes('홍길동'));
  assert.ok(!d.conditions.replaceAll(d.company, '').includes('홍길동'));
  assert.ok(d.needsCheck.includes('company'), '번호를 지운 회사 이름은 확인 필요');
  assert.ok(d.needsCheck.includes('description'), '빼 버린 유출 항목이 있으면 확인 필요');
  assertCreatable(d);
});

test('번호만 적힌 회사 이름은 회사가 없는 것으로 본다', () => {
  assert.deepEqual(draftGroup([field('company', '010-1234-5678')]), { error: 'COMPANY_REQUIRED' });
});

test('잘못된 입력은 INVALID_REPORT', () => {
  assert.throws(() => draftGroup(null), /INVALID_REPORT/);
  assert.throws(() => draftGroup({}), /INVALID_REPORT/);
});
