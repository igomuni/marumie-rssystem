# API Guide

全 API エンドポイントの仕様。

## 共通規約

- 全金額は **1円単位**（`metadata.unit: "JPY"`）
- 全応答に `metadata.notes`（データ留意事項）を同梱
- `year` パラメータ: `"2024"`（デフォルト）または `"2025"`。対象外は 400
- 関連リンク（`links.*`）は相対URLで返す（ホスト非依存）

---

## GET /api/sankey/query

> **ローカル実験フェーズ**: Vercel 上（`VERCEL=1` 環境）では機能・理由を明かさない素の 404 を返す（環境変数 `SANKEY_QUERY_API_ENABLED=1` で明示的に有効化した場合を除く）。`npm run dev` のローカル環境では常に利用できる。

`/sankey-svg` のフィルタ条件を構造化クエリ（`SankeyQuery`）として受け取り、フィルタ適用後のサマリ（と必要なら Sankey データ本体）を返す。**AIエージェントがフィルタ条件を組み立て → 結果を検証 → `links.webView` を人間に提示する**自律ループの中核API。ページ側とフィルタロジック・グラフデータを共有しており、`links.webView` を開くと同一条件のサンキー図が表示される。

### クエリパラメータ

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `q` | string(JSON) | — | `SankeyQuery` のJSON（URLエンコード）。**推奨形式** |
| `detail` | string | `"summary"` | `"summary"` = 件数・金額のみ / `"full"` = TopN集約後の nodes/edges も返す |
| `year` | string | `"2024"` | `q.year` 未指定時の年度 |
| （短縮形） | — | — | `q` の代わりに `/sankey-svg` と同じ短縮URLパラメータ（後述の対応表）も受理 |

### SankeyQuery スキーマ（型定義: `types/sankey-query.ts`）

```json
{
  "year": "2024",
  "filter": {
    "projectName": { "query": "再エネ|再生可能エネルギー", "regex": true },
    "recipientName": { "query": "電力", "regex": false },
    "ministries": ["経済産業省", "環境省"],
    "budget": { "min": 1000000000, "max": null },
    "spending": { "min": null, "max": null },
    "accountCategories": ["general", "special", "both", "none"]
  },
  "view": {
    "topMinistry": 37, "topProject": 50, "topRecipient": 50,
    "pin": { "projectId": null, "recipientId": null, "ministryName": null },
    "focusRelated": false,
    "offset": { "target": "project", "recipient": 0, "project": 0 },
    "projectSortBy": "budget",
    "showAggProject": true, "showAggRecipient": true,
    "scaleBudgetToVisible": true
  }
}
```

- 全フィールド optional。省略時は `/sankey-svg` の初期表示と同じ既定値
- `filter` = どのノードを残すか（条件は AND 結合）。`view` = どう見せるか（TopN集約・ピン等）。通常は `filter` だけ指定すれば足りる
- 金額は1円単位。名前フィルタの `regex: false` は大文字小文字無視の部分一致、`regex: true` は正規表現（フラグ `i`、128文字以内）
- `ministries` は府省庁名の完全一致リスト
- `accountCategories`: `general`（一般会計）/ `special`（特別会計）/ `both` / `none`（区分情報なし）。省略 or 全4種 = フィルタなし
- 上限: `topMinistry` ≤ 37、`topProject` / `topRecipient` ≤ 300

### レスポンス

```json
{
  "metadata": {
    "year": 2024, "unit": "JPY", "notes": ["..."],
    "appliedQuery": { "（既定値補完後の SankeyQuery。省略時の解釈を確認できる）": "..." },
    "detail": "summary", "filterActive": true
  },
  "summary": {
    "projects": {
      "count": 15,
      "budgetTotal": 224800000000,
      "spendingTotal": 85900000000,
      "top": [{ "id": "project-spending-706", "projectId": 706, "name": "...", "ministry": "...", "budget": 0, "spending": 0 }]
    },
    "recipients": {
      "count": 65,
      "top": [{ "id": "r-...", "name": "...", "inflow": 0 }],
      "topShare1": 0.42, "topShare3": 0.71
    },
    "ministries": { "count": 2, "names": ["環境省", "経済産業省"] }
  },
  "sankey": { "（detail=full のみ）nodes/edges/totalProjectCount/totalRecipientCount": "..." },
  "links": {
    "webView": "/sankey-svg?yr=2024&fp=1&fnp=...&fnpr=1&fmb=10億",
    "docs": "..."
  }
}
```

