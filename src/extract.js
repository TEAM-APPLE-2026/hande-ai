// 피해 글 → 정리 결과
// 규칙: 값마다 원문 근거(quote)를 붙이고, 못 찾으면 추측하지 않고 needsCheck=true
export const FIELD_KEYS = ['company', 'type', 'noticeDate', 'leaked', 'secondary', 'card'];

const LABEL = {
  company: '상대 기업', type: '피해 유형', noticeDate: '통지 시점',
  leaked: '유출된 정보', secondary: '2차 피해', card: '카드 정보 유출'
};

function find(text, re) {
  const m = text.match(re);
  return m ? { value: m[1] ?? m[0], quote: m[0] } : null;
}

const RULES = {
  // [예시] 기호 이름(△△ 통신사)과 일반 회사 이름 모두 잡는다
  company: (t) => find(t, /([^\s,.]{1,12}\s?(?:통신사|쇼핑몰|카드사|보험사|여행사|은행|병원|앱))/),
  type: (t) => /유출|해킹|털렸/.test(t)
    ? { value: '개인정보 유출', quote: (t.match(/[^\s]*(?:유출|해킹|털렸)[^\s]*/) || [''])[0] }
    : null,
  noticeDate: (t) => {
    return find(t, /(\d{1,2}월\s?(?:초|중순|말|\d{1,2}일)?)/);
  },
  leaked: (t) => {
    const items = ['이름', '연락처', '전화번호', '주소', '이메일', '생년월일', '계좌'].filter((w) => t.includes(w));
    return items.length ? { value: items.join(' · '), quote: items.join(', ') } : null;
  },
  secondary: (t) => {
    const r = t.match(/(스미싱|보이스피싱|명의\s?도용)[^.]*?(\d+|한|두|세|네|다섯)\s?(?:번|건|회)/);
    if (!r) return null;
    const n = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5 }[r[2]] ?? Number(r[2]);
    return { value: `${r[1]} ${n}회`, quote: r[0] };
  },
  card: (t) => /카드\s?(?:번호|정보)/.test(t)
    ? { value: '유출됨', quote: (t.match(/카드\s?(?:번호|정보)[^.]*/) || [''])[0] }
    : null
};

/**
 * @param {string} text 사용자가 쓴 피해 글
 * @returns {{ fields: Array<{key:string,label:string,value:string|null,quote:string|null,needsCheck:boolean,source:'ai'}>, filled:number, total:number }}
 */
export function extract(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('EMPTY_TEXT');
  const fields = FIELD_KEYS.map((key) => {
    const r = RULES[key](text);
    return { key, label: LABEL[key], value: r?.value ?? null, quote: r?.quote ?? null, needsCheck: !r, source: 'ai' };
  });
  return { fields, filled: fields.filter((f) => !f.needsCheck).length, total: fields.length };
}
