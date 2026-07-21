/**
 * @file quiz.js
 * 出題モード・出題方式に応じたクイズキューの生成、および解答判定を行う。
 */

import { getDueWords, sortByWeakness } from './review.js';

/** 出題モード定義 */
const QUIZ_TYPES = {
  PINYIN_TO_HANZI: 'pinyin_to_hanzi',
  AUDIO_TO_HANZI: 'audio_to_hanzi',
  MEANING_TO_HANZI: 'meaning_to_hanzi',
  HANZI_TO_MEANING: 'hanzi_to_meaning',
};

/** 出題方式定義 */
const ORDER_MODES = {
  RANDOM: 'random',
  SEQUENTIAL: 'sequential',
  SHUFFLE: 'shuffle',
  WEAK: 'weak',
  WRONG_ONLY: 'wrong_only',
  REVIEW_DUE: 'review_due',
};

/** 配列をランダムにシャッフルした新しい配列を返す（Fisher–Yates） */
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * フィルタと出題方式に基づき出題キューを構築する。
 * @param {import('./storage.js').Word[]} allWords
 * @param {Object} options
 * @param {string[]} options.decks 対象の課（空配列なら全部）
 * @param {string} options.orderMode ORDER_MODES のいずれか
 * @param {number} [options.limit] 出題数上限（省略時は全件）
 * @returns {import('./storage.js').Word[]}
 */
function buildQueue(allWords, { decks, orderMode, limit }) {
  let pool = decks && decks.length > 0 ? allWords.filter((w) => decks.includes(w.deck)) : [...allWords];

  switch (orderMode) {
    case ORDER_MODES.SEQUENTIAL:
      // 登録順のまま
      break;
    case ORDER_MODES.SHUFFLE:
    case ORDER_MODES.RANDOM:
      pool = shuffleArray(pool);
      break;
    case ORDER_MODES.WEAK:
      pool = sortByWeakness(pool);
      break;
    case ORDER_MODES.WRONG_ONLY:
      pool = shuffleArray(pool.filter((w) => w.stats.wrong > 0));
      break;
    case ORDER_MODES.REVIEW_DUE:
      pool = shuffleArray(getDueWords(pool));
      break;
    default:
      pool = shuffleArray(pool);
  }

  if (limit && limit > 0) pool = pool.slice(0, limit);
  return pool;
}

/**
 * ユーザーの解答が正解かどうかを判定する。
 * @param {import('./storage.js').Word} word
 * @param {string} userInput
 * @param {string} quizType QUIZ_TYPES のいずれか
 * @returns {boolean}
 */
function checkAnswer(word, userInput, quizType) {
  const input = (userInput || '').trim();
  if (!input) return false;

  if (quizType === QUIZ_TYPES.HANZI_TO_MEANING) {
    // 意味は表記ゆれを許容するため、句読点や空白を除去した緩い比較を行う
    const normalize = (s) => s.replace(/[\s、。,.\u3000]/g, '');
    return normalize(input) === normalize(word.meaning);
  }

  // それ以外（ピンイン→中国語, 音声→中国語, 意味→中国語）は中国語の完全一致
  const normalizeHanzi = (s) => s.replace(/\s/g, '');
  return normalizeHanzi(input) === normalizeHanzi(word.hanzi);
}

/**
 * 出題画面に表示する「問題文」を組み立てる。
 * @param {import('./storage.js').Word} word
 * @param {string} quizType
 * @returns {{prompt:string, showAudio:boolean, showHanzi:boolean}}
 */
function buildPrompt(word, quizType) {
  switch (quizType) {
    case QUIZ_TYPES.PINYIN_TO_HANZI:
      return { prompt: word.pinyin || '(ピンイン未登録)', showAudio: true, showHanzi: false };
    case QUIZ_TYPES.AUDIO_TO_HANZI:
      return { prompt: '', showAudio: true, showHanzi: false };
    case QUIZ_TYPES.MEANING_TO_HANZI:
      return { prompt: word.meaning, showAudio: false, showHanzi: false };
    case QUIZ_TYPES.HANZI_TO_MEANING:
      return { prompt: word.hanzi, showAudio: true, showHanzi: true };
    default:
      return { prompt: '', showAudio: false, showHanzi: false };
  }
}

export { QUIZ_TYPES, ORDER_MODES, buildQueue, checkAnswer, buildPrompt, shuffleArray };
