/**
 * @file app.js
 * アプリのエントリーポイント。画面遷移とイベント配線を行う。
 */

import { parseWordList } from './parser.js';
import {
  getWords, saveWords, addWords, updateWordContent, deleteWord,
  getDeckList, getDeckById, addDeck, renameDeck, moveDeckToFolder, reorderDeck, deleteDeck,
  getFolderList, addFolder, renameFolder, reorderFolder, deleteFolder,
  getSettings, saveSettings, getHistory, recordStudySession,
  exportData, importData,
} from './storage.js';
import { QUIZ_TYPES, ORDER_MODES, buildQueue, checkAnswer, buildPrompt } from './quiz.js';
import { applyReviewResult, sortByWeakness } from './review.js';
import { speakChinese, isSpeechSupported } from './speech.js';
import { saveToGist, loadFromGist } from './gist.js';

/* ---------------------------------------------------------
   要素参照
--------------------------------------------------------- */
const el = {
  headerTitle: document.getElementById('header-title'),
  btnBack: document.getElementById('btn-back'),
  btnSettings: document.getElementById('btn-settings'),
  btnReorderToggle: document.getElementById('btn-reorder-toggle'),

  homeToolbar: document.querySelector('.home-toolbar'),
  btnCreateFolder: document.getElementById('btn-create-folder'),
  deckList: document.getElementById('deck-list'),
  homeEmptyHint: document.getElementById('home-empty-hint'),
  btnGotoImport: document.getElementById('btn-goto-import'),

  importDeckSelect: document.getElementById('import-deck-select'),
  newDeckFields: document.getElementById('new-deck-fields'),
  deckNameInput: document.getElementById('deck-name-input'),
  newDeckFolderSelect: document.getElementById('new-deck-folder-select'),
  pasteTextarea: document.getElementById('paste-textarea'),
  btnParse: document.getElementById('btn-parse'),
  previewArea: document.getElementById('preview-area'),
  previewCountNum: document.getElementById('preview-count-num'),
  previewList: document.getElementById('preview-list'),
  btnSaveWords: document.getElementById('btn-save-words'),

  deckDetailName: document.getElementById('deck-detail-name'),
  deckDetailFolder: document.getElementById('deck-detail-folder'),
  btnAddWordsToDeck: document.getElementById('btn-add-words-to-deck'),
  deckDetailWordCount: document.getElementById('deck-detail-word-count'),
  deckDetailWordList: document.getElementById('deck-detail-word-list'),
  btnDeleteDeck: document.getElementById('btn-delete-deck'),

  folderDetailName: document.getElementById('folder-detail-name'),
  folderDetailDeckList: document.getElementById('folder-detail-deck-list'),
  btnDeleteFolder: document.getElementById('btn-delete-folder'),

  setupDecks: document.getElementById('setup-decks'),
  setupQuizType: document.getElementById('setup-quiz-type'),
  setupOrderMode: document.getElementById('setup-order-mode'),
  btnStartQuiz: document.getElementById('btn-start-quiz'),

  progressFill: document.getElementById('progress-fill'),
  progressLabel: document.getElementById('progress-label'),
  quizPrompt: document.getElementById('quiz-prompt'),
  btnSpeak: document.getElementById('btn-speak'),
  answerInput: document.getElementById('answer-input'),
  btnSkip: document.getElementById('btn-skip'),
  btnCheck: document.getElementById('btn-check'),
  answerFeedback: document.getElementById('answer-feedback'),
  feedbackResult: document.getElementById('feedback-result'),
  feedbackDetail: document.getElementById('feedback-detail'),
  btnNext: document.getElementById('btn-next'),

  summaryTotal: document.getElementById('summary-total'),
  summaryCorrect: document.getElementById('summary-correct'),
  summaryRate: document.getElementById('summary-rate'),
  btnSummaryRetry: document.getElementById('btn-summary-retry'),
  btnSummaryHome: document.getElementById('btn-summary-home'),

  historyDays: document.getElementById('history-days'),
  historyWords: document.getElementById('history-words'),
  historyRate: document.getElementById('history-rate'),
  weakWordList: document.getElementById('weak-word-list'),

  speechRateSlider: document.getElementById('speech-rate-slider'),
  btnTestSpeech: document.getElementById('btn-test-speech'),
  settingsDeckList: document.getElementById('settings-deck-list'),

  gistTokenInput: document.getElementById('gist-token-input'),
  gistIdInput: document.getElementById('gist-id-input'),
  gistLastBackup: document.getElementById('gist-last-backup'),
  btnGistBackup: document.getElementById('btn-gist-backup'),
  btnGistRestore: document.getElementById('btn-gist-restore'),

  toast: document.getElementById('toast'),
};

