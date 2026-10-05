# 概算要求PDF 8.6pt 項候補の全 corpus 抽出（rotate=90 を含む）— protocol（全件評価の前に固定）

指示: `docs/chats/20261001_2104_概算要求対応の検討/20261005_2108_Full_Corpus_8p6pt_Detail_Row_Extraction.md`。直前研究（`30ff61f`、protocol `20261005_2040_…8p6pt_Item_Candidate_Full_Corpus_Protocol.md`）の candidate rule・band・名称条項・縦罫線 linker・MOF 名称 only exact・normalization を**そのまま**使い、変更点は次の 2 つだけ。(1) rotate ≠ 0 の page も除外せず、人が通常の PDF viewer で見る向きに座標を正規化して評価する。(2) candidate ごとに rotate・raw row text・account を保存する。総表・hierarchy・`recordKind=item`・request x・`requestX − 6.9pt`・金額・MOF（Phase A）・code+name exact（primary）は使わない。band（5.6 ≤ deltaX ≤ 11.6）は結果を見て変更しない。

## 1. Candidate rule（前回と同じ）
logical row のうち、request-shaped（`recordKind === 'request'`）でなく、行頭 code が plain 3 桁（`^\d{3}$`、FieldResolver の row-local code 観測）、名称 text が非空と確認できる（resolved、または `continuation_ambiguous` で名称 token はあるが連結不能 = `nameComplete=false`。連結を推測しない）、左の縦罫線（page の全 merged vertical rule のうち、codeX より左で row bbox の vertical midpoint を y 区間が含む最近傍）が一意に取れ、`deltaX = codeX − ruleX` が 5.6〜11.6pt（端を含む）。金額は条件にしない（blank でも残す）。rule 不在・曖昧は status を分けて保存し補完しない。

## 2. rotate 正規化（新規。production code は変更しない）
- 対象: 全 82 PDF の全 page。page の `rotate` が 0 の page は前回と同じ経路（frozen baseline の records、または同じ pdf.js 抽出）。rotate ≠ 0 の page を含む PDF（前回 `unavailable_rotate90` だった 8 PDF）は、research 側の抽出で records を作り直す。
- 座標系: pdf.js の `page.getViewport({ scale: 1 })`（page の rotate を含む表示向き）の transform `M` を使い、text item の transform `T` を `U = F∘M∘T`（`F = [1,0,0,−1,0,viewport.height]` で y を上向きに戻す）に変換した上で、既存の `toSourceTokens` に渡す（meta は view = [0,0,viewport.width,viewport.height]、rotate = 0 の表示正規化 page として構成）。これにより token の bbox は表示上の左 → 右・上 → 下の座標になる。
- 罫線: `extractDrawingPrimitives`（既存、user space・左上原点）の線分の端点を `convertToViewportPoint` で表示座標へ変換し、orientation を再導出してから既存の `mergeVerticalRules` に渡す（rotate 0 の page は変換しない）。
- records: 正規化した tokens に対し既存の `buildTableGeometry` → `resolveLogicalRows` → `resolveFields({pages, hierarchy: null})`（row-local のみ。hierarchy を使わない）。
- 検証 gate: 合成 transform での正規化の単体 test、rotate 0 page で research 経路の tokens が production の `extractPageTokens` と一致すること、前回 Phase A の 74 evaluable PDF の candidate 集合（916 件）を本研究の同じ PDF で再現すること。
- 評価できない page・PDF は理由付きの status として保存し、除外ではなく fail-closed で報告する。

## 3. 保存項目（candidate ごと）
PDF の完全な local path・filename・page・rotate・logical row 識別（logicalRowIndex、candidateId）・raw row text（その page の source token のうち bbox の縦中心が row bbox の y 区間に入るものを x 昇順に連結。source 由来のみ）・plain 3 桁 code・抽出名称（nameRaw / nameNormalized / nameComplete / nameStatus）・vertical rule provenance（merge 元 path index・y 区間・線幅）・ruleX・codeX・deltaX・request-shaped でない判定・account（manifest の source metadata）・status / unavailable reason。pre-band universe（band 外の row も deltaX 付き）も保存する。

## 4. Phase B（freeze 後のみ MOF）
前回と同じ: MOF 一般会計 784 項（distinct `parentSectionId`、784 でなければ STOP）、`normalizeKey` による**名称 only** exact、code は診断のみ。MOF row coverage と distinct normalized name coverage、exact match candidate 行数と unique / ambiguous、未一致 MOF 項の全件一覧（所管・code・名称）、exact match の全 candidate（MOF 項・PDF path・page・candidate code / 名称・ruleX・codeX・deltaX）、未一致の所管別件数。candidate 0 件 PDF と評価不能 page / PDF の path 一覧。今回は Phase C（band 外診断）は行わず、この抽出と実測だけで終了する。

## 5. 禁止・STOP・commit
総表を GT にした項の先行列挙・hierarchy・level frame・table-frame・header label・MOF を candidate 生成に使うこと・金額条件・band の変更・production detector の変更・新しい detector 仮説・この結果からの別研究の開始は行わない。frozen hash 不一致・前回 candidate の非再現・MOF 784 不一致・production diff は STOP。測定バグは初回出力を保存し独立 commit で修正する。
Commit: protocol → Phase A 実装 + freeze → Phase B → result。PR は作成しない。
