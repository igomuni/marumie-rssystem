# Budget Flow 最小実装

`/budget-flow` は独立参照ZIPの実データを読む新しいページ。既存V1・ローカルTypeScript V2のパイプライン、生成物、Integrated画面は変更しない。

## 入力と再生成

```sh
python3 scripts/generate-budget-flow.py
# パスを変える場合
python3 scripts/generate-budget-flow.py --archive /path/to/pipeline-v2-full-output.zip
```

入力は `data/pipeline-v2-full-output.zip` と `public/data/mof-budget-{2024,2025}.json.gz`。ZIPを展開せず読み込む。通常のbuildから生成処理を呼ばず、既存データの再生成や上書きもしない。成果物は専用の `public/budget-flow-v2/` のみ。年度別索引とID先頭文字別16分割の詳細をgzipで保存し、ブラウザは選択項の分割ファイルだけを取得する。圧縮データ約5.6MBはGit管理に含める。追加API・外部通信・追加パッケージは不要。ブラウザはDecompressionStream対応が必要。

ZIPのreference schemaはローカル `scripts/pipeline-v2/types.ts` のschemaとは異なる。相互に上書き・混用せず、ページ用adapterで変換する。

## 意味の保持

- Budget Entityは予算年度＋会計種別・所管・組織・特別会計・勘定・機関・項コード・項名の完全一致。年度をまたいで同一としない。IDはこの組から生成する。項コード単独でまとめない。
- raw record ID・raw item/section natural keyとページ用canonical IDを別に保持。code_changed関係を表示するが、別項の自動統合に使わない。
- Budget Eventは元のevent IDを保持し、種別・提出/成立・補正次数ごとに項内で集計。0円行も保持。状態額と増減額を別々に表示し、タイムライン全体を合計しない。
- MOF sourceYearはこのアーカイブのソース年度。RSはreviewYearをsourceYearに対応づけ、リンクのfiscalYearを別に保持する。異なるsourceYearのRSリンクや金額を合算しない。
- provenanceはraw record ID・原典ZIPパス・ZIP内CSV名・行番号・manifestのSHA-256。原典本体を配信・PDF本文パースはしない。
- 日付がないためタイムラインは予算段階の順序。実施日時や実際の資金移動順序とは主張しない。
- 移替は決算CSVの純増減のみ。相手先を推定しない。RSリンクは名称完全一致の候補であり同一事業と断定しない。

## V1比較

V1の `mof-budget` 公開物（Integratedと共通のMOF元データから生成）と全識別フィールドで照合。当初成立額同士、決算書歳出予算額同士の比較のみ。補正増減と補正後残高を混同しない。不一致を自動補正しない。照合不能は「未比較」であり0円ではない。

Integratedの `year` はRS提出年度で、MOF年度はその前年。ページからの比較リンクは既存のMOF2024×RS2025を明示して開く。MOF2025対応のIntegratedが存在するとは扱わない。

## 実データの検証値

| fiscalYear | raw records | Budget Events | Entity（全段階の和集合） | 決算式の一致 |
|---|---:|---:|---:|---:|
| 2024 | 19,680 | 94,902 | 1,311 | 1,272 / 1,272 項 |
| 2025 | 19,623 | 19,640 | 1,100 | 決算データなし |

2024年度の当初1,056項・補正999項・決算1,272項を保持。2025年度の提出・成立は別イベント。V1比較は2024年度2,324組（うち差額あり4組）、2025年度1,080組（同2組）。各ページで差額と参照生成物のSHA-256を確認できる。

## 検証方法

```sh
python3 scripts/validate-budget-flow.py
npx vitest run app/budget-flow/model.test.ts
npx tsc --noEmit --incremental false
npx playwright test tests/e2e/budget-flow.spec.ts tests/e2e/integrated-sankey.spec.ts --workers=2
```

生成時に金額の整数精度、原典参照の存在、項ごとの決算式を検査。独立validatorは全event IDと金額が元ZIPに一致すること、原典の行参照、ゼロ行、年度・段階の件数、同一コード異名称の分離、2025年の提出/成立の分離を検査する。UIテストは検索・原典・差分・年度・欠損決算・モバイル・通信失敗からの再読込を検査する。

## RS全事業一覧・双方向接続

上部の「MOF 項 / RS 事業」で切り替える。両視点のフィルター・選択・ペイン幅は切替時も保持する。接続先へ移動する場合は対象側のフィルターを解除して対象年度・項／事業を選択する。既存MOFのイベント・原典・V1比較はそのまま利用できる。既存のMultiSelect、SearchInput（正規表現含む）、PaneLayoutとCSSを再利用し、RS一覧もページ分割せずスクロールする。列ソート・列幅変更にも対応。