const SCREEN_TITLES = {
  'screen-home': '中文単語帳',
  'screen-import': '単語を取り込む',
  'screen-deck-detail': '課の詳細',
  'screen-folder-detail': 'フォルダの詳細',
  'screen-quiz-setup': 'テスト設定',
  'screen-quiz': 'テスト中',
  'screen-summary': '結果',
  'screen-history': '学習履歴',
  'screen-settings': '設定',
};

/* ---------------------------------------------------------
   状態
--------------------------------------------------------- */
let navStack = ['screen-home'];
let lastParsedEntries = [];
let settings = getSettings();

let reorderMode = false;
let currentDeckDetailId = null;
let currentFolderDetailId = null;
let pendingDeckPreselect = null; // クイズ設定画面を開くときに事前選択する課ID（'ALL' も可）
let importReturnTarget = null; // 取り込み後に戻る先。null ならホーム、{deckId} ならその課の詳細へ

/* ---------------------------------------------------------
   画面遷移
--------------------------------------------------------- */
function showScreen(id, { push = true } = {}) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  el.headerTitle.textContent = SCREEN_TITLES[id] || '中文単語帳';

  if (push) {
    if (navStack[navStack.length - 1] !== id) navStack.push(id);
  }
  el.btnBack.classList.toggle('hidden', navStack.length <= 1);
  el.btnSettings.classList.toggle('hidden', id === 'screen-settings');
  el.btnReorderToggle.classList.toggle('hidden', id !== 'screen-home');

  if (id === 'screen-home') renderHome();
  if (id === 'screen-import') renderImportDeckOptions();
  if (id === 'screen-deck-detail') renderDeckDetail();
  if (id === 'screen-folder-detail') renderFolderDetail();
  if (id === 'screen-quiz-setup') renderQuizSetup();
  if (id === 'screen-history') renderHistory();
  if (id === 'screen-settings') renderSettings();
}

function goBack() {
  if (navStack.length <= 1) return;
  navStack.pop();
  const prev = navStack[navStack.length - 1];
  showScreen(prev, { push: false });
}

el.btnBack.addEventListener('click', goBack);
el.btnSettings.addEventListener('click', () => showScreen('screen-settings'));
el.btnReorderToggle.addEventListener('click', () => {
  reorderMode = !reorderMode;
  el.btnReorderToggle.classList.toggle('active', reorderMode);
  renderHome();
});

/* ---------------------------------------------------------
   トースト通知
--------------------------------------------------------- */
let toastTimer = null;
function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 2400);
}

/* ---------------------------------------------------------
   小さいアイコンボタンを組み立てるヘルパー
--------------------------------------------------------- */
function makeIconButton(label, svgInner, onClick, extraClass = '') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `small-icon-btn ${extraClass}`.trim();
  btn.setAttribute('aria-label', label);
  btn.innerHTML = svgInner;
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

const ICONS = {
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
};

/* ---------------------------------------------------------
   ホーム画面
--------------------------------------------------------- */
function renderHome() {
  const words = getWords();
  const decks = getDeckList();
  const folders = getFolderList();
  el.deckList.innerHTML = '';
  el.homeEmptyHint.classList.toggle('hidden', decks.length > 0);

  if (decks.length === 0) return;

  el.deckList.appendChild(buildAllDecksCard(words, decks));

  folders.forEach((folder) => {
    const folderDecks = decks.filter((d) => d.folderId === folder.id);
    el.deckList.appendChild(buildFolderGroup(folder, folderDecks, words));
  });

  const rootDecks = decks.filter((d) => !d.folderId || !folders.some((f) => f.id === d.folderId));
  rootDecks.forEach((deck, idx) => {
    el.deckList.appendChild(buildDeckRow(deck, words.filter((w) => w.deckId === deck.id), idx === 0, idx === rootDecks.length - 1));
  });
}

function computeAccuracy(words) {
  const seen = words.reduce((sum, w) => sum + w.stats.seen, 0);
  const correct = words.reduce((sum, w) => sum + w.stats.correct, 0);
  if (seen === 0) return null;
  return Math.round((correct / seen) * 100);
}

function buildDeckCardBody(label, words) {
  const card = document.createElement('div');
  card.className = 'deck-card';
  card.tabIndex = 0;

  const title = document.createElement('div');
  title.className = 'deck-card-title';
  title.textContent = label;

  const meta = document.createElement('div');
  meta.className = 'deck-card-meta';
  const acc = computeAccuracy(words);
  meta.innerHTML = `<span>${words.length} 語</span><span>${acc === null ? '未学習' : `正答率 ${acc}%`}</span>`;

  const bar = document.createElement('div');
  bar.className = 'deck-card-bar';
  const fill = document.createElement('div');
  fill.className = 'deck-card-bar-fill';
  fill.style.width = `${acc || 0}%`;
  bar.appendChild(fill);

  card.append(title, meta, bar);
  return card;
}

