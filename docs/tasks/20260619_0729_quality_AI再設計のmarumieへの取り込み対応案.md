# /quality AI再設計（rs-vis）の marumie-rssystem への取り込み 対応案

**日時**: 2026-06-19 07:29 (JST)
**対象**: `/quality`（事業別 支出先データ品質スコア）
**目的**: rs-vis 側で実施した「品質スコアのAI評価ベース再設計」を、開発リポジトリ marumie-rssystem に取り込む。本書は実装前の**対応案（差分分析・移植方針・リスク）**であり、コード変更は含まない。

---

## 1. 背景

通常の同期方向は **marumie（開発・上流）→ rs-vis（公開ミラー）**。
今回は例外的に、`/quality` の刷新が **rs-vis 側で先行実装**され、それを marumie に逆流（バックポート）させたい。

rs-vis 側の該当コミット:

- `40ccdb7` 品質スコアをAI評価ベースに再設計（透明性4軸＋有効性）
- `b3facbc` chore: 品質スコアデータ（project-quality-scores-2024.json）を再生成

設計の全体像は rs-vis の `docs/tasks/20260616_1749_AI支出先データ品質スコアリング再設計.md` に詳しい。

### 再設計の要点

ルール/辞書ベースの加重5軸（軸1 支出先名品質40%／軸2 CN記入率20%…）を、**AI評価3軸＋機械計算2軸**へ刷新:

| 軸 | 種別 | 重み | 測るもの |
|----|------|------|----------|
| A 支出先の特定可能性 | AI判定 | 28% | 第三者が支出先の実在を確認できるか |
| B 使途の説明性 | AI判定 | 22% | 何にいくら使ったかが理解・検証できるか |
| C 収支の整合性 | 機械計算 | 15% | 執行額と実支出が許容バンド内で一致するか |
| E 有効性／成果設計の明確さ | AI判定 | 35% | 国民生活への寄与が明確・妥当に説明されているか（0-10・意図ベース・実測成果ではない） |
| D 構造の整合性 | 機械計算 | （参考・総合不算入） | ブロック金額の内部整合・孤立ブロック（平均99.9でほぼ弁別せず） |

- A/B/E を LLM（OpenRouter, OpenAI互換API, 既定 `google/gemini-3.5-flash`）で判定。
- `OPENROUTER_API_KEY` 未設定時は決定的ヒューリスティックで完走（`aiSource="heuristic"`）。

---

## 2. 差分分析（marumie 現状 vs rs-vis 再設計後）

実ファイルを突き合わせた結果、**移植は「ファイル単純コピー」では成立しない**。理由は API 層の分岐。

### 2-1. クリーンに移植できるもの（rs-vis が前進・marumie は旧状態のまま）

| 対象 | 状況 | 移植方針 |
|------|------|----------|
| `app/quality/page.tsx` | marumie版と rs-vis 再設計**前**版は**バイト完全一致**。rs-vis のみ再設計済 | rs-vis 版で**置き換え可**（ただし §2-3 の依存に注意） |
| `scripts/score-project-quality-ai.py` | marumie に**存在しない**（新規 686行） | **新規追加** |
| `scripts/score-project-quality.py` | rs-vis 側で新スキーマの入力signal出力に微修正（10行） | 差分を取り込み |
| `public/data/project-quality-scores-{2024,2025}.json` | marumie は旧スキーマ（4.4/4.5MB）、rs-vis は新スキーマ（5.8/7.0MB、reason等付き） | **再生成 or rs-vis 成果物をコピー**（§3 で方針決定） |
| `docs/quality-scoring-guide.md` | rs-vis で改訂（+25行、新4軸の説明） | 差分を取り込み |
| `package.json` | `score-quality-ai` / `score-quality-ai-2025` スクリプト追加（2行） | 追記 |
| 設計ドキュメント | rs-vis の `docs/tasks/20260616_1749_*.md` | 参照用にコピー（任意） |

