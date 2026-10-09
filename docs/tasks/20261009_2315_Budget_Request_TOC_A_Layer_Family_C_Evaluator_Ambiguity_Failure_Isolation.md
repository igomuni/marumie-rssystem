# Budget Request TOC A層 Family C（evaluator ambiguity）corpus-level failure isolation

## 1. Objective と限界

Family C（H3 = meti ippan_o p4 で見えた duplicate marker key による評価側の判定不能）が TOC 82 ページの corpus でどの程度・どの機構で起きるかを、**commit 済み artifact のみ**から機械的に切り分ける。evaluator / parser / H1 / GT / #395 protocol / 過去の formal result は変更しない。matching rule・identity の提案、仮説、最終 outcome の選択はしない。

入力の境界:

- 使用: GT（#392 first23・#401 new25）、現行 H1 の 82 ページ出力（`full-corpus-h1-output.json`、sha256 `7d31dbb5…2316` を検証）、`full-corpus-status.json`、#396/#402 の評価結果、#404 の `observations.json`、evaluator のコード。
- 不使用: raw-text・PDF・`data/download`・`data/work`。**完全再実行はしていない**（provenance 判定は RawPageLines を要するため）。
- 採用した方式: evaluator を import し、`evaluatePage` を **dummy raw（空 line）**で呼ぶ。groups / fragments / instances は raw 非依存（key・unit の `provenance.sourceRawSlice`・GT のみを使う。evaluator L96-186）。provenance 系の結果（`provenance`、`PROVENANCE_MISMATCH` instance）は破棄する。例外は出ず、結果は決定的（§8）。key multiplicity は export 済み primitive（`gtKey` / `parserKey` / `isComparableGt` / `normKey`）で別集計し、evaluator の groups と突き合わせた。evaluator の規則は再実装していない。
- #396 の旧 parser（#393）出力は commit されていないため再計算せず、記録値を FACT として引用する。

## 2. 研究質問

- Q1 同一ページ内の同一 identity key 衝突は何件・何ページか。
- Q2 衝突は GT 側 / parser 側 / 両方のどこで発生するか。
- Q3 衝突により実際に判定不能になるのは row matching / fragment owner / provenance / column・order のどれか（duplicate key の存在と actual ambiguity を分ける）。
- Q4 H3 以外に AMBIGUOUS_OWNER_GROUP または同等 mechanism による unresolved があるか。
- Q5 duplicate MARKER 以外に同型の non-1:1 collision があるか。

## 3. Source of truth

- identity（amendment `amendedAlignment`）: REQUEST = (page, 正規化 request 番号)、MARKER = (page, 正規化 marker, 正規化 code)。column / 順序 / page ref / occurrence は identity に含めない。
- `duplicateHandling`: occurrence による個別 pairing はしない。group の n（GT）・m（parser）で判定し、min(n,m) を対応済みとする。column は多重集合比較。order inversion は同一 column の 1:1 group 同士のみ（descriptive）。
- `WRONG_FRAGMENT_ATTACHMENT`: owner group が n=m=1 のときのみ判定。owner group が 1:1 でなければ UNRESOLVED（AMBIGUOUS_OWNER_GROUP）。`unresolvedBlocksPass` により AMBIGUOUS_OWNER_GROUP / OTHER_CODE の出現は REVIEW_REQUIRED。
- clarification: REQUEST は「page 内で一意な前提」。PLAIN_ROW は全 row metric で NOT_COMPARABLE（mapping を作らない）。
- evaluator 実装（`budget-request-toc-row-assembly-evaluator.ts`）: identity L24-31（`gtKey` L25 / `parserKey` L27）、group n/m L96-137（1:1 は `pairOneToOne` L135）、merge 検出 L139-148（同一 key は skip）、order inversion L150-158（1:1 のみ）、fragment owner 判定 L160-186（非 1:1 owner は L166-170、parser 側 fragment は L184-185）、provenance L188-195（key 非依存）。

## 4. 区別と分類（census 前に固定。コード冒頭コメントと同一）

- A. DUPLICATE_KEY_PRESENT: key が同一ページに複数回存在する（max(n,m) ≥ 2）。
- B. MATCHING_AMBIGUITY: duplicate により GT/parser の対応が非 1:1。
- C. OWNER_AMBIGUITY: fragment の owner が collision group に属し、evaluator が AMBIGUOUS_OWNER_GROUP を出した。
- D. ACTUAL_PARSER_ERROR: source evidence 上の parser 誤り。**本 census は A/B/C から D を推測せず判定しない**。

