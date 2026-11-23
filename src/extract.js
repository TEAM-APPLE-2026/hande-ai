// 피해 글 → ReportField[] (integration-contract.md 4장)
// 규칙: 값마다 원문 근거(quote)를 붙이고, 못 찾으면 추측하지 않고 aiValue=null, needsCheck=true
import { parseNoticeDate } from './date.js';
import { findSensitive, overlaps } from './sensitive.js';

export const FIELD_KEYS = ['company', 'type', 'notice_date', 'leaked', 'secondary', 'card'];
export const OPTIONAL_FIELD_KEYS = ['secondary_detail']; // 찾았을 때만 결과에 넣는다
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

// 부정 표현. "끊임없이", "적지 않게", "뿐만 아니라"처럼 실제로는 부정이 아닌 말은 뺀다.
const NEGATION = /안\s?(?:왔|옴|와|받|당)|아직\s?안|(?<!끊임|어이|정신|틀림|빠짐|쉴\s?새\s?)없|(?<!적지\s?|끊이지\s?|멈추지\s?)않|아니(?!라|나)|못\s?받|괜찮/;
// 절 경계: "없었는데", "왔지만", "없었고 ", "왔어요, "
const CLAUSE_END = /는데|지만|(?<=[요다고])[,，]|(?<=[었았였왔갔됐했오받않없])고(?=[\s,，])/g;
const NEAR_BEFORE = 12, NEAR_AFTER = 20; // 키워드 앞뒤로 부정을 찾는 거리(글자)

const SECONDARY_RULE = {
  word: /스미싱|보이스\s?피싱|피싱|명의\s?도용|사칭\s?(?:문자|전화)|스팸\s?(?:문자|전화)|무단\s?(?:결제|이체)|부정\s?(?:결제|사용)|2차\s?피해|(?:별다른|추가)\s?피해|(?:이상한|수상한)\s?문자/g,
  yes: /스미싱|피싱|명의\s?도용|사칭|스팸|무단|부정/,
  no: NEGATION,
  unknown: /모르|모름|잘\s?모/,
  // 단독으로는 피해라고 볼 수 없지만, 부정 문장과 함께 나오면 'no'로 단정하지 않는다
  suspect: /(?:결제|이상한|수상한)\s?(?:문자|전화)[^.!?\n]*?(?:왔|받)/
};

// 2차 피해 상세: 원문 표현(공백 제거) → 화면에 쓰는 이름
const HARM_LABEL = {
  스미싱: '스미싱 문자', 보이스피싱: '보이스피싱 전화', 피싱: '피싱', 명의도용: '명의도용',
  사칭문자: '사칭 문자', 사칭전화: '사칭 전화', 스팸문자: '스팸 문자', 스팸전화: '스팸 전화',
  무단결제: '무단 결제', 무단이체: '무단 이체', 부정결제: '부정 결제', 부정사용: '부정 사용'
};
const HARM_TOKEN = /스미싱|보이스\s?피싱|피싱|명의\s?도용|사칭\s?(?:문자|전화)|스팸\s?(?:문자|전화)|무단\s?(?:결제|이체)|부정\s?(?:결제|사용)/g;
const HARM_COUNT = /(\d{1,3}|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s?(?:번|회|차례|건)/;
const KOREAN_COUNT = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };

const CARD_RULE = {
  word: /카드\s?(?:정보|번호)|카드(?:는|은|도|가)(?=\s|$)/g, // "카드사"는 키워드가 아니다
  yes: /카드\s?(?:정보|번호)/,
  no: new RegExp(`${NEGATION.source}|유출\\s?안|포함\\s?안|안전`),
  unknown: /모르|모름|확인\s?중/
};

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

function clauses(s) {
  const out = [];
  let from = 0;
  for (const m of s.text.matchAll(CLAUSE_END)) {
    const end = m.index + m[0].length;
    out.push({ text: s.text.slice(from, end), offset: from });
    from = end;
  }
  if (from < s.text.length) out.push({ text: s.text.slice(from), offset: from });
  return out;
}

