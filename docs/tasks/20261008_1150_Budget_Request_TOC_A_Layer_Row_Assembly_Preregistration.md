# FY2024 概算要求 TOC A 層 row assembly — Preregistration

機械可読な正本: `tests/fixtures/budget-request-toc-row-assembly/2024/preregistration.json`（本書はその説明。食い違う場合は JSON が正）。held-out 候補 membership: 同 `heldout-candidates.json`。

**本 unit は preregistration のみ。parser・GT・held-out 目視・評価・B 層は一切行っていない。** judgment = `READY_FOR_TOC_ROW_ASSEMBLY_GT_FREEZE`（GT freeze を開始してよい、のみ。parser GO ではない）。

## 1. Integrity

| 項目 | 値 |
|---|---|
| 作成 | 2026-10-08T11:50:06+09:00 |
| base main | `5a02b54cb0f1363df85617af361c2cc2b234d0ba`（#390 を含む。#390 head `b10919e6…` と内容同等を確認） |
| Raw Text corpus digest | `7c6d2dcec1f4bec0ca37a1b3aa391adce7d99b93ac4642c74cab7a328dac4052` |
| Page Classification corpus digest | `39464fc76b1b83272d5852d3db1db776e22bb570ee0f6b7ca4d1da64de4a5ecc` |
| population | TOC 82 = DIRECT 55 + INHERITED 27、physical PDF 55 |
| 使った development evidence | PR-3A 19 / #389 12 / #390 render 10 page、#389・#390 の machine inventory |
| 使った post-hoc evidence | 右 row 開始 character index の spread 0〜2（#390、validated ではない）、jinji p3 の 3 桁 code row（1 page） |

preregistration 後の変更は禁止。変更が要る場合は原本を残し、現実験を STOP / protocol deviation として記録し、別研究単位で再 preregister する。

## 2. Scope / contract

- 対象: FY2024、Page Classification = TOC の 82 page、A 層 physical row reconstruction。
- 対象外: hierarchy・section carry・INHERITED の state 解決・MOF/RS 照合・丸囲み/PUA 復元・future FY。
- **Input**: 各 page の `localPdfPath` / `pdfSha256` / `physicalPage` / `textSha256` / `classifierSource` と Raw Text の `nonEmptyLines[{lineIndex,text}]`。列位置は Unicode code point の character index（display width は使わない）。
- **Output（行）**: page identity / column(LEFT|RIGHT|UNSPLIT) / column 内 sourceOrder / rowKind / rowStartTokenRaw / codeRaw / titleRaw / pageRefRaw / fragments / provenance / state(RESOLVED|ABSTAINED)+reason。parent・section・carried hierarchy・semantic category は**入れない**。
- **Provenance**: `localPdfPath, pdfSha256, physicalPage, textSha256, lineIndex, charStart, charEnd, sourceRawSlice`。既存 Raw Text primitive を再利用し、新 primitive は作らない（意味 field を持たせない）。

## 3. Row kinds（raw observable のみで判定）

| kind | 定義 |
|---|---|
| REQUEST_NUMBER_ROW | segment 先頭 token が `\d{1,3}\s+\d{2}[‐‑-]\d{2}` |
| MARKER_ROW | segment 先頭 token が `（…）` / `(…)` |
| TITLE_OR_HEADING | header zone（page 先頭〜最初の row-start 行の直前）の行。分割せず raw 保持 |
| OTHER_CODE | `^\s+(0\d{2})\s+(?!NN-NN)(名称)\s+(PAGEREF)\s*$` に完全一致。0 始まり 3 桁 code + 名称 + page ref。**意味分類ではなく jinji p3 形式の bounded 保持**。他の未知 code 形は catch-all にせず abstain |
| WRAPPED_FRAGMENT | header zone 外で上記いずれでもなく、数字で始まらず、末尾に page ref を持たない segment |
| UNKNOWN_ABSTAINED | 上記以外（数字始まりの未定義形、page ref を持つ fragment 候補等） |

PAGEREF = 任意の 1 文字 prefix（`エ` `国` 等）＋任意の `（…）` ＋ 1〜4 桁数字。raw のまま保持し数値化・補完しない。

## 4. Page-local column segmentation（核心）

1. **右 column evidence（band 構築用）**: 行内で先頭 token ではない request token（直前に `\d{1,4}\s+`）。その開始 character index を集める。marker は band に使わない（#390 では request と marker の開始 index が 6〜10 ずれ、marker 単独の根拠は未確立）。
2. **band tolerance = 2 character index（単位: Unicode code point の character index）**。最小値 E から `[E, E+2]` に全て入れば 1 cluster。
   - 選択理由: #390 の development 観測（種別ごと spread 0〜2）。**development observation に基づく preregistered choice であり、frozen evaluation ではまだ検証されていない。評価後に変更しない。**
