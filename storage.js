/**
 * @file storage.js
 * LocalStorage を用いたデータ永続化レイヤー。
 * 単語データ・課・フォルダ・設定・学習履歴の読み書きをすべてここに集約する。
 *
 * データ構造 (v2):
 *   Folder { id, name, order, createdAt }
 *   Deck   { id, name, folderId(nullable), order, createdAt }
 *   Word   { id, hanzi, pinyin, meaning, deckId, stats }
 *
 * v1 (旧: word.deck が文字列だった時代) のデータは初回読み込み時に自動移行する。
 */

const KEYS = {
  WORDS: 'ct_words_v1',
  DECKS: 'ct_decks_v1',
  FOLDERS: 'ct_folders_v1',
  SETTINGS: 'ct_settings_v1',
  HISTORY: 'ct_history_v1',
};

const DEFAULT_SETTINGS = {
  theme: 'auto', // 'auto' | 'light' | 'dark'
  speechRate: 0.85,
  speechVoiceURI: null,
  schemaVersion: 1,
  gistToken: '',
  gistId: '',
  lastBackupAt: null,
};

/**
 * @typedef {Object} WordStat
 * @property {number} seen 出題回数
 * @property {number} correct 正解数
 * @property {number} wrong 不正解数
 * @property {string|null} lastStudied ISO日付文字列
 * @property {number} srsLevel 間隔反復レベル (0-5)
 * @property {string} nextReview 次回復習予定日 (YYYY-MM-DD)
 * @property {number} streakSinceMistake 直近の間違い以降の連続正解数
 */

/**
 * @typedef {Object} Word
 * @property {string} id
 * @property {string} hanzi
 * @property {string} pinyin
 * @property {string} meaning
 * @property {string} deckId
 * @property {WordStat} stats
 */

/**
 * @typedef {Object} Deck
 * @property {string} id
 * @property {string} name
 * @property {string|null} folderId
 * @property {number} order
 * @property {string} createdAt
 */

/**
 * @typedef {Object} Folder
 * @property {string} id
 * @property {string} name
 * @property {number} order
 * @property {string} createdAt
 */

/** ユニークIDを生成する */
function makeId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** @returns {string} 今日の日付 (YYYY-MM-DD) */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    streakSinceMistake: 0,
  };
}

/* ---------------------------------------------------------
   低レベル読み書きヘルパー
--------------------------------------------------------- */
function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error(`${key} の読み込みに失敗しました`, e);
    return fallback;
  }
}
function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getSettingsRaw() {
  return { ...DEFAULT_SETTINGS, ...readJson(KEYS.SETTINGS, {}) };
}
function saveSettingsRaw(settings) {
  writeJson(KEYS.SETTINGS, settings);
}

/* ---------------------------------------------------------
   v1 -> v2 マイグレーション
   （word.deck という文字列だった旧データを Deck エンティティへ変換）
--------------------------------------------------------- */
let migrationChecked = false;
function ensureMigrated() {
  if (migrationChecked) return;
  migrationChecked = true;

  const settings = getSettingsRaw();
  if (settings.schemaVersion >= 2) return;

  const rawWords = readJson(KEYS.WORDS, []);
  const existingDecks = readJson(KEYS.DECKS, []);

  const needsMigration = rawWords.some((w) => w.deckId === undefined && typeof w.deck === 'string');

  if (needsMigration) {
    const deckNames = [...new Set(rawWords.filter((w) => w.deckId === undefined).map((w) => w.deck))];
    const nameToId = {};
    const newDecks = [...existingDecks];
    deckNames.forEach((name, i) => {
      const deck = {
        id: makeId('d'),
        name,
        folderId: null,
        order: newDecks.length + i,
        createdAt: new Date().toISOString(),
      };
      newDecks.push(deck);
      nameToId[name] = deck.id;
    });

    const newWords = rawWords.map((w) => {
      if (w.deckId !== undefined) return w;
      return {
        id: w.id,
        hanzi: w.hanzi,
        pinyin: w.pinyin || '',
        meaning: w.meaning,
        deckId: nameToId[w.deck],
        stats: { ...makeInitialStats(), ...w.stats, streakSinceMistake: (w.stats && w.stats.streakSinceMistake) || 0 },
      };
    });

    writeJson(KEYS.WORDS, newWords);
    writeJson(KEYS.DECKS, newDecks);
  }

  settings.schemaVersion = 2;
  saveSettingsRaw(settings);
}

/* ---------------------------------------------------------
   単語 (Word)
--------------------------------------------------------- */

/** @returns {Word[]} */
function getWords() {
  ensureMigrated();
  return readJson(KEYS.WORDS, []);
}

/** @param {Word[]} words */
function saveWords(words) {
  writeJson(KEYS.WORDS, words);
}