function buildAllDecksCard(words, decks) {
  const card = buildDeckCardBody('すべての課', words);
  card.addEventListener('click', () => {
    pendingDeckPreselect = 'ALL';
    showScreen('screen-quiz-setup');
  });
  return card;
}

/**
 * 1つの課の行（デッキカード + 操作アイコン）を作る。
 * @param {import('./storage.js').Deck} deck
 * @param {import('./storage.js').Word[]} deckWords
 * @param {boolean} isFirst
 * @param {boolean} isLast
 */
function buildDeckRow(deck, deckWords, isFirst, isLast) {
  const row = document.createElement('div');
  row.className = 'deck-card-row';

  const card = buildDeckCardBody(deck.name, deckWords);
  card.addEventListener('click', () => {
    pendingDeckPreselect = deck.id;
    showScreen('screen-quiz-setup');
  });

  const controls = document.createElement('div');
  controls.className = 'item-controls';
  controls.appendChild(makeIconButton('編集', ICONS.edit, () => {
    currentDeckDetailId = deck.id;
    showScreen('screen-deck-detail');
  }));
  if (reorderMode) {
    controls.appendChild(makeIconButton('上へ', ICONS.up, () => { reorderDeck(deck.id, -1); renderHome(); }, isFirst ? 'disabled' : ''));
    controls.appendChild(makeIconButton('下へ', ICONS.down, () => { reorderDeck(deck.id, 1); renderHome(); }, isLast ? 'disabled' : ''));
  }

  row.append(card, controls);
  return row;
}

function buildFolderGroup(folder, folderDecks, words) {
  const group = document.createElement('div');
  group.className = 'folder-group';

  const header = document.createElement('div');
  header.className = 'folder-group-header';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'folder-group-title';
  titleWrap.innerHTML = `${ICONS.folder}<span>${escapeHtml(folder.name)}</span>`;

  const controls = document.createElement('div');
  controls.className = 'item-controls';
  controls.appendChild(makeIconButton('編集', ICONS.edit, () => {
    currentFolderDetailId = folder.id;
    showScreen('screen-folder-detail');
  }));
  if (reorderMode) {
    const folders = getFolderList();
    const idx = folders.findIndex((f) => f.id === folder.id);
    controls.appendChild(makeIconButton('上へ', ICONS.up, () => { reorderFolder(folder.id, -1); renderHome(); }, idx === 0 ? 'disabled' : ''));
    controls.appendChild(makeIconButton('下へ', ICONS.down, () => { reorderFolder(folder.id, 1); renderHome(); }, idx === folders.length - 1 ? 'disabled' : ''));
  }

  header.append(titleWrap, controls);

  const decksWrap = document.createElement('div');
  decksWrap.className = 'folder-group-decks';
  if (folderDecks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'field-hint';
    empty.style.margin = '0';
    empty.textContent = 'このフォルダにはまだ課がありません';
    decksWrap.appendChild(empty);
  } else {
    folderDecks.forEach((deck, idx) => {
      decksWrap.appendChild(buildDeckRow(deck, words.filter((w) => w.deckId === deck.id), idx === 0, idx === folderDecks.length - 1));
    });
  }

  group.append(header, decksWrap);
  return group;
}

el.btnGotoImport.addEventListener('click', () => {
  importReturnTarget = null;
  pendingDeckPreselect = null;
  el.pasteTextarea.value = '';
  el.previewArea.classList.add('hidden');
  lastParsedEntries = [];
  showScreen('screen-import');
});

el.btnCreateFolder.addEventListener('click', () => {
  const name = prompt('フォルダの名前を入力してください');
  if (!name || !name.trim()) return;
  addFolder(name.trim());
  renderHome();
  showToast('フォルダを作成しました');
});

/* ---------------------------------------------------------
   取り込み画面
--------------------------------------------------------- */
function renderImportDeckOptions() {
  const decks = getDeckList();
  const folders = getFolderList();
  const folderName = (id) => (folders.find((f) => f.id === id) || {}).name;

  el.importDeckSelect.innerHTML = '';
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '＋ 新しい課を作成';
  el.importDeckSelect.appendChild(newOpt);

  decks.forEach((deck) => {
    const opt = document.createElement('option');
    opt.value = deck.id;
    opt.textContent = deck.folderId ? `${folderName(deck.folderId)} / ${deck.name}` : deck.name;
    el.importDeckSelect.appendChild(opt);
  });

  el.newDeckFolderSelect.innerHTML = '<option value="">フォルダなし</option>';
  folders.forEach((folder) => {
    const opt = document.createElement('option');
    opt.value = folder.id;
    opt.textContent = folder.name;
    el.newDeckFolderSelect.appendChild(opt);
  });

  el.deckNameInput.value = '';

  if (importReturnTarget && importReturnTarget.deckId) {
    el.importDeckSelect.value = importReturnTarget.deckId;
  } else {
    el.importDeckSelect.value = '__new__';
  }
  updateNewDeckFieldsVisibility();
}