collision の分類（GT あり・parser が PAGE_ABSTAINED でないページ）:

- rowIssue = `n≠m` または `wrongColumn>0` または `extras>0` または `unmatchedState≠null`、または AMBIGUOUS_OWNER_GROUP 以外の evaluator instance が当該 key を名指しする。
- fragRel = GT fragment のうち owner の key が k の件数 + parser の key=k の RESOLVED unit に付いた fragment 件数。ownerAmb = AMBIGUOUS_OWNER_GROUP instance が key k を名指しする。
- DUPLICATE_ONLY_NO_EVAL_EFFECT = !rowIssue かつ !ownerAmb かつ fragRel=0。ROW_MATCHING_AMBIGUITY = rowIssue のみ。FRAGMENT_OWNER_AMBIGUITY = !rowIssue かつ ownerAmb かつ fragRel>0。MULTIPLE_EFFECTS = 両方。UNRESOLVED_MECHANISM = 上記以外。
- 追加の mechanical subcategory: NOT_EVALUABLE_NO_GT（GT なし。parser 側 fragment 関係のみ示す）、NOT_EVALUATED_PAGE_ABSTAINED（GT あり・parser が page abstain。evaluator は group を作らない）。
- latent limitation（actual effect とは別記）: DUPLICATE_ONLY group について ORDER_INVERSION_NOT_EVALUATED、SAME_KEY_MERGE_NOT_DETECTABLE、COLUMN_MULTISET_ONLY（GT occurrence が LEFT/RIGHT に跨る場合のみ）。

## 5. H3 の再現

再現できた。`observations.json` の H3 entry（groupsNotOneToOne・pageOutcome・rowStates・fragments・instances）と、dummy raw で再計算した値が **完全一致**（`reproducesObservations404 = true`）。値は census.json の `validation.h3`。

- 対象: meti ippan_o.pdf p4（INHERITED、parser UNSPLIT・evidence 0）。groups: 項010 n2m2、項030 n2m2（いずれも matched 2、wrongColumn 0、extras 0）。
- occurrence: parser は 項030 が line15（sourceOrder 12、直前の（組織）= 040）と line33（sourceOrder 22、組織 060）。GT は LEFT:10（組織 040）と LEFT:20（組織 060）。項010 も同様に 040/060。
- fragment: GT 5 件（41・項030・43・項040・44 の owner）。parser は同じ 5 件を attach。項030 の fragment は GT 側 LEFT:10+f1、parser 側 UNSPLIT:12@line15。owner の rowId は一意だが key group が n2m2 のため L166-170 と L184-185 が各 1 件の AMBIGUOUS_OWNER_GROUP を出す＝**同一物理 fragment の GT 側・parser 側 2 件計上**（fragments.unresolved 2）。項010 は fragment 関係なし。
- 分類: 項010 = DUPLICATE_ONLY_NO_EVAL_EFFECT、項030 = FRAGMENT_OWNER_AMBIGUITY。

## 6. Corpus census

82 ページ（DEV34 / FIRST23 / NEW25 = 34 / 23 / 25、overlap 0、`full-corpus-status.json` の page 順と一致）。GT あり 48（FIRST23 + NEW25）、GT なし 34（DEV34）。parser state: DEV34 = SPLIT20/UNSPLIT13/ABSTAINED1、FIRST23 = 9/12/2、NEW25 = 6/19/0。

| 集合 | pages | REQUEST units（unique） | MARKER units（unique） | duplicate key 数 | duplicate のあるページ |
|---|---|---|---|---|---|
| 全 82 | 82 | 1,519（1,519） | 1,106（980） | 82（REQUEST 0・MARKER 82） | 17 |
| DEV34（GT なし） | 34 | 767（767） | 571（513） | 43 | 9 |
| FIRST23（GT） | 23 | 449（449） | 278（253） | 17 | 4 |
| NEW25（GT） | 25 | 303（303） | 257（214） | 22 | 4 |
| GT 48 | 48 | 752 | 535 | 39 | 8 |

unique/units は per-page の合計。**REQUEST の key 衝突は parser・GT とも 0**（clarification の「page 内一意」前提は GT 48 ページで成立）。82 件の duplicate のうち marker は（項）81・（組織）1。多重度は 2:55, 3:18, 4:4, 5:3, 6:1, 7:1。

