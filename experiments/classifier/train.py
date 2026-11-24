"""secondary · card 분류 모델 학습 (TF-IDF 글자 n-gram + 로지스틱 회귀).

- 글자 n-gram 어휘 · idf는 학습 문장으로 한 번만 만들고 두 항목이 같이 쓴다(classifier.json에 한 번만 저장).
- 분류기는 secondary, card를 따로 학습한다.
- 검증 데이터로 C(0.3, 1, 3, 10, 30, 100)를 고르고(macro F1), 학습 데이터로만 학습한 그 모델을 평가 데이터로 잰다.
- 같은 평가 문장에 현재 규칙(src/extract.js, 모델 끔)을 node로 돌려 비교한다. 규칙의 unknown은 따로 센다.
- 결과: experiments/classifier/REPORT.md, experiments/classifier/classifier.json(원본), src/models/classifier.js(같은 내용의 ES 모듈, 패키지에 들어감), experiments/classifier/parity.json
  (REPORT.md의 <!-- hybrid:start --> ~ <!-- hybrid:end --> 구역은 hybrid.mjs가 쓰므로 그대로 둔다)

실행: python experiments/classifier/train.py   (먼저 make_data.py로 data/classifier/*.json을 만든다)
"""
import datetime as dt
import json
import random
import re
import subprocess
import time
from pathlib import Path

import numpy as np
import sklearn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
DATA = ROOT / 'data' / 'classifier'
MODEL_OUT = HERE / 'classifier.json'  # 원본(패키지에는 넣지 않음)
# 브라우저 · Node가 import attributes 없이 읽도록 같은 내용을 ES 모듈로도 쓴다 (src/classify.js가 이것을 import)
MODEL_JS_OUT = ROOT / 'src' / 'models' / 'classifier.js'
REPORT_OUT = HERE / 'REPORT.md'
PARITY_OUT = HERE / 'parity.json'
HYBRID_START, HYBRID_END = '<!-- hybrid:start -->', '<!-- hybrid:end -->'

TARGETS = ['secondary', 'card']
LABELS = ['yes', 'no', 'none']           # 정답 라벨
RULE_LABELS = LABELS + ['unknown']       # 규칙은 unknown도 낸다
C_GRID = [0.3, 1, 3, 10, 30, 100]
VEC_CONFIG = dict(analyzer='char_wb', ngram_range=(2, 4), max_features=5000)
ROUND = 6          # 내보낼 때 소수 자리
PARITY_N = 30
PARITY_SEED = 0
N_ERRORS = 5


def load(name):
    return json.loads((DATA / f'{name}.json').read_text(encoding='utf-8'))['items']


def metrics(gold, pred, pred_labels):
    p, r, f, s = precision_recall_fscore_support(gold, pred, labels=LABELS, zero_division=0)
    return {
        'accuracy': accuracy_score(gold, pred),
        # macro F1은 정답 라벨 3개 기준. 규칙의 unknown은 어느 정답과도 같지 않으므로 틀린 것으로 들어간다.
        'macro_f1': f1_score(gold, pred, labels=LABELS, average='macro', zero_division=0),
        'per_label': {lab: {'precision': p[i], 'recall': r[i], 'f1': f[i], 'support': int(s[i])} for i, lab in enumerate(LABELS)},
        'confusion': confusion_matrix(gold, pred, labels=pred_labels)[:len(LABELS)].tolist(),
        'confusion_cols': pred_labels,
        'unknown': sum(1 for x in pred if x == 'unknown'),
    }


def run_rules(path):
    out = subprocess.run(['node', str(HERE / 'rules.mjs'), str(path)], cwd=ROOT,
                         capture_output=True, check=True, encoding='utf-8')
    return {r['id']: r for r in json.loads(out.stdout)}


# ── 내보낸 JSON만으로 다시 계산 (src/classify.js가 따라 하는 순서와 같다) ──
WS = re.compile(r'\s\s+')


