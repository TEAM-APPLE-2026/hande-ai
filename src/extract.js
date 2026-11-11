// 피해 글 → ReportField[] (integration-contract.md 4장)
// 규칙: 값마다 원문 근거(quote)를 붙이고, 못 찾으면 추측하지 않고 aiValue=null, needsCheck=true
import { parseNoticeDate } from './date.js';
import { findSensitive, overlaps } from './sensitive.js';

export const FIELD_KEYS = ['company', 'type', 'notice_date', 'leaked', 'secondary', 'card'];
export const MAX_TEXT_LENGTH = 2000; // save_report 원문 1~2000자

// 유출 정보: 화면에 쓰는 이름 ← 원문 표현 (검사 순서: "이메일 주소"가 '주소'로 잡히지 않게 긴 표현 먼저)
const LEAKED_ITEMS = [
  ['주민등록번호', /주민\s?(?:등록\s?)?번호/],
  ['이메일', /이메일(?:\s?주소)?|메일\s?주소/],
  ['전화번호', /(?:전화|휴대폰|핸드폰|휴대전화)\s?번호/],
  ['연락처', /연락처/],
  ['이름', /이름|성명/],
  ['주소', /주소/],
  ['생년월일', /생년월일/],
  ['계좌', /계좌(?:\s?번호)?/],
  ['아이디', /아이디/],
  ['비밀번호', /비밀번호/]
];
// 결과 배열 순서
export const LEAKED_ORDER = ['이름', '연락처', '전화번호', '주소', '이메일', '생년월일', '주민등록번호', '계좌', '아이디', '비밀번호'];
const LEAK_WORD = /유출|해킹|털렸|털린|새어\s?나|노출/;

const SECONDARY_NO = /2차\s?피해[^.!?\n]*?(?:없|아직\s?(?:없|안))|(?:별다른|추가)\s?피해[^.!?\n]*?없/;
const SECONDARY_UNKNOWN = /2차\s?피해[^.!?\n]*?(?:모르|모름|잘\s?모)/;
const SECONDARY_YES = /스미싱|보이스\s?피싱|피싱|명의\s?도용|사칭\s?(?:문자|전화)|스팸\s?(?:문자|전화)|무단\s?(?:결제|이체)|부정\s?(?:결제|사용)/;

const CARD_NO = /카드\s?(?:정보|번호)[^.!?\n]*?(?:유출되지\s?않|포함되지\s?않|유출\s?안|포함\s?안|안전|없)/;
const CARD_UNKNOWN = /카드\s?(?:정보|번호)[^.!?\n]*?(?:모르|모름|확인\s?중)/;
const CARD_YES = /카드\s?(?:정보|번호)/;

/** 원문을 문장 단위로 자르되, 원문 위치(start)를 함께 기억 */
function sentences(text) {
  const out = [];
  // 마침표 뒤에 공백·끝이 올 때만 문장 끝 ("2025.3.14"는 안 끊음)
  const re = /(?:[^.!?。\n]|[.!?。](?!\s|$))+[.!?。]*/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const s = raw.trim();
    if (s) out.push({ text: s, start: m.index + lead, end: m.index + lead + s.length });
  }
  return out;
}

/**
 * 근거 문장을 quote로 쓰되, 민감 번호가 겹치면 짧은 표현(token)으로 대신한다.
 * token도 겹치면 quote=null (번호가 결과에 들어가지 않게).
 */
function makeQuote(sentence, token, tokenStart, ranges) {
  if (sentence && !overlaps(ranges, sentence.start, sentence.end)) return sentence.text;
  if (token && !overlaps(ranges, tokenStart, tokenStart + token.length)) return token;
  return null;
}

function firstSentence(sents, re, ranges) {
  for (const s of sents) {
    const m = s.text.match(re);
    if (m) return { sentence: s, token: m[0], tokenStart: s.start + m.index, quote: makeQuote(s, m[0], s.start + m.index, ranges) };
  }
  return null;
}

