import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract } from '../src/index.js';

const TEXT = '10월 초에 △△ 통신사에서 고객정보가 유출됐다는 문자를 받았어요. 이름, 연락처, 주소가 유출됐다고 했어요. 10월 초부터 택배 사칭 스미싱 문자가 세 번 왔어요.';

test('예시 글에서 5개 정리, 카드 정보는 확인 필요', () => {
  const r = extract(TEXT);
  const get = (k) => r.fields.find((f) => f.key === k);
  assert.equal(get('company').value, '△△ 통신사');
  assert.equal(get('type').value, '개인정보 유출');
  assert.equal(get('leaked').value, '이름 · 연락처 · 주소');
  assert.equal(get('secondary').value, '스미싱 3회');
  assert.equal(get('card').needsCheck, true);
  assert.equal(r.filled, 5);
});

test('값마다 원문 근거가 원문 안에 있다', () => {
  for (const f of extract(TEXT).fields) if (f.quote) assert.ok(TEXT.includes(f.quote), f.key);
});

test('빈 글은 오류', () => { assert.throws(() => extract('  '), /EMPTY_TEXT/); });