def char_wb_ngrams(text, lo, hi):
    """sklearn char_wb와 같은 규칙: 소문자 → 연속 공백을 한 칸으로 → 단어마다 앞뒤 공백을 붙여 n-gram.
    단어(공백 포함)가 n보다 짧으면 단어 전체를 한 번만 세고 더 긴 n은 보지 않는다."""
    text = WS.sub(' ', text.lower())
    grams = []
    for w in text.split():
        w = f' {w} '
        for n in range(lo, hi + 1):
            offset = 0
            grams.append(w[offset:offset + n])
            while offset + n < len(w):
                offset += 1
                grams.append(w[offset:offset + n])
            if offset == 0:
                break
    return grams


def predict_from_export(model, target, text):
    counts = {}
    for g in char_wb_ngrams(text, *model['preprocess']['ngramRange']):
        i = model['vocabulary'].get(g)
        if i is not None:
            counts[i] = counts.get(i, 0) + 1
    x = {i: c * model['idf'][i] for i, c in counts.items()}
    norm = sum(v * v for v in x.values()) ** 0.5
    if norm:
        x = {i: v / norm for i, v in x.items()}
    t = model['targets'][target]
    logits = [b + sum(row[i] * v for i, v in x.items()) for row, b in zip(t['coef'], t['intercept'])]
    m = max(logits)
    e = [np.exp(z - m) for z in logits]
    s = sum(e)
    return [float(v / s) for v in e]


def export(vec, clfs, chosen, sizes, test_metrics):
    vocab = {g: int(i) for g, i in sorted(vec.vocabulary_.items(), key=lambda kv: kv[1])}
    return {
        'format': 'hande-tfidf-logreg',
        'formatVersion': 2,
        'preprocess': {
            'lowercase': True,
            'collapseWhitespace': '\\s\\s+ → " "',
            'analyzer': 'char_wb',
            'ngramRange': list(VEC_CONFIG['ngram_range']),
            'wordPadding': ' ',
            'shortWord': '단어(앞뒤 공백 포함)가 n보다 짧으면 단어 전체를 한 번 세고 더 긴 n은 건너뜀',
            'unit': 'Unicode code point (JS는 Array.from으로 자를 것)',
            'tf': 'raw count', 'idf': 'smooth (내보낸 값 그대로 곱함)', 'norm': 'l2',
            'output': 'softmax(coef · x + intercept), classes 순서',
        },
        # 두 항목이 같이 쓰는 어휘(n-gram → index)와 idf
        'vocabulary': vocab,
        'idf': [round(float(v), ROUND) for v in vec.idf_],
        'targets': {t: {
            'classes': [str(c) for c in clf.classes_],
            'C': chosen[t],
            'coef': [[round(float(v), ROUND) for v in row] for row in clf.coef_],
            'intercept': [round(float(v), ROUND) for v in clf.intercept_],
        } for t, clf in clfs.items()},
        'metadata': {
            'trainedAt': dt.date.today().isoformat(),
            'data': sizes,
            'dataNote': '[예시] 직접 만든 합성 문장 (data/classifier). 학습 데이터로만 학습, C는 검증 데이터로 선택',
            'test': {t: {'accuracy': round(m['accuracy'], 4), 'macroF1': round(m['macro_f1'], 4)} for t, m in test_metrics.items()},
            'sklearn': sklearn.__version__,
            'rounding': f'소수 {ROUND}자리',
        },
    }


def pct(x):
    return f'{x * 100:.1f}%'


def confusion_md(m, title):
    cols = m['confusion_cols']
    lines = [f'**{title}** (행: 정답, 열: 예측)', '', '| 정답 \\ 예측 | ' + ' | '.join(cols) + ' |',
             '|---|' + '---:|' * len(cols)]
    for lab, row in zip(LABELS, m['confusion']):
        lines.append(f'| {lab} | ' + ' | '.join(map(str, row)) + ' |')
    return '\n'.join(lines)


def per_label_md(rule, model):
    lines = ['| 라벨 | 규칙 정밀도 | 규칙 재현율 | 모델 정밀도 | 모델 재현율 | 개수 |', '|---|---:|---:|---:|---:|---:|']
    for lab in LABELS:
        r, m = rule['per_label'][lab], model['per_label'][lab]
        lines.append(f"| {lab} | {pct(r['precision'])} | {pct(r['recall'])} | {pct(m['precision'])} | {pct(m['recall'])} | {r['support']} |")
    return '\n'.join(lines)


