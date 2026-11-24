// R-06 새 그룹 만들기 AI 초안: 정리 결과(ReportField[], 사용자 수정 반영) → create_group 인자 초안
// 백엔드 create_group 규칙(backend: docs/database/integration-contract.md 3장)에 맞춘다.
// 개인정보 보호: 원문 · quote · secondary_detail 같은 자유 글은 읽지 않는다.
// 초안에 들어가는 글자는 회사 이름(번호 · 이메일을 지운 것)과 정해진 유출 항목 이름뿐이다.
import { finalValue } from './match.js';
import { LEAKED_ORDER } from './extract.js';
import { findSensitive } from './sensitive.js';

export const GROUP_LIMITS = {
  name: 100, company: 200, description: 2000, conditions: 1000,
  requiredEvidence: { count: 20, length: 100 }
};
export const EVIDENCE = {
  base: '유출 안내 문자·메일 캡처',
  secondary: '스미싱·이상 결제 문자 캡처',
  card: '카드 재발급·결제 내역'
};
// needsCheck에 넣는 키 순서
const OUTPUT_KEYS = ['name', 'company', 'description', 'conditions', 'periodStart', 'periodEnd', 'requiredEvidence'];
// 정리 필드 → 그 값으로 만든 초안 키
const AFFECTS = {
  company: ['name', 'company', 'description', 'conditions'],
  notice_date: ['name', 'description', 'conditions', 'periodStart', 'periodEnd'],
  leaked: ['description', 'conditions'],
  secondary: ['description', 'requiredEvidence'],
  card: ['description', 'requiredEvidence']
};

const PHONE = /(?<!\d)0\d{1,2}[\s-]?\d{3,4}[\s-]?\d{4}(?!\d)/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// PostgreSQL char_length처럼 문자(code point) 단위로 센다
const chars = (s) => [...s];
const clip = (s, max) => chars(s).slice(0, max).join('').trim();

/** 회사 이름에서 전화번호 · 이메일 · 민감 번호를 지운다. 지운 게 있으면 changed=true */
function scrubCompany(raw) {
  let s = raw;
  const ranges = findSensitive(s).sort((a, b) => b[0] - a[0]);
  for (const [a, b] of ranges) s = s.slice(0, a) + ' ' + s.slice(b);
  s = s.replace(PHONE, ' ').replace(EMAIL, ' ').replace(/\s+/g, ' ').trim();
  return { value: s, changed: s !== raw.replace(/\s+/g, ' ').trim() };
}

function period(nd) {
  if (!nd || typeof nd !== 'object' || !DATE.test(nd.from ?? '') || !DATE.test(nd.to ?? '') || nd.from > nd.to) return null;
  if (!['day', 'month', 'year'].includes(nd.precision)) return null;
  return nd;
}

/** "2026년 10월 3일" · "2026년 10월" · "2026년" */
function periodText(p) {
  const [y, m, d] = p.from.split('-').map(Number);
  if (p.precision === 'day') return `${y}년 ${m}월 ${d}일`;
  if (p.precision === 'month') return `${y}년 ${m}월`;
  return `${y}년`;
}
const periodTag = (p) => (p.precision === 'year' ? p.from.slice(0, 4) : p.from.slice(0, 7).replace('-', '.'));

/**
 * @param {{fields: import('./extract.js').ReportField[]} | import('./extract.js').ReportField[]} report extract() 결과(사용자 수정 반영본)
 * @returns {{ name:string, company:string, harmType:'privacy_leak', description:string, conditions:string,
 *   periodStart:string|null, periodEnd:string|null, requiredEvidence:string[], needsCheck:string[] } | { error:'COMPANY_REQUIRED' }}
 */
