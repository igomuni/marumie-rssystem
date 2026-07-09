'use client';

/**
 * サンキーAIチャットパネル（/sankey-svg 右側）。
 *
 * 表示専用コンポーネント: API 呼び出し・チャット状態の保持・結果の適用はすべて
 * page.tsx がコールバック経由で行う（client/components は直接APIコール禁止）。
 * AI の結果は自動適用せず、結果カードの「この条件で図を表示」で明示適用する。
 */
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { SankeyChatResult } from '@/types/sankey-ai-chat';
import { formatYen } from '@/app/lib/sankey-svg-constants';
import { CHAT_MARKDOWN_STYLES } from './chat-markdown-styles';

// Markdown 描画（react-markdown + remark-gfm）は初回メッセージ表示時に遅延ロードし、
// ページ初期バンドルに含めない。ロード完了までは Suspense fallback で本文を平文表示する
// （メッセージはユーザー操作後にのみ存在するため、この lazy が SSR で評価されることはない）
const ChatMarkdown = lazy(() => import('./ChatMarkdown'));

/** ページが保持するチャット表示用メッセージ（API の履歴形式 + 表示用の付加情報） */
export interface AiChatUiMessage {
  role: 'user' | 'assistant';
  content: string;
  /** フィルタ条件が確定した assistant 応答に付く */
  result?: SankeyChatResult;
  /** 次に聞ける質問の提案（最大3件）。assistant 応答に付く */
  suggestions?: string[];
  /** 送信失敗などのエラー表示 */
  isError?: boolean;
}

interface AiChatPanelProps {
  open: boolean;
  onToggle: () => void;
  messages: AiChatUiMessage[];
  sending: boolean;
  onSend: (text: string) => void;
  onApplyResult: (result: SankeyChatResult) => void;
  onClear: () => void;
  /** 実効パネル幅（ビューポートクランプ済み）。isCompactWidth のときは無視して全幅 */
  width: number;
  isCompactWidth: boolean;
  onResizeStart: (e: React.MouseEvent) => void;
  isResizing: boolean;
  onResetWidth: () => void;
}

const EXAMPLE_PROMPTS = [
  '再エネ関連で予算100億円以上の事業だけ見たい',
  '経済産業省と環境省の事業に絞って',
  'NTTデータへの支出がある事業を見たい',
];

const PANEL_Z_INDEX = 210; // 右上の設定ボタン(200)より前面。ScoreDetailDialog は body へ portal されるため影響しない

