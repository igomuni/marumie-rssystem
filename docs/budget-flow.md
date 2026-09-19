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
