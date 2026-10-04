# 概算要求PDF 項候補数の全コーパス確認 — 事前登録（development 結果・規則・全件走査方法）

full-corpus baseline・hierarchy failure isolation（branch `research/budget-request-hierarchy-failure-isolation`、result freeze `a671aca`）の後続。population-size diagnostic であり、候補は正式な項 GT ではなく、MOF XML の 784 項を PDF 側の正解母数とも仮定しない。74 PDF の候補件数は、本書を commit するまで計算・閲覧しない。

## 0. 依存の確認

baseline の 82 PDF / 9,899 pages、一般会計 50 PDF・特別会計 32 PDF、item 97（一般会計 81）、一般会計の項照合 77 / 79、hierarchy ON/OFF の item 97→0 を既存 artifact から確認済み。各 frozen artifact の hash（baseline 各 artifact・isolation の `transition-evaluation.json` `off-diagnostic.json`・P1 matcher）は走査 script が実行時に照合する。MOF XML の項 784 は `budget-jikou.jsonl` の 784 section（#371 の frozen evaluation）。

## 1. Candidate mechanism（upstream の観測）

- 使う表現: SourceToken → TableGeometry → LogicalRow → FieldResolver の row-local 出力（行頭 token の code 観測、名称）を `hierarchy = null` で得たもの。hierarchy・MOF・金額は参照しない。実体は baseline の null 区間の records と、8 PDF の hierarchy 区間は isolation の OFF 出力（hierarchy を渡さずに同一ページを再実行したもの）。
- 3 桁 code: `rowLocal.code`（行頭 token の 3 桁数字。request 行は行頭の request 番号の次の `NN-NN` code）。code token の x は `rowLocal.code.evidence.bboxUnion.xMin`。
- Fact（development の 8 PDF の観測）: request 行の code x は一般会計 65.57・特別会計 79.37 で PDF 内でほぼ一定。ON で item だった行の code x は 58.67 / 72.47 で、request の code x より 6.90pt 左（1 インデント）。organization は一般会計で 52、特別会計で 66。名称・金額の有無は項と明細行を分けない（ON item の名称は resolved 95・ambiguous 2、金額あり 28 で、明細行と同様に分布）。したがって row-local の形だけでは項は判別できず、インデント位置が唯一の識別手がかりになる。
- この x 位置の規則は DocumentHierarchy の indent sequence と同系統の手がかりを、request 行を基準に row-local だけで使うもの。semantic な項の検出器ではなく item-shaped row candidate detector と呼ぶ。

## 2. Development check（8 PDF の hierarchy 区間。`development-comparison.json`、SHA-256 `86938afb…f54`）

| 指標 | 値 |
|---|---:|
| candidate rows | 158 |
| 既存 item 97 のうち候補に入る | 97 |
| 候補だが既存 item でない | 61（ON で organization 7・unclassified 54。名称 resolved 60・ambiguous 1） |
| 既存 item で候補に入らない | 0 |
| within-document unique / duplicate / ambiguous | 155 / 0 / 3 |

PDF 別: cfa 13 候補（既存 item 0。x が item 位置の行は organization 7・unclassified 6）、env 35（item 17）、maff-fukko 8（8）、meti 32（30）、mext 19（19）、mhlw 14（14）、mlit-fukko 8（8）、mod 29（item 1。残りは ON で unclassified）。

注意: x のオフセット 6.9pt と許容 1.0pt は、この 8 PDF の request / item の x から固定した定数であり、97/97 は規則の独立な検証ではない（development 内の整合）。candidate-but-not-item 61 件は、ON の hierarchy が organization / unclassified とした行で、これらが誤検出か、hierarchy 側の未判定か、この PDF の layout で項に相当するかは今回判断しない（人手 GT は作らない）。

## 3. 凍結する candidate rule（`scripts/pipeline-v2/lib/budget-request-item-candidate.ts`）

