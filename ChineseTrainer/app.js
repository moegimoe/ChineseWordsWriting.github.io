/**
 * @file app.js
 * アプリのエントリーポイント。画面遷移とイベント配線を行う。
 */

import { parseWordList } from './parser.js';
import {
  getWords, saveWords, addWords, getDecks, deleteDeck,
  getSettings, saveSettings, getHistory, recordStudySession,
  exportData, importData,
} from './storage.js';
import { QUIZ_TYPES, ORDER_MODES, buildQueue, checkAnswer, buildPrompt } from './quiz.js';
import { applyReviewResult, sortByWeakness } from './review.js';
import { speakChinese, isSpeechSupported } from './speech.js';

/* ---------------------------------------------------------
   要素参照
--------------------------------------------------------- */
const el = {
  headerTitle: document.getElementById('header-title'),
  btnBack: document.getElementById('btn-back'),
  btnSettings: document.getElementById('btn-settings'),

  deckList: document.getElementById('deck-list'),
  homeEmptyHint: document.getElementById('home-empty-hint'),
  btnGotoImport: document.getElementById('btn-goto-import'),

  deckNameInput: document.getElementById('deck-name-input'),
  pasteTextarea: document.getElementById('paste-textarea'),
  btnParse: document.getElementById('btn-parse'),
  previewArea: document.getElementById('preview-area'),
  previewCountNum: document.getElementById('preview-count-num'),
  previewList: document.getElementById('preview-list'),
  btnSaveWords: document.getElementById('btn-save-words'),

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
  btnExport: document.getElementById('btn-export'),
  btnImport: document.getElementById('btn-import'),
  importFileInput: document.getElementById('import-file-input'),

  toast: document.getElementById('toast'),
};

const SCREEN_TITLES = {
  'screen-home': '中文単語帳',
  'screen-import': '単語を取り込む',
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

/** クイズ実行中セッション */
let session = null; // {queue, index, quizType, correctCount, results:[{word, correct}]}
let lastSetup = null; // 「もう一度」用に前回の設定を保持

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

  if (id === 'screen-home') renderHome();
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

/* ---------------------------------------------------------
   トースト通知
--------------------------------------------------------- */
let toastTimer = null;
function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 2200);
}

/* ---------------------------------------------------------
   ホーム画面
--------------------------------------------------------- */
function renderHome() {
  const words = getWords();
  const decks = getDecks();
  el.deckList.innerHTML = '';
  el.homeEmptyHint.classList.toggle('hidden', decks.length > 0);

  if (decks.length === 0) return;

  // 「すべての課」カード
  el.deckList.appendChild(buildDeckCard('__all__', 'すべての課', words));

  for (const deck of decks) {
    const deckWords = words.filter((w) => w.deck === deck);
    el.deckList.appendChild(buildDeckCard(deck, deck, deckWords));
  }
}

function computeAccuracy(words) {
  const seen = words.reduce((sum, w) => sum + w.stats.seen, 0);
  const correct = words.reduce((sum, w) => sum + w.stats.correct, 0);
  if (seen === 0) return null;
  return Math.round((correct / seen) * 100);
}

function buildDeckCard(deckKey, label, words) {
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
  card.addEventListener('click', () => {
    lastSetup = null;
    showScreen('screen-quiz-setup');
    if (deckKey !== '__all__') {
      // 該当の課だけを選択状態にする
      requestAnimationFrame(() => {
        el.setupDecks.querySelectorAll('.chip').forEach((chip) => {
          chip.classList.toggle('selected', chip.dataset.deck === deckKey);
        });
      });
    }
  });
  return card;
}

el.btnGotoImport.addEventListener('click', () => {
  el.pasteTextarea.value = '';
  el.deckNameInput.value = '';
  el.previewArea.classList.add('hidden');
  lastParsedEntries = [];
  showScreen('screen-import');
});

/* ---------------------------------------------------------
   取り込み画面
--------------------------------------------------------- */
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
  const deckName = el.deckNameInput.value.trim() || '未分類';
  const { added, updated } = addWords(lastParsedEntries, deckName);
  showToast(`保存しました（新規 ${added} 件 / 更新 ${updated} 件）`);
  showScreen('screen-home', { push: false });
  navStack = ['screen-home'];
});

/* ---------------------------------------------------------
   クイズ設定画面
--------------------------------------------------------- */
function renderQuizSetup() {
  const decks = getDecks();
  el.setupDecks.innerHTML = '';

  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = 'chip selected';
  allChip.textContent = 'すべて';
  allChip.dataset.deck = '__all__';
  allChip.addEventListener('click', () => {
    el.setupDecks.querySelectorAll('.chip').forEach((c) => c.classList.toggle('selected', c === allChip));
  });
  el.setupDecks.appendChild(allChip);

  for (const deck of decks) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = deck;
    chip.dataset.deck = deck;
    chip.addEventListener('click', () => {
      allChip.classList.remove('selected');
      chip.classList.toggle('selected');
      const anySelected = [...el.setupDecks.querySelectorAll('.chip')].some((c) => c.classList.contains('selected'));
      if (!anySelected) allChip.classList.add('selected');
    });
    el.setupDecks.appendChild(chip);
  }
}

function getSelectedDecks() {
  const chips = [...el.setupDecks.querySelectorAll('.chip.selected')];
  if (chips.length === 0 || chips.some((c) => c.dataset.deck === '__all__')) return [];
  return chips.map((c) => c.dataset.deck);
}

el.btnStartQuiz.addEventListener('click', () => {
  const decks = getSelectedDecks();
  const quizType = el.setupQuizType.querySelector('input:checked').value;
  const orderMode = el.setupOrderMode.querySelector('input:checked').value;

  const allWords = getWords();
  const queue = buildQueue(allWords, { decks, orderMode });

  if (queue.length === 0) {
    showToast('出題できる単語がありません。条件を変更してください。');
    return;
  }

  lastSetup = { decks, quizType, orderMode };
  startQuiz(queue, quizType);
});

/* ---------------------------------------------------------
   クイズ画面
--------------------------------------------------------- */
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

  if (quizType === QUIZ_TYPES.AUDIO_TO_HANZI) {
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
  const queue = buildQueue(allWords, { decks: lastSetup.decks, orderMode: lastSetup.orderMode });
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

  el.settingsDeckList.innerHTML = '';
  const decks = getDecks();
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
    chip.textContent = `${deck} ✕`;
    chip.addEventListener('click', () => {
      if (confirm(`「${deck}」を削除しますか？（元に戻せません）`)) {
        deleteDeck(deck);
        renderSettings();
        showToast('削除しました');
      }
    });
    el.settingsDeckList.appendChild(chip);
  }
}

el.speechRateSlider.addEventListener('change', () => {
  settings.speechRate = parseFloat(el.speechRateSlider.value);
  saveSettings(settings);
});

el.btnTestSpeech.addEventListener('click', () => {
  speakChinese('你好，欢迎使用中文单词本。', { rate: settings.speechRate, voiceURI: settings.speechVoiceURI });
});

el.btnExport.addEventListener('click', () => {
  const json = exportData();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `chinese-trainer-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

el.btnImport.addEventListener('click', () => el.importFileInput.click());
el.importFileInput.addEventListener('change', async () => {
  const file = el.importFileInput.files[0];
  if (!file) return;
  const text = await file.text();
  const ok = importData(text);
  showToast(ok ? '復元しました' : '読み込みに失敗しました');
  el.importFileInput.value = '';
  if (ok) renderSettings();
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
