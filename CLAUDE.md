# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

```bash
npm run dev              # Dev server (localhost:3000, Turbopack)
npm run build            # Production build（prebuildで.gzを自動展開）
npm run lint             # ESLint チェック
npx tsc --noEmit         # TypeScript 型チェック
```

データパイプライン・JSON生成コマンドは `/pipeline` スキルを参照。

## Architecture

日本の2024年度予算・支出データをインタラクティブなSankey図で可視化する Next.js アプリ。

**公開ページ**: `/sankey-svg`（メイン、`/` からリダイレクト）、`/subcontracts`、`/mof-budget-overview`（URL直打ち）、`/mof-jikou`（URL直打ち・予算書の事項一覧）、`/mof-kou-moku`（URL直打ち・予算書の目一覧）、`/mof-kou`（URL直打ち・予算書の項一覧）、`/mof-hierarchy`（URL直打ち・事項の階層サンキー）、`/quality`（URL直打ち）、`/project-bubble`（URL直打ち・事業バブルチャート＝意味的2次元配置）

**Key Statistics**: 151.12兆円 総予算 / 5,003事業 / 26,823支出先（予算年度2023実績・再委託先含む）

### Layer Design Rules

| Layer | Directory | 役割 |
|-------|-----------|------|
| Data Pipeline | `scripts/` | ソースデータの取得・変換（CSV処理に加え、MOF予算書Web帳票のXML取得も含む。`generate-mof-jikou-data.ts`・`generate-mof-kou-moku-data.ts`等）。UIやAPIロジック禁止 |
| Domain Logic | `app/lib/` | Pure Sankey生成。HTTP・React禁止 |
| API Layer | `app/api/` | HTTPハンドラ。ロジックは `app/lib/` に委譲 |
| UI Components | `client/components/` | 再利用可能UI。直接APIコール禁止 |
| Pages | `app/*/page.tsx` | 状態管理・API呼び出し・レイアウトのみ |
| Types | `types/` | 全レイヤー共通の型定義 |

### Critical Notes

- **データ単位**: 全金額は **1円単位**（千円単位ではない）。総予算 = 151,120,000,000,000円
- **「その他」vs「その他の支出先」**: 別ノード。"その他" = 支出先名が「その他」(~26兆円)、"その他の支出先" = TopN以外集計(~51兆円)
- **Import alias**: `@/*` はリポジトリルートにマップ（例: `@/types/structured`）
- **データ圧縮**: `.gz` のみGit管理（~11MB）、ビルド時に自動展開（~96MB）

## Skills（作業別エントリーポイント）

| 作業内容 | 使うスキル |
|---------|-----------|
| Sankey図の実装（/sankey-svg） | `/sankey` |
| データパイプライン・CSV処理・JSON生成 | `/pipeline` |
| lint + TypeScript チェック | `/quality-check` |
| CSVデータ更新→JSON生成→Git反映 | `/data-update` |

## Deployment

`main` ブランチへの push → Vercel 自動ビルド（東京リージョン `hnd1`）。
`prebuild` フックが `.gz` → `.json` を自動展開。

## 応答スタイル

- **簡潔に。** 主要な答えに文字数を使い、前置き・注意書き・まとめの再掲は短く。説明を求められたらまず要点を述べ、詳細な解説は明示的に求められたときだけ書く。
- **作業中の実況は最小限に。** 最初のツール呼び出し前に「何をするか」を1文。作業中は重要な発見か方針転換のときだけ短く報告する。完了時は結論（何が起きたか／何が分かったか）を第1文に置き、根拠や詳細はその後に書く。
- **自己訂正のナレーションを絞る。** 先の発言の誤りは、ユーザーのコード・結論・判断が変わる場合だけ訂正する。影響のない言い間違いは黙って直して先に進む。

## Agent の行動ルール

- **指示された範囲を、指示された粒度でやる。** 定型的な判断は自分で決めてよいが、解釈違いで成果物が大きく変わる場合だけ確認を取る。依頼が誤っていると思ったら1〜2文で指摘したうえで、依頼どおりに進める（黙って範囲を狭めたり広げたり作り替えたりしない）。着手した範囲は最後まで終わらせ、できなかった部分は明示して報告する。
- **コミットメッセージにセッション URL を含めないこと。** `https://claude.ai/code/session_...` 形式の URL はコミットメッセージに追記しない。
- **PR は必ずユーザーの明示的な許可を得てから作成すること。** 実装・修正が完了しても、ユーザーから「PR を出してください」「PR お願いします」などの指示がない限り、自律的に PR を作成・プッシュしてはならない。
- コミットは実装完了のタイミングで行ってよいが、プッシュ・PR 作成は指示待ちとする。
- **PR は draft（下書き）で作成すること。** 実行手段に関わらず draft を保証する：デスクトップ版は `gh pr create --draft`、Web版（`gh` が無い環境）は GitHub MCP ツール `mcp__github__create_pull_request` に **`draft: true` を明示指定**する（省略すると通常PRになり CodeRabbitAI のレビューが即走るため注意）。CodeRabbitAI のレビューが RateLimit を持つため、ある程度まとめてから ready for review に切り替える運用とする（ready 化はユーザーが任意のタイミングで行う）。

## Documentation Standards

- **Task docs**（設計・調査・実装計画）: `docs/tasks/YYYYMMDD_HHMM_タイトル.md`
- **Architecture guides**（恒久的な参照ドキュメント）: `docs/*.md`

## Known Bugs / Limitations

- **Multi-block spending**: 支出先が同一事業の複数ブロックに出現する場合、`projects.find()` ではなく `projects.filter().reduce()` で金額を合算すること
