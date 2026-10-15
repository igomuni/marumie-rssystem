# fixtures と scripts の整理案（参照元なしのもの）

状態: **案（ユーザーの確認待ち）。まだ何も消していない。** 対象は、棚卸し（同日の Inventory Result）で、コード・テスト・docs/*.md・task doc のどこからも言及されない scripts 80 本と、コード・テスト・docs/*.md から参照されない fixtures 5 ディレクトリ。全件は `docs/inventory/repo-artifacts/pruning-proposal.csv`（path・案・理由）。

| 案 | scripts | fixtures | 中身 |
|---|---:|---:|---|
| delete | 60 | 3 | 概算要求の個別実験 45 本（2026-10-03〜10）、MOF XML parser v0 の評価・凍結 generator 5 本、TOC P3〜P6 研究 10 本と対の fixtures 3 つ（約 0.5MB） |
| hold | 4 | 1 | J1 複数×K2 の visual GT／142 行昇格に関わる script 4 本（`assemble-detail-table-window-gt-final.py` ほか）と、#460 の X anchor 検証の証跡 |
| decide | 15 | 0 | 製品側の分析・export（2026-07〜09）。`analyze-*`、`export-*`、`extract-*`、`dev/ai-chat-eval.mjs` など |
| keep | 1 | 1 | `build-mof-jikou-special-csv.ts`（最終 CSV の builder）、`budget-request-inventory`（#468、142 行昇格の入力） |

- delete の根拠は「結果が凍結済みで、再実行する計画が見えない」こと。計画の有無はユーザーが判断する（私は研究計画を持っていない）。
- 削除しても、parser・lib（`scripts/pipeline-v2/lib/`）は触らない。テストは凍結 artifact を読むだけなので、scripts を消してもテストは落ちない見込み（実際の削除前に全テストで確認する）。
- 削除の手順: 案をユーザーが確認 → 該当を `git rm` → `tsc` と全テスト → 他の参照が出たら戻す。履歴から復元できる。
- この 80 本以外の「参照元なし」65 本（task doc だけが言及）と、参照のある scripts／fixtures は、この案の対象外。
