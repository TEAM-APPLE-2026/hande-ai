// 정리 결과 + 그룹 목록 → 같은 사건 후보
// 1단계: 회사 · 피해 유형으로 거르기  2단계: 글자 2개씩 비교(bigram cosine) 점수
export const THRESHOLD = { same: 70, similar: 45 };

function bigrams(s) {
  const t = (s || '').replace(/\s+/g, '');
  const m = new Map();
  for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
  return m;
}
function cosine(a, b) {
  const A = bigrams(a), B = bigrams(b);
  let dot = 0, na = 0, nb = 0;
  for (const [g, v] of A) { na += v * v; if (B.has(g)) dot += v * B.get(g); }
  for (const v of B.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
const norm = (s) => (s || '').replace(/\[예시\]|\s/g, '');

/**
 * @param {{fields:Array<{key:string,value:string|null}>}} report extract() 결과(사용자 수정 반영본)
 * @param {Array<{id:string,name:string,company:string,type:string,period?:string,keywords?:string}>} groups
 * @returns {Array<{groupId:string,score:number,level:'same'|'similar',matches:string[],diffs:string[]}>} 점수 높은 순, 45점 미만 제외
 */
export function match(report, groups) {
  const v = Object.fromEntries(report.fields.map((f) => [f.key, f.value]));
  return groups
    .filter((g) => (!v.company || norm(g.company) === norm(v.company)) && (!v.type || g.type === v.type))
    .map((g) => {
      const matches = [], diffs = [];
      if (v.company) matches.push(`회사: ${g.company}`);
      if (v.type) matches.push(`피해 유형: ${g.type}`);
      const text = [v.leaked, v.secondary, v.noticeDate].filter(Boolean).join(' ');
      const sim = cosine(text, `${g.keywords || ''} ${g.period || ''}`);
      if (v.noticeDate && g.period && !g.period.includes(v.noticeDate.replace(/\D/g, ''))) diffs.push(`시기: 내 글 ${v.noticeDate} / 그룹 ${g.period}`);
      const score = Math.round(Math.min(100, (v.company ? 40 : 0) + (v.type ? 20 : 0) + sim * 40));
      return { groupId: g.id, score, level: score >= THRESHOLD.same ? 'same' : 'similar', matches, diffs };
    })
    .filter((r) => r.score >= THRESHOLD.similar)
    .sort((a, b) => b.score - a.score);
}