/**
 * 新しい単語を追加する。同じ deckId 内で hanzi が重複する場合は上書き（統計は保持）。
 * @param {{hanzi:string, pinyin?:string, meaning:string}[]} entries
 * @param {string} deckId
 * @returns {{added:number, updated:number}}
 */
function addWords(entries, deckId) {
  const words = getWords();
  let added = 0;
  let updated = 0;
  for (const entry of entries) {
    const existing = words.find((w) => w.deckId === deckId && w.hanzi === entry.hanzi);
    if (existing) {
      existing.pinyin = entry.pinyin || existing.pinyin;
      existing.meaning = entry.meaning;
      updated++;
    } else {
      words.push({
        id: makeId('w'),
        hanzi: entry.hanzi,
        pinyin: entry.pinyin || '',
        meaning: entry.meaning,
        deckId,
        stats: makeInitialStats(),
      });
      added++;
    }
  }
  saveWords(words);
  return { added, updated };
}

/** 統計情報を含む任意フィールドをパッチする（内部利用） @param {string} id @param {Partial<Word>} patch */
function updateWord(id, patch) {
  const words = getWords();
  const idx = words.findIndex((w) => w.id === id);
  if (idx === -1) return;
  words[idx] = { ...words[idx], ...patch };
  saveWords(words);
}

/**
 * 単語の内容（漢字・ピンイン・意味）を書き換える。統計は保持される。
 * @param {string} id
 * @param {{hanzi:string, pinyin:string, meaning:string}} content
 */
function updateWordContent(id, content) {
  updateWord(id, content);
}

/** @param {string} id */
function deleteWord(id) {
  const words = getWords().filter((w) => w.id !== id);
  saveWords(words);
}

/* ---------------------------------------------------------
   課 (Deck)
--------------------------------------------------------- */

/** @returns {Deck[]} order 昇順でソート済み */
function getDeckList() {
  ensureMigrated();
  return readJson(KEYS.DECKS, []).sort((a, b) => a.order - b.order);
}
function saveDeckList(decks) {
  writeJson(KEYS.DECKS, decks);
}

/** @param {string} id @returns {Deck|undefined} */
function getDeckById(id) {
  return getDeckList().find((d) => d.id === id);
}

/**
 * 新しい課を作成する。
 * @param {string} name
 * @param {string|null} [folderId]
 * @returns {Deck}
 */
function addDeck(name, folderId = null) {
  const decks = readJson(KEYS.DECKS, []);
  const maxOrder = decks.reduce((m, d) => Math.max(m, d.order), -1);
  const deck = { id: makeId('d'), name, folderId, order: maxOrder + 1, createdAt: new Date().toISOString() };
  decks.push(deck);
  saveDeckList(decks);
  return deck;
}

/** @param {string} id @param {string} newName */
function renameDeck(id, newName) {
  const decks = readJson(KEYS.DECKS, []);
  const deck = decks.find((d) => d.id === id);
  if (!deck) return;
  deck.name = newName;
  saveDeckList(decks);
}

/** @param {string} id @param {string|null} folderId */
function moveDeckToFolder(id, folderId) {
  const decks = readJson(KEYS.DECKS, []);
  const deck = decks.find((d) => d.id === id);
  if (!deck) return;
  deck.folderId = folderId;
  saveDeckList(decks);
}

/**
 * 課を1つ上/下（同じフォルダ内）へ移動する。
 * @param {string} id
 * @param {-1|1} direction
 */
function reorderDeck(id, direction) {
  const decks = readJson(KEYS.DECKS, []);
  const target = decks.find((d) => d.id === id);
  if (!target) return;
  const siblings = decks.filter((d) => d.folderId === target.folderId).sort((a, b) => a.order - b.order);
  const idx = siblings.findIndex((d) => d.id === id);
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;
  const other = siblings[swapIdx];
  const tmp = target.order;
  target.order = other.order;
  other.order = tmp;
  saveDeckList(decks);
}

/** 課とその中の単語をすべて削除する @param {string} id */
function deleteDeck(id) {
  const decks = readJson(KEYS.DECKS, []).filter((d) => d.id !== id);
  saveDeckList(decks);
  const words = getWords().filter((w) => w.deckId !== id);
  saveWords(words);
}

/* ---------------------------------------------------------
   フォルダ (Folder)
--------------------------------------------------------- */

/** @returns {Folder[]} order 昇順でソート済み */
function getFolderList() {
  ensureMigrated();
  return readJson(KEYS.FOLDERS, []).sort((a, b) => a.order - b.order);
}
function saveFolderList(folders) {
  writeJson(KEYS.FOLDERS, folders);
}

/** @param {string} name @returns {Folder} */
function addFolder(name) {
  const folders = readJson(KEYS.FOLDERS, []);
  const maxOrder = folders.reduce((m, f) => Math.max(m, f.order), -1);
  const folder = { id: makeId('f'), name, order: maxOrder + 1, createdAt: new Date().toISOString() };
  folders.push(folder);
  saveFolderList(folders);
  return folder;
}