export function AiChatPanel({
  open, onToggle, messages, sending, onSend, onApplyResult, onClear,
  width, isCompactWidth, onResizeStart, isResizing, onResetWidth,
}: AiChatPanelProps) {
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // 新着メッセージ・送信中インジケータで最下部へ自動スクロール
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, sending]);

  const submit = () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    onSend(text);
  };

  // 深掘り提案チップのタップ: そのテキストをそのままユーザーメッセージとして送信する
  const submitSuggestion = (text: string) => {
    if (sending) return;
    onSend(text);
  };

  // 閉状態: 右端中央の開閉タブのみ表示
  if (!open) {
    return (
      <button
        data-pan-disabled="true"
        onClick={onToggle}
        title="AIフィルターアシスタントを開く"
        aria-label="AIフィルターアシスタントを開く"
        style={{
          position: 'fixed', right: 0, top: '50%', transform: 'translateY(-50%)',
          width: 28, height: 64, zIndex: PANEL_Z_INDEX,
          background: '#fff', border: '1px solid #e0e0e0', borderRight: 'none',
          borderRadius: '6px 0 0 6px', boxShadow: '-2px 0 4px rgba(0,0,0,0.08)',
          cursor: 'pointer', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 2, padding: 0,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: '#1a73e8' }}>AI</span>
        <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 6 9 12 15 18" />
        </svg>
      </button>
    );
  }

  return (
    <div
      data-pan-disabled="true"
      style={{
        position: 'fixed', right: 0, top: 0, height: '100%',
        width: isCompactWidth ? '100%' : width,
        background: '#fff',
        borderLeft: isCompactWidth ? 'none' : '1px solid #e0e0e0',
        boxShadow: '-2px 0 8px rgba(0,0,0,0.1)',
        zIndex: PANEL_Z_INDEX,
        transition: isResizing ? 'none' : 'width 0.2s ease',
        display: 'flex', flexDirection: 'column',
        cursor: 'default',
        colorScheme: 'light', color: '#333',
      }}
    >
      {/* 幅リサイズハンドル — 左端（コンパクト幅では非表示） */}
      {!isCompactWidth && (
        <div
          data-pan-disabled="true"
          role="separator"
          aria-orientation="vertical"
          aria-label="AIチャットパネルの幅を変更"
          title="ドラッグで幅を変更（ダブルクリックで既定値）"
          onMouseDown={e => { e.preventDefault(); onResizeStart(e); }}
          onDoubleClick={onResetWidth}
          style={{
            position: 'absolute', left: -3, top: 0, width: 6, height: '100%',
            cursor: 'ew-resize', zIndex: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            userSelect: 'none',
          }}
        >
          <div style={{ width: 3, height: 32, borderRadius: 2, background: isResizing ? '#a0a0a0' : 'transparent' }} />
        </div>
      )}

      {/* ヘッダ */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #f0f0f0', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#333', flex: 1, minWidth: 0 }}>
          AIフィルターアシスタント
        </span>
        {messages.length > 0 && (
          <button
            onClick={onClear}
            disabled={sending}
            title="会話をクリア"
            style={{ fontSize: 11, color: '#888', background: 'transparent', border: '1px solid #ddd', borderRadius: 4, padding: '3px 8px', cursor: sending ? 'default' : 'pointer' }}
          >クリア</button>
        )}
        <button
          onClick={onToggle}
          title="パネルを閉じる"
          aria-label="パネルを閉じる"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Markdown 描画用スタイル（メッセージごとではなくパネルで1回だけ描画する） */}
      <style>{CHAT_MARKDOWN_STYLES}</style>

      {/* メッセージリスト */}
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 4px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ fontSize: 12, color: '#777', lineHeight: 1.7 }}>
            <p style={{ margin: '0 0 8px' }}>
              見たい条件を自然な言葉で伝えると、AIがフィルタ条件を組み立てます。
              結果は件数を確認してから図に反映できます。
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {EXAMPLE_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => setInput(p)}
                  style={{ textAlign: 'left', fontSize: 12, color: '#1a73e8', background: '#f5f8ff', border: '1px solid #dbe6ff', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', lineHeight: 1.5 }}
                >{p}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '88%',
              padding: '7px 11px',
              borderRadius: m.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
              background: m.role === 'user' ? '#e8f0fe' : m.isError ? '#fdecea' : '#f4f4f4',
              color: m.isError ? '#c62828' : '#333',
              fontSize: 13, lineHeight: 1.6,
              // assistant の通常応答は Markdown が段落を扱うため pre-wrap にしない（二重改行を防ぐ）
              whiteSpace: m.role === 'assistant' && !m.isError ? 'normal' : 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {m.role === 'assistant' && !m.isError
                ? (
                  <Suspense fallback={<span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>}>
                    <ChatMarkdown text={m.content} />
                  </Suspense>
                )
                : m.content}
            </div>
            {m.result && (
              <div style={{ marginTop: 6, maxWidth: '88%', minWidth: '70%', border: '1px solid #dbe6ff', borderRadius: 8, background: '#f9fbff', padding: '8px 11px', fontSize: 12 }}>
                {m.result.interpretation && (
                  <div style={{ marginBottom: 6, fontSize: 11, color: '#777' }}>
                    解釈: {m.result.interpretation}
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, color: '#444' }}>
                  <div>マッチ事業: <b>{m.result.summary.projects.count.toLocaleString()}件</b>（予算 {formatYen(m.result.summary.projects.budgetTotal)}）</div>
                  <div>支出先: <b>{m.result.summary.recipients.count.toLocaleString()}件</b> ／ 府省庁: <b>{m.result.summary.ministries.count}</b></div>
                </div>
                <button
                  onClick={() => onApplyResult(m.result!)}
                  disabled={m.result.summary.projects.count === 0}
                  style={{ marginTop: 8, width: '100%', fontSize: 12, fontWeight: 600, color: '#fff', background: m.result.summary.projects.count > 0 ? '#1a73e8' : '#9e9e9e', border: 'none', borderRadius: 6, padding: '7px 0', cursor: m.result.summary.projects.count > 0 ? 'pointer' : 'default' }}
                >この条件で図を表示</button>
              </div>
            )}
            {m.role === 'assistant' && m.suggestions && m.suggestions.length > 0 && (
              <div style={{ marginTop: 6, maxWidth: '88%', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {m.suggestions.map((s, si) => (
                  <button
                    key={si}
                    onClick={() => submitSuggestion(s)}
                    disabled={sending}
                    title={s}
                    style={{
                      fontSize: 11.5, color: '#1a73e8', background: '#f5f8ff', border: '1px solid #dbe6ff',
                      borderRadius: 14, padding: '4px 10px', cursor: sending ? 'default' : 'pointer',
                      opacity: sending ? 0.6 : 1,
                    }}
                  >{s}</button>
                ))}
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#888', fontSize: 12, padding: '2px 4px' }}>
            <span style={{
              width: 14, height: 14, borderRadius: '50%',
              border: '2px solid #d0d0d0', borderTopColor: '#1a73e8',
              animation: 'ai-chat-spin 0.9s linear infinite', display: 'inline-block',
            }} />
            条件を組み立てています…
            <style>{'@keyframes ai-chat-spin { to { transform: rotate(360deg); } }'}</style>
          </div>
        )}
      </div>

      {/* 入力欄 */}
      <div style={{ flexShrink: 0, borderTop: '1px solid #f0f0f0', padding: 10, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            // Escape はページ全体のノード選択解除ショートカットに奪わせない
            if (e.key === 'Escape') { e.stopPropagation(); return; }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="例: 再エネ関連で予算100億円以上"
          rows={2}
          disabled={sending}
          style={{
            flex: 1, minWidth: 0, resize: 'none', fontSize: 13, lineHeight: 1.5,
            padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8,
            outline: 'none', fontFamily: 'inherit', background: sending ? '#fafafa' : '#fff',
            boxSizing: 'border-box', color: '#333',
          }}
        />
        <button
          onClick={submit}
          disabled={sending || !input.trim()}
          title="送信（Enter）"
          aria-label="送信"
          style={{
            width: 36, height: 36, flexShrink: 0, borderRadius: 8, border: 'none',
            background: sending || !input.trim() ? '#e0e0e0' : '#1a73e8',
            cursor: sending || !input.trim() ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="#fff"><path d="M120-160v-640l760 320-760 320Zm72-110 474-210-474-210v147l240 63-240 63v147Zm0 0v-420 420Z"/></svg>
        </button>
      </div>
    </div>
  );
}
