/**
 * AIチャット会話履歴の IndexedDB 永続化（リロードしても会話が残る）。
 *
 * このブラウザにのみ保存され、サーバへは送信されない（保存対象は表示用メッセージ
 * 配列そのもの。BYOK キーは含まれない — キーは api-key-store の別ストア）。
 * 「クリア」ボタン・BYOKキー削除時は空配列が保存され、履歴も消える。
 */
import type { AiChatUiMessage } from '@/client/components/SankeySvg/AiChatPanel';

const DB_NAME = 'ai-chat-history';
const DB_VERSION = 1;
const STORE_NAME = 'session';
const RECORD_KEY = 'current';

/** 保存する最大メッセージ数（表示用。API 送信上限とは独立に大きめに取る） */
const MAX_SAVED_MESSAGES = 100;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const req = fn(tx.objectStore(STORE_NAME));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onabort = () => db.close();
  }));
}

/** 保存済み会話を取得（未保存・非対応環境は空配列） */
export async function loadChatHistory(): Promise<AiChatUiMessage[]> {
  try {
    const value = await withStore('readonly', store => store.get(RECORD_KEY));
    return Array.isArray(value) ? (value as AiChatUiMessage[]) : [];
  } catch {
    return [];
  }
}

/** 会話を保存（失敗は握りつぶす。チャット利用を妨げない） */
export async function saveChatHistory(messages: AiChatUiMessage[]): Promise<void> {
  try {
    await withStore('readwrite', store => store.put(messages.slice(-MAX_SAVED_MESSAGES), RECORD_KEY));
  } catch {
    // IndexedDB 非対応・容量超過等は永続化なしで続行
  }
}
