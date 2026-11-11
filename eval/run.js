// 정확도 평가: eval/cases.json의 정답과 비교해 항목별 맞힌 비율 출력
import { readFileSync } from 'node:fs';
import { extract, FIELD_KEYS } from '../src/index.js';
const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url)));
const hit = Object.fromEntries(FIELD_KEYS.map((k) => [k, 0])), seen = { ...hit };
for (const c of cases) {
  const got = Object.fromEntries(extract(c.text).fields.map((f) => [f.key, f.value]));
  for (const k of Object.keys(c.expect)) { seen[k]++; if ((got[k] ?? null) === c.expect[k]) hit[k]++; }
}
for (const k of FIELD_KEYS) if (seen[k]) console.log(`${k.padEnd(11)} ${hit[k]}/${seen[k]}`);
console.log(`케이스 ${cases.length}개 — 목표: 케이스 50개, 항목별 80% 이상`);
