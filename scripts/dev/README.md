# scripts/dev

AIチャット（`/api/ai/sankey-chat`）の応答品質を反復評価するための開発用ハーネス。`scripts/` 直下のCSV処理パイプラインとは別枠で、ローカル開発時の動作確認専用。

実行手順: `npm run dev` でローカルサーバーを起動（`.env.local` に `OPENROUTER_API_KEY` が必要）→ 別ターミナルで `node scripts/dev/ai-chat-eval.mjs`（`--only <id>` で1シナリオのみ、`--out <path>` で結果をファイルにも保存、`BASE_URL` でホスト変更）。
