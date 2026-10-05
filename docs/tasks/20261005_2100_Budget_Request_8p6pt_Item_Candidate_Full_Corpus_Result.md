# 罫線基準 8.6pt 項候補の全 corpus 抽出 — Result

Written for: 本研究チェーンの次フェーズ判断者。

## 最重要結果

**MOF 一般会計 784 項のうち、名称だけで 632 項（80.6%）が 8.6 ± 3.0pt の candidate に存在した**（distinct 正規化名称では 598 / 750）。未一致 152 項のうち 151 項は、source universe のどこにも名称 exact の行が無く、band 外に見つかった項は 0。記述的な分類は **`SIMPLE_RULE_PARTIAL_COVERAGE`**（数値 threshold は後付けしていない）。ただし name-only exact であり precision / recall ではなく、MOF 一致 = 正しい項、未一致 = PDF の抽出失敗、とは断定しない。

| metric | result |
|---|---:|
| corpus PDFs | 82（9,899 page） |
| evaluable PDFs | 74（8,663 page）。`unavailable_rotate90` 8 PDF（1,236 page） |
| candidate rows（8.6±3pt） | 916（一般会計 676・特別会計 240） |
| PDFs with candidate | 57（evaluable 74 のうち。candidate 無し 17） |
| MOF rows with exact-name candidate | 632 / 784 |
| distinct MOF names covered | 598 / 750 |
| unmatched MOF rows | 152 |
| unmatched but exact name found outside band | 0 |
| unmatched with no exact source name | 151（残り 1 は plain 3 桁でない構造で名称 exact あり） |

## Fact

- Pre-flight: 親 `2a1e797`、frozen hash 一致、production diff 0、working tree は既知の `.DS_Store` 2 件のみ。protocol の名称条項は、records に名称断片 text が無いことを全 corpus 集計で確認し、全件評価の前に独立 commit で訂正した（resolved の名称、または `continuation_ambiguous` で名称 token が存在し text を安全に連結できない行を candidate 可、`unresolved` は candidate にしない）。
- Phase A（freeze `f47a524`、source-only、gate 全 PASS、再実行 byte 一致）: pre-band universe（非要求・plain 3 桁・resolved の code）は 16,013 row。罫線 status は rule_linked 13,528・rule_unavailable 2,485（rule_ambiguous 0）。名称 class は resolved 9,652・continuation_ambiguous 3,326・name_unresolved 3,035。candidate = 名称 text あり（resolved 909・continuation_ambiguous 7）・rule linked・5.6 ≤ deltaX ≤ 11.6。金額は条件にしていない。
- deltaX（0.1pt）の分布（universe 全体、上位）: 29.3pt 5,501・22.4pt 4,055・15.5pt 981・8.6pt 916・51.8pt 596・58.7pt 227・36.2pt 191・25.9pt 162・265.7pt 140・43.1pt 105・1.7pt 81・12.1pt 78 など。band（5.6〜11.6）に入る値は 6.9pt（27）・8.6pt（916）・10.4pt（6）で、candidate 916 は 8.6pt に集中している（6.9pt・10.4pt の行は名称が確認できない）。全 value と page 別 candidate 件数は `phaseA-summary.json` に保存。
- Phase B（Phase A freeze 後に MOF を読む）: MOF 一般会計は 784 行（distinct 正規化名称 750）。一般会計 candidate 676 の分類: name_exact_unique 583・name_exact_ambiguous 63・no_exact_name_match 23・name_unavailable 7。exact を持つ PDF は 41、exact 行は計 646。全件は `phaseB-exact-matches.jsonl.gz` に保存。
- Phase C: absent の 152 行を一般会計 PDF の records から名称 exact（deltaX 制限なし）で検索した結果、exact_name_found_outside_8p6_band 0、exact_name_found_but_rule_unavailable 0、exact_name_found_but_not_plain_3digit_structure 1（財務省「公務員宿舎施設費」、code が plain 3 桁でない行 6 件）、no_exact_name_found_in_source_universe 151。
- 評価不能: rotate=90 の 8 PDF（財務省 5・公正取引委員会 1・文部科学省 1・法務省 1）は coverage gap。未一致の MOF 行の所管は内閣府 67・法務省 35・財務省 31・文部科学省 8・その他 11。

## Observation

- 8.6pt の単純規則だけで 784 項の約 8 割の名称が candidate に存在し、距離を広げても取りこぼしは増えなかった（band 外で見つかった項は 0）。未一致 152 のほとんどは「名称 exact の行がそもそも universe に無い」ため、原因は距離ではなく、名称が resolved されない（継続行の連結不能など）か、PDF 側に無い・評価不能 PDF にある、のいずれか。所管が内閣府・法務省・財務省に集中し、財務省・法務省は rotate=90 の評価不能 PDF を含む。
- candidate には item 以外の行も混じる（916 行のうち MOF の名称 exact になったのは 646 行）。candidate が多いこと・code が MOF と一致しないことを理由に rule は狭めていない。

## Interpretation と限界

- name-only exact overlap の診断で、項を拾う主 detector としての可能性は相当にあるが、未一致 152 は 8.6pt の単純規則では拾えていない（独立の failure class として次研究で isolation の対象になる）。
- limitations: rotate=90 の 8 PDF 未対応、`continuation_ambiguous` の名称は exact 照合に使えない、名称 exact の ambiguous（63 candidate）は同名の MOF 項が複数あり行の同定ができない、特別会計 PDF は MOF 一般会計と突合していない、MOF は PDF 側の GT ではない。

## Validation

tsc 0 error、lint error 0、vitest（band 境界・request 除外・plain 3 桁・名称非空・rule provenance・source scan）pass、Phase A / B / C の再実行で byte 一致、frozen hash guard、production code diff 0。

今回は抽出の population 診断のみ。production・hierarchy・FieldResolver・recordKind・item detector・rotate は変更していない。MOF は Phase A に使っていない。
