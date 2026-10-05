# 概算要求PDF page header label / segment inventory — protocol（extraction・segmentation・Phase B・判定規則を Phase A の全件走査前に固定）

organization / root 境界の source evidence inventory（branch `research/budget-request-organization-root-source-evidence`、`9fbeb57`）の後続。追加する evidence class は **page header / first title line の label** だけ。label の意味（組織略称か等）は解釈せず、外部辞書・MOF・一般知識との照合もしない。production（DocumentHierarchy・FieldResolver・recordKind・SourceToken/TableGeometry の production semantics・item detector・MOF matcher・rotate 対応）は変更しない。既存 manual contract・existing ON kind は human GT ではなく、manual range との一致を semantic GT とは扱わない。

## 0. Discovery provenance と仮説
label 候補は前回 inventory の post-hoc 観測（mhlw: page 1554→1555 `厚（障）`→`厚（地）`、1700→1701 `厚（労）`→`厚（中）`。mext: `文（所）`→空 title の page 1044→`文（文）`、ただし mext の manual range 内部でも label は変わる）から、既存 hierarchy 契約 8 PDF（特に mext / mhlw）で発見された。8 PDF 上の一致は development observation で、それ以外の evaluable PDF は non-discovery set として別集計する（semantic GT がないため held-out accuracy とは呼ばない）。
仮説: first title line の raw label sequence は、PDF を deterministic な contiguous segment に分割する source primitive として使え、その境界は layout・manual activation range・既存 hierarchy root / item-shaped row の構造と対応する。

## 1. Phase A — source-only label projection（manual range・existing kind・MOF を使わない）

### upstream の実体（code evidence）
pdf.js text → SourceToken → TableGeometry → LogicalRow（`resolveLogicalRows`）を、PDF ごとに 1 回 open して page ごとに再実行する（`extractPageTokens` と同じ `getTextContent({ disableNormalization: true })`・`toSourceTokens`・`buildTableGeometry`。production は変更しない）。page の logical row は 0 件以上。

### title 行と first title line の定義（固定）
- logical row の分類: visual order の非空白 token 列 `texts` について、`request`（texts[0] が `^\d{1,3}$` で texts[1] が `^\d{2}-\d{2}`）、`plain3`（texts[0] が `^\d{3}$` で 2 token 以上）、`plain3_only`（texts[0] が `^\d{3}$` のみ）、`hyphen`（texts[0] が `^\d{2,3}-\d`）、それ以外は `other`。`other` 以外が code 行。
- title 行 = page 内で最初の code 行より前の logical row（code 行が無い page は全 row）。first title line = title 行のうち先頭の 1 行。raw = その行の非空白 token の rawText を visual order で空白 1 つで連結した文字列（正規化・補正なし）。page あたり最大 1 件。
- 上流で扱えない page の表現: rotate ≠ 0 → `unavailable_rotate90`（`pageMetaFrom` が例外にする既存挙動に従う。rotate 対応は実装しない）、PDF が無い・hash 不一致 → `unavailable_upstream`、他の例外 → `other_unavailable`。

### 正規化・status・lexical shape（固定。結果を見て変更しない）
- `firstTitleNormalized` = raw に NFKC を適用し、全ての空白（Unicode の空白類）と数字（`\d`。ページ番号の印字位置が奇数・偶数 page で左右に入れ替わるため）を除去した文字列。意味変換はしない。raw は必ず保持。
- status: `observed_nonblank`（normalized が空でない）、`observed_blank`（page は取得できたが、title 行が無い・first title line が空・normalized が空（数字のみ）。`blankReason` = `no_title_row` / `empty_row` / `digits_only`）、`unavailable_upstream`、`unavailable_rotate90`、`other_unavailable`。blank と unavailable は別 status。
- lexical shape（inventory 用。規則として採用しない）: normalized の長さ、半角丸括弧が 1 組で `prefix(inner)` 形か、prefix 長・inner 長、それ以外は `other`。
- sourceRefs: first title line の `logicalRowIndex`・`physicalRowIndexes`・`tokenIndexes`。

### segmentation（固定。fail-closed）
隣接 page（page 番号が連続）の `observed_nonblank` で `firstTitleNormalized` が完全一致する間を同一 label segment。`observed_blank`・各 unavailable は独立の state（連続する同 status の page は 1 つの state run）。blank・unavailable を跨いで同じ label を結合しない（`A, A, blank, A` は A・blank・A の 3 つ）。blank の前後の page から label を carry-forward / backward-fill しない。segment id は PDF 内の連番。

