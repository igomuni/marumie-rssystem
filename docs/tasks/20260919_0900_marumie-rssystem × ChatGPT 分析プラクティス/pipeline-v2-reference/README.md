# Pipeline V2 Reference Implementation

`marumie-rssystem` のローカル実装と独立に比較できるように作った **Python標準ライブラリのみの参照パイプライン**です。

TypeScript版と同じコードを共有すると同じバグを再現する可能性があるため、ダブルチェック用途として意図的に別実装にしています。

## 入力

`--raw-root` の直下に次の2ディレクトリがあることを前提にします。

```text
<raw-root>/
├── mof.go.jp/
│   ├── archive/
│   │   ├── 2024/2024/csv/...
│   │   ├── 2025/2025_teishutsu/csv/...
│   │   └── 2025/2025/csv/...
│   └── account/fy2024/kessan_06_zenntaibann.pdf
└── rssystem.go.jp/
    ├── download-csv/2024/...
    ├── download-csv/2025/...
    └── sheets/...
```

今回アップロードされた `mof.go.jp.zip` / `rssystem.go.jp.zip` の構造をそのまま基準にしています。

## 実行

```bash
python3 run_pipeline.py \
  --raw-root data/download \
  --output-root data/pipeline-v2-reference \
  --fiscal-years 2024 2025 \
  --review-years 2024 2025
```

追加パッケージは不要です。

独立チェック:

```bash
python3 independent_check.py \
  --raw-root data/download \
  --report data/pipeline-v2-reference/validation/report.json
```

## 出力レイヤー

```text
<output-root>/
├── source-manifest.json
├── normalized/
│   ├── mof/fy2024/budget-items.jsonl
│   ├── mof/fy2025/budget-items.jsonl
│   └── rs/
│       ├── review-2024/
│       │   ├── projects.jsonl
│       │   ├── budget-summary.jsonl
│       │   └── budget-items.jsonl
│       └── review-2025/...
├── derived/
│   ├── mof/fy*/budget-events.jsonl
│   ├── mof/fy*/identity-relations.jsonl
│   ├── rs/review-*/budget-events.jsonl
│   └── links/mof-rs-review-*-fy*.jsonl
└── validation/
    ├── report.json
    └── report.md
```

## MOFの扱い

### 当初予算

- `archive/YYYY/YYYY/csv/DLYYYY11/12/13...` → `budgetStatus=enacted`
- `archive/YYYY/YYYY_teishutsu/csv/...` → `budgetStatus=submitted`

令和7年度のように提出版と成立版の両方が存在する場合、同一の項・目を比較して差額を `parliamentary_amendment` event として生成します。

### 補正

`21xxx` / `22xxx` を補正として扱い、以下を別々に保持します。

- 成立予算額
- 補正追加額
- 補正修正減少額
- 補正差引額
- 改予算額

Budget Event の金額は **補正差引額（signed delta）** とし、改予算額を二重加算しません。

### 決算

`76xxx` / `77xxx` / `78xxx` を決算として扱います。

一般会計では次式を検算します。

```text
歳出予算額
+ 前年度繰越額
+ 予備費使用額
+ 流用等増△減額
+ 予算決定後移替増△減額
= 歳出予算現額
```

```text
歳出予算現額
= 支出済歳出額
+ 翌年度繰越額
+ 不用額
```

特別会計・政府関係機関では原本に存在する `予算総則の規定による経費増額` も式へ入れます。

## RSの時間軸

RSは `reviewYear` と `fiscalYear` を分離します。

例えば review 2024 の `2-2` には複数の予算年度が存在します。`翌年度要求額` は `requestFiscalYear = fiscalYear + 1` として別イベント化します。

したがって `RS 2024 = FY2024` という前提は置きません。

## MOF項コードの重要な扱い

参照実装では `項コード` 単独を項identityにしません。

実データ上、東日本大震災復興特別会計で同一scope・同一項コードに複数の項名が存在します。

例:

- 項コード `01`: `復興債費` / `復興庁共通費`
- 項コード `02`: `東日本大震災復興支援対策費` / `復興加速化・福島再生予備費`

そのため、V2の `sectionNaturalKey` には項名も含めています。

比較用として `legacySectionKey`（項名を含めないコード中心キー）も保持します。

## PDFの扱い

`mof.go.jp/account/fy2024/kessan_06_zenntaibann.pdf` は `source-manifest.json` に原本として登録・hash化します。

この参照実装では **PDF本文の自動パースはまだ行いません**。構造化CSV/XMLを主データとし、PDFは移替・予備費・繰越等の証拠/検算ソースとして後から追加できる位置付けです。

## MOF ↔ RS link

`derived/links` は完全一致名のみの診断用リンクです。

- 一般会計: 所管 / 組織 / 項 / 目
- 特別会計: 所管 / 会計 / 勘定 / 項 / 目
- 当初予算および第N次補正を対象

これは最終canonical identityではありません。移替・繰越・行政移管・名称変更の推論は行っていません。

## この参照実装の目的

このコードをそのまま本番に採用することよりも、ローカルのTypeScript Pipeline V2と以下を比較することを想定しています。

- source inventory / SHA-256
- MOF raw row count
- 項数（source-preserving / legacy code-centric）
- 決算式の一致数
- 提出版→成立版の差分イベント
- RS reviewYear / fiscalYear の分布
- MOF↔RS exact link件数・金額

差分が出たら、どちらかへ合わせる前に **なぜ差が出るかを確認する** 用途です。