- `summary` はフィルタ適用後の**全マッチ**の集計（TopN集約前）。`top` は各10件
- `summary.recipients.topShare1` / `topShare3` = 上位1件・上位3件の受領額シェア（0〜1、小数4桁）。集中度の一次スクリーニング用。「その他の支出先」（表示件数制限からの集計ノード）は除外するが、支出先名「その他」（実データ）は1支出先として含む。分母が0の場合は `null`
- `summary.projects.spendingTotal` は「残存事業 → 残存支出先」エッジの合計。支出先フィルタ使用時は事業の総支出より小さくなる
- `detail=full` の `sankey.nodes/edges` は TopN 集約後（= 図に描画される内容そのもの）
- 不正なクエリ（正規表現エラー・min>max・未知の会計区分等）は 400 で `details: string[]` に修正方法を返す

### AIエージェントの利用手順

1. 要求を `SankeyQuery` に翻訳し `detail=summary` で実行
2. `summary` の件数・金額で絞り込み過不足を判断し、条件を調整して再実行（0件 → 条件を緩める。語彙探索には `/api/search/projects` / `/api/search/recipients` を併用）
3. 確定したら `links.webView` の URL をユーザーに提示する

### 年度間比較（`compareYears`）

`compareYears=基準年,比較年`（例: `compareYears=2024,2025`）を指定すると、同一フィルタ条件を2年度に適用した summary と差分を1応答で返す。手動での2回引き・突き合わせによる誤りを避けるため、差分計算は API 側で行う。指定時は通常の `summary` / `sankey` 応答の代わりに `years` / `diff` を返す（`detail` は無視される）。

- 対応年度は2つとも `"2024"` / `"2025"` のいずれかで、かつ異なる年度であること。違反時は 400
- `filter` / `view` は両年度に同一条件をそのまま適用する（年度別の調整はしない）
- **年度ズレの罠**: `compareYears=2024,2025` は「事業年度2024 vs 2025」の比較だが、事業年度Nのデータは予算年度N-1の執行実績なので、実質は**予算年度2023 vs 2024** の執行実績比較になる（`metadata.notes` に同注記あり）

```json
{
  "metadata": {
    "year": 2024, "compareYear": 2025, "unit": "JPY", "notes": ["..."],
    "appliedQuery": { "（既定値補完後の SankeyQuery）": "..." },
    "filterActive": true
  },
  "years": {
    "2024": { "（summarizeFilteredGraph と同一形式）": "..." },
    "2025": { "（同上）": "..." }
  },
  "diff": {
    "projects": {
      "increased": [{ "projectId": 20079, "name": "国税総合管理(KSK)システム(...)", "ministry": "デジタル庁",
        "budgetBase": 0, "budgetCompare": 0, "budgetDiff": 0, "budgetDiffRate": null,
        "spendingBase": 43229620000, "spendingCompare": 65268016244, "spendingDiff": 22038396244, "spendingDiffRate": 0.5098 }],
      "decreased": [{ "（同じ形式。spendingDiff の小さい順）": "..." }],
      "added": [{ "projectId": 21095, "name": "...", "ministry": "デジタル庁", "budget": 0, "spending": 0 }],
      "removed": [{ "（added と同形式。base 年度のみ存在）": "..." }]
    },
    "recipients": {
      "increased": [{ "id": "r-...", "name": "...", "inflowBase": 0, "inflowCompare": 0, "diff": 0, "diffRate": null }],
      "decreased": [ "（同上）" ],
      "added": [{ "id": "r-...", "name": "...", "inflow": 0 }],
      "removed": [ "（added と同形式）" ]
    }
  }
}
```

