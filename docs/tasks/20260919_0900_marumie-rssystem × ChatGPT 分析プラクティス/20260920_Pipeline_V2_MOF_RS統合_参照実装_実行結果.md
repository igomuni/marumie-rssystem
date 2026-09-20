# Pipeline V2 MOF + RS 統合参照実装 — 実行結果

実行日: 2026-09-20

## 実施内容

- main の現行 V2 / Budget Flow / public 構成を確認
- 独立 Python 参照実装を MOF + RS + links + publish まで統合
- MOF FY2024/FY2025 normalized/derived を実データから生成
- 既存の RS review-2025 全15 CSV normalized/derived と統合
- RS review-2026 sheets-only product も publish
- `public/data/v2` を256 shard構成で生成
- public cross-reference validation を実行
- stress PID の core bundle を確認

## 主な実データ件数

- MOF FY2024: 19,680 normalized records / 94,902 events / 1,311 public sections
- MOF FY2025: 19,623 normalized records / 19,640 events / 1,100 public sections
- RS review-2025: 5,798 projects
- RS review-2026 sheets-only: 2,579 projects
- link review-2025 × FY2024: 4,914 groups / 4,537 linked projects
- link review-2025 × FY2025: 5,086 groups / 4,851 linked projects

## public/data/v2 実測

- files: 1,546
- total: 47,609,795 bytes = 約45.4 MiB
- maximum single static file: 712,629 bytes
- files > 1 MiB: 0

内訳:

- MOF FY2024+FY2025: 約5.64 MiB
- links: 約0.32 MiB
- RS 2025 index: 約0.68 MiB
- RS 2025 core: 約9.65 MiB
- RS 2025 context: 約17.83 MiB
- RS 2025 spending: 約10.82 MiB
- RS 2026 sheets-only: 約0.46 MiB

## public validation

PASS

- gzip/json parse: PASS
- MOF index → detail shard refs: PASS
- RS index → core shard refs: PASS
- link → MOF section refs: PASS
- link → RS project refs: PASS
- duplicate public entity IDs: none detected
- >1MiB static file warnings: none

## 追加で発見・反映した事項

### FY2025 initial snapshot

submitted と enacted の `initial_budget_state` を eventType だけで集計すると二重計上になる。
public index は次を分離した。

- `initialSubmittedYen`
- `initialEnactedYen`
- `initialYen` = enacted 優先、なければ submitted

### PID:4 / デジタル庁大型予算

FY2024「情報通信技術調達等適正・効率化推進費」:

- initial: 480,327,293,000
- supplement delta: +205,412,304,000
- post-supplement: 685,739,597,000
- settlement budget appropriation: 176,048,747,050
- unresolved pre-settlement delta: **-509,690,849,950**

structured settlement の `transfer_adjustment` 自体は0なので、これを「移替なし」と解釈してはいけない。
public では `unresolvedPreSettlementDeltaYen` / `stageGaps` として明示し、公式 relation evidence が入るまでは transfer と断定しない。

## テスト

- Python unit tests: 6 / 6 PASS
- public full-data validation: PASS

