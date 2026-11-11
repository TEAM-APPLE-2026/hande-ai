// notice_date 해석: 원문의 날짜 표현 → { from, to, precision }
// 규칙은 README "notice_date 규칙" 표와 같다. 바꾸면 README도 같이 고치기.

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(y, m, 0).getDate();
const validDay = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= lastDay(y, m);

const day = (y, m, d) => (validDay(y, m, d) ? { from: iso(y, m, d), to: iso(y, m, d), precision: 'day' } : null);

// 월 단위: 초 1~10일, 중순 11~20일, 말 21일~말일, 없으면 1일~말일
function month(y, m, part) {
  if (m < 1 || m > 12) return null;
  const end = lastDay(y, m);
  const [a, b] = { 초: [1, 10], 상순: [1, 10], 중순: [11, 20], 말: [21, end], 하순: [21, end] }[part] ?? [1, end];
  return { from: iso(y, m, a), to: iso(y, m, b), precision: 'month' };
}
const year = (y) => ({ from: iso(y, 1, 1), to: iso(y, 12, 31), precision: 'year' });
const shift = (now, days) => { const d = new Date(now); d.setDate(d.getDate() + days); return d; };
const fromDate = (d) => day(d.getFullYear(), d.getMonth() + 1, d.getDate());

const PART = '(초|상순|중순|하순|말)?';

// 구체적인 것부터. 앞의 규칙이 잡은 위치는 뒤 규칙이 다시 잡지 않는다.
const PATTERNS = [
  [/(?<!\d)((?:19|20)\d{2})\s?년\s?(\d{1,2})\s?월\s?(\d{1,2})\s?일/g, (m) => day(+m[1], +m[2], +m[3])],
  [/(?<!\d)((?:19|20)\d{2})\s?[.\-/]\s?(\d{1,2})\s?[.\-/]\s?(\d{1,2})(?!\d)/g, (m) => day(+m[1], +m[2], +m[3])],
  [new RegExp(`(?<!\\d)((?:19|20)\\d{2})\\s?년\\s?(\\d{1,2})\\s?월\\s?${PART}`, 'g'), (m) => month(+m[1], +m[2], m[3])],
  [/(?<!\d)(\d{1,2})\s?월\s?(\d{1,2})\s?일/g, (m, now) => day(now.getFullYear(), +m[1], +m[2])],
  [new RegExp(`(?<!\\d)(\\d{1,2})\\s?월\\s?${PART}`, 'g'), (m, now) => month(now.getFullYear(), +m[1], m[2])],
  [/(?<!\d)((?:19|20)\d{2})\s?년/g, (m) => year(+m[1])],
  [/지난\s?달|저번\s?달/g, (m, now) => { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); return month(d.getFullYear(), d.getMonth() + 1); }],
  [/이번\s?달|이달/g, (m, now) => month(now.getFullYear(), now.getMonth() + 1)],
  [/작년|지난\s?해/g, (m, now) => year(now.getFullYear() - 1)],
  // 오늘·어제·그제는 흔한 말이라 통지 문장 안에서만 날짜로 쓴다(weak)
  [/그저께|그제/g, (m, now) => fromDate(shift(now, -2)), 'weak'],
  [/어제/g, (m, now) => fromDate(shift(now, -1)), 'weak'],
  [/오늘/g, (m, now) => fromDate(now), 'weak']
];

// 통지(안내 문자·메일 등)를 말하는 문장의 날짜를 우선한다. 2차 피해 문장의 날짜는 뒤로.
const NOTICE = /통지|안내|공지|알림|문자|메일|연락|발표/;
const LEAK = /유출|해킹|털렸|털린/;
const HARM = /스미싱|피싱|명의\s?도용|사칭/;

function sentenceScore(s) {
  return (NOTICE.test(s) ? 2 : 0) + (LEAK.test(s) ? 1 : 0) - (HARM.test(s) ? 2 : 0);
}

/**
 * @param {string} text 원문
 * @param {Array<{text:string,start:number,end:number}>} sents 문장 목록(원문 위치 포함)
 * @param {Date} now 연도 없는 날짜의 기준
 * @returns {{ value:{from:string,to:string,precision:string}, quote:string, needsCheck:boolean } | null}
 */
export function parseNoticeDate(text, sents, now = new Date()) {
  const taken = [];
  const found = [];
  for (const [re, toValue, weak] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const start = m.index, end = m.index + m[0].trimEnd().length;
      if (taken.some(([s, e]) => start < e && s < end)) continue;
      const value = toValue(m, now);
      if (!value) continue;
      const sent = sents.find((s) => start >= s.start && start < s.end);
      const score = sent ? sentenceScore(sent.text) : 0;
      if (weak && score < 2) continue;
      taken.push([start, end]);
      found.push({ start, value, quote: m[0].trimEnd(), score });
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => b.score - a.score || a.start - b.start);
  const best = found[0];
  // 통지 문장이 아닌 곳에서 고른 날짜는 확인 필요
  return { value: best.value, quote: best.quote, needsCheck: best.score < 2 };
}