- `diff.projects` は projectId でマッチングし、`increased` / `decreased` は **`spendingDiff`（残存支出先への実支出の差分）** でランキングする。`budgetDiff`（project-budgetノードの予算額差）も同梱するが、デジタル庁一括計上等で事業単体の予算が0円のまま執行額だけ変動するケースがあるため（例の KSK システム）、budgetDiff だけでは実態を見誤る
- `diff.recipients` は支出先ノードIDでマッチングし、受領額（inflow）の差分でランキングする。「その他の支出先」等の集計ノードは除外される
- `added` / `removed` は片年度のみ存在するエントリ（存在した年度の金額降順、各最大10件）
- `diffRate` は基準年度（1つ目）の値が0の場合 `null`（0除算回避）
- 使用例: `GET /api/sankey/query?fnp=国税総合管理&compareYears=2024,2025` — 国税総合管理(KSK)システムの支出増減を年度間で比較

### /sankey-svg URLパラメータ対応表（短縮形）

`links.webView` が使用する。短縮形パラメータでこのAPIを直接呼ぶこともできる。

| 短縮キー | SankeyQuery フィールド | 備考 |
|---------|----------------------|------|
| `fnp` / `fnpr` | `filter.projectName.query` / `.regex` | `fnpr=1` で正規表現 |
| `fnr` / `fnrr` | `filter.recipientName.query` / `.regex` | 同上 |
| `fm`（複数可） | `filter.ministries[]` | 府省庁名 |
| `fmb` / `fxb` | `filter.budget.min` / `.max` | 金額テキスト（`10億`, `1兆` 等） |
| `fms` / `fxs` | `filter.spending.min` / `.max` | 同上 |
| `ac` | `filter.accountCategories` | `g`/`s`/`b`/`n` の連結（例: `ac=g`） |
| `tm` / `tp` / `tr` | `view.topMinistry` / `topProject` / `topRecipient` | |
| `pp` / `pr` / `pm` | `view.pin.projectId` / `recipientId` / `ministryName` | `pp` はノードID形式（`project-spending-<pid>`）、`pr` は `r-<支出先名>` |
| `fr` | `view.focusRelated` | `1` でON |
| `ro` / `po` / `ot` | `view.offset.recipient` / `.project` / `.target` | `ot=r` or `p` |
| `ps` | `view.projectSortBy` | `s` = spending |
| `ar` / `ap` / `sb` | `view.showAggRecipient` / `showAggProject` / `scaleBudgetToVisible` | `0` でOFF |
| `yr` | `year` | |
| `fp` | —（フィルタパネル表示） | webView では常に `1` |

### 実装（レイヤー）

- Domain: `app/lib/sankey-query.ts`（クエリ正規化・除外集合構築・サマリ・年度間比較差分（`compareYearsSummary`）・URL変換。`/sankey-svg` ページと共有）
- Loader: `app/lib/api/sankey-graph-loader.ts`（`sankey-svg-{year}-graph.json` のメモリキャッシュ）
- TopN集約: `app/lib/sankey-svg-filter.ts` の `filterTopN`（ページと同一関数）

---

## GET /api/search/projects

事業名の部分一致検索。`scope=details` で事業詳細テキスト（目的・概要・現状課題）も対象に含められる。名前が抽象的な事業や、計上先の府省庁が実態と異なる事業（例: 国税システム群がデジタル庁に一括計上）を掘り起こす入口。

**クエリパラメータ**: `q`（必須）、`year`、`limit`（デフォルト20・上限100）、`offset`、`sort`（`budget` | `spending`）、`scope`（`name`（既定）| `details`。不正値は400）

**レスポンス**: `items[]`（pid・事業名・府省庁・予算/執行額・再委託有無・`matchedIn`）+ 各itemに `links`（`detail` / `subcontracts` / `sankeyView` 等）、`links.next` でページネーション。`matchedIn` は `'name' | 'details'`（`scope=details` 時のみ意味を持つ。事業名にもマッチした場合は `'name'` を優先）。

---

## GET /api/search/recipients

支出先名の検索（recipient-index の正規化キーに対して）。

**クエリパラメータ**: `q`（必須）、`year`、`limit`（デフォルト20・上限100）

**レスポンス**: `items[]`（key・支出先名・法人番号・直接/再委託受注の件数と金額・事業数）+ 各itemに `links.recipient` / `links.sankeyView`。

---