/**
 * yes/no/unknown 판단. 키워드와 같은 절의 가까운 표현만 본다.
 * 긍정과 부정이 함께 있으면 unknown + 확인 필요.
 */
function judge(sents, ranges, rule) {
  const hits = [];
  let suspect = false;
  for (const s of sents) {
    for (const c of clauses(s)) {
      for (const m of c.text.matchAll(rule.word)) {
        const near = c.text.slice(Math.max(0, m.index - NEAR_BEFORE), m.index + m[0].length + NEAR_AFTER);
        const value = rule.unknown.test(near) ? 'unknown' : rule.no.test(near) ? 'no' : rule.yes.test(m[0]) ? 'yes' : null;
        if (value) hits.push({ value, sentence: s, token: m[0], tokenStart: s.start + c.offset + m.index });
      }
      if (rule.suspect?.test(c.text) && !rule.no.test(c.text)) suspect = true;
    }
  }
  if (!hits.length) return null;
  const has = (v) => hits.some((h) => h.value === v);
  const mixed = has('no') && (has('yes') || suspect);
  const value = mixed || has('unknown') ? 'unknown' : has('yes') ? 'yes' : 'no';
  const hit = hits.find((h) => h.value === value) ?? hits[0];
  return { value, quote: makeQuote(hit.sentence, hit.token, hit.tokenStart, ranges), needsCheck: value === 'unknown' };
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
    return judge(sents, ranges, SECONDARY_RULE);
  },

  card(text, ranges, sents) {
    return judge(sents, ranges, CARD_RULE);
  },

  // "스미싱 문자 3회"처럼 종류와 횟수만 만든다. 원문을 복사하지 않으므로 민감 번호가 들어가지 않는다.
  secondary_detail(text, ranges, sents) {
    const counts = new Map();
    let source = null;
    for (const s of sents) {
      const tokens = [...s.text.matchAll(HARM_TOKEN)];
      tokens.forEach((m, i) => {
        const label = HARM_LABEL[m[0].replace(/\s/g, '')];
        const after = s.text.slice(m.index + m[0].length, tokens[i + 1]?.index ?? s.text.length);
        // 부정은 이 피해를 말하는 절 안에서만 본다 ("스미싱이 세 건 있었는데 카드 피해는 없어요"는 있음)
        const clause = after.split(/는데|지만|[,，]/)[0];
        if (NEGATION.test(clause)) return;
        const c = clause.match(HARM_COUNT);
        const count = c ? (KOREAN_COUNT[c[1]] ?? +c[1]) : null;
        if (!counts.has(label) || (counts.get(label) === null && count !== null)) counts.set(label, count);
        source ??= { sentence: s, token: m[0], tokenStart: s.start + m.index };
      });
    }
    if (!source) return null;
    const value = [...counts].map(([label, n]) => (n ? `${label} ${n}회` : label)).join(', ');
    return { value, quote: makeQuote(source.sentence, source.token, source.tokenStart, ranges) };
  }
};

/**
 * @typedef {'company'|'type'|'notice_date'|'leaked'|'secondary'|'card'|'secondary_detail'} FieldKey
 * @typedef {string|string[]|{from:string,to:string,precision:'day'|'month'|'year'}} FieldValue
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
  const toField = (key) => {
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
  };
  const fields = FIELD_KEYS.map(toField);
  // 상세는 2차 피해가 yes일 때만. 없으면 필드를 넣지 않는다(null+needsCheck=false는 저장 함수가 거부).
  if (fields.find((f) => f.key === 'secondary').aiValue === 'yes') {
    const detail = toField('secondary_detail');
    if (detail.aiValue !== null) fields.push(detail);
  }
  return { fields, warnings: ranges.length ? ['SENSITIVE_NUMBER'] : [] };
}
