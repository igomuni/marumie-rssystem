# AIチャット アーキテクチャ ガイド

`/sankey-svg` のAIチャットパネル（自然言語 → SankeyQuery 変換）の恒久的な設計ルール。
実装を変更する前に本書を読むこと。`POST /api/ai/sankey-chat` のリクエスト/レスポンス型は
`types/sankey-ai-chat.ts` を正典とする（公開 API の仕様は [docs/api-guide.md](api-guide.md)）。

## 1. 2つの実行モードと3層分割

チャットは**サーバモード**（サイト運営のキー）と **BYOK モード**（使用者自身の OpenRouter キー）の
2モードで動く。両者でエージェントのループ・プロンプト・ツール定義を共有するため、次の3層に分かれている。

| 層 | ファイル | 役割 |
|----|---------|------|
| コア（Pure） | `app/lib/ai/chat-core.ts` | ループ・システムプロンプト・ツール定義 |
| 整形（Pure・両モード共有） | `app/lib/ai/tool-shaping.ts` | ツール応答の整形・件数クランプ |
| サーバ実装 | `app/lib/ai/tool-executor-server.ts` | ローダ直呼び |
| サーバ入口 | `app/lib/ai/sankey-chat-agent.ts` | 従来 API 向け互換エントリ |
| クライアント実装 | `client/lib/ai/client-tool-executor.ts` ほか | 公開 API fetch + graph のローカル実行 |

**規約**:

- `chat-core.ts` は `fs`・`fetch`・`NextResponse`・React を一切 import しない。LLM 呼び出しは
  `LlmCaller`、ツール実行は `ChatToolExecutor` として**注入**する
- **両モードの応答同一性は「ツール応答（payload）の形を揃えること」で担保する。**
  モード分岐をコアに持ち込まない
- BYOK モードの `run_sankey_query` は、公開 API を増やさず `executeQuery`（`app/lib/sankey-query.ts`・
  Pure 関数）をブラウザで直接実行する。`/sankey-svg` は graph を読み込み済みなのでデータの二重取得も無い
- 確定クエリは `executeQuery` で再度 `resolveSankeyQuery` を通す。**AI の生出力がそのまま
  クライアントへ返ることはない**

## 2. API キーの取り扱い規律（BYOK）

使用者のキーは `client/lib/ai/api-key-store.ts` が IndexedDB に保存する。

- **キーはこのブラウザにのみ保存し、自サイトのサーバへは送信しない。** UI 文言もこれを明示する
- ブラウザ保存キーは **XSS に対して原理的に防御不能**（HttpOnly にできない）。したがって
  UI では「**利用上限を設定したキーの使用**」を案内する（OpenRouter はキー別のクレジット上限を設定可能）
- **キーを `console.log`・URL・エラーレポート・テレメトリに含めない。** 将来クライアント側の
  例外通知を入れる場合もヘッダをマスクする
- 二段目の壁として CSP を `next.config.ts` の `headers()` で本番のみ付与している
  （`connect-src 'self' https://openrouter.ai` が本命。dev は HMR が eval/ws を使うため除外）。
  **外部ホストへの接続先を増やす変更は、キー流出経路を広げる**ことを意識して行う

## 3. 進行イベント（ストリーミング）

`stream: true` のとき SSE で進行イベントを配信する。**トークンストリームは行わない** —
配信するのは「今どの段階か」の構造化イベントのみ。

型は `types/sankey-ai-chat.ts` の `SankeyChatProgressEvent`（判別可能ユニオン）。
**日本語ラベルへの変換は UI 層（`AiChatPanel.tsx` の `progressLabel`）でのみ行う。**
イベント側に表示文言を持たせない。

| イベント | 条件 | ラベル |
|---------|------|-------|
| `llm_round` | `round <= 1` | 要求を解釈しています… |
| `llm_round` | `round >= 2` | 結果を確認しています…（N回目） |
| `tool` | `run_sankey_query`（`matched` あり） | クエリを実行しました — N事業がマッチ |
| `tool` | `search_projects` / `search_recipients` | 語彙を検索しています… |
| `tool` | その他 | 詳細データを取得しています… |
| `retry` | — | 混雑のため待機して再試行します… |
| （なし） | 初期状態・不明 | 条件を組み立てています… |

## 4. 会話履歴の制約

サーバはステートレスで、**会話履歴はクライアントが毎回全量を送る**。上限は
`types/sankey-ai-chat.ts` の定数（`MAX_CHAT_MESSAGES` = 20 件、`MAX_CHAT_TOTAL_CHARS` = 8000 字）。
サーバは超過を 400 で拒否し、クライアントは送信前に古い履歴を切り捨てる。

この制約から、**前のターンのツール生データは次のターンには残らない**。
会話をまたいで数値を再利用する機能（レポート化など）はこの前提の上で設計すること。

## 5. レポート化ボタンの定型プロンプト

`AiChatPanel.tsx` の `REPORT_PROMPT` は「会話整形の1ターン + 出典付記」の形に固定してある。
文面を変更する場合も次の2要件は外さない。

1. **数値・事実は会話に出てきたものだけを使い、会話に無い数値は書かせない**（捏造防止）
2. 末尾に「再現情報」として、適用したフィルタ条件（SankeyQuery JSON）と、
   主要な数値がどのツール・条件から得られたかを付記させる

## 6. 表示のフィーチャーフラグ（デプロイ単位）

コードは全環境に入れたうえで、公開先ごとに UI を出すかどうかだけを切り替える。定義は `app/lib/feature-flags.ts`。

| 環境変数 | 対象 |
|---|---|
| `NEXT_PUBLIC_FEATURE_AI_CHAT` | AIチャットパネル（起動ボタンを含む） |
| `NEXT_PUBLIC_FEATURE_EXPLORATION_HISTORY` | 探索履歴・発見メモ |

`'1'` または `'true'` で有効、**未設定・それ以外は無効**。開発元（marumie-rssystem）は `.env.local` で有効にし、公開ミラー（rs-vis）は設定しない。

サーバ API（`/api/ai/sankey-chat` 等）はフラグで塞いでいない。UI を出さないだけで、エンドポイント自体を置くかどうかは公開ポリシーの別判断に属するため。

## 7. 既知の制約

- OpenRouter の障害・仕様変更が使用者体験に直結する（運営プロキシが無いため介入余地なし）。
  エラー文言は使用者自身の OpenRouter ダッシュボード確認へ誘導する
- モデルごとに function calling の互換性が異なる。**既定モデルでの動作保証 + その他は無保証**の線引き
- BYOK モードではサーバが会話を観測できない。利用観測を行う場合は会話本文を送らない
  軽量テレメトリを別途設ける（未実施）