> 注: `public/data/project-quality-recipients-{year}.json(.gz)` は両リポジトリで**完全一致**（AI判定の入力。再生成不要）。

### 2-2. ⚠️ 単純コピー不可 — marumie の API 層が rs-vis より**前進**している

marumie は直近の **PR #231「AIフレンドリー化＋セキュリティ初期ハードニング」**（commit `d9aa127`）で API 層を改良済み。rs-vis はこの改良**前**の marumie から枝分かれしているため、**rs-vis のルートをそのまま上書きすると marumie の改良がデグレする**。

該当3ルートの扱い:

| ルート | rs-vis 再設計が加えた変更 | marumie 固有（保持すべき）改良 | 対応 |
|--------|--------------------------|-------------------------------|------|
| `app/api/quality-scores/route.ts` | `QualityScoreItem` に新軸フィールド（`axisIdentify/Purpose/Budget/Structure/Effective`, `identifyLevelAvg`, `purposeLevelAvg`, `effectiveLevel`, `effectiveReason`, `aiSource`）を**追加**（型のみ・加算的） | `parseYear()` による年度バリデーション、`serverErrorResponse()` | **マージ**: marumie 版に新軸フィールドだけ追記。`aiSource` のコメントは rs-vis では `"gemini:<model>"` 表記、本文は `"openrouter:<model>"`。表記を統一する |
| `app/api/quality-scores/recipients/route.ts` | `.gz` フォールバック（展開済み .json 優先、無ければ `zlib.gunzipSync`）を追加 | `parseYear()`, `serverErrorResponse()` | **マージ**: marumie 版に `.gz` フォールバックのみ移植。`parseYear/serverErrorResponse` は残す |
| `app/api/project-details/[projectId]/route.ts` | `.gz` フォールバック（`gunzipSync`）を追加 | `projectLinks()` による関連リンク付与、`API_CACHE_CONTROL` | **マージ**: marumie 版に `.gz` フォールバックのみ移植。`projectLinks/API_CACHE_CONTROL` は残す |

**結論**: API 3ルートは「rs-vis の追加点（新軸の型 ＋ `.gz` フォールバック）」だけを、marumie の現行ルートに**手作業でマージ**する。上書きは禁止。

### 2-3. page.tsx の依存確認（取り込み前にチェック）

`page.tsx` 自体は再設計前まで一致しているが、rs-vis 再設計版が marumie に**存在しない関数・型**を参照していないか取り込み時に要確認:

- 新軸を読む型（`QualityScoreItem` の新フィールド）は §2-2 のルート型更新と整合させる。
- `app/lib/api/api-notes`（`parseYear` 等）は marumie 側に存在（PR #231）。rs-vis 側の page がこれを参照していなければ問題なし。

---

## 3. 確認が必要な論点（実装着手前にユーザー判断）

1. **スコアJSONの作り方**:
   - (a) rs-vis の成果物 `project-quality-scores-{year}.json` を**そのままコピー**（即座に同じ表示。再現性は rs-vis 依存）
   - (b) marumie 側で `score-project-quality-ai.py` を**再実行して生成**（要 `OPENROUTER_API_KEY`、または heuristic で生成）
   - 推奨: まず (a) で表示一致を担保し、パイプライン再現は (b) を別途整備。
2. **`.gz` 管理方針**: marumie は「`.gz` のみ Git 管理、ビルド時展開」が原則（CLAUDE.md）。新スキーマのスコアJSONは現状 `.gz` 未生成。**`.gz` を生成して Git 管理に乗せるか**を決める（recipients は両方 `.gz` あり）。
3. **`data/cache/`**: AI スクリプトのキャッシュ出力先。marumie `.gitignore` は `__pycache__/` のみで `data/cache/` 未登録。**`.gitignore` への追加が必要**。
4. **依存追加**: `openai`（Python）。再実行する場合のみ必要。`requirements.txt` 等への記載要否を確認。

---

## 4. 実装ステップ（案）