## GET /api/search/spending

支出行の使途テキスト（`role`=事業を行う上での役割、`cc`=契約概要）の横断検索。「広報にいくら使われている？」「システム改修を受注しているのは誰？」のような使途起点の質問に使う。

**クエリパラメータ**: `q`（必須・2文字以上、未満は400）、`year`、`limit`（デフォルト20・上限100）、`offset`

**レスポンス**:

- `aggregate`（マッチ全体の集計。ページングに依存しない）: `hitCount`・`projectCount`・`amountDirect`（直接支出=d0の合計）・`amountSubcontract`（再委託=d>0の合計）・`topProjects`（事業別合計の上位10件、pid・事業名・府省庁・金額）
- `items[]`（ページング対象のマッチ行）: pid・事業名・支出先名・法人番号・金額・`depth`（委託深度）・`matchedIn`（`'role' | 'cc'`、両方マッチは role 優先）・`excerpt`（マッチ位置の前後を含む約120字の抜粋）・`links`
- `amountDirect` と `amountSubcontract` の単純合算は資金の通過分の二重計上になるため、常に分離して扱うこと（`metadata.notes` に明記）
- 検索対象は role / cc のみ（`chain` は経路情報でノイズが多いため対象外）

---

## GET /api/highlights

過去のレポートが人力で見つけた「発見の型」を6指標として全事業を機械スキャンし、観測可能な「注目シグナル」を列挙する（WP4-1）。**「異常」「無駄」の判定ではない**。設計の正典: `docs/tasks/20260710_2052_highlights異常度指標API設計.md`。

**クエリパラメータ**: `year`（既定2024）、`metric`（省略時は全指標。指定時は次のいずれか1つに絞り込み。不正値は400）

| metric | 観測している事実 | 母集団の下限 |
|--------|----------------|-------------|
| `spendingChange` | 前年からの支出の急増・急減、新規/消滅（`compareYearsSummary` をフィルタなしで適用） | なし |
| `otherRatio` | 支出先「その他」（実データ）への流入比率 | 支出額（`spendTotal`）10億円以上 |
| `concentration` | 支出先上位1社シェア | 同上 |
| `lowScoreHighBudget` | 品質スコア下位25%かつ予算額の大きい順 | budgetAmount > 0 |
| `execBudgetGap` | \|執行額/予算額 − 1\| の大きい順 | budgetAmount > 0 |
| `subcontractDepth` | 再委託の深さ（`redelegationDepth`）の大きい順 | 支出額10億円以上 |

**レスポンス**:

- `metrics.{metric名}`: 各上位10件（`metric` 指定時はそのキーのみ）。エントリには pid・事業名・府省庁・指標の根拠数値（例: `otherRatio` なら `otherAmount`/`spendTotal`/`otherRatio`）と `links`（`projectLinks` 相当）を含む。`spendingChange` のみ `increased`/`decreased`/`added`/`removed` の4リスト構造（`priorYear` が対応年度なしなら `null` + 各リスト空）
- `multiSignal`: 2指標以上に同時該当した事業（該当指標名 `signals[]` 付き、上位10件、`links.sankeyView` も付与）
- `metadata`: `minSpendYen`（母集団下限、1,000,000,000円固定）・`population`（otherRatio/concentration/subcontractDepthの実母集団数）・`lowScoreThreshold`（lowScoreHighBudget の下位25%閾値として使った totalScore）
- `metadata.notes` に語彙の規律（シグナル列挙であって判定ではない・品質スコアの意味・年度ズレ・「その他」の意味）を明記

**実装（レイヤー）**:

- Domain: `app/lib/highlights.ts`（`computeHighlights`。入力は graph 1〜2年度分・品質スコア items。Pure）
- Loader: `app/lib/api/highlights-loader.ts`（年度別メモリキャッシュ。パイプライン新設なし、既存の `loadSankeyGraph`/`loadQualityScores` を in-process で使う）
- AI: `app/lib/ai/sankey-chat-agent.ts` の `get_highlights` ツール（「無駄遣いっぽい」型の質問に使う。metric省略時はダイジェスト）

---

## GET /api/recipients/[key]

支出先の逆引き詳細（府省庁横断の受注構造）。