function updateNewDeckFieldsVisibility() {
  el.newDeckFields.classList.toggle('hidden', el.importDeckSelect.value !== '__new__');
}
el.importDeckSelect.addEventListener('change', updateNewDeckFieldsVisibility);

el.btnParse.addEventListener('click', () => {
  const entries = parseWordList(el.pasteTextarea.value);
  if (entries.length === 0) {
    showToast('単語を検出できませんでした。形式をご確認ください。');
    return;
  }
  lastParsedEntries = entries.map((e) => ({ ...e, pinyin: e.pinyin || autoPinyin(e.hanzi) }));
  renderPreview(lastParsedEntries);
});

/**
 * 利用可能であれば pinyin-pro ライブラリでピンインを自動生成する。
 * ライブラリが読み込めない（オフライン等）場合は空文字を返し、致命的エラーにしない。
 * @param {string} hanzi
 * @returns {string}
 */
function autoPinyin(hanzi) {
  try {
    const lib = window.pinyinPro;
    if (lib && typeof lib.pinyin === 'function') {
      return lib.pinyin(hanzi, { toneType: 'symbol', type: 'string' });
    }
  } catch (e) {
    // ライブラリ未読み込み時は無視してフォールバック
  }
  return '';
}

function renderPreview(entries) {
  el.previewCountNum.textContent = String(entries.length);
  el.previewList.innerHTML = '';
  for (const entry of entries) {
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.className = 'preview-hanzi';
    left.textContent = entry.pinyin ? `${entry.hanzi}（${entry.pinyin}）` : entry.hanzi;
    const right = document.createElement('span');
    right.className = 'preview-meaning';
    right.textContent = entry.meaning;
    li.append(left, right);
    el.previewList.appendChild(li);
  }
  el.previewArea.classList.remove('hidden');
}

el.btnSaveWords.addEventListener('click', () => {
  if (lastParsedEntries.length === 0) return;

  let deckId = el.importDeckSelect.value;
  if (deckId === '__new__') {
    const name = el.deckNameInput.value.trim();
    if (!name) {
      showToast('新しい課の名前を入力してください');
      return;
    }
    const folderId = el.newDeckFolderSelect.value || null;
    const deck = addDeck(name, folderId);
    deckId = deck.id;
  }

  const { added, updated } = addWords(lastParsedEntries, deckId);
  showToast(`保存しました（新規 ${added} 件 / 更新 ${updated} 件）`);

  if (importReturnTarget && importReturnTarget.deckId) {
    currentDeckDetailId = importReturnTarget.deckId;
    importReturnTarget = null;
    showScreen('screen-deck-detail', { push: false });
    navStack = ['screen-home', 'screen-deck-detail'];
  } else {
    showScreen('screen-home', { push: false });
    navStack = ['screen-home'];
  }
});

/* ---------------------------------------------------------
   課の詳細画面
--------------------------------------------------------- */
function renderDeckDetail() {
  const deck = getDeckById(currentDeckDetailId);
  if (!deck) { showScreen('screen-home', { push: false }); navStack = ['screen-home']; return; }

  el.deckDetailName.value = deck.name;

  const folders = getFolderList();
  el.deckDetailFolder.innerHTML = '<option value="">フォルダなし</option>';
  folders.forEach((folder) => {
    const opt = document.createElement('option');
    opt.value = folder.id;
    opt.textContent = folder.name;
    el.deckDetailFolder.appendChild(opt);
  });
  el.deckDetailFolder.value = deck.folderId || '';

  renderDeckDetailWordList();
}

function renderDeckDetailWordList() {
  const words = getWords().filter((w) => w.deckId === currentDeckDetailId);
  el.deckDetailWordCount.textContent = String(words.length);
  el.deckDetailWordList.innerHTML = '';

  if (words.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'まだ単語がありません';
    el.deckDetailWordList.appendChild(li);
    return;
  }

  for (const word of words) {
    el.deckDetailWordList.appendChild(buildWordEditRow(word));
  }
}