1. 同一 PDF の走査範囲の request 行（recordKind=request。行頭の request 番号 + code を観測した行で、hierarchy に依存しない）の code x（0.01pt 丸め）の最頻値を `refX` とする。同数なら小さい x。request 行が 5 件未満なら `no_reference`（候補を数えない。別枠で報告）。
2. 候補 = recordKind=unclassified（hierarchy=null の出力で plain code の行）かつ code が `^\d{3}$`（4 桁等は除外）かつ `|codeX - (refX - 6.9)| ≤ 1.0`。ハイフン付き code と request 行は候補にならない（行頭 token が request 番号 / ハイフン code の行は plain code ではない）。
3. 名称は FieldResolver の `name`（status=resolved のときのみ値を使う）。名称が resolved でない候補は ambiguous（候補行には数えるが key を持たず、unique 集計に入れない）。名称の補完・推測はしない。
4. key = `code | normalizeKey(name.raw)`（P1 と同じ NFKC + 空白除去。それ以外の正規化・fuzzy は使わない）。within-document unique = 同一 PDF 内の distinct key 数。duplicate rows = key を持つ候補行 − within-document unique。cross-document unique は組織を特定できない参考値で、semantic な項数としては扱わない（code を省庁横断の ID と仮定しない）。
5. page continuation は扱わない（行単位。ページをまたぐ名称の継続は FieldResolver の name status に依存し、ambiguous になる）。
6. organization / 明細行 / 金額行との衝突: 規則は x 位置だけで項を絞るため、organization 行（cfa のようにインデントが項の位置にある layout）や、ページ左端などの数字は候補に混ざり得る。除去せず candidate として数え、混入は development の 61 件のように記録する。
7. unsupported: `no_reference` の PDF、rotate=90 などで上流 artifact が無い PDF は候補を数えず、coverage の分類に入れる。

## 4. 全件走査（freeze 後に実行。`scan-budget-request-item-candidates.ts`）

- 82 PDF を分類: `scannable`（baseline が success）/ `unscannable_rotate90`（結果の error に rotate=90）/ `unscannable_missing_upstream_artifact` / `unscannable_other`。production extraction の修正・再抽出はしない。
- 集計: 全会計・一般会計・特別会計、hierarchy 契約あり 8 PDF / 契約なし 74 PDF、省庁別、PDF 別。candidate rows・within-document unique・duplicate・ambiguous を分けて出す。
- 8 PDF（契約あり）は PDF 全体（null 区間は baseline、hierarchy 区間は OFF 出力）を走査する。

## 5. MOF 784 との比較

一般会計について「MOF XML 784 / PDF candidate rows / PDF within-document unique / 現行 production item 81」を並べる。比率は candidate-count ratio to MOF（参考値）と呼び、recall・coverage とは呼ばない。理由: 概算要求と当初予算で予算段階が異なる／PDF 側の全項 GT がない／rotate=90 等の未走査がある／code 体系が異なる／同名・統合・分割があり得る。

## 6. Optional: MOF exact-name overlap（件数 freeze 後のみ・診断）

候補名（上と同じ normalizeKey）と MOF section 名の exact 一致のみ。組織が安全に得られないため名称単独の exact は diagnostic only とし、unique / ambiguous / no exact を分ける。MOF の一致有無で候補を増減しない。一般会計のみ。baseline の正式照合（一般会計 77 / 79 = 97.5%、hierarchy 付き population）を基準情報として併記する。

## 7. 判定規則（機械的。件数同士の比較のみ。結果を見た後に条件・閾値を足さない）

量: 契約なし 74 PDF のうち `scannable` かつ reference ありの PDF について、`R` = candidate rows、`U` = within-document unique、`D` = duplicate rows、`A` = ambiguous、`Pub` = 候補を持つ publisher の数。`productionItems` = 現行の item records 総数（97）。

1. `INCONCLUSIVE`: development で既存 item が候補に全て入らない／契約なし 74 PDF に reference のある scannable が 0／unscannable な PDF 数 ≥ scannable な PDF 数。
2. `ITEM_CANDIDATES_EXIST_BUT_AMBIGUOUS`: `A > U` または `D > U`。
3. `NO_LARGE_HIDDEN_ITEM_POPULATION`: `R ≤ productionItems(97)` または `Pub < 2`。
4. `ITEM_POPULATION_HIDDEN_BY_HIERARCHY`: 上記以外（契約なし PDF 単独の候補 R が現行 item 97 全体を上回り、2 publisher 以上に存在し、ambiguous・duplicate が unique を上回らない）。

どの判定でも candidate = 正しい項とは主張しない。

## 8. 順序・禁止

Commit A（本書・candidate lib・tests・development artifact・走査 script を凍結）→ Commit B（全件走査・optional 診断）→ Commit C（result freeze）。DocumentHierarchy・FieldResolver・recordKind・MOF matcher の変更、item の production 補完、fuzzy、人手 GT、rotate=90 対応、MOF 784 を母数とした recall 算出、PR 作成は行わない。
