# FY2024 概算要求 TOC A 層 row assembly — Parser Implementation

実装: `scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts`（`assembleTocPage`）。正本 spec は #391 の `preregistration.json`。freeze: `tests/fixtures/budget-request-toc-row-assembly-parser/2024/implementation-freeze-manifest.json`。

**本 unit は implementation のみ。held-out 23 page への parser 実行 0、GT 内容の読込 0、評価なし。** judgment = `READY_FOR_TOC_ROW_ASSEMBLY_FROZEN_EVALUATION`（次 unit で implementation を変更せず frozen evaluation を始めてよい、のみ。SAFETY_PASS / production GO ではない）。

## 実装した rule（preregistration のとおり）

- 入力: Raw Text の page record（text hash と nonEmptyLines を再検証 → 不一致は `FROZEN_INPUT_MISMATCH`）。lineIndex 非単調は `SOURCE_ORDER_CONFLICT`。列位置は code point の character index。
- 右 band evidence: 行内で先頭 token ではない request token（直前 `\d{1,4}\s+`）。`bandToleranceChars=2`、`bandMinEvidence=2`、代表 edge = 最小 index。cluster 外 → `MULTIPLE_INCOMPATIBLE_BOUNDARY_CLUSTERS`、1 件 → `RIGHT_EVIDENCE_INSUFFICIENT`、marker 右候補のみ → `MARKER_ONLY_RIGHT_BOUNDARY`（いずれも page abstain）、evidence なし → `NO_RIGHT_COLUMN_EVIDENCE`（UNSPLIT。RIGHT_EMPTY は生成しない）。
- 行: `BOUNDARY_CONFLICT_LINE`（band 外 request token）/ `BOUNDARY_CROSSING`（`line[E-1]`,`line[E]` ともに非空白）は行 abstain（column=UNSPLIT。両 column の barrier）。それ以外は `line[0:E]` / `line[E:]` に分割。
- header zone（最初の row-start 行の直前まで）は `TITLE_OR_HEADING` として分割せず raw 保持。
- row kind は #391 の 6 種のみ（REQUEST_NUMBER_ROW / MARKER_ROW / TITLE_OR_HEADING / OTHER_CODE / WRAPPED_FRAGMENT / UNKNOWN_ABSTAINED）。`OTHER_CODE` は preregistered 限定形（0 始まり 3 桁 + 名称 + page ref）のみ。他の 3 桁 code 形は `OTHER_CODE_UNSUPPORTED_FORM`、その他の数字始まりは `UNKNOWN_ROW_START`。
- fragment: 同一 page・同一 column の直前 RESOLVED row に順に attach。page ref を持つ → `FRAGMENT_WITH_PAGE_REF`、owner 不在・ABSTAINED/TITLE の barrier 越し → `FRAGMENT_NO_SAFE_OWNER`、同一 raw line の左右双方 fragment → `SIMULTANEOUS_LR_FRAGMENT`。
- page ref・丸囲み digit は raw のまま。provenance は file / PDF hash / page / text hash / lineIndex / charStart・charEnd / rawSlice を各 row・fragment に保持。

## 到達しない abstention（実装上の注記）

- `FRAGMENT_OWNER_NOT_UNIQUE`: owner を「同 column の直前 RESOLVED row」と決定的に定めるため発生しない（定義は保持）。
- `REQUIRES_HIERARCHY_SEMANTICS`: hierarchy を使う判断経路が無いため発生しない。
- `PROVENANCE_UNAVAILABLE`: rawSlice の再現検証に失敗した場合のみ（通常は発生しない）。

## PLAIN_ROW の境界

`PLAIN_ROW`（#392 の visual-only class）は実装に使っていない。parser の出力に PLAIN_ROW は存在せず、GT から rule も作っていない。page 末尾の「…定員表 N」のような行は preregistered rule どおり `UNKNOWN_ABSTAINED(FRAGMENT_WITH_PAGE_REF)`（header zone 内なら `TITLE_OR_HEADING`）になる。**実装には mapping は不要だった**が、frozen evaluation で parser kind と GT の `PLAIN_ROW` を比較する mapping は依然未定義のため、**評価 unit の前に protocol clarification が要る**（評価時に事後決定してはならない）。

## development-only 結果（explored 34 page。評価ではない）

| 項目 | 値 |
|---|---|
| page state | ASSEMBLED_SPLIT 20 / UNSPLIT(NO_RIGHT_COLUMN_EVIDENCE) 13 / PAGE_ABSTAINED 1（RIGHT_EVIDENCE_INSUFFICIENT） |
| row 出力 | 1519、attach された fragment 36 |
| row abstention | FRAGMENT_WITH_PAGE_REF 12（「…定員表 N」行） |
| OTHER_CODE | 15 行（jinji の既知形） |
| 未規定 case | なし（STOP_PROTOCOL_UNSPECIFIED_CASE 該当なし） |

BOUNDARY_* / MARKER_ONLY / SIMULTANEOUS は development 34 page では発生せず、synthetic test で確認した。T=2・minEvidence=2 は変更していない。

## Held-out firewall（正直な注記）

実装中に `ground-truth.json`・`visual-gt-source.txt`・held-out の render を開いていない。ただし**この GT は同じ agent が前 unit で作成**しており、記憶としての GT 知識は排除できない。実装は preregistration と development の観測のみから書き、GT 由来の rule は入れていない（parser module が GT 系ファイル名を参照しないことを test で確認）。独立検証ではない。

## Freeze

implementation commit・source hash・rule/config hash・preregistration hash・GT freeze manifest hash・development fixture hash を `implementation-freeze-manifest.json` に固定。数値基準（UNRESOLVED_ACCEPTANCE_THRESHOLD）は未決のまま、development 結果から後付けしない。
