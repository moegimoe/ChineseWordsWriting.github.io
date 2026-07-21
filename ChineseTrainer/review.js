/**
 * @file review.js
 * Anki 風の間隔反復（Spaced Repetition）ロジック。
 * レベル 0〜5 に応じて次回出題日を決定するシンプルな Leitner 方式。
 */

import { todayStr } from './storage.js';

/** レベルごとの復習間隔（日数） */
const INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];
const MAX_LEVEL = INTERVAL_DAYS.length - 1;

/**
 * @param {string} dateStr YYYY-MM-DD
 * @param {number} days
 * @returns {string} 加算後の日付 (YYYY-MM-DD)
 */
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 解答結果に応じて単語の SRS 状態を更新する（破壊的変更）。
 * @param {import('./storage.js').Word} word
 * @param {boolean} isCorrect
 */
function applyReviewResult(word, isCorrect) {
  const today = todayStr();
  const stats = word.stats;
  stats.seen += 1;
  stats.lastStudied = today;

  if (isCorrect) {
    stats.correct += 1;
    stats.srsLevel = Math.min(MAX_LEVEL, stats.srsLevel + 1);
  } else {
    stats.wrong += 1;
    stats.srsLevel = 0;
  }
  stats.nextReview = addDays(today, INTERVAL_DAYS[stats.srsLevel]);
}

/**
 * 今日時点で復習すべき単語を抽出する。
 * @param {import('./storage.js').Word[]} words
 * @returns {import('./storage.js').Word[]}
 */
function getDueWords(words) {
  const today = todayStr();
  return words.filter((w) => w.stats.nextReview <= today);
}

/**
 * 単語の「苦手度」スコアを計算する（高いほど苦手）。
 * 出題回数が少ない単語も一定の優先度を持たせる。
 * @param {import('./storage.js').Word} word
 * @returns {number}
 */
function weaknessScore(word) {
  const { seen, correct, wrong } = word.stats;
  if (seen === 0) return 0.5; // 未出題は中程度の優先度
  const errorRate = wrong / seen;
  return errorRate + wrong * 0.05; // 間違えた回数が多いほど優先
}

/**
 * 苦手な単語順（降順）に並べ替えた配列を返す。
 * @param {import('./storage.js').Word[]} words
 * @returns {import('./storage.js').Word[]}
 */
function sortByWeakness(words) {
  return [...words].sort((a, b) => weaknessScore(b) - weaknessScore(a));
}

export { INTERVAL_DAYS, applyReviewResult, getDueWords, weaknessScore, sortByWeakness, addDays };