1. ✅ 本対応案ドキュメント
2. `scripts/score-project-quality-ai.py` を新規追加、`score-project-quality.py` の差分を取り込み
3. `package.json` に `score-quality-ai` / `score-quality-ai-2025` を追記、`.gitignore` に `data/cache/` 追加
4. API 3ルートを**マージ**（§2-2 の方針: 新軸型＋`.gz` フォールバックのみ。marumie 改良は保持）
5. `app/quality/page.tsx` を rs-vis 再設計版に更新（型整合を確認）
6. スコアJSON（2024/2025）を §3-1 の方針で反映（必要なら `.gz` 生成）
7. `docs/quality-scoring-guide.md` を改訂
8. 品質チェック: `npm run lint` ／ `npx tsc --noEmit` ／ `npm run dev` で `/quality` 動作確認（新4軸列・詳細ダイアログ・分布軸切替）
9. （任意）rs-vis の設計ドキュメントを `docs/tasks/` に参照コピー

---

## 5. リスク・留意点

- **最大リスク**: API ルートの単純上書きによる PR #231（DoS ハードニング・AIフレンドリー化）のデグレ。§2-2 のマージを厳守。
- `aiSource` の表記ゆれ（`gemini:` vs `openrouter:`）を統一する。
- スコアJSON再生成には生CSV不要（既存 recipients JSON のみで AI 再評価可能）。ただし本番品質には `OPENROUTER_API_KEY` が必要。未設定時は heuristic で完走するが値は本番と異なる。
- 軸E（有効性）は**実測成果ではなく「成果設計の明確さ（意図ベース）」**。UI 注記「※実測成果ではない」も合わせて移植する。
- 軸D（構造）は**総合不算入の参考表示**。UI/集計ロジックがこの扱いを反映しているか確認。

---

## 6. 実施結果（2026-06-19）

§3 の論点はユーザー判断で次のとおり確定し、§4 を実装・検証済み（PR/push は未実施・指示待ち）。

- 3-1 スコアJSON: **(a) rs-vis 成果物をそのままコピー**（即一致を優先）
- 3-2 `.gz` 方針: **`.gz` 化して Git 管理**（raw JSON は `git rm --cached` で追跡解除し、`.gitignore`/`decompress-data.sh`/`compress-data` を更新）
- 3-3 `data/cache/`: `/data/` が既に gitignore 済みのため追加不要

検証: `npx tsc --noEmit` パス、`npm run lint` エラーなし（ported page の既存warningのみ）、`npm run dev` で `/quality` と `/api/quality-scores`・`/recipients`・`/project-details` がいずれも 200。`.gz`→`.json` の prebuild 展開ラウンドトリップも確認。

### ⚠️ 既知の不整合（別タスク化・今回は是正しない）

rs-vis の **2024年度スコア成果物は世代が古い**ことを取り込み時に確認:

| | 2024 | 2025 |
|---|------|------|
| `aiSource` | 全件 `heuristic`（実AI未使用） | 全件 `openrouter:google/gemini-3.5-flash`（実LLM） |
| `effectiveLevel` スケール | 旧 **0〜3**（level3→100点） | 新 **0〜10**（level6→60点） |

UI は `レベル: {effectiveLevel}/10` 表記のため、2024 は「レベル: 3/10 → 100点」のような矛盾表示になる。これは rs-vis 側の既知の宿題（rs-vis 設計ドキュメント §8「2024年度は別途再実行が必要」）。

**ユーザー決定: rs-vis との完全一致を優先し、このまま取り込む。2024 の再生成（`npm run score-quality-ai` で 0-10 スケール化、実LLM品質には `OPENROUTER_API_KEY` 必要、生CSV不要で既存 recipients JSON から再評価可）は別タスクに切り出す。**

---

## 7. 次アクション

- 2024年度スコアの再生成（0-10スケール化・実LLM）を別タスクとして起票。
- ready for review / PR 作成はユーザー指示待ち。
