# 概算要求PDF label-shaped predicate ambiguity の source-only failure isolation — 結果

protocol: `20261005_1200_Budget_Request_Label_Shaped_Predicate_Ambiguity_Protocol.md`（Commit A `eae6080`、doc SHA-256 `0d1e4bc8…00cd`）。candidate universe の freeze は Commit B `86cc8cf`、comparison / decision は Commit C `c691069`、representative examples と本結果は Commit D。frozen label-shaped predicate・alternative projection rule・current projection・normalization は変更していない。観測のみ。production は無変更。manual contract・MOF・existing ON kind・組織名辞書・human semantic label は使っていない。

**判定: `AMBIGUITY_PARTIALLY_ISOLATED`（規則 3）。** row-local の feature には、P1（projected candidate）と P2（ambiguity-causing additional candidate）を完全に分離（disjoint）するものはなかった。完全に分離したのは projection context の feature（relative position など、first code row を中心とする projection の定義に結び付くもの）だけ。row-local の geometry / lexical feature の多くは total variation distance 0.99 前後と、ほぼ分離している。

## Pre-flight / frozen dependencies
branch `research/budget-request-label-shaped-predicate-ambiguity-isolation`、親 `e6e1b24`、origin/main `38e5080`（chain は未 merge）。frozen 入力（full-corpus manifest・alternative projection の artifact / primary / segment / population・title ordering / header label / alternative projection の実装・protocol）の hash を script が照合。再現確認: evaluable 9,145 page、ambiguous page 1,123、P1 = 2,532（recovered）、P2 = 1,786。working tree は未追跡 `.DS_Store` 2 件のみ。

## A1 — Candidate universe accounting（Q1・Q2）
frozen label-shaped candidate は 9,145 page 中 8,432 page に 14,675 row（1 page あたり 1〜6 row。1 row の page が 4,643、2 row が 2,147）。id は一意で、population の合計は総数に一致し、provenance の欠落は 0（universe は `candidate-universe.json.gz`、内容 SHA-256 `ee0b2580…d35f`）。

| population | rows | pages |
|---|---:|---:|
| P1 projected_same_row | 2,532 | 2,532 |
| P2 ambiguity_additional_after_code | 1,786 | 1,123 |
| P3 nonambiguous_additional_after_code | 534 | 413 |
| P4 before_first_code | 5,572 | 3,695 |
| P5 other | 4,251 | 2,428 |

Q2: ambiguous 1,123 page には、ambiguity-causing additional candidate が 1,786 row 存在する。

## A3 — exact structural separator（Q3・Q4。projection context と row-local を分けて報告）
- projection context（P1 と P2 を完全分離）: `relativePosition`（`same_as_first_code` vs `after_first_code`）・`deltaToFirstCodeBin`・`codeShapedRowBefore`。これは first code row を中心とする projection の定義と構造的に結び付いており、predicate の lexical specificity が十分であることの根拠にはならない（protocol §16）。
- row-local（F2・F3・F4 と candidate 自身の code-shaped / request-shaped）: 完全分離するものは 0。ただし total variation distance ≥ 0.5 のものが 22: `topBin` 0.9992・`maxXBin` 0.9992・`lastTokenXBin` 0.9992・`widthBin` 0.997・`minXBin`・`firstTokenXBin`・`firstTokenOffsetFromAnchorBin` 0.9936・`raw_total` 0.9914・`tokenCountBin` 0.9527・`raw_whitespace` 0.9544・`raw_han` 0.9401・`selfCodeShaped` 0.916・`firstShapeStage` 0.8141 ほか。P1 の大半は上端（normalized top の bin 0.02）・左端（first token x の bin 30、幅の bin 40）・2 token の短い row だが、P1 の少数（topBin 0.08 / 0.14 に各 1 row など）が P2 の分布と値を共有するため完全分離にならない。

## A2 / A6 — geometry（Q6）
P1 は上端帯の最上部（top bin 0.02 が 2,530/2,532）、幅 40pt（bin）、first token x が左端（bin 30）。P2 は top 0.08〜0.18、幅 40〜700pt、first token x・last token x が広く分布（last token x の bin 790 が 1,346 row など）。disjoint ではない（P1 に 2 row の外れ値）が、geometry の差は大きい。thin anchor を使った first token の offset も同様（P1 の bin −20 が 2,529/2,532）。

