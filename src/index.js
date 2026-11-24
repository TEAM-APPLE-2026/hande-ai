// HANDE AI 모듈 진입점. 프론트엔드는 여기서만 가져다 쓴다.
export { extract, FIELD_KEYS, OPTIONAL_FIELD_KEYS, MAX_TEXT_LENGTH } from './extract.js';
export { match, finalValue, THRESHOLD } from './match.js';
export { summarize } from './summarize.js';
export { draftGroup, GROUP_LIMITS, EVIDENCE } from './draft.js';
export { analyze, withTimeout, AI_TIMEOUT_MS } from './analyze.js';
export const VERSION = '0.4.0';
