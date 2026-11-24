// secondary · card 분류 모델(브라우저에서 실행). src/models/classifier.js만 쓰고 네트워크 요청은 하지 않는다.
// 전처리는 sklearn TfidfVectorizer(analyzer='char_wb')와 같다 — experiments/classifier/train.py의 char_wb_ngrams 참고.
// classifier.js는 train.py가 classifier.json과 같은 내용으로 만든 ES 모듈 (import attributes가 필요 없다)
import bundled from './models/classifier.js';

export const CLASSIFIER_TARGETS = ['secondary', 'card'];
// 모델 최고 확률이 이보다 낮으면 unknown + 확인 필요.
// 검증 데이터로 0.5 / 0.6 / 0.7 중 고름 (experiments/classifier/hybrid.mjs, REPORT.md "기준값 고르기")
export const MODEL_THRESHOLD = 0.5;

const WS = /\s\s+/g;

/** sklearn char_wb와 같은 n-gram. 길이는 code point 단위(Array.from). */
export function charWbNgrams(text, lo, hi) {
  const grams = [];
  for (const word of text.toLowerCase().replace(WS, ' ').split(/\s+/)) {
    if (!word) continue;
    const w = Array.from(` ${word} `);
    for (let n = lo; n <= hi; n++) {
      let offset = 0;
      grams.push(w.slice(offset, offset + n).join(''));
      while (offset + n < w.length) {
        offset += 1;
        grams.push(w.slice(offset, offset + n).join(''));
      }
      if (offset === 0) break; // 짧은 단어는 한 번만 센다
    }
  }
  return grams;
}

const isNumArray = (a, n) => Array.isArray(a) && (n === undefined || a.length === n) && a.every((v) => typeof v === 'number' && Number.isFinite(v));

/**
 * classifier.json → 예측기. 모양이 틀리면 Error('INVALID_MODEL').
 * @returns {{ predict(target: 'secondary'|'card', text: string): Record<string, number> }}
 */
export function loadClassifier(json) {
  const bad = () => { throw new Error('INVALID_MODEL'); };
  if (!json || json.format !== 'hande-tfidf-logreg' || json.formatVersion !== 2) bad();
  const [lo, hi] = json.preprocess?.ngramRange ?? [];
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi < lo) bad();
  if (!json.vocabulary || typeof json.vocabulary !== 'object') bad();
  const vocab = new Map(Object.entries(json.vocabulary));
  const size = json.idf?.length;
  if (!isNumArray(json.idf) || ![...vocab.values()].every((i) => Number.isInteger(i) && i >= 0 && i < size)) bad();

  const targets = {};
  for (const t of CLASSIFIER_TARGETS) {
    const m = json.targets?.[t];
    if (!m || !Array.isArray(m.classes) || !m.classes.length || !isNumArray(m.intercept, m.classes.length)) bad();
    if (!Array.isArray(m.coef) || m.coef.length !== m.classes.length || !m.coef.every((row) => isNumArray(row, size))) bad();
    targets[t] = m;
  }

  return {
    predict(target, text) {
      const m = targets[target];
      if (!m) throw new Error('UNKNOWN_TARGET');
      const counts = new Map();
      for (const g of charWbNgrams(String(text), lo, hi)) {
        const i = vocab.get(g);
        if (i !== undefined) counts.set(i, (counts.get(i) ?? 0) + 1);
      }
      let norm = 0;
      const x = [];
      for (const [i, c] of counts) { const v = c * json.idf[i]; x.push([i, v]); norm += v * v; }
      norm = Math.sqrt(norm);
      const logits = m.coef.map((row, k) => x.reduce((s, [i, v]) => s + row[i] * (norm ? v / norm : 0), m.intercept[k]));
      const top = Math.max(...logits);
      const e = logits.map((z) => Math.exp(z - top));
      const sum = e.reduce((a, b) => a + b, 0);
      const probs = Object.fromEntries(m.classes.map((c, k) => [c, e[k] / sum]));
      if (!Object.values(probs).every(Number.isFinite)) throw new Error('INVALID_OUTPUT');
      return probs;
    }
  };
}

// 같은 모델 객체는 한 번만 준비한다. 준비에 실패하면 null(규칙만 쓰기).
const cache = new WeakMap();
export function getClassifier(json = bundled) {
  if (!json || typeof json !== 'object') return null;
  if (!cache.has(json)) {
    try { cache.set(json, loadClassifier(json)); } catch { cache.set(json, null); }
  }
  return cache.get(json);
}

export { bundled as BUNDLED_MODEL };