**パスパラメータ**: `key` = 法人番号13桁 または `name:正規化名`

**クエリパラメータ**: `year`、`limit`（appearances の件数。デフォルト50・上限200）

**レスポンス**: `recipient`（name・corporateNumber・aliases・totals・byMinistry・appearances[]）。存在しないキーは 404 + 検索APIへの hint。直接受注と再委託受注の合算は二重計上になるため常に分離して扱うこと。

---

## GET /api/sankey/mof-overview

財務省（MOF）予算全体ビュー用の Sankey データを返す。

**クエリパラメータ**: なし

**データソース**: `public/data/mof-budget-overview-2023.json`（サーバープロセス内にタイムベースキャッシュ、TTL=1時間）

---

## GET /api/quality-scores

事業別品質スコア一覧を返す。

**クエリパラメータ**:

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `year` | string | `"2024"` | 対象年度（`"2024"` または `"2025"`） |
| `pids` | string | — | 予算事業IDのカンマ区切り（最大300件）。指定時は該当事業のみの軽量プロジェクションを返す |

**レスポンス**:

- `pids` 未指定: `QualityScoresResponse`（全事業の `items` と `summary`。約7MB、`/quality` ページ用）
- `pids` 指定: `{ metadata, items }`。`items` は軽量プロジェクション（`pid`/`name`/`ministry`/`totalScore`/AI軸5種/`effectiveLevel`/`effectiveReason`/`aiSource` + `links`）。`metadata.missingPids` に見つからなかったIDを返す。エージェントが数事業のスコアを数KBで取得する用途

**注意**: 品質スコアは報告の**形式品質**（特定可能性・説明性・成果設計の明確さ）を測るもので、資金経路の透明性そのものではない（`metadata.notes` に同梱）。

**データソース**: `public/data/project-quality-scores-{year}.json`

---

## GET /api/quality-scores/[pid]

単一事業の品質スコア（軽量プロジェクション）を返す。サイドパネル表示・エージェント探索用。

**パスパラメータ**: `pid`（予算事業ID）

**クエリパラメータ**: `year`（`"2024"` | `"2025"`、デフォルト `"2024"`）

**レスポンス**: `{ metadata, score, links }`。`score` は上記軽量プロジェクションと同形。存在しない pid は 404 + 検索APIへの hint。

---

## GET /api/quality-scores/recipients

事業の支出先明細（品質詳細ダイアログ用）を返す。

**クエリパラメータ**:

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `pid` | string | **必須** | 予算事業ID |
| `year` | string | `"2024"` | 対象年度 |

**データソース**: `public/data/project-quality-recipients-{year}.json`

**レスポンス**: `RecipientRow[]`（支出先行ごとの品質情報）

フィールド名は短縮形（JSONサイズ削減）:

| フィールド | 意味 |
|-----------|------|
| `n` | 支出先名 |
| `b` | 支出先ブロック番号 |
| `s` | 判定ステータス（`valid`/`gov`/`supp`/`invalid`/`unknown`） |
| `c` | 法人番号記入あり |
| `o` | 不透明キーワードにマッチ |
| `a2` | 個別支出額（null=空欄） |
| `r` | ルートブロック（直接支出）か |
| `chain` | ブロック委託チェーン（例: `"組織→A→B"`） |
| `d` | 委託深度 |
| `role` | 事業を行う上での役割 |
| `cc` | 契約概要 |

---

## GET /api/project-details/[projectId]

事業詳細情報（事業概要・実施方法等）を返す。

**パスパラメータ**: `projectId`（予算事業ID）

**クエリパラメータ**:

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `year` | string | `"2024"` | 対象年度（`"2024"` または `"2025"`） |

**データソース**: `public/data/rs{year}-project-details.json`

---

## GET /api/subcontracts/[projectId]

再委託構造データを返す。

**パスパラメータ**: `projectId`（予算事業ID）

**クエリパラメータ**:

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `year` | string | `"2024"` | 対象年度（`"2024"` または `"2025"`） |

**データソース**: `public/data/subcontracts-{year}.json`

**レスポンス**: `SubcontractGraph`（ブロックノード・エッジ・支出先情報）
