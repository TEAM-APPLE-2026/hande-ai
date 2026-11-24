// 하이브리드(규칙 + 모델) 실험: 기준값 고르기(검증) · 규칙/모델/하이브리드 비교(평가) · v0.3.0 대비 eval/cases.json
// 실행: node experiments/classifier/hybrid.mjs   → REPORT.md의 <!-- hybrid:start --> ~ <!-- hybrid:end --> 구역을 다시 쓴다
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deepStrictEqual } from 'node:assert';
import { extract, FIELD_KEYS } from '../../src/index.js';
import { getClassifier, MODEL_THRESHOLD } from '../../src/classify.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const REPORT = join(HERE, 'REPORT.md');
const START = '<!-- hybrid:start -->', END = '<!-- hybrid:end -->';
const NOW = new Date(2026, 10, 11);
const TARGETS = ['secondary', 'card'];
const LABELS = ['yes', 'no', 'none'];
const THRESHOLDS = [0.5, 0.6, 0.7];
const OLD_VERSION = 'v0.3.0';

const load = (name) => JSON.parse(readFileSync(join(ROOT, 'data', 'classifier', `${name}.json`), 'utf8')).items;
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const val = load('val'), test = load('test');
const clf = getClassifier();

const fieldValue = (r, key) => r.fields.find((f) => f.key === key)?.aiValue ?? 'none';
const predictors = {
  rule: (text) => extract(text, { now: NOW, classifier: null }),
  hybrid: (text, threshold = MODEL_THRESHOLD) => extract(text, { now: NOW, modelThreshold: threshold })
};
// 모델만: 문장 전체를 한 번에 분류(train.py의 "모델"과 같은 방식)
function modelOnly(text, key) {
  const p = clf.predict(key, text);
  return Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];
}

function score(gold, pred) {
  const n = gold.length;
  const correct = gold.filter((g, i) => g === pred[i]).length;
  const unknown = pred.filter((p) => p === 'unknown').length;
  const f1s = LABELS.map((lab) => {
    const tp = gold.filter((g, i) => g === lab && pred[i] === lab).length;
    const fp = pred.filter((p, i) => p === lab && gold[i] !== lab).length;
    const fn = gold.filter((g, i) => g === lab && pred[i] !== lab).length;
    const prec = tp + fp ? tp / (tp + fp) : 0, rec = tp + fn ? tp / (tp + fn) : 0;
    return prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
  });
  return {
    n, correct, unknown, wrong: n - correct - unknown,
    accuracy: correct / n,
    macroF1: f1s.reduce((a, b) => a + b, 0) / LABELS.length,
    answeredAccuracy: n - unknown ? correct / (n - unknown) : 0,
    // 기준값 고르기 점수: 맞히면 +1, 틀리면 -1, 확인 필요(unknown)는 0 — 틀린 답이 "확인 필요"보다 나쁘다
    net: correct - (n - correct - unknown)
  };
}

// ── 1. 기준값 고르기 (검증 데이터) ──
const thresholdRows = THRESHOLDS.map((th) => {
  const results = val.map((x) => predictors.hybrid(x.text, th));
  const per = Object.fromEntries(TARGETS.map((t) => [t, score(val.map((x) => x[t]), results.map((r) => fieldValue(r, t)))]));
  return { th, per, net: per.secondary.net + per.card.net };
});
// 점수가 같으면 높은 기준값(덜 단정하는 쪽)
const best = thresholdRows.reduce((a, b) => (b.net > a.net || (b.net === a.net && b.th > a.th) ? b : a));

// ── 2. 평가 데이터: 규칙 / 모델 / 하이브리드 ──
const testRule = test.map((x) => predictors.rule(x.text));
const testHybrid = test.map((x) => predictors.hybrid(x.text));
const compare = TARGETS.map((t) => {
  const gold = test.map((x) => x[t]);
  return {
    t,
    rule: score(gold, testRule.map((r) => fieldValue(r, t))),
    model: score(gold, test.map((x) => modelOnly(x.text, t))),
    hybrid: score(gold, testHybrid.map((r) => fieldValue(r, t)))
  };
});
const hybridMistakes = TARGETS.map((t) => [t, test
  .map((x, i) => ({ x, got: fieldValue(testHybrid[i], t) }))
  .filter(({ x, got }) => got !== x[t])]);

