/**
 * @file parser.js
 * 授業資料の貼り付けテキストを単語配列に変換する。
 *
 * 対応フォーマット:
 *   1) 空行区切りブロック形式
 *        叫
 *        〜という
 *
 *        专业
 *        専攻
 *   2) パイプ区切り形式（ピンイン指定あり）
 *        学习|xuéxí|学習
 *   3) 空行なしの単純交互形式（中国語/意味が1行ずつ交互に並ぶ）
 */

/**
 * @typedef {Object} ParsedEntry
 * @property {string} hanzi
 * @property {string} pinyin
 * @property {string} meaning
 */

/**
 * 1行をパイプ形式として解釈できれば {hanzi, pinyin, meaning} を返す。できなければ null。
 * @param {string} line
 * @returns {ParsedEntry|null}
 */
function tryParsePipeLine(line) {
  if (!line.includes('|')) return null;
  const parts = line.split('|').map((s) => s.trim()).filter((s) => s.length > 0 || s === '');
  if (parts.length === 3) {
    const [hanzi, pinyin, meaning] = parts;
    if (hanzi && meaning) return { hanzi, pinyin, meaning };
  } else if (parts.length === 2) {
    const [hanzi, meaning] = parts;
    if (hanzi && meaning) return { hanzi, pinyin: '', meaning };
  }
  return null;
}

/**
 * 貼り付けテキストを解析して単語配列を返す。
 * @param {string} rawText
 * @returns {ParsedEntry[]}
 */
function parseWordList(rawText) {
  if (!rawText || !rawText.trim()) return [];

  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\u3000/g, ' ');
  const hasBlankLineSeparators = /\n[ \t]*\n/.test(normalized.trim());

  const entries = [];

  if (hasBlankLineSeparators) {
    // ブロック形式: 空行でブロックを区切り、各ブロックの1行目=中国語, 2行目=意味
    const blocks = normalized.split(/\n[ \t]*\n+/).map((b) => b.trim()).filter(Boolean);
    for (const block of blocks) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) continue;

      // ブロックが1行だけならパイプ形式を試す
      if (lines.length === 1) {
        const pipeEntry = tryParsePipeLine(lines[0]);
        if (pipeEntry) entries.push(pipeEntry);
        continue;
      }

      const pipeEntry = tryParsePipeLine(lines[0]);
      if (pipeEntry) {
        entries.push(pipeEntry);
        continue;
      }

      const hanzi = lines[0];
      const meaning = lines.slice(1).join(' / ');
      entries.push({ hanzi, pinyin: '', meaning });
    }
  } else {
    // 空行なし: 1行ずつ交互（中国語, 意味, 中国語, 意味...）またはパイプ形式が混在
    const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);
    let i = 0;
    while (i < lines.length) {
      const pipeEntry = tryParsePipeLine(lines[i]);
      if (pipeEntry) {
        entries.push(pipeEntry);
        i += 1;
        continue;
      }
      if (i + 1 < lines.length) {
        entries.push({ hanzi: lines[i], pinyin: '', meaning: lines[i + 1] });
        i += 2;
      } else {
        // 意味が欠けている最後の1行は無視する
        i += 1;
      }
    }
  }

  // 空データを除外
  return entries.filter((e) => e.hanzi && e.meaning);
}

export { parseWordList };
