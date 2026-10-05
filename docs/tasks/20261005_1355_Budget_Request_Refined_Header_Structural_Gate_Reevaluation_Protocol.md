# 概算要求PDF table-frame refined projection 後の page-header structural gate 再評価 — protocol（structural evaluation の前に固定）

table-frame predicate refinement（branch `research/budget-request-table-frame-predicate-refinement`、`2ca8130`）の後続。refined projection を固定したまま、以前の page-header label 研究の segment / structural gate（G1・G3・G4・G5）を変更せずに再適用する。新しい header rule・semantic rule・DocumentHierarchy generator は作らない。ambiguous 1,196 row の構造分解・predicate の追加 tuning・label の意味解釈・manual contract / MOF を教師にすることはしない。manual contract は diagnostic のみ。

## 1. Research question
Table-frame refined projection により既知の projection artifact を抑制した後でも、page-header label segment は manual activation boundary に対して boundary-specific な source evidence となるか。

## 2. One change
structural gate に入力する page-header projection を、alternative projection（`alt-title-projection.json`）から、table-frame refined projection に置き換える。それ以外は不変: label-shaped predicate・normalization・title / header lexical rule・table-frame classifier と threshold・segment algorithm・blank bridge rule（bridge しない）・layout range・manual contract・G1 / G3 / G4 / G5 の式と threshold・MOF matcher・DocumentHierarchy・FieldResolver・recordKind・item detector・rotate。

## 3. Primary input（frozen table-frame refined projection）
refined projection は、frozen artifact から決定的に導出する（新しい rule を持たない）: alternative projection（`alt-title-projection.json` `cc071c77…c6cd`）の各 page の出力を使い、alternative が `label_on_first_code_row` で採用した page のうち、table-frame の eligibility（`candidate-frame-relations.json.gz` `cfce15fe…6936b`、classifier `budget-request-table-frame-eligibility.ts` `b43eab8b…fdf2`）で header position と分類されなかった page（refined-evaluation の rejected 3 page）は、current projection（`header-label-projection.json` `9ff3b970…02e5`）の出力に戻す。現行 nonblank の page は変更しない。manual contract・MOF・既存 hierarchy kind は projection の生成・変更に使わない。
refined projection の population integrity は、frozen な refined evaluation（`refined-evaluation.json` `9100df13…bb9dd`）と一致しなければ structural evaluation に進まず STOP: evaluable 9,145・current nonblank 6,195・target 2,537・accepted 2,529・rejected body/table 2・rejected unavailable 1・unresolved 5・non-target changed 0・regression 0・provenance loss 0・source fidelity violation 0。

## 4. 再利用する frozen gate（定義の source）
正確な定義は frozen の protocol（`20261005_0930_Budget_Request_Page_Header_Label_Segment_Protocol.md` §3、SHA-256 `fed62291…5493`）と、それを実装した frozen script（`compare-budget-request-header-labels.ts` `658f0553…4676`、alternative projection の再評価 `evaluate-budget-request-alt-title-projection.ts` `de59c244…997a` の `segments` phase）から取る。チャットの記述から再構成しない。
- G1: evaluable page（observed_nonblank + observed_blank）に対する observed_nonblank の比率が、corpus 全体で ≥ 0.5 かつ non-discovery（hierarchy 契約を持たない 74 PDF）でも ≥ 0.5。
- G3: mext の manual 開始 1045・mhlw の manual 開始 1555・mhlw の manual 終了 1700 の 3 境界が、すべて label segment の開始 / 終了 page（開始は page > 1 の label segment の先頭、終了は label segment の末尾で PDF の最終 page でない）であり、かつ layout range の境界（開始は layout range の先頭、終了は layout range の末尾で PDF の最終 page でない）ではない。
- G4: mext・mhlw のそれぞれで、manual 境界以外の label transition（label segment の開始（page > 1）のうち、manual 開始の page と manual 終了の次の page を除くもの）が PDF 全体で 2 以下。
- G5: hierarchy 契約を持たない PDF のうち observed_nonblank の page を持つものについて、`prefix(inner)` 形の page が observed_nonblank の過半（≥ 0.5）である PDF の割合が ≥ 0.5。
segmentation: 隣接 page の observed_nonblank で `firstTitleNormalized` が完全一致する間を同一 label segment。blank・unavailable は独立の state で、跨いで結合しない（carry-forward・bridge なし）。gate 実装は、frozen alt 評価の gate 計算の忠実な移植（`lib/budget-request-header-gates.ts`）とし、alternative projection に適用して frozen の `segment-structural-evaluation.json`（`3eccc9ea…a005`）と同じ値になることを equivalence test で固定する（gate logic を書き直さない）。

## 5. Decision rule（評価前に固定）
- D1 `REFINED_HEADER_BOUNDARY_SUPPORTED`: G1・G3・G4・G5 がすべて pass。
- D2 `HEADER_LABEL_INTRINSICALLY_NOT_BOUNDARY_SPECIFIC`: G1・G3・G5 が pass、G4 が fail。
- D3 `REFINEMENT_STRUCTURAL_REGRESSION_OR_INCONCLUSIVE`: G1・G3・G5 のいずれかが fail、dependency / population の不整合、gate を同一条件で再利用できない、projection の provenance が失われる、refined projection が frozen evaluation と一致しない。
- STOP: frozen の G1 / G3 / G4 / G5 の定義・threshold を一意に復元できない、dependency hash の不一致、population の不一致、manual boundary を見て rule を変更する必要が生じた、evaluation 前に preregistration を freeze できない。
この decision rule を evaluation 後に変更しない。

## 6. 必須の出力
projection population integrity／current・alternative・refined の segment 比較（observed_nonblank・observed_blank・label segment・全 segment・同 label の非連続な再出現・直接 label→label transition・mext segment・mhlw segment）／G1・G3・G4・G5 の定義・numerator・denominator・実測値・threshold・PASS/FAIL／manual boundary diagnostic（mext 1045・mhlw 1555・mhlw 1700 の refined label・segment 開始 / 終了との関係・layout 境界との関係・前後 label・blank / nonblank・provenance）／G4 が fail の場合のみ、rule を変えずに mext・mhlw の manual 境界以外の label change の内訳（page locator・before label・after label・transition type・refined で新規発生か・alternative と current にも存在したか。label の意味は解釈しない）／alternative → refined で変わった page の inventory（page 数・PDF 数・old / new の status と label・table-frame relation・segment 境界への影響）。

## 7. 順序・禁止・終了条件
Commit A（本書）→ B（implementation freeze: refined projection の導出・gate の移植・equivalence / integrity test）→ C（frozen evaluation）→ D（result・INDEX）。測定バグが見つかった場合は隠さず、初回結果を保存し、population / rule / gate を変更したか否かを明記し、measurement fix は独立 commit、preregistration を書き換えない。禁止: ambiguous 1,196 row の追加 isolation・P2 350 ambiguous の救済・predicate の refinement・新しい lexical regex の探索・label の意味の推測・organization/root GT の作成・DocumentHierarchy / activation range generator の実装・production の変更・rotate・fuzzy・MOF / manual contract の teacher 化・threshold tuning・hierarchy 回復件数の推計。G4 が再び fail した場合は `HEADER_LABEL_INTRINSICALLY_NOT_BOUNDARY_SPECIFIC` を negative result として freeze し、header-label 単独の activation-boundary 研究を一旦終了し、次の研究単位を「full-corpus DocumentHierarchy を source evidence からどう構成するか」に戻す。全 gate が pass した場合も production には進まず、page-header label を activation evidence の候補として freeze し、別 population / held-out を含む検証設計を行う。