### 入力調査とキー

- 現行Budget Flowと同じ `data/pipeline-v2-full-output.zip` を入力とする独立したPRODUCTS adapterを追加。SOURCE、NORMALIZED、DERIVED、V1、既存MOF productを更新しない。
- `normalized/rs/review-{reviewYear}/projects.jsonl` は1-1組織情報の**行**。同じ事業が複数行あり、年度内の `projectId` ごとにまとめる。UIキーは `reviewYear:projectId`。年度間の同一事業は推測しない。
- 2024は8,537行→5,664事業、2025は8,540行→5,794事業。調査時点のローカルTS版 `data/normalized/rs/{year}/projects.json`（1-2由来）ともユニーク事業ID集合は一致した。ローカルTS版と参照ZIPのスキーマは混ぜない。
- `budget-summary.jsonl` の `scopeLevel=project_total` のみを表示。会計別行を合計に加算しない。同一事業・予算年度の重複合計は各項目の非null値の一致を確認し統合する（不一致は生成失敗）。ゼロは値として残し、全nullはnull。原典行参照はすべて保持。重複グループは2024レビュー2組、2025レビュー17組。
- `initialBudgetYen / currentBudgetYen / executionYen` は行の `fiscalYear`、`nextYearRequestYen` は `requestFiscalYear` に対応。要求年度をレビュー年度から推測しない。
- 会計フィルターは `budget-items.jsonl` の年度別 `accountType` を使う。金額のない事業も初期状態では除外しない。金額・会計条件を明示した場合だけ該当するものに絞る。
- 参照ZIPには1-2の目的・概要がないため、事業名・複数組織・年度別予算／執行・原典を表示し、概要を創作しない。

### 接続と年度

`derived/links/mof-rs-review-{reviewYear}-fy{fiscalYear}.jsonl` の `projectIds` を反転し、`mofRecordIds` から既存MOFと同じ年度・完全識別キーによるEntity IDに接続する。リンクID・phase・revision・matchMethod・RS/MOFレコードIDを保持。複数項や複数事業にまたがるリンクの金額を事業単位の配分額として表示しない。

左側でレビュー年度と表示金額／接続の予算年度を別に選ぶ。レビュー年度の全事業が母集団であり、予算年度変更だけでは事業を除外しない。MOF照合対象外の年度には「照合データなし」と表示する。「接続なし」フィルターはこの状態も含む旨を明示。MOF詳細のIdentity / RSにはレビュー年度別の事業名と遷移ボタン、RS詳細には選択予算年度の項名と逆方向の遷移ボタンを表示する。

| レビュー年度 | 対象MOF予算年度 | 全事業 | 接続あり | 接続なし |
|---|---|---:|---:|---:|
| 2024 | 2024 | 5,664 | 4,673 | 991 |
| 2025 | 2024 | 5,794 | 4,537 | 1,257 |
| 2025 | 2025 | 5,794 | 4,851 | 943 |

2025レビューで対象MOF年度を横断したユニーク接続ありは5,112事業、なし682事業。年度別の接続あり件数は重複があるため足し合わせない。

### 生成と検証

```sh
python3 scripts/generate-budget-flow-rs.py
# 外部の参照ZIPを指定する場合
python3 scripts/generate-budget-flow-rs.py --archive /path/to/pipeline-v2-full-output.zip
python3 -m unittest discover -s scripts -p test_budget_flow_rs.py
# 検証時のZIPも指定可能
BUDGET_FLOW_ARCHIVE=/path/to/pipeline-v2-full-output.zip python3 -m unittest discover -s scripts -p test_budget_flow_rs.py
npx vitest run
npx tsc --noEmit --incremental false
npm run build
npx playwright test tests/e2e/budget-flow.spec.ts tests/e2e/budget-flow-rs.spec.ts tests/e2e/integrated-sankey.spec.ts --workers=2
```

`public/budget-flow-v2/rs/` にレビュー年度別index、IDハッシュ先頭文字による16分割詳細、件数サマリー付きmanifestをgzipで保存（合計約10MB）。indexは約487KB / 583KB。`DecompressionStream('gzip')` を使い、詳細は選択したシャードのみ読む。gzip時刻を固定し、同じ入力からバイト一致で再生成できる。build時に原典の取得・生成はしない。原典ZIPは従来どおりGit管理対象外、配信用gzipはGit管理対象。

生成時に件数サマリーを標準出力し、manifestにも保持。Python検証は全事業の母集団、元の合計金額、全リンク・年度・phase、既存MOF productへの参照を独立照合する。参照ZIPがない環境ではフル照合をskipするため、リリース前にはZIP指定で実行する。