3. 代表 left edge **E = cluster の最小 index**。
4. evidence 2 件未満 → `RIGHT_EVIDENCE_INSUFFICIENT`（page abstain）。保守的な設計判断で、development の数値根拠はない。
5. 複数 cluster（E+2 超の index がある）→ `MULTIPLE_INCOMPATIBLE_BOUNDARY_CLUSTERS`（page abstain）。
6. **marker-only**（marker 右候補のみで request 右候補 0）→ `MARKER_ONLY_RIGHT_BOUNDARY`（page abstain）。offset を新規推定しない。
7. **right evidence 無し**（request・marker とも右候補 0）→ `NO_RIGHT_COLUMN_EVIDENCE`。`RIGHT_EMPTY` は出さない。column=UNSPLIT で行全体を保持し、右 column が存在しないとは主張しない（視覚で右があれば評価で `NO_EVIDENCE_BUT_VISUAL_RIGHT_PRESENT` として計測）。
8. **Segment assignment**（E 解決 page）: left = `line[0:E]`、right = `line[E:]`。
   - `line[E-1]` と `line[E]` がともに非空白 → `BOUNDARY_CROSSING`（その行を abstain。片側へ推測配置しない）。
   - 行内の先頭 token でない request token が `[E-2,E-1]` または `E+3` 以上にある → `BOUNDARY_CONFLICT_LINE`（その行 abstain）。

## 5. Wrapped fragment / source order

- **Attachment**: fragment は同一 page・同一 column の**直前の RESOLVED row**（REQUEST_NUMBER_ROW / MARKER_ROW / OTHER_CODE）に attach。連続 fragment は同じ owner に順に attach。
- 採否の明示: 候補原則「row-start も page ref も持たない fragment」を**そのまま採用**。page ref を持つ fragment 候補は `FRAGMENT_WITH_PAGE_REF` で abstain（continuation 行に ref が来るかは未確認のため、安全側）。
- abstain: owner 不在 / owner との間に当該 column の ABSTAINED・TITLE が挟まる / column 未解決 → `FRAGMENT_NO_SAFE_OWNER`、owner が一意でない → `FRAGMENT_OWNER_NOT_UNIQUE`、同一 raw line の左右双方が fragment → `SIMULTANEOUS_LR_FRAGMENT`（#390 では NOT_OBSERVED_IN_TARGETED_SAMPLE。存在しない前提を置かない）。
- **Source order**: column 内で lineIndex 昇順を保持。非単調なら `SOURCE_ORDER_CONFLICT`（page abstain）。左右を raw line 単位で対応付けない。出力順は読み順の主張ではない。
- **丸囲み**: raw の plain digit を token として扱い、丸囲み復元・意味推定はしない（representation limitation）。

## 6. Abstention（既知条件の全列挙）

page 単位: `FROZEN_INPUT_MISMATCH` / `RIGHT_EVIDENCE_INSUFFICIENT` / `MARKER_ONLY_RIGHT_BOUNDARY` / `MULTIPLE_INCOMPATIBLE_BOUNDARY_CLUSTERS` / `SOURCE_ORDER_CONFLICT`。
行・segment 単位: `BOUNDARY_CONFLICT_LINE` / `BOUNDARY_CROSSING` / `UNKNOWN_ROW_START` / `FRAGMENT_WITH_PAGE_REF` / `FRAGMENT_OWNER_NOT_UNIQUE` / `FRAGMENT_NO_SAFE_OWNER` / `SIMULTANEOUS_LR_FRAGMENT` / `REQUIRES_HIERARCHY_SEMANTICS` / `OTHER_CODE_UNSUPPORTED_FORM` / `PROVENANCE_UNAVAILABLE`。

abstain は failure ではなく安全な出力状態。評価では件数・率・理由を計測する。

## 7. Failure taxonomy

#390 の名称を再利用（`COLUMN_BOUNDARY_MULTIPLE_CANDIDATES` `COLUMN_BOUNDARY_NO_SAFE_EVIDENCE` `RIGHT_EMPTY_AMBIGUOUS` `CROSS_COLUMN_FRAGMENT_AMBIGUOUS` `WRAPPED_FRAGMENT_OWNER_AMBIGUOUS` `RAW_SOURCE_ORDER_CONFLICT` `CIRCLED_REQUEST_NUMBER_REPRESENTATION_LOSS` `ROW_BOUNDARY_REPRESENTATION_BLOCKED`）。評価用に追加: `SEGMENT_CROSS_BOUNDARY` `FRAGMENT_NO_SAFE_OWNER` `UNKNOWN_ROW_START` `OTHER_CODE_UNSUPPORTED_FORM` `PROVENANCE_FAILURE` `NO_EVIDENCE_BUT_VISUAL_RIGHT_PRESENT`。abstention → family の対応は JSON `failureTaxonomy.abstentionToFamily`。

