# scripts/dev

AIチャット（`/api/ai/sankey-chat`）の応答品質を反復評価するための開発用ハーネス。`scripts/` 直下のCSV処理パイプラインとは別枠で、ローカル開発時の動作確認専用。

実行手順: `npm run dev` でローカルサーバーを起動（`.env.local` に `OPENROUTER_API_KEY` が必要）→ 別ターミナルで `node scripts/dev/ai-chat-eval.mjs`（`--only <id>` で1シナリオのみ、`--out <path>` で結果をファイルにも保存、`--pace <ms>` でターン間待機、`BASE_URL` でホスト変更）。

接続先の差し替え（OpenAI互換エンドポイント）: `SANKEY_AI_CHAT_BASE_URL` / `SANKEY_AI_CHAT_API_KEY` / `SANKEY_AI_CHAT_MODEL` を指定して `npm run dev` を起動する。**注意: Gemini API 無料枠（gemini-3.5-flash: 5 RPM / 20 RPD）ではフルスイート（1回25〜40リクエスト）は日次上限を超える**ため、`--only` での単発スモーク用途に限る。
