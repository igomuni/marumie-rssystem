# 概算要求PDF label-shaped predicate ambiguity の source-only failure isolation — protocol（candidate universe の全件生成の前に固定）

alternative title projection（branch `research/budget-request-page-header-alternative-projection`、`e6e1b24`）の後続。frozen label-shaped predicate・alternative projection rule・current projection・normalization は変更しない。観測のみ。目的は、C2 の ambiguous 1,123 page の ambiguity が、predicate が projected candidate と最初の code row より後ろの additional candidate の両方を label-shaped と判定する構造差・共通性のどこから生じるかの分解。predicate refinement・ambiguity の解消・manual contract に合う候補の選択・label の意味解釈・unresolved 5 page の救済は行わない。manual contract・MOF・existing ON kind・組織名辞書・human semantic classification は使わない。

## 0. 用語（固定）
- candidate row: 直前研究と同一の frozen label-shaped predicate（`evidenceOf` の `labelShaped`: row の bbox.yMin < page 高さ × 0.2、かつ normalized（NFKC → 空白・数字の除去）が `^([^()]+)\(([^()]+)\)$`）を満たす logical row。基本単位は candidate row。logical row は既存 pipeline の row（新しい grouping は作らない）。
- projected candidate: alternative projection が title に採用した row（`alt.title.sourceRefs.logicalRowIndex` の row が label-shaped のとき）。additional candidate: 同じ page の他の candidate row。ambiguity-causing additional candidate: 直前研究で ambiguous とされた page（alternative が `label_on_first_code_row` で投影し、projection と normalized が異なる別の label-shaped row が同 page にある page = 1,123）の、normalized が projected と異なる additional candidate。「誤検出」とは呼ばない（human GT がない）。
- relative row position（`firstCodeRowIndex` = current projection の最初の code row = `classifyRow(texts) !== 'other'` の最初の row の logical row index に対して）: `before_first_code` / `same_as_first_code` / `after_first_code` / `first_code_unavailable`。

## 1. Phase A — candidate universe（P0 の全件列挙。1,123 page だけを先に見ない）
primary evaluable 9,145 page（rotate=90 の 754 page は対象外）の全 candidate row を列挙。各 row に: identity / provenance（localPath・page・logicalRowIndex・tokenIndexes・raw・page 幅・高さ・rotate・row の x / y の範囲）、frozen classification（projected か additional か・page が ambiguous か・relative position・current / alternative の status・firstCodeRowIndex・page の candidate 数）、label projection（raw・normalized・shape・normalization の各段階）、F1〜F5 の feature（下記）。universe の membership と hash を freeze し、Phase B で変更しない。

## 2. feature family（candidate の raw text を人間が個別に読む前に固定）
- F1 row ordering / structural position: logicalRowIndex・firstCodeRowIndex との差・page 内 row 数・page 先頭からの順位・candidate より前 / 後の row 数・candidate より前に code-shaped row（先頭 token が 3 桁）/ request-shaped row（`classifyRow === 'request'`）があるか・candidate 自身が code-shaped / request-shaped か。
- F2 geometry: minX・maxX・minY・maxY・normalized top（yMin / 高さ）・row 幅・row 高さ・token 数・first / last token の x。thin anchor（freeze 済みの rule-line primitive の T1: thin な long 垂直罫線の最も左）が page で利用可能か、first token の x − anchor x（selection には使わない）。
- F3 lexical composition（意味解釈なし）: raw / normalized の総文字数・数字（`\p{Nd}`）・ASCII 数字・CJK（Han）・ひらがな・カタカナ・Latin・空白・句読点 / 記号（`\p{P}\p{S}`）・開き / 閉じ括弧・カンマ・スラッシュ・パーセント類。特定の既知例に合わせた regex・特定の文字や省庁名の feature・語彙辞書は作らない。
- F4 normalization dependency（既存の変換の counterfactual decomposition。predicate は変更しない）: raw / NFKC 後 / NFKC + 空白除去後 / 最終 normalized（+ 数字除去）の各段階で `prefix(inner)` 形になるか、最初に形になる段階（path）、digit removal 後に初めて形になるか（`digit_removal_dependent`）。
- F5 neighboring rows: ±2 logical rows のみ（拡張しない）。各 neighbor の index・code-shaped・request-shaped・frozen label-shaped・x / y・raw・token 数。
数値 feature の disjoint 判定は固定の bin で行う（個数: 0・1・2・3〜5・6〜10・11 以上、normalized top: 0.02 刻み、x: 10pt 刻み、幅: 20pt 刻み、高さ: 2pt 刻み）。単一 threshold の探索・最適化はしない。