def errors_md(items, pred, target, n=N_ERRORS):
    wrong = [(it, p) for it, p in zip(items, pred) if p != it[target]]
    if not wrong:
        return '- (틀린 예 없음)'
    picked = random.Random(1).sample(wrong, min(n, len(wrong)))
    return '\n'.join(f"- `{it['text']}` — 정답 {it[target]}, 예측 {p}" for it, p in picked) + f'\n\n(틀린 문장 {len(wrong)}개 중 {len(picked)}개)'


def main():
    train, val, test = load('train'), load('val'), load('test')
    sizes = {'train': len(train), 'val': len(val), 'test': len(test)}
    texts = lambda items: [x['text'] for x in items]

    # 어휘 · idf는 학습 문장으로 한 번만 (라벨을 보지 않으므로 두 항목에 같다)
    start = time.perf_counter()
    vec = TfidfVectorizer(**VEC_CONFIG)
    X_train = vec.fit_transform(texts(train))
    X_val, X_test = vec.transform(texts(val)), vec.transform(texts(test))
    vec_seconds = time.perf_counter() - start

    chosen, search, clfs, fit_seconds, test_pred, test_proba = {}, {}, {}, {}, {}, {}
    start = time.perf_counter()
    for t in TARGETS:
        search[t] = {}
        for c in C_GRID:
            clf = LogisticRegression(C=c, max_iter=5000).fit(X_train, [x[t] for x in train])
            search[t][c] = f1_score([x[t] for x in val], clf.predict(X_val), labels=LABELS, average='macro', zero_division=0)
        # 점수가 같으면 작은 C(규제가 강한 쪽)
        chosen[t] = max(C_GRID, key=lambda c: (round(search[t][c], 6), -c))
    search_seconds = time.perf_counter() - start

    for t in TARGETS:
        start = time.perf_counter()
        clfs[t] = LogisticRegression(C=chosen[t], max_iter=5000).fit(X_train, [x[t] for x in train])
        fit_seconds[t] = time.perf_counter() - start
        test_pred[t] = list(clfs[t].predict(X_test))
        test_proba[t] = clfs[t].predict_proba(X_test)

    model_metrics = {t: metrics([x[t] for x in test], test_pred[t], LABELS) for t in TARGETS}

    # 내보내기 + 내보낸 값만으로 다시 계산해서 sklearn과 비교
    # (규칙 비교보다 먼저: rules.mjs가 src를 불러오면 src/models/classifier.js가 있어야 한다)
    model_json = export(vec, clfs, chosen, sizes, model_metrics)
    MODEL_JS_OUT.parent.mkdir(parents=True, exist_ok=True)
    compact = json.dumps(model_json, ensure_ascii=False, separators=(',', ':'))
    MODEL_OUT.write_text(compact, encoding='utf-8')
    MODEL_JS_OUT.write_text('// 자동 생성: experiments/classifier/train.py — 직접 고치지 말 것 (experiments/classifier/classifier.json과 같은 내용)\n'
                            f'export default {compact};\n', encoding='utf-8')
    model_bytes = MODEL_OUT.stat().st_size
    model_js_bytes = MODEL_JS_OUT.stat().st_size
    max_diff = 0.0
    for t in TARGETS:
        for i, x in enumerate(test):
            p = predict_from_export(model_json, t, x['text'])
            max_diff = max(max_diff, float(np.max(np.abs(np.array(p) - test_proba[t][i]))))
    assert max_diff < 1e-4, f'내보낸 모델과 sklearn 확률 차이가 큼: {max_diff}'

    rules = run_rules(DATA / 'test.json')
    rule_pred = {t: [rules[x['id']][t] for x in test] for t in TARGETS}
    rule_metrics = {t: metrics([x[t] for x in test], rule_pred[t], RULE_LABELS) for t in TARGETS}

    # parity: 평가 문장 30개, 내보낸 JSON으로 계산한 확률 (JS가 1e-6 안에서 같은 값을 내야 함)
    picked = random.Random(PARITY_SEED).sample(test, PARITY_N)

    def parity_target(x, t):
        p = predict_from_export(model_json, t, x['text'])
        return {'gold': x[t], 'probs': [round(v, 10) for v in p],
                'pred': model_json['targets'][t]['classes'][int(np.argmax(p))]}

    parity = {
        'note': '[예시] 평가 문장. probs는 내보낸 모델(experiments/classifier/classifier.json = src/models/classifier.js)만으로 계산한 값(classes 순서). JS 구현과 비교용.',
        'tolerance': 1e-6,
        'maxDiffVsSklearn': max_diff,
        'classes': {t: model_json['targets'][t]['classes'] for t in TARGETS},
        'items': [{'id': x['id'], 'text': x['text'], **{t: parity_target(x, t) for t in TARGETS}} for x in picked],
    }
    PARITY_OUT.write_text(json.dumps(parity, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    write_report(sizes, search, chosen, rule_metrics, model_metrics, test, rule_pred, test_pred,
                 vec_seconds, search_seconds, fit_seconds, model_bytes, model_js_bytes, max_diff, model_json)
    print_summary(search, chosen, rule_metrics, model_metrics, fit_seconds, model_js_bytes)


def write_report(sizes, search, chosen, rule_m, model_m, test, rule_pred, model_pred,
                 vec_seconds, search_seconds, fit_seconds, model_bytes, model_js_bytes, max_diff, model_json):
    old = REPORT_OUT.read_text(encoding='utf-8') if REPORT_OUT.exists() else ''
    hybrid = old[old.index(HYBRID_START):old.index(HYBRID_END) + len(HYBRID_END)] if HYBRID_START in old and HYBRID_END in old \
        else f'{HYBRID_START}\n(`node experiments/classifier/hybrid.mjs`를 실행하면 여기에 하이브리드 결과가 들어간다)\n{HYBRID_END}'
    out = [
        '# secondary · card 분류 실험 결과',
        '',
        f"- 날짜: {dt.date.today().isoformat()} · 데이터: [예시] 학습 {sizes['train']} / 검증 {sizes['val']} / 평가 {sizes['test']}문장 (같은 씨앗의 변형은 한쪽에만)",
        f"- 모델: TfidfVectorizer(char_wb, 2~4글자, 최대 5000개, 두 항목 공유) + LogisticRegression(secondary · card 따로). sklearn {sklearn.__version__}",
        '- 규칙: 현재 `src/extract.js`의 secondary · card 키워드 판단(모델 끔)을 평가 문장 한 개씩 돌린 결과. 찾지 못함(null)은 none, **unknown은 따로 센다**(정답 라벨에 unknown이 없으므로 정확도·F1에서는 틀린 것).',
        '- macro F1: 정답 라벨 yes · no · none 3개의 F1 평균.',
        '- ⚠️ 평가 데이터는 직접 만든 [예시] 문장이라 실제 글에서의 성능을 보장하지 않는다. 대부분의 라벨 조합이 평가에서 씨앗 1개뿐이라 조합별 수치는 흔들림이 크다.',
        '',
        '## 요약 (평가 데이터, 문장 단위)',
        '',
        '| 항목 | 규칙 정확도 | 규칙 macro F1 | 규칙 unknown | 모델 정확도 | 모델 macro F1 | 모델 C |',
        '|---|---:|---:|---:|---:|---:|---:|',
    ]
    for t in TARGETS:
        r, m = rule_m[t], model_m[t]
        out.append(f"| {t} | {pct(r['accuracy'])} | {r['macro_f1']:.3f} | {r['unknown']}개 | {pct(m['accuracy'])} | {m['macro_f1']:.3f} | {chosen[t]} |")
    out += ['', hybrid, '', '## C 고르기 (검증 데이터 macro F1)', '', '| 항목 | ' + ' | '.join(f'C={c}' for c in C_GRID) + ' | 선택 |',
            '|---|' + '---:|' * (len(C_GRID) + 1)]
    for t in TARGETS:
        out.append(f'| {t} | ' + ' | '.join(f'{search[t][c]:.3f}' for c in C_GRID) + f' | {chosen[t]} |')
    for t in TARGETS:
        out += ['', f'## {t}', '', '### 라벨별 정밀도 · 재현율', '', per_label_md(rule_m[t], model_m[t]), '',
                '### 혼동행렬', '', confusion_md(rule_m[t], '규칙'), '', confusion_md(model_m[t], '모델'), '',
                '### 틀린 예', '', '**규칙**', '', errors_md(test, rule_pred[t], t), '', '**모델**', '', errors_md(test, model_pred[t], t)]

    # 평가 데이터의 씨앗 목록: 수치가 어떤 표현 몇 개에서 나왔는지 함께 봐야 한다
    seeds = {}
    for x in test:
        seeds.setdefault(x['seed'], x)
    out += ['', '## 평가 데이터의 씨앗 (대표 문장)', '',
            f'평가 {len(test)}문장은 씨앗 {len(seeds)}개의 변형이다. 한 씨앗이 틀리면 그 변형 4~8문장이 같이 틀린다.', '',
            '| 씨앗 | secondary | card | 문장 수 | 대표 문장 | 규칙 (secondary/card) |', '|---:|---|---|---:|---|---|']
    first_idx = {x['id']: i for i, x in enumerate(test)}
    for s, x in sorted(seeds.items(), key=lambda kv: (kv[1]['secondary'], kv[1]['card'], kv[0])):
        n = sum(1 for y in test if y['seed'] == s)
        i = first_idx[x['id']]
        out.append(f"| {s} | {x['secondary']} | {x['card']} | {n} | {x['text']} | {rule_pred['secondary'][i]} / {rule_pred['card'][i]} |")
    out += ['', '## 학습 시간 · 모델 크기', '',
            f"- 어휘 · idf 만들기(학습 문장 1회): {vec_seconds:.3f}초",
            f"- C 고르기(2항목 × C {len(C_GRID)}개 학습 + 검증): {search_seconds:.2f}초",
            f"- 최종 학습: secondary {fit_seconds['secondary']:.3f}초 · card {fit_seconds['card']:.3f}초",
            f"- `experiments/classifier/classifier.json`(원본, 패키지 제외): {model_bytes:,} bytes ({model_bytes / 1024:.0f} KB), 공유 어휘 {len(model_json['vocabulary']):,}개, 소수 {ROUND}자리",
            f"- `src/models/classifier.js` (같은 내용의 ES 모듈, 브라우저가 import): {model_js_bytes:,} bytes ({model_js_bytes / 1024:.0f} KB)",
            f"- 내보낸 JSON만으로 다시 계산한 확률과 sklearn 확률의 최대 차이: {max_diff:.2e}",
            '',
            '## 다시 만들기', '', '```bash', 'pip install -r experiments/classifier/requirements.txt',
            'python experiments/classifier/make_data.py', 'python experiments/classifier/train.py',
            'node experiments/classifier/hybrid.mjs   # 하이브리드 기준값 · 비교 표', '```', '']
    REPORT_OUT.write_text('\n'.join(out), encoding='utf-8')


def print_summary(search, chosen, rule_m, model_m, fit_seconds, model_bytes):
    for t in TARGETS:
        print(f'{t} C 검증 F1: ' + ', '.join(f'{c}={search[t][c]:.3f}' for c in C_GRID) + f' → {chosen[t]}')
    print('| 항목 | 규칙 정확도 | 규칙 macro F1 | 규칙 unknown | 모델 정확도 | 모델 macro F1 | C |')
    print('|---|---:|---:|---:|---:|---:|---:|')
    for t in TARGETS:
        r, m = rule_m[t], model_m[t]
        print(f"| {t} | {pct(r['accuracy'])} | {r['macro_f1']:.3f} | {r['unknown']} | {pct(m['accuracy'])} | {m['macro_f1']:.3f} | {chosen[t]} |")
    print('학습 시간: ' + ', '.join(f'{t} {s:.3f}s' for t, s in fit_seconds.items()) + f' · classifier.js {model_bytes:,} bytes')


if __name__ == '__main__':
    main()
