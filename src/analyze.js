// 화면에서 부르는 래퍼: 시간 제한(기본 20초)과 공통 응답 { data } | { error:{code,message} }
import { extract } from './extract.js';
import { match } from './match.js';

export const AI_TIMEOUT_MS = 20000; // 계약 4장: 추출·매칭 타임아웃 초기 20초

const MESSAGE = {
  AI_TIMEOUT: 'AI 분석 시간이 초과되었습니다. 다시 시도하거나 직접 입력해 주세요.',
  AI_FAILED: 'AI 분석에 실패했습니다. 다시 시도하거나 직접 입력해 주세요.',
  INVALID_INPUT: '피해 내용을 1~2000자로 입력해 주세요.'
};
const fail = (code) => ({ error: { code, message: MESSAGE[code] } });

/**
 * task를 실행하고 timeoutMs 안에 끝나지 않으면 AI_TIMEOUT.
 * (task가 동기 코드면 중간에 끊을 수는 없고, 끝난 뒤 시간을 넘겼는지로 판정한다)
 * @template T
 * @param {() => T | Promise<T>} task
 * @param {number} timeoutMs
 * @returns {Promise<{data:T} | {error:{code:string,message:string}}>}
 */
export async function withTimeout(task, timeoutMs = AI_TIMEOUT_MS) {
  let timer;
  const started = Date.now();
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(fail('AI_TIMEOUT')), timeoutMs); });
  const run = Promise.resolve()
    .then(task)
    .then((data) => (Date.now() - started > timeoutMs ? fail('AI_TIMEOUT') : { data }))
    .catch((e) => (e?.message === 'EMPTY_TEXT' || e?.message === 'TEXT_TOO_LONG' ? fail('INVALID_INPUT') : fail('AI_FAILED')));
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 피해 글 정리(+ groups를 주면 같은 사건 찾기까지)
 * @param {string} text
 * @param {{timeoutMs?:number, now?:Date, groups?:object[]}} [options]
 * @returns {Promise<{data:{fields:object[], warnings:string[], candidates?:object[]}} | {error:{code:'AI_TIMEOUT'|'AI_FAILED'|'INVALID_INPUT',message:string}}>}
 */
export function analyze(text, { timeoutMs = AI_TIMEOUT_MS, now, groups } = {}) {
  return withTimeout(() => {
    const report = extract(text, { now });
    return groups ? { ...report, candidates: match(report, groups) } : report;
  }, timeoutMs);
}