function buildWordEditRow(word) {
  const li = document.createElement('li');

  const display = document.createElement('div');
  display.className = 'word-row-display';

  const text = document.createElement('div');
  text.className = 'word-row-text';
  text.innerHTML = `
    <span class="word-row-hanzi">${escapeHtml(word.hanzi)}${word.pinyin ? `　<span class="word-row-pinyin">${escapeHtml(word.pinyin)}</span>` : ''}</span>
    <span class="word-row-meaning">${escapeHtml(word.meaning)}</span>`;

  const controls = document.createElement('div');
  controls.className = 'item-controls';
  const editBtn = makeIconButton('編集', ICONS.edit, () => form.classList.toggle('open'));
  const delBtn = makeIconButton('削除', ICONS.trash, () => {
    if (!confirm(`「${word.hanzi}」を削除しますか？`)) return;
    deleteWord(word.id);
    renderDeckDetailWordList();
    showToast('削除しました');
  });
  controls.append(editBtn, delBtn);

  display.append(text, controls);

  const form = document.createElement('div');
  form.className = 'word-edit-form';
  const hanziInput = document.createElement('input');
  hanziInput.value = word.hanzi;
  hanziInput.placeholder = '中国語';
  const pinyinInput = document.createElement('input');
  pinyinInput.value = word.pinyin;
  pinyinInput.placeholder = 'ピンイン（任意）';
  const meaningInput = document.createElement('input');
  meaningInput.value = word.meaning;
  meaningInput.placeholder = '意味';

  const formButtons = document.createElement('div');
  formButtons.className = 'row-buttons';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', () => {
    const hanzi = hanziInput.value.trim();
    const meaning = meaningInput.value.trim();
    if (!hanzi || !meaning) { showToast('中国語と意味は必須です'); return; }
    updateWordContent(word.id, { hanzi, pinyin: pinyinInput.value.trim(), meaning });
    renderDeckDetailWordList();
    showToast('更新しました');
  });
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-ghost';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', () => form.classList.remove('open'));
  formButtons.append(cancelBtn, saveBtn);

  form.append(hanziInput, pinyinInput, meaningInput, formButtons);

  li.append(display, form);
  return li;
}

el.deckDetailName.addEventListener('change', () => {
  const name = el.deckDetailName.value.trim();
  if (!name || !currentDeckDetailId) return;
  renameDeck(currentDeckDetailId, name);
  showToast('課の名前を更新しました');
});

el.deckDetailFolder.addEventListener('change', () => {
  if (!currentDeckDetailId) return;
  moveDeckToFolder(currentDeckDetailId, el.deckDetailFolder.value || null);
  showToast('フォルダを変更しました');
});

el.btnAddWordsToDeck.addEventListener('click', () => {
  importReturnTarget = { deckId: currentDeckDetailId };
  el.pasteTextarea.value = '';
  el.previewArea.classList.add('hidden');
  lastParsedEntries = [];
  showScreen('screen-import');
});

el.btnDeleteDeck.addEventListener('click', () => {
  const deck = getDeckById(currentDeckDetailId);
  if (!deck) return;
  if (!confirm(`「${deck.name}」を削除しますか？中の単語もすべて削除されます。`)) return;
  deleteDeck(currentDeckDetailId);
  showToast('削除しました');
  showScreen('screen-home', { push: false });
  navStack = ['screen-home'];
});

/* ---------------------------------------------------------
   フォルダの詳細画面
--------------------------------------------------------- */
function renderFolderDetail() {
  const folders = getFolderList();
  const folder = folders.find((f) => f.id === currentFolderDetailId);
  if (!folder) { showScreen('screen-home', { push: false }); navStack = ['screen-home']; return; }

  el.folderDetailName.value = folder.name;

  const decks = getDeckList().filter((d) => d.folderId === folder.id);
  el.folderDetailDeckList.innerHTML = '';
  if (decks.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'このフォルダにはまだ課がありません';
    el.folderDetailDeckList.appendChild(li);
  } else {
    decks.forEach((deck, idx) => {
      const li = document.createElement('li');
      const display = document.createElement('div');
      display.className = 'word-row-display';
      const name = document.createElement('span');
      name.className = 'word-row-hanzi';
      name.textContent = deck.name;
      name.style.cursor = 'pointer';
      name.addEventListener('click', () => {
        currentDeckDetailId = deck.id;
        showScreen('screen-deck-detail');
      });

      const controls = document.createElement('div');
      controls.className = 'item-controls';
      controls.appendChild(makeIconButton('上へ', ICONS.up, () => { reorderDeck(deck.id, -1); renderFolderDetail(); }, idx === 0 ? 'disabled' : ''));
      controls.appendChild(makeIconButton('下へ', ICONS.down, () => { reorderDeck(deck.id, 1); renderFolderDetail(); }, idx === decks.length - 1 ? 'disabled' : ''));
      const outBtn = document.createElement('button');
      outBtn.type = 'button';
      outBtn.className = 'btn btn-ghost btn-small';
      outBtn.textContent = 'フォルダから出す';
      outBtn.addEventListener('click', () => { moveDeckToFolder(deck.id, null); renderFolderDetail(); showToast('フォルダから出しました'); });

      display.append(name, controls);
      li.append(display, outBtn);
      el.folderDetailDeckList.appendChild(li);
    });
  }
}

el.folderDetailName.addEventListener('change', () => {
  const name = el.folderDetailName.value.trim();
  if (!name || !currentFolderDetailId) return;
  renameFolder(currentFolderDetailId, name);
  showToast('フォルダ名を更新しました');
});