// ── 3. eval/cases.json: v0.3.0(규칙) vs 지금(하이브리드) ──
async function loadOldExtract() {
  const dir = mkdtempSync(join(tmpdir(), 'hande-ai-old-'));
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', OLD_VERSION, 'src'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
  for (const f of files) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    writeFileSync(join(dir, f), execFileSync('git', ['show', `${OLD_VERSION}:${f}`], { cwd: ROOT }));
  }
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  const mod = await import(pathToFileURL(join(dir, 'src', 'index.js')).href);
  return { extract: mod.extract, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const { now: evalNow, cases } = JSON.parse(readFileSync(join(ROOT, 'eval', 'cases.json'), 'utf8'));
const [ey, em, ed] = evalNow.split('-').map(Number);
const EVAL_NOW = new Date(ey, em - 1, ed);
const same = (a, b) => { try { deepStrictEqual(a, b); return true; } catch { return false; } };

function runCases(fn) {
  const hit = Object.fromEntries(FIELD_KEYS.map((k) => [k, 0]));
  const misses = [];
  cases.forEach((c, i) => {
    const r = fn(c.text);
    const got = Object.fromEntries(r.fields.map((f) => [f.key, f.aiValue]));
    for (const k of FIELD_KEYS) {
      if (same(got[k] ?? null, c.expect[k])) hit[k]++;
      else misses.push({ i: i + 1, k, want: c.expect[k], got: got[k] ?? null });
    }
  });
  return { hit, misses };
}

const old = await loadOldExtract();
const evalOld = runCases((text) => old.extract(text, { now: EVAL_NOW }));
old.cleanup();
const evalNew = runCases((text) => extract(text, { now: EVAL_NOW }));

// ── REPORT.md 구역 쓰기 ──
const md = [START, '## 하이브리드 (규칙 + 모델) — `src/extract.js`', '',
  '- 키워드 규칙이 yes / no / unknown을 내면 규칙 값, 키워드가 없으면 문장마다 모델을 돌려 가장 확신 높은 문장을 근거로 쓴다.',
  `- 모델 최고 확률이 기준값 미만이거나, 기준 이상의 yes 문장과 no 문장이 함께 있으면 unknown + 확인 필요. 지금 기준값: **${MODEL_THRESHOLD}**`,
  '- unknown은 정답 라벨에 없으므로 정확도 · macro F1에서는 틀린 것으로 센다.', '',
  '### 기준값 고르기 (검증 데이터, 하이브리드)', '',
  '점수 = 맞힘 − 틀림 (unknown은 0점: 틀린 답보다 "확인 필요"가 낫다). 같으면 높은 기준값.', '',
  '| 기준값 | secondary 정확도 | secondary unknown | secondary 답한 것 중 정확도 | card 정확도 | card unknown | card 답한 것 중 정확도 | 점수 |',
  '|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...thresholdRows.map(({ th, per, net }) => `| ${th}${th === best.th ? ' ✅' : ''} | ${pct(per.secondary.accuracy)} | ${pct(per.secondary.unknown / per.secondary.n)} | ${pct(per.secondary.answeredAccuracy)} | ${pct(per.card.accuracy)} | ${pct(per.card.unknown / per.card.n)} | ${pct(per.card.answeredAccuracy)} | ${net} |`),
  '',
  '### 평가 데이터: 규칙 / 모델 / 하이브리드', '',
  '| 항목 | 방식 | 정확도 | macro F1 | unknown | 틀림 |', '|---|---|---:|---:|---:|---:|',
  ...compare.flatMap(({ t, rule, model, hybrid }) => [['규칙', rule], ['모델', model], ['하이브리드', hybrid]]
    .map(([name, s]) => `| ${t} | ${name} | ${pct(s.accuracy)} | ${s.macroF1.toFixed(3)} | ${s.unknown} | ${s.wrong} |`)),
  '',
  '**하이브리드가 틀린 예** (최대 5개씩)', '',
  ...hybridMistakes.flatMap(([t, list]) => [`- ${t}: ${list.length}개`, ...list.slice(0, 5).map(({ x, got }) => `  - \`${x.text}\` — 정답 ${x[t]}, 결과 ${got}`)]),
  '',
  `### eval/cases.json (${cases.length}케이스, 여러 문장 글): ${OLD_VERSION}(규칙) vs 지금(하이브리드)`, '',
  '| 항목 | ' + OLD_VERSION + ' | 지금 |', '|---|---:|---:|',
  ...FIELD_KEYS.map((k) => `| ${k} | ${evalOld.hit[k]}/${cases.length} (${pct(evalOld.hit[k] / cases.length)}) | ${evalNew.hit[k]}/${cases.length} (${pct(evalNew.hit[k] / cases.length)}) |`),
  '',
  `지금 틀린 항목: ${evalNew.misses.length ? evalNew.misses.map((m) => `케이스 ${m.i} ${m.k}(정답 ${JSON.stringify(m.want)} / 결과 ${JSON.stringify(m.got)})`).join(', ') : '없음'}`,
  '',
  `⚠️ eval/cases.json 43개는 이번에 새로 쓴 [예시] 글이고 모델 학습 데이터와 따로 만들었지만, 같은 사람이 쓴 비슷한 말투라 실제 글보다 쉬울 수 있다.`,
  END].join('\n');

const report = readFileSync(REPORT, 'utf8');
if (!report.includes(START) || !report.includes(END)) throw new Error('REPORT.md에 hybrid 구역이 없음 — train.py를 먼저 실행');
writeFileSync(REPORT, report.slice(0, report.indexOf(START)) + md + report.slice(report.indexOf(END) + END.length));

console.log(md.replace(START, '').replace(END, ''));
if (best.th !== MODEL_THRESHOLD) {
  console.log(`\n⚠️ 검증 데이터가 고른 기준값은 ${best.th}인데 src/classify.js의 MODEL_THRESHOLD는 ${MODEL_THRESHOLD}. 고치고 다시 실행하세요.`);
  process.exitCode = 1;
}