const RULES = {
  // [예시] 기호 이름(△△ 통신사)과 일반 회사 이름 모두 잡는다
  company(text, ranges) {
    const re = /([^\s,.!?]{1,12}\s?(?:통신사|쇼핑몰|카드사|보험사|여행사|증권사|은행|병원|마트|플랫폼|앱))/g;
    for (const m of text.matchAll(re)) {
      if (overlaps(ranges, m.index, m.index + m[0].length)) continue;
      return { value: m[1], quote: m[0] };
    }
    return null;
  },

  type(text, ranges, sents) {
    const hit = firstSentence(sents, /유출|해킹|털렸|털린|새어\s?나/, ranges);
    return hit ? { value: 'privacy_leak', quote: hit.quote } : null;
  },

  notice_date(text, ranges, sents, now) {
    return parseNoticeDate(text, sents, now);
  },

  leaked(text, ranges, sents) {
    // 문장마다 유출 정보 항목을 찾고, '유출' 문장 중 가장 많이 언급한 문장을 근거로 쓴다
    let best = null;
    const better = (a, b) => !b || a.leak > b.leak || (a.leak === b.leak && a.found.length > b.found.length);
    const all = new Set();
    for (const s of sents) {
      // "이메일 주소"의 '주소'를 주소로 세지 않도록, 찾은 부분은 지워 가며 검사
      let rest = s.text;
      const found = [];
      let token = null;
      for (const [name, re] of LEAKED_ITEMS) {
        const m = rest.match(re);
        if (m && (!token || m.index < token.index)) token = { text: m[0], index: m.index };
        if (m) { found.push(name); rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice(m.index + m[0].length); }
      }
      found.forEach((f) => all.add(f));
      const cand = { s, found, token, leak: LEAK_WORD.test(s.text) };
      if (found.length && better(cand, best)) best = cand;
    }
    if (!best) return null;
    const value = LEAKED_ORDER.filter((n) => all.has(n));
    // '유출'이라는 말 없이 항목만 나오면 확인 필요
    return { value, quote: makeQuote(best.s, best.token.text, best.s.start + best.token.index, ranges), needsCheck: !best.leak };
  },

  secondary(text, ranges, sents) {
    for (const [re, value] of [[SECONDARY_NO, 'no'], [SECONDARY_UNKNOWN, 'unknown'], [SECONDARY_YES, 'yes']]) {
      const hit = firstSentence(sents, re, ranges);
      if (hit) return { value, quote: hit.quote, needsCheck: value === 'unknown' };
    }
    return null;
  },

  card(text, ranges, sents) {
    for (const [re, value] of [[CARD_NO, 'no'], [CARD_UNKNOWN, 'unknown'], [CARD_YES, 'yes']]) {
      const hit = firstSentence(sents, re, ranges);
      if (hit) return { value, quote: hit.quote, needsCheck: value === 'unknown' };
    }
    return null;
  }
};

/**
 * @typedef {'company'|'type'|'notice_date'|'leaked'|'secondary'|'card'} FieldKey
 * @typedef {string|string[]|{from:string|null,to:string|null,precision:'day'|'month'|'year'|'unknown'}} FieldValue
 * @typedef {{key:FieldKey, aiValue:FieldValue|null, quote:string|null, userValue:FieldValue|null, source:'ai'|'user', needsCheck:boolean}} ReportField
 *
 * @param {string} text 사용자가 쓴 피해 글 (1~2000자)
 * @param {{now?: Date}} [options] now: 연도 없는 날짜의 기준 (기본: 오늘)
 * @returns {{ fields: ReportField[], warnings: string[] }}
 */
export function extract(text, { now = new Date() } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('EMPTY_TEXT');
  if (text.length > MAX_TEXT_LENGTH) throw new Error('TEXT_TOO_LONG');

  const ranges = findSensitive(text);
  const sents = sentences(text);
  const fields = FIELD_KEYS.map((key) => {
    const r = RULES[key](text, ranges, sents, now);
    const aiValue = r?.value ?? null;
    const quote = aiValue === null ? null : (r.quote ?? null);
    return {
      key,
      aiValue,
      quote,
      userValue: null,
      source: 'ai',
      // 근거(quote)를 못 붙인 값도 확인 필요 (민감 번호와 겹쳐 근거를 뺀 경우 등)
      needsCheck: aiValue === null || quote === null || r.needsCheck === true
    };
  });
  return { fields, warnings: ranges.length ? ['SENSITIVE_NUMBER'] : [] };
}
