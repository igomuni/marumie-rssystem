# Pipeline V2 フルパイプラインclean実行と再現性検証

MOF publish・standalone links publish・root manifestの実装完了後、`data/normalized`・`data/derived`・`public/data/v2`を削除した状態（`data/download`の生データは保持）から、Raw→Normalize→Derived→Integrated→Validate→Publishを通しで実行し、所要時間・再現性・最終サイズを計測した。ブランチ `feat/pipeline-v2-mof-source-preserving`、コミット`91c9cc4`時点。

## 実行コマンドと所要時間

| ステップ | コマンド | 所要時間 |
|---|---|---:|
| 1. normalize:mof | `tsx normalize-mof.ts 2024 2025` | 0.78s |
| 2. normalize:rs | `tsx normalize-rs.ts 2024 2025 2026` | 34.98s |
| 3. derive:mof | `tsx derive-mof.ts 2024 2025` | 2.23s |
| 4. derive:rs | `tsx derive-rs.ts 2024 2025 2026` | 4.45s |
| 5. derive:integrated | `tsx derive-integrated.ts` | 1.32s |
| 6. validate | `tsx validate-v2.ts` | 2.50s |
| 7. publish | `tsx publish-v2.ts 2024 2025 2026` | 18.60s |
| **合計** | | **約65秒** |

RS Normalizeが全体の過半（15CSV×3年度、review-sheets含む）を占めるが、それでも1分強でフルパイプラインが完走する。CI/デプロイ前提として十分高速。

## 再現性

- 各ステップのレコード件数・golden acceptance数値（MOF↔RS linkage、Funding Graph stress fixture等）は、本セッション内の以前の実行結果と完全一致。
- publish-v2.tsを独立に2回実行し、`rs/review-2025/index.json.gz`・`rs/review-2025/core/00.json.gz`・`mof/fy2024/index.json.gz`・`mof/fy2024/sections/00.json.gz`のSHA-256ハッシュが**完全に一致**（byte-for-byte reproducible）。gzip出力のMTIMEフィールドをゼロ埋めするgzipDeterministic()の効果を実測で確認。
- validate-v2.tsはerror=0（golden acceptance含む）。

## 最終public/data/v2サイズ

root manifest.jsonの`totalPublicBytes`: **87,883,605 bytes（約83.8 MiB）**

| product | 内訳 |
|---|---|
| RS | review-2024/2025がcompleteness=full、review-2026がcompleteness=partial（review-sheets中心） |
| MOF | fy2024: 1311 section・256 shard、fy2025: 1100 section・252 shard |
| links (standalone) | review-2024×fy2024・review-2025×fy2024・review-2025×fy2025の3組 |

## 次のステップ

Pipeline側は Raw → Normalize → Derived → Integrated → Validate → Publish が一本通った。次はBudget Flow UIを`/public/data/v2`へ切り替える作業（旧`public/budget-flow-v2` adapterの撤去含む）。