export function draftGroup(report) {
  const fields = Array.isArray(report) ? report : report?.fields;
  if (!Array.isArray(fields)) throw new TypeError('INVALID_REPORT');
  const byKey = Object.fromEntries(fields.filter((f) => f && typeof f.key === 'string').map((f) => [f.key, f]));
  const v = (k) => (byKey[k] ? finalValue(byKey[k]) : null);

  const check = new Set();
  const mark = (fieldKey) => AFFECTS[fieldKey].forEach((k) => check.add(k));
  // 사용자가 고친 값(source='user')은 확인한 값으로 본다. 값이 없거나 AI가 확인 필요로 둔 값만 표시.
  for (const k of Object.keys(AFFECTS)) {
    const f = byKey[k];
    if (!f || v(k) === null || (f.source !== 'user' && f.needsCheck)) mark(k);
  }

  // 회사
  const rawCompany = typeof v('company') === 'string' ? v('company') : '';
  const scrubbed = scrubCompany(rawCompany);
  if (!scrubbed.value) return { error: 'COMPANY_REQUIRED' };
  if (scrubbed.changed || chars(scrubbed.value).length > GROUP_LIMITS.company) mark('company');
  const company = clip(scrubbed.value, GROUP_LIMITS.company);

  // 시기
  const p = period(v('notice_date'));
  if (v('notice_date') !== null && !p) mark('notice_date');

  // 유출 항목: 정해진 이름만 쓴다(사용자가 적은 다른 글자는 개인정보일 수 있어 빼고 확인 필요로 표시)
  const rawLeaked = Array.isArray(v('leaked')) ? v('leaked') : [];
  const leaked = LEAKED_ORDER.filter((n) => rawLeaked.includes(n));
  if (rawLeaked.some((x) => !LEAKED_ORDER.includes(x))) mark('leaked');

  const secondary = v('secondary');
  const card = v('card');

  // name: "○○쇼핑 개인정보 유출 피해 모임 (2026.10)" — 길면 회사 이름 부분을 줄인다
  const suffix = ` 개인정보 유출 피해 모임${p ? ` (${periodTag(p)})` : ''}`;
  const name = clip(company, GROUP_LIMITS.name - chars(suffix).length) + suffix;

  // description: 유출 시점 · 유출 항목 · 2차 피해 여부 3문장
  const when = p ? `${periodText(p)}에 ` : '';
  const items = [...leaked, ...(card === 'yes' ? ['카드 정보'] : [])];
  const description = clip([
    `${company}에서 ${when}개인정보 유출 안내를 받은 피해자들의 모임입니다.`,
    items.length ? `유출된 정보는 ${items.join(', ')}입니다.` : '유출된 정보의 종류는 아직 확인 중입니다.',
    secondary === 'yes' ? '스미싱 등 2차 피해 사례가 있습니다.'
      : secondary === 'no' ? '아직 확인된 2차 피해는 없습니다.'
        : '2차 피해 여부는 아직 확인 중입니다.'
  ].join(' '), GROUP_LIMITS.description);

  // conditions: 참여 조건 2~4줄
  const conditions = clip([
    `${company}에서 개인정보 유출 안내(문자·메일 등)를 받은 분`,
    ...(p ? [`${periodText(p)} 무렵 유출 안내를 받은 분`] : []),
    ...(leaked.length ? [`유출 항목에 ${leaked.join(', ')} 중 하나 이상이 포함된 분`] : []),
    '유출 안내 문자·메일 캡처 등 피해를 확인할 자료가 있는 분'
  ].join('\n'), GROUP_LIMITS.conditions);

  const requiredEvidence = [
    EVIDENCE.base,
    ...(secondary === 'yes' ? [EVIDENCE.secondary] : []),
    ...(card === 'yes' ? [EVIDENCE.card] : [])
  ];

  return {
    name,
    company,
    harmType: 'privacy_leak',
    description,
    conditions,
    periodStart: p ? p.from : null,
    periodEnd: p ? p.to : null,
    requiredEvidence,
    needsCheck: OUTPUT_KEYS.filter((k) => check.has(k))
  };
}
