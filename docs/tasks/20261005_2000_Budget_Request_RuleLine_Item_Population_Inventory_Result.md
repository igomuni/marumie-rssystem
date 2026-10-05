# 罫線基準「項」population inventory / MOF 突合 — Result

Written for: 本研究チェーンの次フェーズ判断者。

## 結論（記述的。機械判定の閾値は置いていない）

事前登録した structural 定義（罫線 → plain 3 桁 NNN → 名称 → **金額列に numeric token が 1 つ以上**）の row は全 corpus で 5,255 件（全件 rule_linked）。罫線から NNN までの距離は 7 種の 0.1pt 値に量子化されて観測された。一般会計の MOF 784 項と code + 正規化名称で exact 一致した distinct MOF 項は **5 / 784**。この定義では MOF 項の大半（および既存 hierarchy の item 97 のうち 69）が universe に入らない。**amount evidence 条件が「項」行の取得を妨げている**という観測が最大の結果（候補の条件は結果を見て変更していない）。記述ラベルとしては `RULE_DISTANCE_MULTIPLE_ITEM_PATTERNS_OBSERVED` ではなく、むしろ「この structural 定義では MOF overlap が極端に小さい」（`RULE_DISTANCE_NOT_INFORMATIVE_FOR_MOF_OVERLAP` に近いが、universe 定義の限界によるもので距離の情報量の否定ではない）。

## Fact

- Pre-flight: 親 `f02239a`、frozen hash 一致、working tree は既知の `.DS_Store` 2 件のみ、production diff 0。
- Phase A（freeze `65df723`、source-only）: coverage は 82 PDF / 9,899 page のうち scannable 74 PDF / 8,663 page、`unscannable_rotate90` 8 PDF / 1,236 page（coverage gap）。入力は frozen baseline の row-local records（hierarchy 区間は OFF artifact）。gate 全 PASS（duplicate 0・provenance loss 0・`leftRuleX < codeX`・距離 > 0・nearest eligible・rule の raw provenance）、再実行 byte 一致。MOF・hierarchy・manual・既存 item・既知の indent 定数は未参照（source scan test）。
- structural row 5,255（一般会計 4,557・特別会計 698）。rule_linked 5,255、rule_unavailable 0、rule_ambiguous 0。名称 status: resolved 4,737・ambiguous 517・unresolved 1。amount evidence パターン（前年度 P・要求 R・差 D）: PRD 5,126・P-D 88・-RD 41。
- 距離の分布（0.1pt 丸め、raw 範囲 1.725〜43.140、0.001pt 丸めでは 54 種）: 1.7pt 59 件（22 PDF）、8.6pt 210（44 PDF）、15.5pt 9（8 PDF）、22.4pt 2,077（56 PDF）、29.3pt 2,799（49 PDF）、36.2pt 78（8 PDF）、43.1pt 23（7 PDF）。全 value は `phaseA-summary.json` に保存。隣り合う値の差はほぼ 6.9pt（インデント 1 段）。
- Phase B（`06294f2`、Phase A freeze 後に MOF を読む）: MOF 一般会計の項は 784（distinct code 259・distinct 正規化名称 750）。一般会計 candidate 4,557 の分類: code_name_exact_unique 5、code_name_exact_ambiguous 0、name_exact_ambiguous 23、name_exact_code_mismatch 169、code_exact_name_mismatch 3,611、no_exact_match 274、name_unavailable 475。特別会計 698 は未評価。
- **distinct MOF item exact-overlap count / 784 = 5 / 784**（unique 行のみでも 5）。
- 距離 × MOF 一致（code + name exact の row / distinct MOF 項）: 8.6pt は 4 row・4 項（candidate 210、一般会計 176）、29.3pt は 1 row・1 項（candidate 2,799）、それ以外の距離は 0。8.6pt の一般会計 176 行の内訳は code_name_exact_unique 4・name_exact_ambiguous 21・name_exact_code_mismatch 149・name_unavailable 1・no_exact_match 1。22.4pt / 29.3pt の一般会計行は code_exact_name_mismatch が大半（それぞれ 1,526 / 2,035）。5 件の一致項は 8.6pt の 4 件（附帯・受託工事費、防衛装備庁共通費、厚生労働本省共通費、防衛力基盤強化推進費）と 29.3pt の 1 件（デジタル庁共通費）。
- MOF 側 unmatched inventory（784）: code+name exact の candidate あり 5、名称一致のみ 183、code 一致のみ 490、candidate universe に対応候補なし 106。これは「PDF から取りこぼした」ことを意味しない（universe の定義・coverage gap・PDF 側不在を区別していない）。
- secondary（candidate rule の変更には使わない）: 既存 hierarchy item 97 のうち universe に含まれるのは 28（うち 8.6pt 22・22.4pt 6）、含まれない 69 は全件 `no_amount_evidence`（金額列に numeric token が無い行）。previous 一般会計 candidate 641 のうち universe に含まれるのは 155（すべて 8.6pt）、含まれない 486（全 candidate 929 では 195 / 734）。new-only の距離は 22.4pt と 29.3pt が大半。previous の MOF 名称単独 exact 診断（一般会計 candidate 641 行・名称あり 618 のうち unique exact name 534）と今回の code + name exact（5 行）は定義が異なる。

## Observation

- 距離が 8.6pt の行は既存の「request x − 6.9pt」条件の候補・既存 item と重なる（previous 155 件がすべて 8.6pt）一方、22.4pt / 29.3pt の行（計 4,876）は plain 3 桁 code と amount を持つが MOF の項コードとは一致しない（code は一致しても名称が不一致）。距離だけでは「項らしさ」を示す一意のパターンは観測されず、MOF overlap は 8.6pt に集中している（5 項中 4）。
- 既存 item 97 のうち 69 件は amount evidence が無いため、今回の structural universe（amount 条件あり）に入らない。この amount 条件は、項行（code + 名称のみで金額が空欄の見出し行が多い）を構造的に落としている可能性が高い。

## 限界と次研究候補（開始しない）

- amount 条件（protocol で事前固定）が universe を大きく狭めている。次研究では amount evidence を条件にしない structural universe（罫線 → NNN → 名称）を事前登録して再 inventory する根拠がある。
- rotate=90 の 8 PDF（1,236 page）は未対応（coverage gap）。名称が取得できない candidate（一般会計 475）は name_unavailable。MOF 784 は PDF 側の正解母数とは仮定していない。specials は未評価。
- 本研究は inventory のみで、item detector の採用規則は次研究で事前登録する。

## Validation

tsc 0 error、lint error 0、vitest（structural row・left rule・丸め・source scan）pass、Phase A / B の再実行で byte 一致、frozen hash guard、production code diff 0。

今回は population inventory のみ。production・hierarchy・FieldResolver・recordKind・item detector・rotate は変更していない。MOF は Phase B の diagnostic だけに使い、教師にも oracle にもしていない。