## 3. 比較 population（排他。上から順に最初に当たるもの）
P1 projected_same_row（alternative が `label_on_first_code_row` で採用した、`same_as_first_code` の candidate）／P2 ambiguity_additional_after_code（ambiguous page の `after_first_code` の ambiguity-causing additional candidate）／P3 nonambiguous_additional_after_code（ambiguous でない page の `after_first_code` の additional candidate）／P4 before_first_code の candidate（projected・additional を問わない）／P5 other（上記以外。件数を隠さず保存。分類不能は P5 に入れ、推測しない）。1,123 page と candidate row 数を混同しない。

## 4. Primary analysis
A1 accounting（総 candidate row・page・page あたりの分布・P1〜P5 の row / page 数・provenance の欠落）。A2 feature overlap（P1 と P2 の分布・overlap・disjoint か・missing）。A3 exact structural separator（P1 と P2 を完全に分離する既定の categorical / boolean / bin feature を列挙）。A4 normalization dependency（P1・P2 の digit removal 依存件数・overlap・shape 成立までの path）。separator は **projection context**（relative position・index・neighbor の順序・first code row との関係など、first code row を中心とする projection の定義に結び付くもの）と **row-local predicate / lexical / geometry evidence**（F2・F3・F4 と F1 のうち candidate 自身の code-shaped / request-shaped）に分けて報告する。`same_as_first_code` vs `after_first_code` の完全分離は結果として記録するが、projection mechanism と結び付くので lexical specificity の十分性とは見なさない。

## 5. Decision rule（結果を見る前に固定）
- D4 `INCONCLUSIVE`: candidate universe を再現できない（既知値: 総 P1 = 2,532 row・ambiguous page 1,123・P2 = 1,786 row と一致しない）、provenance の欠落が 0 でない、accounting が合わない、frozen predicate を再現できない。
- D1 `AMBIGUITY_STRUCTURALLY_ISOLATED`: accounting が完全で provenance 欠落 0、かつ **row-local**（projection context を除く F2・F3・F4 と candidate 自身の code-shaped / request-shaped）の feature に、P1 と P2 を完全に分離（値の集合が disjoint）するものが 1 つ以上ある。その feature は manual contract・MOF・組織名辞書・human label を使わず、deterministic に再現できる。次 phase で predicate refinement を preregister する根拠にのみ使う（production GO ではない）。
- D2 `AMBIGUITY_PARTIALLY_ISOLATED`: D1 でなく、row-local に完全分離する feature はないが、(a) projection context の feature だけが完全に分離する、または (b) row-local feature の P1 / P2 の分布の total variation distance ≥ 0.5 のものがある。
- D3 `AMBIGUITY_NOT_ISOLATED`: 上記いずれでもない。
- 判定の順序: D4 → D1 → D2 → D3。

## 6. Post-freeze representative inspection
primary の artifact と decision の freeze 後にのみ、deterministic（辞書順）に P1 の先頭 5・P2 の先頭 5・P2 の主要な lexical / normalization class（F4 の path 別）ごとの先頭 3・overlap のある feature の class の先頭 3 を保存する。新しい rule は追加せず、「本文」「header」の判断は `post_hoc_interpretation` と明示する。

## 7. 禁止・順序
frozen predicate・alternative rule・current projection・normalization・title extractor・DocumentHierarchy・FieldResolver・recordKind・item detector の変更、unresolved 5 page の救済（request 行からの救済・second code row の探索・前後 page からの補完・復興庁の例外）、manual contract / MOF / 組織名辞書 / existing ON kind の使用は行わない。Commit A（本書）→ B（candidate universe freeze）→ C（comparison / decision）→ D（result・representative examples）。candidate membership を結果後に変更したくなったら STOP。
