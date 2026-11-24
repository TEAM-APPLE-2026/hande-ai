// 현재 규칙(src/extract.js)의 secondary · card 판단을 데이터 파일의 문장마다 돌린다.
// 사용: node experiments/classifier/rules.mjs data/classifier/test.json  → stdout에 JSON
// 규칙 결과: 'yes' | 'no' | 'unknown' | 'none'(aiValue=null, 찾지 못함)
import { readFileSync } from 'node:fs';
import { extract } from '../../src/index.js';

const NOW = new Date(2026, 10, 11);
const { items } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const label = (fields, key) => fields.find((f) => f.key === key)?.aiValue ?? 'none';

const out = items.map(({ id, text }) => {
  const { fields } = extract(text, { now: NOW });
  return { id, secondary: label(fields, 'secondary'), card: label(fields, 'card') };
});
process.stdout.write(JSON.stringify(out));