## 8. GT / fixture freeze protocol（次工程。本 unit では作らない）

- **評価単位**: page（state と column 構成）/ row（`{pdf}#{page}:{column}:{orderInColumn}`、一意）/ fragment（owner との対）。
- **GT source**: PDF の visual のみ。禁止: raw からの補完、blank→0、差分補完、丸囲み推測、他 page・一般知識、parser output を見ながらの作成。GT と parser の対応は row-start token + column + 順序で取り、provenance の rawSlice 再現は機械検証。
- **explored 除外**: PR-3A 19 ∪ #389 12 ∪ #390 render 済み 10（RECHECK 4 は #389 に含まれる）= 34 page を除外 → pool 48。
- **selection**: machine inventory のみで決定した deterministic rule（seed・hash 規則は script と JSON）。membership 23 page（DIRECT 14 / INHERITED 9）、digest `8fa5a8a8…a44156`。目視前なので `HELDOUT_CANDIDATE` と呼び、held-out evidence とは呼ばない。
- **risk strata**（pool / take）: right-column-used 17/6、no-right-row-evidence（body≥15）12/4、同（body<15）19/2、wrapped fragment 右 3/3・左 7/2、asymmetric 6/2、INHERITED 12/3、DIRECT 36/3。
- **pool 0（捏造しない・held-out では NOT_COVERED）**: marker-only right column、左右同時 fragment、OTHER_CODE、tolerance を超える複数 index cluster。
- **Frozen hashes**: GT fixture 全文 / membership digest / preregistration.json / 評価 script / 評価時の parser output を SHA-256 固定。
- **順序**: ① GT freeze unit（parser 未実装で visual GT を commit・hash 固定）→ ② parser 実装 unit（development 34 page のみで descriptive regression。held-out GT を読まない。rule 変更なし）→ ③ frozen evaluation unit（一度だけ評価）。
- **限界**: 同一 agent が GT と parser を扱うため独立検証ではない（commit order と hash で leakage を抑える）。23 page は小さく汎化は主張しない。

## 9. Metrics / GO・STOP

- 判定 outcome: CORRECT / INCORRECT / ABSTAINED / UNRESOLVED を page・row・fragment 単位で区別。
- **severe（abstention より重い）**: `FALSE_POSITIVE_ROW_ASSEMBLY`、`WRONG_COLUMN_ASSIGNMENT`、`WRONG_FRAGMENT_ATTACHMENT`、`PROVENANCE_MISMATCH`。
- その他: `WRONG_ROW_START_CLASSIFICATION`、abstention 件数・率（理由別）、taxonomy 件数、`NO_EVIDENCE_BUT_VISUAL_RIGHT_PRESENT` 件数、stratum 別 coverage。
- **STOP_SAFETY**: severe が 1 件でも出たら STOP（rule・tolerance を調整して再評価しない。別研究単位で再仮説化）。
- **STOP_PROTOCOL**: 評価前の hash 不一致 / explored の混入 / 評価を見た rule 変更。
- **SAFETY_PASS_COVERAGE_REPORTED**: severe 0 件かつ protocol 遵守。「この sample で severe error が観測されなかった」のみを意味し、自動で次工程に進まない。
- **UNRESOLVED_ACCEPTANCE_THRESHOLD**: coverage 下限・abstention 率上限・row-start 誤分類の許容は根拠不足のため数値を作らない。結果報告のみ行い、採否と次工程へ進むかは user review。

## 10. Unresolved / claim boundary

- UNRESOLVED_ACCEPTANCE_THRESHOLD（上記）。
- T=2 は未検証の preregistered choice。`bandMinEvidence=2` は設計判断で development の数値根拠なし。
- fragment 行が page ref を持つか未確認（持てば abstain）。
- 右 column が fragment / OTHER_CODE のみの page は NO_RIGHT_COLUMN_EVIDENCE となり得る（評価で計測）。
- 左右同時 wrap・marker-only・OTHER_CODE は held-out では NOT_COVERED。
- 本 unit は rule と protocol の固定のみ。rule の正しさ・coverage・汎化は何も検証していない。