- Q2 発生側: GT あり 39 件は全て BOTH（n=m≥2）。GT のみ・parser のみの collision は 0。DEV34 の 43 件は parser のみ観測（GT なしで GT 側は不明）。
- GT accounting: FIRST23 は 834 rows（REQUEST 492・MARKER 310・PLAIN 32、fragment 17）、NEW25 は 614 rows（REQUEST 303・MARKER 257・PLAIN 54、fragment 3）で committed GT の `counts` と一致。comparable 802（first23）は `existingGtStatus` の gtComparable と一致。GT 側 exempt（UNSPLIT かつ GT 右 rows ありで評価対象外）row は 0。なお本 worker は S1-B の記録値を参照できなかったため、S1-B との照合は未実施（committed GT counts との照合のみ）。

## 7. Evaluation impact（GT あり 39 collision）

| 分類 | 件数 | 内訳 |
|---|---|---|
| DUPLICATE_ONLY_NO_EVAL_EFFECT | 38 | FIRST23 16・NEW25 22 |
| FRAGMENT_OWNER_AMBIGUITY | 1 | FIRST23（H3 項030） |
| ROW_MATCHING_AMBIGUITY / MULTIPLE_EFFECTS / UNRESOLVED_MECHANISM | 0 | — |
| NOT_EVALUATED_PAGE_ABSTAINED | 0 | GT ありの abstain 2 ページに collision なし |
| NOT_EVALUABLE_NO_GT（別集計） | 43 | DEV34・9 ページ。parser 側 fragment 関係は 43 件中 0 |

- Q3: 実際に評価不能になったのは **fragment owner matching の 1 fragment（H3）のみ**。row matching（n≠m・wrongColumn・extras・unmatched）、provenance（key 非依存）、column・order で判定不能になった collision は 0。
- latent limitation（38 件の DUPLICATE_ONLY 全てが対象）: order inversion 未評価 38、同一 key 内 merge 検出不能 38、column が多重集合比較のみ（GT が LEFT/RIGHT に跨る）26。これは evaluator が構造的に見ない領域であり、actual effect としては 0。

## 8. 他の collision 型と Q4/Q5

- Q4: 現行 H1 の post-hoc では AMBIGUOUS_OWNER_GROUP は ippan_o p4 のみ（FIRST23 の 2 instance＝1 fragment。`existingGtStatus` の unresolved 2 と一致）。NEW25 は 0（#402 と一致）。**旧 parser（#393、#396 の記録）**では 3 instance: ippan_o p4 の 2 件と、**230901-2 p3 の R|18**。後者は duplicate key ではなく merge（n=1, m=0, INCORRECT_MERGED）で owner group が非 1:1 になった別 mechanism。現行 H1 では同キーが 1:1 に戻り、FIRST23 post-hoc には現れない。
- Q5 REQUEST: 衝突 0。n≠m group: 現行 H1 の GT 48 ページで 0（他の non-1:1 shape も 0）。旧 parser の記録（#396）は non-1:1 26 groups・7 ページ＝ n=m 16 + n=2,m=1 が 1（05-3b-01 p3 項015）+ n=1,m=0 の merge 9。引用に「17 duplicate n=m groups」とあるが、記録上の n=m は 16 で、17 は n2m1 の 1 件を含む。現行 H1 での FIRST23 は 17 件全て n=m。旧 non-1:1 の merge 9 件と n2m1 は現行では全て 1:1 または n=m（census.json `validation.committed396_oldParser_recordedFacts.oldParserVsCurrentH1`）。
- OTHER_CODE: 14 units は全て DEV34（GT なし）。GT 48 ページは 0（NO_GT_CLASS_FOR_OTHER_CODE の blocking は 0）。DEV34 分は frozen protocol 上は出現すれば UNRESOLVED だが GT なしで評価していない。PLAIN_ROW: GT 86 rows（32+54）は frozen protocol で NOT_COMPARABLE、key census の対象外。

committed 評価結果との整合: #402（NEW25）は 25 ページ全てで groups / fragments / instances（provenance 除く）が committed と **完全一致**、non-1:1 22 groups は全て n=m かつ matched、unresolved 0。#403 post-hoc の FIRST23 は unresolved fragment 2・AMBIGUOUS_OWNER_GROUP 2 で再計算と一致。#396 は記録値（26 / 7 ページ / merge 9 / AMBIGUOUS_OWNER_GROUP 3 = ippan_o p4 ×2 + 230901-2 p3 ×1）が committed JSON と一致。