el.btnDeleteFolder.addEventListener('click', () => {
  if (!currentFolderDetailId) return;
  if (!confirm('フォルダを削除しますか？中の課はフォルダなしに戻り、削除されません。')) return;
  deleteFolder(currentFolderDetailId);
  showToast('フォルダを削除しました');
  showScreen('screen-home', { push: false });
  navStack = ['screen-home'];
});

/* ---------------------------------------------------------
   クイズ設定画面
--------------------------------------------------------- */
function renderQuizSetup() {
  const decks = getDeckList();
  const folders = getFolderList();
  el.setupDecks.innerHTML = '';

  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = 'chip selected';
  allChip.textContent = 'すべて';
  allChip.dataset.deck = '__all__';
  allChip.addEventListener('click', () => selectOnlyAll());
  el.setupDecks.appendChild(allChip);

  function selectOnlyAll() {
    el.setupDecks.querySelectorAll('.chip').forEach((c) => c.classList.toggle('selected', c === allChip));
  }
  function onAnyDeckToggle() {
    allChip.classList.remove('selected');
    const anySelected = [...el.setupDecks.querySelectorAll('.chip[data-deck-id]')].some((c) => c.classList.contains('selected'));
    if (!anySelected) allChip.classList.add('selected');
  }

  function addDeckChip(deck) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = deck.name;
    chip.dataset.deckId = deck.id;
    chip.addEventListener('click', () => { chip.classList.toggle('selected'); onAnyDeckToggle(); });
    return chip;
  }

  folders.forEach((folder) => {
    const folderDecks = decks.filter((d) => d.folderId === folder.id);
    if (folderDecks.length === 0) return;

    const label = document.createElement('div');
    label.className = 'chip-group-folder-label';
    label.textContent = folder.name;
    el.setupDecks.appendChild(label);

    const folderChip = document.createElement('button');
    folderChip.type = 'button';
    folderChip.className = 'chip chip-folder';
    folderChip.textContent = `${folder.name} 全部`;
    const childChips = [];
    folderChip.addEventListener('click', () => {
      const allSelected = childChips.every((c) => c.classList.contains('selected'));
      childChips.forEach((c) => c.classList.toggle('selected', !allSelected));
      onAnyDeckToggle();
    });
    el.setupDecks.appendChild(folderChip);

    folderDecks.forEach((deck) => {
      const chip = addDeckChip(deck);
      childChips.push(chip);
      el.setupDecks.appendChild(chip);
    });
  });

  const rootDecks = decks.filter((d) => !d.folderId || !folders.some((f) => f.id === d.folderId));
  if (rootDecks.length > 0 && folders.length > 0) {
    const label = document.createElement('div');
    label.className = 'chip-group-folder-label';
    label.textContent = 'フォルダなし';
    el.setupDecks.appendChild(label);
  }
  rootDecks.forEach((deck) => el.setupDecks.appendChild(addDeckChip(deck)));

  // 事前選択の反映
  if (pendingDeckPreselect && pendingDeckPreselect !== 'ALL') {
    const target = el.setupDecks.querySelector(`.chip[data-deck-id="${pendingDeckPreselect}"]`);
    if (target) {
      selectOnlyAll();
      allChip.classList.remove('selected');
      target.classList.add('selected');
    }
  }
  pendingDeckPreselect = null;
}

function getSelectedDeckIds() {
  const chips = [...el.setupDecks.querySelectorAll('.chip[data-deck-id].selected')];
  const allSelected = el.setupDecks.querySelector('.chip[data-deck="__all__"]')?.classList.contains('selected');
  if (allSelected || chips.length === 0) return [];
  return chips.map((c) => c.dataset.deckId);
}

el.btnStartQuiz.addEventListener('click', () => {
  const deckIds = getSelectedDeckIds();
  const quizType = el.setupQuizType.querySelector('input:checked').value;
  const orderMode = el.setupOrderMode.querySelector('input:checked').value;

  const allWords = getWords();
  const queue = buildQueue(allWords, { deckIds, orderMode });

  if (queue.length === 0) {
    showToast('出題できる単語がありません。条件を変更してください。');
    return;
  }

  lastSetup = { deckIds, quizType, orderMode };
  startQuiz(queue, quizType);
});

/* ---------------------------------------------------------
   クイズ画面
--------------------------------------------------------- */
let session = null; // {queue, index, quizType, correctCount, results:[{word, correct}]}
let lastSetup = null; // 「もう一度」用に前回の設定を保持

function startQuiz(queue, quizType) {
  session = { queue, index: 0, quizType, correctCount: 0, results: [] };
  showScreen('screen-quiz');
  renderQuestion();
}

