// 정확도 평가: eval/cases.json의 정답과 aiValue를 비교해 항목별 맞힌 비율 출력
// now: 연도 없는 날짜("10월 초")를 해석하는 기준일 — 결과가 날마다 바뀌지 않게 고정
import { readFileSync } from 'node:fs';
import { deepStrictEqual } from 'node:assert';
import { extract, FIELD_KEYS } from '../src/index.js';

const { now, cases } = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url)));
const [y, m, d] = now.split('-').map(Number);
const NOW = new Date(y, m - 1, d);

const same = (a, b) => { try { deepStrictEqual(a, b); return true; } catch { return false; } };
const hit = Object.fromEntries(FIELD_KEYS.map((k) => [k, 0])), seen = { ...hit };
const misses = [];

cases.forEach((c, i) => {
  const r = extract(c.text, { now: NOW });
  for (const f of r.fields) {
    if (f.quote && !c.text.includes(f.quote)) throw new Error(`케이스 ${i + 1} ${f.key}: quote가 원문에 없음`);
  }
  const got = Object.fromEntries(r.fields.map((f) => [f.key, f.aiValue]));
  for (const k of Object.keys(c.expect)) {
    seen[k]++;
    if (same(got[k] ?? null, c.expect[k])) hit[k]++;
    else misses.push(`  케이스 ${i + 1} ${k}: 정답 ${JSON.stringify(c.expect[k])} / 결과 ${JSON.stringify(got[k] ?? null)}`);
  }
});

for (const k of FIELD_KEYS) if (seen[k]) console.log(`${k.padEnd(12)} ${hit[k]}/${seen[k]}`);
if (misses.length) console.log(`틀린 항목:\n${misses.join('\n')}`);
console.log(`케이스 ${cases.length}개 — 목표: 케이스 50개, 항목별 80% 이상`);
