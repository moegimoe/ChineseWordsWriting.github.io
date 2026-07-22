/**
 * @file gist.js
 * GitHub Gist をバックエンドにしたバックアップ／復元。
 * GitHub の REST API (Gist) は CORS に対応しているため、サーバーなしでブラウザから直接呼び出せる。
 */

const API_BASE = 'https://api.github.com/gists';
const BACKUP_FILENAME = 'chinese-trainer-backup.json';
const GIST_DESCRIPTION = '中文単語帳 ChineseTrainer バックアップ';

/**
 * @param {string} token GitHub Personal Access Token
 * @returns {Object} fetch用ヘッダー
 */
function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
}

/**
 * データをGistへ保存する。gistId が未指定の場合は新規Gistを作成する。
 * @param {Object} options
 * @param {string} options.token
 * @param {string} [options.gistId]
 * @param {string} options.content バックアップ本文（JSON文字列）
 * @returns {Promise<{gistId:string}>}
 */
async function saveToGist({ token, gistId, content }) {
  if (!token) throw new Error('Personal Access Token が設定されていません');

  const body = {
    description: GIST_DESCRIPTION,
    public: false,
    files: { [BACKUP_FILENAME]: { content } },
  };

  const url = gistId ? `${API_BASE}/${gistId}` : API_BASE;
  const method = gistId ? 'PATCH' : 'POST';

  const res = await fetch(url, { method, headers: authHeaders(token), body: JSON.stringify(body) });

  if (!res.ok) {
    if (res.status === 404 && gistId) {
      // 指定されたGistが見つからない場合は新規作成にフォールバック
      return saveToGist({ token, gistId: undefined, content });
    }
    const detail = await safeErrorMessage(res);
    throw new Error(`Gistへの保存に失敗しました (${res.status}) ${detail}`);
  }

  const data = await res.json();
  return { gistId: data.id };
}

/**
 * Gistから最新のバックアップ内容を取得する。
 * @param {Object} options
 * @param {string} options.token
 * @param {string} options.gistId
 * @returns {Promise<string>} バックアップ本文（JSON文字列）
 */
async function loadFromGist({ token, gistId }) {
  if (!token) throw new Error('Personal Access Token が設定されていません');
  if (!gistId) throw new Error('Gist ID が設定されていません（先に一度バックアップを実行してください）');

  const res = await fetch(`${API_BASE}/${gistId}`, { method: 'GET', headers: authHeaders(token) });

  if (!res.ok) {
    const detail = await safeErrorMessage(res);
    throw new Error(`Gistの取得に失敗しました (${res.status}) ${detail}`);
  }

  const data = await res.json();
  const file = data.files && data.files[BACKUP_FILENAME];
  if (!file) throw new Error('Gist内にバックアップファイルが見つかりませんでした');

  // truncated な場合（非常に大きいファイル）は raw_url から取得し直す
  if (file.truncated && file.raw_url) {
    const rawRes = await fetch(file.raw_url);
    if (!rawRes.ok) throw new Error('バックアップ本文の取得に失敗しました');
    return rawRes.text();
  }

  return file.content;
}

/** @param {Response} res @returns {Promise<string>} */
async function safeErrorMessage(res) {
  try {
    const data = await res.json();
    return data.message || '';
  } catch (e) {
    return '';
  }
}

export { saveToGist, loadFromGist };
