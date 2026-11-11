// 정리 결과(ReportField[]) + 그룹 목록(Group) → 같은 사건 후보
// 1단계: 회사 · 피해 유형으로 거르기  2단계: 시기 · 유출 정보 · 2차 피해로 점수
export const THRESHOLD = { same: 70, similar: 45 };
// 시기가 맞으면 +20, 확실히 어긋나면 -20, 모르면 0
export const WEIGHT = { company: 40, type: 20, period: 20, leaked: 15, secondary: 5 };
// 통지는 사건 뒤에 오는 일이 많아서 그룹 기간 앞뒤로 여유를 둔다
export const PERIOD_GRACE_DAYS = 60;

const HARM_LABEL = { privacy_leak: '개인정보 유출' };
const DAY = 24 * 60 * 60 * 1000;

const normCompany = (s) => String(s || '')
  .replace(/\[예시\]|\(주\)|㈜|주식회사|\s/g, '')
  .toLowerCase();

/** 최종값: 사용자가 고쳤으면 userValue, 아니면 aiValue */
export const finalValue = (f) => (f.source === 'user' ? f.userValue : f.aiValue);

function values(report) {
  const fields = Array.isArray(report) ? report : report?.fields;
  if (!Array.isArray(fields)) throw new TypeError('INVALID_REPORT');
  return Object.fromEntries(fields.map((f) => [f.key, finalValue(f)]));
}

const range = (s) => (s ? `${s.from ?? '?'}~${s.to ?? '?'}` : '?');

function periodCheck(nd, g) {
  if (!nd || (!nd.from && !nd.to) || (!g.periodStart && !g.periodEnd)) return null; // 모르면 점수 없이 넘어감
  const rFrom = Date.parse(nd.from ?? nd.to), rTo = Date.parse(nd.to ?? nd.from);
  const gStart = g.periodStart ? Date.parse(g.periodStart) - PERIOD_GRACE_DAYS * DAY : -Infinity;
  const gEnd = g.periodEnd ? Date.parse(g.periodEnd) + PERIOD_GRACE_DAYS * DAY : Infinity;
  return rFrom <= gEnd && rTo >= gStart;
}

/**
 * @param {{fields: import('./extract.js').ReportField[]} | import('./extract.js').ReportField[]} report extract() 결과(사용자 수정 반영본)
 * @param {Array<{id:string,name:string,company:string,harmType:'privacy_leak',status?:string,description?:string,conditions?:string,periodStart:string|null,periodEnd:string|null}>} groups 계약 2장 Group
 * @returns {Array<{groupId:string,score:number,level:'same'|'similar',matches:string[],diffs:string[]}>} 점수 높은 순, 45점 미만 제외
 */
export function match(report, groups) {
  const v = values(report);
  const company = typeof v.company === 'string' && v.company.trim() ? v.company : null;
  const type = typeof v.type === 'string' ? v.type : null;
  const leaked = Array.isArray(v.leaked) ? v.leaked : [];

  return (groups || [])
    .filter((g) => g && g.status !== 'closed')
    .filter((g) => (!company || normCompany(g.company) === normCompany(company)) && (!type || g.harmType === type))
    .map((g) => {
      const matches = [], diffs = [];
      let score = 0;
      if (company) { score += WEIGHT.company; matches.push(`회사: ${g.company}`); }
      if (type) { score += WEIGHT.type; matches.push(`피해 유형: ${HARM_LABEL[g.harmType] ?? g.harmType}`); }

      const period = periodCheck(v.notice_date, g);
      const gRange = range({ from: g.periodStart, to: g.periodEnd });
      if (period === true) { score += WEIGHT.period; matches.push(`시기: 그룹 기간 ${gRange}과 맞음`); }
      if (period === false) score -= WEIGHT.period;
      if (period === false) diffs.push(`시기: 내 글 ${range(v.notice_date)} / 그룹 ${gRange}`);

      const groupText = `${g.name || ''} ${g.description || ''} ${g.conditions || ''}`;
      if (leaked.length) {
        const same = leaked.filter((x) => groupText.includes(x));
        const only = leaked.filter((x) => !groupText.includes(x));
        score += (same.length / leaked.length) * WEIGHT.leaked;
        if (same.length) matches.push(`유출 정보: ${same.join(', ')}`);
        if (same.length && only.length) diffs.push(`그룹 설명에 없는 유출 정보: ${only.join(', ')}`);
      }
      if (v.secondary === 'yes' && /2차|스미싱|피싱|명의\s?도용|사칭/.test(groupText)) {
        score += WEIGHT.secondary; matches.push('2차 피해 있음');
      }

      score = Math.round(Math.max(0, Math.min(100, score)));
      return { groupId: g.id, score, level: score >= THRESHOLD.same ? 'same' : 'similar', matches, diffs };
    })
    .filter((r) => r.score >= THRESHOLD.similar)
    .sort((a, b) => b.score - a.score);
}
