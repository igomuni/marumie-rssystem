'use client';

/**
 * AIチャットの assistant 応答を Markdown として描画する（表・強調・リスト対応）。
 *
 * react-markdown は生 HTML を描画しないため、LLM 出力をそのまま渡しても XSS の懸念がない。
 * AiChatPanel から next/dynamic で遅延ロードされる（react-markdown + remark-gfm を
 * ページ初期バンドルに含めないため、このファイルは AiChatPanel から直接 import しない）。
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** チャット吹き出し（fontSize 13 基調）に合わせたコンパクトな Markdown スタイル */
const MD_STYLES = `
.ai-chat-md > :first-child { margin-top: 0; }
.ai-chat-md > :last-child { margin-bottom: 0; }
.ai-chat-md p { margin: 0 0 6px; }
.ai-chat-md h1, .ai-chat-md h2, .ai-chat-md h3, .ai-chat-md h4 {
  font-size: 13px; font-weight: 700; margin: 10px 0 4px; line-height: 1.5;
}
.ai-chat-md ul, .ai-chat-md ol { margin: 0 0 6px; padding-left: 18px; }
.ai-chat-md li { margin: 2px 0; }
.ai-chat-md code {
  font-size: 12px; background: #ececec; border-radius: 3px; padding: 1px 4px;
}
.ai-chat-md pre { margin: 0 0 6px; overflow-x: auto; }
.ai-chat-md pre code { display: block; padding: 6px 8px; }
.ai-chat-md blockquote {
  margin: 0 0 6px; padding: 2px 0 2px 8px; border-left: 3px solid #d0d0d0; color: #666;
}
.ai-chat-md hr { border: none; border-top: 1px solid #e0e0e0; margin: 8px 0; }
.ai-chat-md .ai-chat-md-table-wrap { overflow-x: auto; margin: 0 0 6px; }
.ai-chat-md table { border-collapse: collapse; font-size: 11.5px; }
.ai-chat-md th, .ai-chat-md td {
  border: 1px solid #ddd; padding: 3px 7px; text-align: left; white-space: nowrap;
}
.ai-chat-md th { background: #efefef; font-weight: 600; }
`;

export default function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="ai-chat-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 外部リンクは新規タブで開く（チャット状態を保持したまま参照できるように）
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
          // 表はパネル幅を超えることがあるため横スクロールで収める
          table: ({ children }) => (
            <div className="ai-chat-md-table-wrap"><table>{children}</table></div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
      <style>{MD_STYLES}</style>
    </div>
  );
}