## 9. Visual review queue

H3 以外で mechanical evidence だけで分類できない collision: **0**（UNRESOLVED_MECHANISM 0）。参考として DEV34 の GT なし 9 ページ（43 件）は評価影響を判定できない（NOT_EVALUABLE_NO_GT）。ページは census.json の `pages[]`（partition = DEVELOPMENT_EXPLORED かつ collisions あり）を参照。PDF は開いていない。

## 10. Outcome の整理（最終選択はしない）

- C0（H3 のみ／極少数）: GT 評価可能な 48 ページで actual な評価不能は 1 ページ 1 collision。支持される。
- C1（複数あるが大半は評価に影響しない）: GT あり 39 collision 中 38 が影響なし。DEV34 を含めると duplicate は 82 件・17 ページ。支持される。
- C2（複数ページで actual ambiguity）: GT あり 48 ページ中 1 ページのみ。現行 H1 では支持されない（旧 parser の 230901-2 p3 は別機構で現行では消失）。
- C3（parser output 自体にも ambiguity/error が絡む）: 本 census は D を判定しないため支持も否定もしない。
- CV（機械的に分類不能）: 該当 0。ただし DEV34 の 43 件は GT がなく評価影響が不明。

## 11. 解釈

- FACT: 衝突は MARKER のみ。GT あり 39 件は全て両側 n=m。actual な評価不能は H3 の fragment owner 1 件（accounting 上 2 instance）。
- OBSERVATION: H3 では fragment を持つ occurrence が GT・parser 双方で同じ（組織）040 の配下にある。fragment 付きの collision は GT 側・parser 側とも H3 項030 の 1 件のみ。DEV34 の 43 件には parser 側 fragment 関係が 0。
- INTERPRETATION: 観測された機構は group 非 1:1 の owner を UNRESOLVED とする evaluator 規則（amendment）が duplicate marker で作動したもので、**evaluator-local に見える**。parser との結合（parser 側の誤り）は、本 census では判定していない。broader identity-design の問題かは、衝突が 82 件でも actual effect が 1 件という本証拠だけでは言えない。
- UNRESOLVED: DEV34 の parser-only duplicate 43 件の評価影響。duplicate の発生が parser の誤りに由来するか（D）。S1-B との accounting 照合。
- POTENTIAL_DISCRIMINATOR（名前と観察事実のみ。identity への追加案ではない）: precedingOrgCode（collision の occurrence 直前の（組織）code。各 occurrence が同一 column 内で別の組織配下に並ぶか）— 全 82 件のうち parser occurrences が (column, precedingOrgCode) で全て区別可能かつ非 null なのは 26 件、GT occurrences で区別可能は 39 件中 9 件（先頭に（組織）がないページや column 跨ぎで null が出る）。occurrence の column・sourceOrder・lineIndex も census.json に記録した。

## 12. Claim boundary と next

- 結論は mechanical census のみ。D（parser の真の誤り）、matching rule の妥当性、production 影響は主張しない。完全再実行ではなく、provenance は未評価。
- GT なし 34 ページ（DEV34）の評価影響は不明。GT 48 ページは post-hoc（FIRST23・NEW25）で、これ以上の母集団への外挿はしない。
- no GT・no preregistration・no parser/evaluator change・no matching rule change・no formal re-evaluation。過去の formal result は保存。

Next research question（仮説ではない）: Family C の actual effect が H3 の 1 fragment に限られている条件下で、fragment を持つ duplicate marker がどの程度の頻度で現れ得るか（DEV34 以外の母集団での duplicate と fragment 付与の共起）をどう切り分けるか。

## 13. Validation

- H3 再現: 一致。決定性: 同一入力 2 回実行＋fixture 書き込みの census.json sha256 が一致（`70821a18…1963`）。
- coverage: 82 ページ、partition 34/23/25、GT 48。
- テスト: 新規 18（synthetic 12＋census fixture integrity 6）、関連既存 `budget-request-toc*` 全て、`npx tsc --noEmit`、`npm run lint`（既存 warning のみ）の結果は PR 本文に記載。
- 再実行: `npx tsx scripts/pipeline-v2/analyze-budget-request-toc-evaluator-ambiguity.ts [--freeze-fixture] [--out <path>]`（`--freeze-fixture` を付けた時だけ書き込む）。