function renderQuestion() {
  const { queue, index, quizType } = session;
  const word = queue[index];
  const { prompt, showAudio } = buildPrompt(word, quizType);

  el.quizPrompt.textContent = prompt;
  el.btnSpeak.classList.toggle('hidden', !showAudio || !isSpeechSupported());
  el.answerInput.value = '';
  el.answerFeedback.classList.add('hidden');
  el.answerInput.classList.remove('hidden');
  el.btnCheck.disabled = false;
  el.btnSkip.disabled = false;

  const pct = Math.round((index / queue.length) * 100);
  el.progressFill.style.width = `${pct}%`;
  el.progressLabel.textContent = `${index + 1} / ${queue.length}`;

  // 音声が使えるモードでは、単語が表示された瞬間に一度自動で読み上げる
  if (showAudio) {
    speakChinese(word.hanzi, { rate: settings.speechRate, voiceURI: settings.speechVoiceURI });
  }

  setTimeout(() => el.answerInput.focus(), 50);
}

el.btnSpeak.addEventListener('click', () => {
  const word = session.queue[session.index];
  speakChinese(word.hanzi, { rate: settings.speechRate, voiceURI: settings.speechVoiceURI });
});

function submitAnswer(isSkip) {
  const word = session.queue[session.index];
  const userInput = isSkip ? '' : el.answerInput.value;
  const correct = !isSkip && checkAnswer(word, userInput, session.quizType);

  applyReviewResult(word, correct);
  saveWords(getWords().map((w) => (w.id === word.id ? { ...w, stats: word.stats } : w)));

  session.results.push({ word, correct });
  if (correct) session.correctCount += 1;

  showFeedback(word, correct, userInput);
}

function showFeedback(word, correct, userInput) {
  el.answerInput.classList.add('hidden');
  el.answerFeedback.classList.remove('hidden');
  el.feedbackResult.textContent = correct ? '○ 正解' : '× 不正解';
  el.feedbackResult.className = `feedback-result ${correct ? 'correct' : 'wrong'}`;

  if (correct) {
    el.feedbackDetail.innerHTML = `
      <div class="fd-hanzi">${escapeHtml(word.hanzi)}</div>
      <div>${escapeHtml(word.pinyin || '')}</div>
      <div>${escapeHtml(word.meaning)}</div>`;
  } else {
    el.feedbackDetail.innerHTML = `
      <div><span class="fd-label">あなた</span>${escapeHtml(userInput || '（無回答）')}</div>
      <div><span class="fd-label">正解</span><span class="fd-hanzi">${escapeHtml(word.hanzi)}</span></div>
      <div><span class="fd-label">ピンイン</span>${escapeHtml(word.pinyin || '-')}</div>
      <div><span class="fd-label">意味</span>${escapeHtml(word.meaning)}</div>`;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

el.btnCheck.addEventListener('click', () => submitAnswer(false));
el.btnSkip.addEventListener('click', () => submitAnswer(true));
el.answerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitAnswer(false);
});

el.btnNext.addEventListener('click', nextQuestion);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !el.answerFeedback.classList.contains('hidden')
      && !document.getElementById('screen-quiz').classList.contains('hidden')) {
    nextQuestion();
  }
});

function nextQuestion() {
  session.index += 1;
  if (session.index >= session.queue.length) {
    finishQuiz();
  } else {
    renderQuestion();
  }
}

function finishQuiz() {
  recordStudySession();
  const total = session.queue.length;
  const correct = session.correctCount;
  el.summaryTotal.textContent = String(total);
  el.summaryCorrect.textContent = String(correct);
  el.summaryRate.textContent = `${total ? Math.round((correct / total) * 100) : 0}%`;
  showScreen('screen-summary');
}

el.btnSummaryRetry.addEventListener('click', () => {
  if (!lastSetup) { showScreen('screen-home', { push: false }); navStack = ['screen-home']; return; }
  const allWords = getWords();
  const queue = buildQueue(allWords, { deckIds: lastSetup.deckIds, orderMode: lastSetup.orderMode });
  if (queue.length === 0) {
    showToast('出題できる単語がありません。');
    showScreen('screen-home', { push: false });
    navStack = ['screen-home'];
    return;
  }
  startQuiz(queue, lastSetup.quizType);
});

el.btnSummaryHome.addEventListener('click', () => {
  showScreen('screen-home', { push: false });
  navStack = ['screen-home'];
});

/* ---------------------------------------------------------
   履歴画面
--------------------------------------------------------- */
function renderHistory() {
  const words = getWords();
  const history = getHistory();
  el.historyDays.textContent = String(history.studyDays ? history.studyDays.length : 0);
  el.historyWords.textContent = String(words.length);
  const acc = computeAccuracy(words);
  el.historyRate.textContent = acc === null ? '-' : `${acc}%`;

  const weak = sortByWeakness(words.filter((w) => w.stats.seen > 0)).slice(0, 10);
  el.weakWordList.innerHTML = '';
  if (weak.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'まだ学習データがありません';
    el.weakWordList.appendChild(li);
  }
  for (const w of weak) {
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.className = 'preview-hanzi';
    left.textContent = `${w.hanzi}${w.pinyin ? `（${w.pinyin}）` : ''}`;
    const right = document.createElement('span');
    right.className = 'preview-meaning';
    const rate = w.stats.seen ? Math.round((w.stats.correct / w.stats.seen) * 100) : 0;
    right.textContent = `正答率 ${rate}%（${w.stats.seen}回）`;
    li.append(left, right);
    el.weakWordList.appendChild(li);
  }
}

