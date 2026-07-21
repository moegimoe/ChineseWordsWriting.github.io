/**
 * @file storage.js
 * LocalStorage を用いたデータ永続化レイヤー。
 * 単語データ・設定・学習履歴の読み書きをすべてここに集約する。
 */

const KEYS = {
  WORDS: 'ct_words_v1',
  SETTINGS: 'ct_settings_v1',
  HISTORY: 'ct_history_v1',
};

const DEFAULT_SETTINGS = {
  theme: 'auto', // 'auto' | 'light' | 'dark'
  speechRate: 0.85,
  speechVoiceURI: null,
};

/**
 * @typedef {Object} WordStat
 * @property {number} seen        出題回数
 * @property {number} correct     正解数
 * @property {number} wrong       不正解数
 * @property {string|null} lastStudied ISO日付文字列
 * @property {number} srsLevel    間隔反復レベル (0-5)
 * @property {string} nextReview  次回復習予定日 (YYYY-MM-DD)
 */

/**
 * @typedef {Object} Word
 * @property {string} id
 * @property {string} hanzi     中国語
 * @property {string} pinyin    ピンイン（空文字可）
 * @property {string} meaning   日本語の意味
 * @property {string} deck      課（グループ名）
 * @property {WordStat} stats
 */

/** ユニークIDを生成する */
function makeId() {
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** @returns {WordStat} 初期状態の統計オブジェクト */
function makeInitialStats() {
  return {
    seen: 0,
    correct: 0,
    wrong: 0,
    lastStudied: null,
    srsLevel: 0,
    nextReview: todayStr(),
  };
}

/** @returns {string} 今日の日付 (YYYY-MM-DD) */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** @returns {Word[]} 保存されている全単語 */
function getWords() {
  try {
    const raw = localStorage.getItem(KEYS.WORDS);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('単語データの読み込みに失敗しました', e);
    return [];
  }
}

/** @param {Word[]} words */
function saveWords(words) {
  localStorage.setItem(KEYS.WORDS, JSON.stringify(words));
}

/**
 * 新しい単語を追加する。同じ deck 内で hanzi が重複する場合は上書き（統計は保持）。
 * @param {{hanzi:string, pinyin?:string, meaning:string}[]} entries
 * @param {string} deck
 * @returns {{added:number, updated:number}}
 */
function addWords(entries, deck) {
  const words = getWords();
  let added = 0;
  let updated = 0;
  for (const entry of entries) {
    const existing = words.find((w) => w.deck === deck && w.hanzi === entry.hanzi);
    if (existing) {
      existing.pinyin = entry.pinyin || existing.pinyin;
      existing.meaning = entry.meaning;
      updated++;
    } else {
      words.push({
        id: makeId(),
        hanzi: entry.hanzi,
        pinyin: entry.pinyin || '',
        meaning: entry.meaning,
        deck,
        stats: makeInitialStats(),
      });
      added++;
    }
  }
  saveWords(words);
  return { added, updated };
}

/** @param {string} id @param {Partial<Word>} patch */
function updateWord(id, patch) {
  const words = getWords();
  const idx = words.findIndex((w) => w.id === id);
  if (idx === -1) return;
  words[idx] = { ...words[idx], ...patch };
  saveWords(words);
}

/** @param {string} id */
function deleteWord(id) {
  const words = getWords().filter((w) => w.id !== id);
  saveWords(words);
}

/** @param {string} deck */
function deleteDeck(deck) {
  const words = getWords().filter((w) => w.deck !== deck);
  saveWords(words);
}

/** @returns {string[]} 登録されている課名の一覧 */
function getDecks() {
  const words = getWords();
  const set = new Set(words.map((w) => w.deck));
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));
}

/** @returns {Object} 設定 */
function getSettings() {
  try {
    const raw = localStorage.getItem(KEYS.SETTINGS);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

/** @param {Object} settings */
function saveSettings(settings) {
  localStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
}

/** @returns {{studyDays:string[], totalSessions:number}} */
function getHistory() {
  try {
    const raw = localStorage.getItem(KEYS.HISTORY);
    return raw ? JSON.parse(raw) : { studyDays: [], totalSessions: 0 };
  } catch (e) {
    return { studyDays: [], totalSessions: 0 };
  }
}

/** 今日の学習を記録する（学習日数のカウント用） */
function recordStudySession() {
  const history = getHistory();
  const today = todayStr();
  if (!history.studyDays.includes(today)) {
    history.studyDays.push(today);
  }
  history.totalSessions = (history.totalSessions || 0) + 1;
  localStorage.setItem(KEYS.HISTORY, JSON.stringify(history));
}

/** @returns {string} JSON形式のバックアップ文字列 */
function exportData() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    words: getWords(),
    settings: getSettings(),
    history: getHistory(),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * バックアップJSONを読み込んで復元する（既存データは置き換え）。
 * @param {string} jsonText
 * @returns {boolean} 成功したかどうか
 */
function importData(jsonText) {
  try {
    const payload = JSON.parse(jsonText);
    if (!Array.isArray(payload.words)) return false;
    saveWords(payload.words);
    if (payload.settings) saveSettings({ ...DEFAULT_SETTINGS, ...payload.settings });
    if (payload.history) localStorage.setItem(KEYS.HISTORY, JSON.stringify(payload.history));
    return true;
  } catch (e) {
    console.error('インポートに失敗しました', e);
    return false;
  }
}

export {
  todayStr,
  getWords,
  saveWords,
  addWords,
  updateWord,
  deleteWord,
  deleteDeck,
  getDecks,
  getSettings,
  saveSettings,
  getHistory,
  recordStudySession,
  exportData,
  importData,
};
