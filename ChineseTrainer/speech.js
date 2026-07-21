/**
 * @file speech.js
 * ブラウザの SpeechSynthesis API を使った中国語読み上げラッパー。
 */

let cachedVoices = [];

/** 利用可能な音声リストを更新してキャッシュする */
function refreshVoices() {
  if (!('speechSynthesis' in window)) return [];
  cachedVoices = window.speechSynthesis.getVoices();
  return cachedVoices;
}

if ('speechSynthesis' in window) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

/** @returns {SpeechSynthesisVoice[]} zh-CN 系の音声一覧 */
function getChineseVoices() {
  const voices = cachedVoices.length ? cachedVoices : refreshVoices();
  return voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('zh'));
}

/**
 * 中国語テキストを読み上げる。
 * @param {string} text
 * @param {Object} [options]
 * @param {number} [options.rate=0.85] 読み上げ速度 (0.5-2.0)
 * @param {string|null} [options.voiceURI] 指定する音声のURI
 * @returns {boolean} 読み上げを開始できたか
 */
function speakChinese(text, options = {}) {
  if (!('speechSynthesis' in window) || !text) return false;
  const { rate = 0.85, voiceURI = null } = options;

  window.speechSynthesis.cancel(); // 前の発話を止めてから再生

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = rate;

  const voices = cachedVoices.length ? cachedVoices : refreshVoices();
  let voice = null;
  if (voiceURI) {
    voice = voices.find((v) => v.voiceURI === voiceURI) || null;
  }
  if (!voice) {
    voice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('zh')) || null;
  }
  if (voice) utterance.voice = voice;

  window.speechSynthesis.speak(utterance);
  return true;
}

/** @returns {boolean} このブラウザが音声合成に対応しているか */
function isSpeechSupported() {
  return 'speechSynthesis' in window;
}

export { speakChinese, getChineseVoices, isSpeechSupported, refreshVoices };