### Phase A で出す集計
coverage（PDF・page・evaluable・observed_nonblank・observed_blank・unavailable・rotate90）、label vocabulary（distinct の raw / normalized・lexical shape・`prefix(inner)` 形・blank 数・PDF ごとの unique label 数）、segment（総数・PDF ごと・長さの分布・transition 数・同 label の非連続な再出現・blank を挟む transition・page 1 から label があるか）、stability（PDF ごとの label 数・blank 率・transition 率を raw count / ratio で）。discovery set（既存 hierarchy 契約 8 PDF）と non-discovery set を別集計。
Phase A の projection artifact を Commit B で freeze し、Phase B の結果を見て extraction / segmentation を変更しない。

## 2. Phase B — structural comparison（Phase A の freeze 後）
- layout: label transition が layout range 境界と一致 / layout range 内部 / layout unavailable / blank・unavailable を伴うか、逆に各 layout 境界が label transition を伴うか。
- manual activation range（discovery 8 PDF）: 開始・終了の直前・当該・直後 page の label、exact transition・blank の有無、label segment 境界との一致、layout 境界との一致（6 PDF では label が layout への追加情報か共起のみかを分ける）。mext・mhlw は個別節（segment 構造・manual 境界が segment start / end か・範囲内部の transition の位置と頻度・manual 境界が他の transition と構造的に異なるか）。
- existing hierarchy / item-shaped: organization 7・item 97・detail_line 613・unclassified 170（`population-887.json`）について、segment 先頭からの page 距離・segment 内の最浅 x-level 行か・segment の最初の 3 桁 plain code 行か・segment 内の root-shaped 行の数。
- x=38 の浅い 3 桁 code 行（前回、mext / mhlw の manual range 外で各 450）: 属する label segment・segment transition との共起・segment 先頭直後への集中・manual 内外の分布。意味は解釈しない。

## 3. Decision gate（Phase B を見る前に固定）
- G1（source primitive）: corpus 全体で observed_nonblank page / evaluable page ≥ 0.5 かつ non-discovery 集合でも ≥ 0.5。
- G3（manual 境界の追加説明）: mext・mhlw の manual 境界のうち文書端でないもの（mext 開始 1045・mhlw 開始 1555・mhlw 終了 1700）がすべて label segment の開始 / 終了 page と一致し、かつ layout 境界では説明できない（layout range の境界でない）。
- G4（境界の特異性）: mext・mhlw のそれぞれで、manual 境界以外の label transition の数（PDF 全体）が 2 以下。
- G5（一般性）: non-discovery の evaluable PDF の 50% 以上で、observed_nonblank page のうち `prefix(inner)` 形が 50% 以上。
- 数値は前回の観測（mext の manual range 内にも label 変化がある）を知った上で、特定の PDF に合わせず事前に決めた値。G4 は厳しく、D1 に届かない見込みであることを開示する。
- 判定（上から順）: 1. evaluable page が全 page の 50% 未満、または source population の不一致 → `INCONCLUSIVE`。2. G1 が偽 → `HEADER_LABEL_SOURCE_UNSTABLE`。3. G1・G3・G4・G5 が真 → `HEADER_LABEL_STRUCTURAL_SEGMENT_SUPPORTED`。4. G3・G4 が真で G5 が偽 → `HEADER_LABEL_LOCAL_ONLY`。5. それ以外 → `HEADER_LABEL_PRESENT_BUT_NOT_BOUNDARY_SPECIFIC`。
- 結果を見た後に gate・分類を変更しない。D1 でも label の意味は調べない（次 phase は別の Semantic Inventory）。D2〜D5 では semantic inventory へ進まない。

## 4. 禁止・claim boundary
label の意味付け（`厚`・`文` 等）、外部辞書・MOF・所管名との照合、blank の bridge / carry-forward、manual range を segment 生成に使うこと、Phase B の結果での rule 変更、production 変更、item coordinate detector・request frame・rule-line anchor・sparse・level_gap・rotate の同時改善は行わない。主張の上限: page header / first title line を source primitive として抽出し、exact sequence から deterministic な contiguous label segment を構成できるか、その segment が layout range・既存 manual activation range・既存 root / item-shaped row とどのような構造関係を持つかを評価した、まで。