/** @param {string} id @param {string} newName */
function renameFolder(id, newName) {
  const folders = readJson(KEYS.FOLDERS, []);
  const folder = folders.find((f) => f.id === id);
  if (!folder) return;
  folder.name = newName;
  saveFolderList(folders);
}

/** @param {string} id @param {-1|1} direction */
function reorderFolder(id, direction) {
  const folders = readJson(KEYS.FOLDERS, []).sort((a, b) => a.order - b.order);
  const idx = folders.findIndex((f) => f.id === id);
  if (idx === -1) return;
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= folders.length) return;
  const tmp = folders[idx].order;
  folders[idx].order = folders[swapIdx].order;
  folders[swapIdx].order = tmp;
  saveFolderList(folders);
}

/** フォルダを削除する（中の課はフォルダなし扱いに戻す） @param {string} id */
function deleteFolder(id) {
  const decks = readJson(KEYS.DECKS, []);
  decks.forEach((d) => { if (d.folderId === id) d.folderId = null; });
  saveDeckList(decks);
  const folders = readJson(KEYS.FOLDERS, []).filter((f) => f.id !== id);
  saveFolderList(folders);
}

/* ---------------------------------------------------------
   設定
--------------------------------------------------------- */

/** @returns {Object} */
function getSettings() {
  ensureMigrated();
  return getSettingsRaw();
}

/** @param {Object} settings */
function saveSettings(settings) {
  saveSettingsRaw(settings);
}

/* ---------------------------------------------------------
   学習履歴
--------------------------------------------------------- */

/** @returns {{studyDays:string[], totalSessions:number}} */
function getHistory() {
  return readJson(KEYS.HISTORY, { studyDays: [], totalSessions: 0 });
}

/** 今日の学習を記録する（学習日数のカウント用） */
function recordStudySession() {
  const history = getHistory();
  const today = todayStr();
  if (!history.studyDays.includes(today)) {
    history.studyDays.push(today);
  }
  history.totalSessions = (history.totalSessions || 0) + 1;
  writeJson(KEYS.HISTORY, history);
}

/* ---------------------------------------------------------
   バックアップ（JSON文字列の生成・復元。Gist連携からも共用）
--------------------------------------------------------- */

/** @returns {string} JSON形式のバックアップ文字列 */
function exportData() {
  const s = getSettings();
  const { gistToken, ...settingsWithoutToken } = s;
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    words: getWords(),
    decks: getDeckList(),
    folders: getFolderList(),
    settings: settingsWithoutToken,
    history: getHistory(),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * バックアップJSONを読み込んで復元する（既存データは置き換え）。
 * v1形式（words に deck 文字列を含む古い形式）にも対応する。
 * @param {string} jsonText
 * @returns {boolean} 成功したかどうか
 */
function importData(jsonText) {
  try {
    const payload = JSON.parse(jsonText);
    if (!Array.isArray(payload.words)) return false;

    if (Array.isArray(payload.decks)) {
      // v2形式
      saveDeckList(payload.decks);
      saveFolderList(Array.isArray(payload.folders) ? payload.folders : []);
      saveWords(payload.words);
    } else {
      // v1形式: word.deck 文字列から Deck を再構築
      const deckNames = [...new Set(payload.words.map((w) => w.deck))];
      const nameToId = {};
      const decks = deckNames.map((name, i) => {
        const d = { id: makeId('d'), name, folderId: null, order: i, createdAt: new Date().toISOString() };
        nameToId[name] = d.id;
        return d;
      });
      const words = payload.words.map((w) => ({
        id: w.id,
        hanzi: w.hanzi,
        pinyin: w.pinyin || '',
        meaning: w.meaning,
        deckId: nameToId[w.deck],
        stats: { ...makeInitialStats(), ...w.stats },
      }));
      saveDeckList(decks);
      saveFolderList([]);
      saveWords(words);
    }

    if (payload.settings) {
      const current = getSettings();
      saveSettings({ ...current, ...payload.settings, gistToken: current.gistToken, schemaVersion: 2 });
    }
    if (payload.history) writeJson(KEYS.HISTORY, payload.history);
    return true;
  } catch (e) {
    console.error('インポートに失敗しました', e);
    return false;
  }
}

export {
  todayStr,
  makeInitialStats,
  getWords,
  saveWords,
  addWords,
  updateWord,
  updateWordContent,
  deleteWord,
  getDeckList,
  getDeckById,
  addDeck,
  renameDeck,
  moveDeckToFolder,
  reorderDeck,
  deleteDeck,
  getFolderList,
  addFolder,
  renameFolder,
  reorderFolder,
  deleteFolder,
  getSettings,
  saveSettings,
  getHistory,
  recordStudySession,
  exportData,
  importData,
};
