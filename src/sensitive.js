// 민감 번호(주민등록번호 · 카드번호 · 계좌번호) 위치 찾기
// 값은 돌려주지 않고 위치만 쓴다. extract()는 이 위치와 겹치는 글자를 결과에 넣지 않는다.

const PATTERNS = [
  // 주민등록번호: YYMMDD-[1-8]XXXXXX (뒷자리 *로 가린 것도 포함)
  /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\s?-?\s?[1-8][\d*]{6}(?![\d*])/g,
  // 카드번호: 4-4-4-4 (공백·하이픈 허용) 또는 15~16자리 숫자
  /(?<!\d)\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{3,4}(?!\d)/g,
  /(?<!\d)\d{15,16}(?!\d)/g,
  // 계좌번호: 하이픈으로 나뉜 숫자 3묶음(예: 110-123-456789, 3333-01-1234567)
  /(?<!\d)\d{2,6}-\d{2,6}-\d{3,7}(?![\d-])/g,
  // 하이픈 없는 12~14자리 숫자
  /(?<!\d)\d{12,14}(?!\d)/g
];

// 전화번호는 민감 번호로 보지 않는다(유출 정보 '전화번호'로 따로 다룸)
const PHONE = /^0(?:1[016789]|2|[3-6][1-5]|70)-?\d{3,4}-?\d{4}$/;

/** @returns {Array<[number, number]>} 민감 번호의 [시작, 끝) 위치 */
export function findSensitive(text) {
  const ranges = [];
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (PHONE.test(m[0])) continue;
      ranges.push([m.index, m.index + m[0].length]);
    }
  }
  return ranges;
}

export const overlaps = (ranges, start, end) => ranges.some(([s, e]) => start < e && s < end);