## A4 — normalization dependency（Q5）
| | rows | digit removal 依存 | shape が最初に成立する段階 |
|---|---:|---:|---|
| P1 | 2,532 | 0 | NFKC 2,532（全角括弧を半角に直す段階） |
| P2 | 1,786 | 1 | raw 1,453・NFKC 332・final 1 |
| P3 | 534 | 5 | raw 371・NFKC 158・final 5 |
| P4 | 5,572 | 2,553 | raw 1,719・NFKC 1,300・final 2,553 |
Q5: digit removal は P2 の成立にほとんど寄与していない（依存は 1/1,786）。P2 の大半（1,453 row）は raw がすでに半角括弧を含む `prefix(inner)` 形（例: `計 44, 084 ( 50, 695 )`）で、332 row は NFKC で全角括弧が半角になって成立する（例: `①１０～７級（全国平均 日帰り）`）。P1 は 0 件が digit removal 依存で、全件が NFKC で成立する。digit removal に依存するのは主に P4（ページ番号を含む通常の before-code label 行）。したがって digit removal は ambiguity の主因ではなく、P1 と P2 で依存の仕方が異なる。

## Q7 — 単一 mechanism か
単一ではない。P2 は少なくとも 3 つの normalization class に分かれる: raw が半角括弧を持つ本文側の行（1,453）、NFKC で成立する全角括弧の行（332）、digit removal で成立する 1 row（request-shaped）。self code-shaped の row が 150、request-shaped が 10 row（他は code でも request でもない）。いずれも最初の code row より後ろ（A3 の context separator）。

## Q8 — 次 phase の根拠
row-local feature の分布差（geometry・lexical・token 数）は強いが、完全分離する row-local feature は見つからなかった。次に predicate refinement を preregister する場合、候補は row-local の geometry / lexical feature（P1 の外れ値の扱いを含む）で、projection context の separator は projection の定義と結び付く点に注意が要る。精度・header label の semantic correctness は主張しない。

## Q9 — unresolved 5 page
`2023_fukkochougaisansaisyutsu.pdf` の 5 page（最初の code row が request 行）は今回の mechanism と独立のまま（参照のみ。救済・second code row の探索・復興庁の例外は行っていない）。

## Representative examples（post-freeze、`id` の辞書順。人間判断は付けない）
P1 の先頭 5 は `cms_caa205_230914_03.pdf` の page 104〜112 の `100 内（消）` 等（row index 0・x 38〜83・top bin 0.02）。P2 の先頭は同 PDF page 106 の `計 44, 084 ( 50, 695 )`（raw で成立）・page 110 の `①１０～７級（全国平均 日帰り）`（NFKC で成立）・page 112 の `前年度限りの経費 0 ( 3, 247 )`。topBin の overlap（0.08・0.14）では、P1 の外れ値に `015 国民健康保険助成費（社 会福祉費）` のような、最初の code row が本文の row になる page がある。これらが「本文」か「header」かは判断していない（`post_hoc_interpretation` も付けていない）。

## Decision
accounting 完全・provenance 欠落 0・既知値再現。row-local に完全分離する feature は無く、projection context の feature が完全分離し、row-local にも TVD ≥ 0.5 の feature がある → `AMBIGUITY_PARTIALLY_ISOLATED`。

## Limitations
bin（個数・top 0.02・x 10pt・幅 20pt・高さ 2pt）は事前に固定した値で、完全分離（disjoint）の判定は bin に依存する。P1 の少数の外れ値のため row-local の完全分離が成立していない（外れ値を除くことは規則に反するため行わない）。human GT はなく、ambiguity-causing candidate を「誤検出」とは呼んでいない。rotate=90 は対象外。

## Next step（候補・開始しない）
predicate refinement の preregistration（row-local の geometry / lexical feature を使う場合は P1 の外れ値の扱いを事前に固定する）→ implementation freeze → frozen evaluation の順で、別研究として行う。production は変更しない。

## Validation / Git
tsc エラー 0・lint エラー 0・vitest 131 files / 1,487 tests pass。universe・comparison・examples の再実行で artifact 不変（universe gz `429ad6c0…b776`・comparison `fd90b142…ccda`・examples `cf54c79f…56d9`）。`scripts/pipeline-v2/lib` は新規ファイルの追加のみ。commit: A `eae6080`、B `86cc8cf`、C `c691069`、D（本結果）。

今回は frozen label-shaped predicate を変更せずに、alternative projection の ambiguity（1,123 page）が predicate の構造差のどこから生じるかを source-only で分解した failure isolation であり、production DocumentHierarchy / FieldResolver / recordKind / item detector / title extractor を変更していない。
