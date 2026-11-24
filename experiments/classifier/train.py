"""secondary · card 분류 모델 학습 (TF-IDF 글자 n-gram + 로지스틱 회귀).

- secondary, card를 따로 학습한다.
- 검증 데이터로 C(0.3, 1, 3, 10)를 고르고(macro F1), 학습 데이터로만 학습한 그 모델을 평가 데이터로 잰다.
- 같은 평가 문장에 현재 규칙(src/extract.js)을 node로 돌려 비교한다. 규칙의 unknown은 따로 센다.
- 결과: experiments/classifier/REPORT.md, src/models/classifier.json, experiments/classifier/parity.json

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
MODEL_OUT = ROOT / 'src' / 'models' / 'classifier.json'
REPORT_OUT = HERE / 'REPORT.md'
PARITY_OUT = HERE / 'parity.json'

TARGETS = ['secondary', 'card']
LABELS = ['yes', 'no', 'none']           # 정답 라벨
RULE_LABELS = LABELS + ['unknown']       # 규칙은 unknown도 낸다
C_GRID = [0.3, 1, 3, 10]
VEC_CONFIG = dict(analyzer='char_wb', ngram_range=(2, 4), max_features=5000)
ROUND = 6          # 내보낼 때 소수 자리
PARITY_N = 30
PARITY_SEED = 0
N_ERRORS = 5


def load(name):
    return json.loads((DATA / f'{name}.json').read_text(encoding='utf-8'))['items']


def make_model(c):
    vec = TfidfVectorizer(**VEC_CONFIG)
    clf = LogisticRegression(C=c, max_iter=2000)
    return vec, clf


def fit(vec, clf, texts, y):
    X = vec.fit_transform(texts)
    clf.fit(X, y)
    return vec, clf


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


# ── 내보낸 JSON만으로 다시 계산 (JS가 따라 할 순서와 같다) ──
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
    pre = model['preprocess']
    t = model['targets'][target]
    counts = {}
    for g in char_wb_ngrams(text, *pre['ngramRange']):
        i = t['vocabulary'].get(g)
        if i is not None:
            counts[i] = counts.get(i, 0) + 1
    x = {i: c * t['idf'][i] for i, c in counts.items()}
    norm = sum(v * v for v in x.values()) ** 0.5
    if norm:
        x = {i: v / norm for i, v in x.items()}
    logits = [b + sum(row[i] * v for i, v in x.items()) for row, b in zip(t['coef'], t['intercept'])]
    m = max(logits)
    e = [np.exp(z - m) for z in logits]
    s = sum(e)
    return [float(v / s) for v in e]


def export(models, chosen, sizes, test_metrics):
    targets = {}
    for target, (vec, clf) in models.items():
        vocab = {g: int(i) for g, i in sorted(vec.vocabulary_.items(), key=lambda kv: kv[1])}
        targets[target] = {
            'classes': [str(c) for c in clf.classes_],
            'C': chosen[target],
            'vocabulary': vocab,
            'idf': [round(float(v), ROUND) for v in vec.idf_],
            'coef': [[round(float(v), ROUND) for v in row] for row in clf.coef_],
            'intercept': [round(float(v), ROUND) for v in clf.intercept_],
        }
    return {
        'format': 'hande-tfidf-logreg',
        'formatVersion': 1,
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
        'targets': targets,
        'metadata': {
            'trainedAt': dt.date.today().isoformat(),
            'data': sizes,
            'dataNote': '[예시] 직접 만든 문장 (data/classifier). 학습 데이터로만 학습, C는 검증 데이터로 선택',
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

    chosen, search, models, fit_seconds, test_pred, test_proba = {}, {}, {}, {}, {}, {}
    search_start = time.perf_counter()
    for target in TARGETS:
        search[target] = {}
        for c in C_GRID:
            vec, clf = fit(*make_model(c), [x['text'] for x in train], [x[target] for x in train])
            pred = clf.predict(vec.transform([x['text'] for x in val]))
            search[target][c] = f1_score([x[target] for x in val], pred, labels=LABELS, average='macro', zero_division=0)
        # 점수가 같으면 작은 C(규제가 강한 쪽)
        chosen[target] = max(C_GRID, key=lambda c: (round(search[target][c], 6), -c))
    search_seconds = time.perf_counter() - search_start

    for target in TARGETS:
        start = time.perf_counter()
        vec, clf = fit(*make_model(chosen[target]), [x['text'] for x in train], [x[target] for x in train])
        fit_seconds[target] = time.perf_counter() - start
        models[target] = (vec, clf)
        X = vec.transform([x['text'] for x in test])
        test_pred[target] = list(clf.predict(X))
        test_proba[target] = clf.predict_proba(X)

    model_metrics = {t: metrics([x[t] for x in test], test_pred[t], LABELS) for t in TARGETS}

    rules = run_rules(DATA / 'test.json')
    rule_pred = {t: [rules[x['id']][t] for x in test] for t in TARGETS}
    rule_metrics = {t: metrics([x[t] for x in test], rule_pred[t], RULE_LABELS) for t in TARGETS}

    # 내보내기 + 내보낸 값만으로 다시 계산해서 sklearn과 비교
    model_json = export(models, chosen, sizes, model_metrics)
    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    MODEL_OUT.write_text(json.dumps(model_json, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    model_bytes = MODEL_OUT.stat().st_size
    max_diff = 0.0
    for t in TARGETS:
        for i, x in enumerate(test):
            p = predict_from_export(model_json, t, x['text'])
            max_diff = max(max_diff, float(np.max(np.abs(np.array(p) - test_proba[t][i]))))
    assert max_diff < 1e-4, f'내보낸 모델과 sklearn 확률 차이가 큼: {max_diff}'

    # parity: 평가 문장 30개, 내보낸 JSON으로 계산한 확률 (JS가 같은 값을 내야 함)
    picked = random.Random(PARITY_SEED).sample(test, PARITY_N)

    def parity_target(x, t):
        p = predict_from_export(model_json, t, x['text'])
        return {'gold': x[t], 'probs': [round(v, 8) for v in p],
                'pred': model_json['targets'][t]['classes'][int(np.argmax(p))]}

    parity = {
        'note': '[예시] 평가 문장. probs는 src/models/classifier.json만으로 계산한 값(classes 순서). JS 구현과 비교용.',
        'tolerance': 1e-6,
        'maxDiffVsSklearn': max_diff,
        'classes': {t: model_json['targets'][t]['classes'] for t in TARGETS},
        'items': [{'id': x['id'], 'text': x['text'], **{t: parity_target(x, t) for t in TARGETS}} for x in picked],
    }
    PARITY_OUT.write_text(json.dumps(parity, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    write_report(sizes, search, chosen, rule_metrics, model_metrics, test, rule_pred, test_pred,
                 search_seconds, fit_seconds, model_bytes, max_diff, model_json)

    print_summary(rule_metrics, model_metrics, chosen, fit_seconds, model_bytes)


def write_report(sizes, search, chosen, rule_m, model_m, test, rule_pred, model_pred,
                 search_seconds, fit_seconds, model_bytes, max_diff, model_json):
    out = [
        '# secondary · card 분류 실험 결과',
        '',
        f"- 날짜: {dt.date.today().isoformat()} · 데이터: [예시] 학습 {sizes['train']} / 검증 {sizes['val']} / 평가 {sizes['test']}문장 (같은 씨앗의 변형은 한쪽에만)",
        f"- 모델: TfidfVectorizer(char_wb, 2~4글자, 최대 5000개) + LogisticRegression, secondary · card 따로. sklearn {sklearn.__version__}",
        '- 규칙: 현재 `src/extract.js`의 secondary · card 판단을 평가 문장 한 개씩 돌린 결과. 찾지 못함(null)은 none, **unknown은 따로 센다**(정답 라벨에 unknown이 없으므로 정확도·F1에서는 틀린 것).',
        '- macro F1: 정답 라벨 yes · no · none 3개의 F1 평균.',
        '- ⚠️ 평가 데이터는 직접 만든 [예시] 문장이라 실제 글에서의 성능을 보장하지 않는다. 대부분의 라벨 조합이 평가에서 씨앗 1개뿐이라 조합별 수치는 흔들림이 크다.',
        '',
        '## 요약 (평가 데이터)',
        '',
        '| 항목 | 규칙 정확도 | 규칙 macro F1 | 규칙 unknown | 모델 정확도 | 모델 macro F1 | 모델 C |',
        '|---|---:|---:|---:|---:|---:|---:|',
    ]
    for t in TARGETS:
        r, m = rule_m[t], model_m[t]
        out.append(f"| {t} | {pct(r['accuracy'])} | {r['macro_f1']:.3f} | {r['unknown']}개 | {pct(m['accuracy'])} | {m['macro_f1']:.3f} | {chosen[t]} |")
    out += ['', '## C 고르기 (검증 데이터 macro F1)', '', '| 항목 | ' + ' | '.join(f'C={c}' for c in C_GRID) + ' | 선택 |',
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
            f'평가 {len(test)}문장은 씨앗 {len(seeds)}개의 변형이다. 한 씨앗이 틀리면 그 변형 5~8문장이 같이 틀린다.', '',
            '| 씨앗 | secondary | card | 문장 수 | 대표 문장 | 규칙 (secondary/card) |', '|---:|---|---|---:|---|---|']
    first_idx = {x['id']: i for i, x in enumerate(test)}
    for s, x in sorted(seeds.items(), key=lambda kv: (kv[1]['secondary'], kv[1]['card'], kv[0])):
        n = sum(1 for y in test if y['seed'] == s)
        i = first_idx[x['id']]
        out.append(f"| {s} | {x['secondary']} | {x['card']} | {n} | {x['text']} | {rule_pred['secondary'][i]} / {rule_pred['card'][i]} |")
    vocab = {t: len(model_json['targets'][t]['vocabulary']) for t in TARGETS}
    out += ['', '## 학습 시간 · 모델 크기', '',
            f"- C 고르기(2항목 × C 4개 학습 + 검증): {search_seconds:.2f}초",
            f"- 최종 학습: secondary {fit_seconds['secondary']:.3f}초 · card {fit_seconds['card']:.3f}초",
            f"- `src/models/classifier.json`: {model_bytes:,} bytes ({model_bytes / 1024:.0f} KB), 어휘 secondary {vocab['secondary']:,}개 · card {vocab['card']:,}개, 소수 {ROUND}자리",
            f"- 내보낸 JSON만으로 다시 계산한 확률과 sklearn 확률의 최대 차이: {max_diff:.2e}",
            '',
            '## 다시 만들기', '', '```bash', 'pip install -r experiments/classifier/requirements.txt',
            'python experiments/classifier/make_data.py', 'python experiments/classifier/train.py', '```', '']
    REPORT_OUT.write_text('\n'.join(out), encoding='utf-8')


def print_summary(rule_m, model_m, chosen, fit_seconds, model_bytes):
    print('| 항목 | 규칙 정확도 | 규칙 macro F1 | 규칙 unknown | 모델 정확도 | 모델 macro F1 | C |')
    print('|---|---:|---:|---:|---:|---:|---:|')
    for t in TARGETS:
        r, m = rule_m[t], model_m[t]
        print(f"| {t} | {pct(r['accuracy'])} | {r['macro_f1']:.3f} | {r['unknown']} | {pct(m['accuracy'])} | {m['macro_f1']:.3f} | {chosen[t]} |")
    print(f'학습 시간: ' + ', '.join(f'{t} {s:.3f}s' for t, s in fit_seconds.items()) + f' · 모델 {model_bytes:,} bytes')


if __name__ == '__main__':
    main()
