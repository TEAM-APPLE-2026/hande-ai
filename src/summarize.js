// 로펌용 익명 집계(integration-contract.md 5장) → 3~4줄 요약
// 아래 숫자 항목만 읽는다. 다른 키(groupId, asOf, 원문 등)는 읽지 않으므로 결과에 들어갈 수 없다.
export const STAT_KEYS = [
  'memberCount',
  'secondaryYesCount', 'secondaryKnownCount', 'secondaryUnknownCount', 'secondaryRatio',
  'evidenceHolderCount', 'evidenceRatio'
];
const RATIO_KEYS = new Set(['secondaryRatio', 'evidenceRatio']);
// 이보다 적으면 이름이 없어도 개인이 드러날 수 있다(계약 5장)
export const SMALL_GROUP = 5;

function pick(stats) {
  if (!stats || typeof stats !== 'object') throw new TypeError('INVALID_STATS');
  const s = {};
  for (const k of STAT_KEYS) {
    const v = stats[k];
    if (v === undefined || v === null) {
      if (k === 'memberCount') throw new TypeError(`INVALID_STATS: ${k}`);
      s[k] = null; // 비율이 null이면 "아직 집계 전"
      continue;
    }
    const bad = typeof v !== 'number' || !Number.isFinite(v) || v < 0 ||
      (RATIO_KEYS.has(k) ? v > 1 : !Number.isInteger(v));
    if (bad) throw new TypeError(`INVALID_STATS: ${k}`);
    s[k] = v;
  }
  return s;
}

const pct = (r) => `${Math.round(r * 100)}%`;
const n = (x) => (x === null ? '-' : `${x}명`);

/**
 * @param {{memberCount:number, secondaryYesCount?:number, secondaryKnownCount?:number, secondaryUnknownCount?:number,
 *   secondaryRatio:number|null, evidenceHolderCount?:number, evidenceRatio:number|null}} stats 숫자만
 * @returns {string} 줄바꿈(\n)으로 이은 3~4줄
 */
export function summarize(stats) {
  const s = pick(stats);
  const lines = [`활성 참여자 ${s.memberCount}명 기준 익명 집계입니다.`];

  lines.push(s.secondaryRatio === null
    ? '2차 피해 비율: 아직 집계 전'
    : `2차 피해 비율: ${pct(s.secondaryRatio)} (응답 ${n(s.secondaryKnownCount)} 중 ${n(s.secondaryYesCount)}, 모름·미응답 ${n(s.secondaryUnknownCount)})`);

  lines.push(s.evidenceRatio === null
    ? '증빙 보유 비율: 아직 집계 전'
    : `증빙 보유 비율: ${pct(s.evidenceRatio)} (${n(s.evidenceHolderCount)} 보유)`);

  if (s.memberCount > 0 && s.memberCount < SMALL_GROUP) {
    lines.push(`참여자가 ${SMALL_GROUP}명 미만이라 개인이 드러날 수 있으니 외부 공유에 주의하세요.`);
  }
  return lines.join('\n');
}