/* ---------------------------------------------------------
   設定画面
--------------------------------------------------------- */
function applyTheme() {
  document.documentElement.setAttribute('data-theme', settings.theme);
}

function renderSettings() {
  document.querySelectorAll('input[name="theme"]').forEach((r) => {
    r.checked = r.value === settings.theme;
    r.onchange = () => {
      settings.theme = r.value;
      saveSettings(settings);
      applyTheme();
    };
  });

  el.speechRateSlider.value = String(settings.speechRate);

  const decks = getDeckList();
  const folders = getFolderList();
  const folderName = (id) => (folders.find((f) => f.id === id) || {}).name;

  el.settingsDeckList.innerHTML = '';
  if (decks.length === 0) {
    const span = document.createElement('span');
    span.className = 'field-label';
    span.textContent = '登録済みの課はありません';
    el.settingsDeckList.appendChild(span);
  }
  for (const deck of decks) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = deck.folderId ? `${folderName(deck.folderId)} / ${deck.name}` : deck.name;
    chip.addEventListener('click', () => {
      currentDeckDetailId = deck.id;
      showScreen('screen-deck-detail');
    });
    el.settingsDeckList.appendChild(chip);
  }

  el.gistTokenInput.value = settings.gistToken || '';
  el.gistIdInput.value = settings.gistId || '';
  el.gistLastBackup.textContent = settings.lastBackupAt
    ? `最終バックアップ: ${new Date(settings.lastBackupAt).toLocaleString('ja-JP')}`
    : 'まだバックアップされていません';
}

el.speechRateSlider.addEventListener('change', () => {
  settings.speechRate = parseFloat(el.speechRateSlider.value);
  saveSettings(settings);
});

el.btnTestSpeech.addEventListener('click', () => {
  speakChinese('你好，欢迎使用中文单词本。', { rate: settings.speechRate, voiceURI: settings.speechVoiceURI });
});

el.gistTokenInput.addEventListener('change', () => {
  settings.gistToken = el.gistTokenInput.value.trim();
  saveSettings(settings);
});
el.gistIdInput.addEventListener('change', () => {
  settings.gistId = el.gistIdInput.value.trim();
  saveSettings(settings);
});

el.btnGistBackup.addEventListener('click', async () => {
  const token = settings.gistToken;
  if (!token) { showToast('先にPersonal Access Tokenを入力してください'); return; }

  el.btnGistBackup.disabled = true;
  showToast('バックアップ中…');
  try {
    const { gistId } = await saveToGist({ token, gistId: settings.gistId || undefined, content: exportData() });
    settings.gistId = gistId;
    settings.lastBackupAt = new Date().toISOString();
    saveSettings(settings);
    el.gistIdInput.value = gistId;
    el.gistLastBackup.textContent = `最終バックアップ: ${new Date(settings.lastBackupAt).toLocaleString('ja-JP')}`;
    showToast('バックアップしました');
  } catch (e) {
    console.error(e);
    showToast(e.message || 'バックアップに失敗しました');
  } finally {
    el.btnGistBackup.disabled = false;
  }
});

el.btnGistRestore.addEventListener('click', async () => {
  const token = settings.gistToken;
  const gistId = settings.gistId;
  if (!token) { showToast('先にPersonal Access Tokenを入力してください'); return; }
  if (!gistId) { showToast('Gist IDが未設定です（先にバックアップするか、IDを入力してください）'); return; }
  if (!confirm('この端末のデータをGistの内容で上書きします。よろしいですか？')) return;

  el.btnGistRestore.disabled = true;
  showToast('復元中…');
  try {
    const content = await loadFromGist({ token, gistId });
    const ok = importData(content);
    if (ok) {
      settings = getSettings();
      showToast('復元しました');
      renderSettings();
    } else {
      showToast('データの形式が正しくありません');
    }
  } catch (e) {
    console.error(e);
    showToast(e.message || '復元に失敗しました');
  } finally {
    el.btnGistRestore.disabled = false;
  }
});

/* ---------------------------------------------------------
   PWA: Service Worker 登録
--------------------------------------------------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('Service Worker の登録に失敗しました', err);
    });
  });
}

/* ---------------------------------------------------------
   初期化
--------------------------------------------------------- */
function init() {
  applyTheme();
  showScreen('screen-home', { push: false });
}

init();
