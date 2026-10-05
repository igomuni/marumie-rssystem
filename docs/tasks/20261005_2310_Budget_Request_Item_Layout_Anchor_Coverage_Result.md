# 項の物理 anchor 拡張による MOF 名称 exact coverage — Result

Written for: 本研究チェーンの次フェーズ判断者。

## 結論

**source 由来の内閣府 `0.pdf` の項 anchor を追加した結果、MOF 名称 only exact coverage は 661 / 784 → 717 / 784（+56）に増加し、既存 661 項の loss は 0 でした（GO）。**

## before / after

| metric | before | after | delta |
|---|---:|---:|---:|
| MOF total | 784 | 784 | 0 |
| exact-covered MOF rows | 661 | 717 | +56 |
| unmatched MOF rows | 123 | 67 | −56 |
| distinct normalized MOF names covered | 627 | 683 | +56 |
| candidate rows（全体 / 一般会計） | 973 / 710 | 1,038 / 775 | +65 / +65 |

期待値の 53（独立測定）と 714 は hard-code していない。実測は +56 で、直前の独立測定（53）との差 3 は、本実装が名称を行の token から code の右・右罫線の左で連結しているため、長い名称（「…特別会計へ繰入」等）を含めて取れたことによる（内閣府 0.pdf の candidate 65 行は一致）。

## profile（source から導出。MOF・名称の意味・filename は不使用）

- 対象: `data/download/cao.go.jp/yosan/soshiki/r06/pdf/0.pdf`（SHA-256 `31590908…23b33`）。導出手順は protocol §4: 「組織計」marker（11 page: 5・7・9・…・25）の後の最初の plain 3 桁 row を組織、以降を項、request-shaped を事項とし、縦罫線との deltaX の cluster を求める。
- ruleX = 50.04。組織 12.078（11 行）、項 15.529（15.527〜15.536、65 行、spread 0.009）、事項 18.980（99 行）。tolerance = 隣接 level 間隔の半分 = 1.726（source から導出。MOF・coverage で調整していない）。
- 項 candidate 65 行（全件名称非空、全件が項 cluster 内、組織・事項は 0、duplicate 0）。直前の独立測定（65 行）を再現。

## regression

lost exact MOF row 0／既存 8.6pt candidate の消失 0／既存 candidate の名称変更 0／unrelated PDF の candidate 変化 0（変化したのは `0.pdf` のみ）。

## 内閣府・残余 unmatched

内閣府の未一致: 66 → `0.pdf` で新規 exact 56 → 残 10。残 10（所管を見ただけで PDF は割り当てていない。item 単位の source evidence が無いため `unresolved_pdf_assignment`）: 内閣本府 4（物価高騰対応地方創生推進費・原子力災害対策費・孤独・孤立対策推進費・地方創生地域産業基盤整備事業推進費）、金融庁 2、こども家庭庁 1、沖縄総合事務局 1、消費者庁 1、日本学術会議 1。
after の未一致 67 の所管別: 法務省 35・内閣府 10・文部科学省 8・財務省 3・国土交通省 3・厚生労働省 3・環境省 1・防衛省 1・農林水産省 1・経済産業省 1・外務省 1。

## 文科省 `施設整備費` 系（今回は変更していない）

文科省の未一致 8 項（`_03.pdf` の source 照合）: full MOF name が単一 token に literal で存在 0／隣接 token をつなぐと存在（source 上で分割）3（国立美術館施設整備費・日本芸術文化振興会施設整備費・科学技術・学術政策推進費）／full name が存在しない（`SOURCE_FULL_NAME_ABSENT`）5（防災科研・国立青少年教育振興機構・原子力機構・教職員支援機構・スポーツ振興センター）。MOF artifact の金額（診断列のみ）では、`SOURCE_FULL_NAME_ABSENT` の 5 項はいずれも令和 6 年度の金額が 0 で前年の金額がある（教職員支援機構は令和 6 年度要求額 0・前年 184,592,000 円）が、これと「概算要求 PDF に項が無い」ことの因果は確定していない（仮説のまま）。名称連結 rule は実装していない。

## 主張してよいこと

PDF / layout ごとに source evidence で確認した項 anchor を使うことで、固定 8.6pt band では落ちていた項を追加回収できた。まだ主張しない: 全 PDF の項 anchor を自動推定できる、すべての項を取得できる、MOF が PDF の GT である、文科省施設整備費が「予算 0 だから存在しない」、drawing-path PDF を解決した。

## artifact / validation

`tests/fixtures/budget-request-item-layout-anchor/2024/`: `baseline.json`・`after-evaluation.json`（gate・before / after・regression・unmatched inventory）・`profile-candidates.jsonl.gz`（65 行、rawRowText・ruleX・codeX・deltaX・profile provenance 付き）・`new-exact-matches.jsonl.gz`（新規 exact の全件）。tsc・lint・全 vitest・deterministic 再実行（baseline / after とも byte 一致）・production code と `data/download/` の変更なし。
