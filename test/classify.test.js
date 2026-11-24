// 분류 모델(src/classify.js)과 extract의 하이브리드(규칙 + 모델) 판단
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extract } from '../src/index.js';
import { charWbNgrams, loadClassifier, getClassifier, BUNDLED_MODEL, MODEL_THRESHOLD } from '../src/classify.js';

const NOW = new Date(2026, 10, 11);
const parity = JSON.parse(readFileSync(new URL('../experiments/classifier/parity.json', import.meta.url), 'utf8'));
const field = (text, key, opts = {}) => extract(text, { now: NOW, ...opts }).fields.find((f) => f.key === key);
const MODEL_ONLY = '모르는 사이트에서 제 아이디로 로그인 시도 알림이 떴어요.'; // secondary 키워드 없음

test('parity: Python(sklearn)과 같은 확률 (1e-6 이내)', () => {
  const clf = getClassifier();
  assert.ok(clf);
  assert.ok(parity.items.length >= 30);
  for (const item of parity.items) {
    for (const t of ['secondary', 'card']) {
      const p = clf.predict(t, item.text);
      parity.classes[t].forEach((c, k) => {
        assert.ok(Math.abs(p[c] - item[t].probs[k]) <= 1e-6, `${t} ${c} ${p[c]} vs ${item[t].probs[k]} — ${item.text}`);
      });
      const pred = Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];
      assert.equal(pred, item[t].pred, item.text);
    }
  }
});

test('char_wb 전처리: 소문자, 연속 공백 정리, 단어 앞뒤 공백, 짧은 단어는 한 번만', () => {
  assert.deepEqual(charWbNgrams('가', 2, 4), [' 가', '가 ', ' 가 ']);
  assert.deepEqual(charWbNgrams('AB', 2, 3), [' a', 'ab', 'b ', ' ab', 'ab ']);
  assert.deepEqual(charWbNgrams('가  나', 2, 2), charWbNgrams('가 나', 2, 2));
  assert.deepEqual(charWbNgrams('😀', 2, 3), [' 😀', '😀 ', ' 😀 ']); // code point 단위
});

test('모델 파일: 어휘 · idf는 한 번만, 두 항목이 같이 씀', () => {
  assert.equal(BUNDLED_MODEL.formatVersion, 2);
  assert.equal(Object.keys(BUNDLED_MODEL.vocabulary).length, BUNDLED_MODEL.idf.length);
  for (const t of ['secondary', 'card']) {
    assert.ok(!('vocabulary' in BUNDLED_MODEL.targets[t]) && !('idf' in BUNDLED_MODEL.targets[t]));
    assert.ok(BUNDLED_MODEL.targets[t].coef.every((row) => row.length === BUNDLED_MODEL.idf.length));
  }
  assert.ok([0.5, 0.6, 0.7].includes(MODEL_THRESHOLD));
});

test('모양이 틀린 모델은 INVALID_MODEL, getClassifier는 null', () => {
  for (const bad of [{}, { ...BUNDLED_MODEL, formatVersion: 1 }, { ...BUNDLED_MODEL, idf: [1, 2] }, { ...BUNDLED_MODEL, targets: {} }]) {
    assert.throws(() => loadClassifier(bad), /INVALID_MODEL/);
    assert.equal(getClassifier(bad), null);
  }
});

test('하이브리드: 키워드가 없으면 모델 값, 가장 확신 높은 문장이 quote', () => {
  const text = `△△ 통신사에서 이름이 유출됐어요. ${MODEL_ONLY}`;
  const f = field(text, 'secondary');
  assert.equal(f.aiValue, 'yes');
  assert.equal(f.quote, MODEL_ONLY);
  assert.ok(text.includes(f.quote));
  assert.equal(f.needsCheck, false);
  // 규칙만이면 찾지 못함
  assert.equal(field(text, 'secondary', { classifier: null }).aiValue, null);
});

test('하이브리드: 규칙이 키워드로 답을 내면 규칙 값 (모델 기준과 상관없이)', () => {
  for (const th of [0.5, 0.99]) {
    const f = field('△△ 통신사 유출이요. 스미싱 문자는 안 왔어요.', 'secondary', { modelThreshold: th });
    assert.equal(f.aiValue, 'no');
    assert.equal(f.needsCheck, false);
    assert.equal(f.quote, '스미싱 문자는 안 왔어요.');
  }
  // 규칙의 unknown(모르겠어요, 긍정·부정이 섞임)도 그대로
  assert.equal(field('2차 피해가 있는지는 잘 모르겠어요.', 'secondary').aiValue, 'unknown');
  assert.equal(field('스미싱 문자가 왔어요. 보이스피싱 전화는 없었어요.', 'secondary').aiValue, 'unknown');
});

test('하이브리드: 모델 최고 확률이 기준값 미만이면 unknown + 확인 필요', () => {
  const f = field(MODEL_ONLY, 'secondary', { modelThreshold: 0.999 });
  assert.equal(f.aiValue, 'unknown');
  assert.equal(f.needsCheck, true);
  assert.equal(f.quote, MODEL_ONLY);
});

test('하이브리드: 모델로 yes여도 secondary_detail 규칙은 그대로 (키워드가 없으면 상세 없음)', () => {
  const r = extract(MODEL_ONLY, { now: NOW });
  assert.equal(r.fields.find((f) => f.key === 'secondary').aiValue, 'yes');
  assert.ok(!r.fields.some((f) => f.key === 'secondary_detail'));
});

test('모델을 못 쓰면(모양 오류 · 계산 오류) 규칙 결과로 돌아간다', () => {
  const rulesOnly = extract(MODEL_ONLY, { now: NOW, classifier: null });
  assert.deepEqual(extract(MODEL_ONLY, { now: NOW, classifier: { broken: true } }), rulesOnly);
  // 계산 중 overflow → 확률이 NaN → 오류 → 규칙 결과
  const huge = structuredClone(BUNDLED_MODEL);
  for (const t of ['secondary', 'card']) huge.targets[t].coef = huge.targets[t].coef.map((row) => row.map(() => 1e308));
  assert.ok(getClassifier(huge));
  assert.throws(() => getClassifier(huge).predict('secondary', MODEL_ONLY), /INVALID_OUTPUT/);
  assert.deepEqual(extract(MODEL_ONLY, { now: NOW, classifier: huge }), rulesOnly);
});

test('외부 네트워크 요청을 하지 않는다', async () => {
  const saved = { fetch: globalThis.fetch, XMLHttpRequest: globalThis.XMLHttpRequest, WebSocket: globalThis.WebSocket };
  let calls = 0;
  const trap = () => { calls++; throw new Error('NETWORK'); };
  globalThis.fetch = trap;
  globalThis.XMLHttpRequest = function () { trap(); };
  globalThis.WebSocket = function () { trap(); };
  try {
    // 새 모델 객체로 준비(loadClassifier)부터 다시 거치게 한다
    extract(`△△ 통신사 유출이요. ${MODEL_ONLY}`, { now: NOW, classifier: structuredClone(BUNDLED_MODEL) });
    const { analyze } = await import('../src/index.js');
    await analyze(MODEL_ONLY);
  } finally {
    Object.assign(globalThis, saved);
  }
  assert.equal(calls, 0);
});
