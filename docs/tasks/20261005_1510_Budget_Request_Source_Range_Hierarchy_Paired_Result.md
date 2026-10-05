# Budget Request Source-Range Hierarchy Paired Diagnostic — Result

Written for: 本研究チェーンの次フェーズ判断者。

## 結論

**D2 `ACTIVATION_RANGE_CHANGES_HIERARCHY_STATE`**（規則 2。D4 ではない）。activation range だけを manual → source-derived layout range に替えると、既存 hierarchy の状態が変わる。manual range は現時点で不要とは言えず、source range が drop-in 置換とも言えない。

## 事実（frozen: `phaseA-evaluation.json` sha `72ad477e…b67b6`）

- same-range 6 PDF（exact_same）: 計 5,893 row 全て unchanged、control = frozen baseline ON records と byte 一致。infrastructure OK、再実行も byte 一致。
- mext / mhlw（source_superset）の intersection 2,080 row のうち 536 row が変化: level_changed 490、newly_unclassified 37、parent_changed 9（primary。flags では root_changed 4、parent 46）。変化はすべて hierarchy 由来の field。
- 状態伝播: x cluster 数が mext 13→27、mhlw 15→34。manual 開始 page 先頭ノードは control では level 1 / 親なし（root）だが、treatment では level 2 で p990 / p1006 の先行ノードを親に解決する。つまり manual 開始位置は、先行 page の見出しを遮断して root にする効果を実際に持っている。
- intersection の kind 遷移（treatment で unclassified 化）: mext は item 19・organization 2、mhlw は item 14・organization 2。range を広げると既存 item の一部が失われる。
- source-only region（mext 3,053 / mhlw 7,001 row）: item 各 1、organization 各 1、親 item が resolved の request 計 191（50 / 141）。region は決定的に処理されるが、cluster が 24 / 31 に増え、unclassified が 1,147 / 1,957。

## Phase B（post-freeze、MOF 名称単独 exact、診断のみ・勘定絞り込みなし）

- intersection の変化 item row（mext 19 / mhlw 14）: exact_unique 14 / 9、exact_ambiguous 3 / 5、name_unavailable 2 / 0。
- source-only item: 各 1 とも exact_unique。
- source-only の resolved request（50 / 141）: jikou_exact_unique 23 / 102、jikou_no_exact_match 1 / 9、parent_no_exact_match 2 / 4、parent_exact_ambiguous 5 / 8、name_unavailable 19 / 15、parent_name_unavailable 0 / 3。
- MOF 一致は source range の正否を示さず、range 選択にも使っていない。optional の item candidate overlap は未実施。

## 解釈と限界

- 原因は range 位置による stack / x cluster の状態差（広い range では先行 page の indent 構造が cluster 配置と親解決に流入する）。変化の「正しさ」は評価していない（manual contract も GT ではない）。
- 母集団は既存 contract の 8 PDF のみ。full rollout 可否は述べない。
- 次の論点候補: source range 内での範囲開始（root 化の遮断）を source evidence で表現できるか。

## Validation

tsc 0 error、lint error 0、vitest（comparator 4 件）pass、Phase A の run / compare 再実行で byte 一致、frozen hash guard、production code diff 0。

今回は paired diagnostic のみ。production / hierarchy / FieldResolver / recordKind / item detector / rotate は変更していない。MOF・manual contract は教師でも oracle でもない。
