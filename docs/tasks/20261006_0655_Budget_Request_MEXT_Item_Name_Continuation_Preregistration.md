# 文科省 複数行項名称の continuation rule — preregistration（実装・評価の前に固定）

Phase A（`phaseA-isolation.json`）の failure isolation の結果: 対象 3 項（`_03.pdf` p556・p1141・p1142）はいずれも `SOURCE_CONTINUATION_STRUCTURALLY_SUPPORTED`。物理的に同じ構造（項の名称が同一の名称セル内で次の行へ折り返され、折り返し行には code も金額も無く、同じ行の右側には別セルの「内容 / 要旨」等の説明文が並ぶ）で、既存 FieldResolver の名称 guard predicate（A 直下の行・B 名称開始 x が揃う・C code で始まらない・D 金額列に token がない）が 3 件とも発火する。現行抽出で exact にならない理由は、p1141 / p1142 では LogicalRow が右側の説明文のため次の行を `ambiguous`（連結せず）にし FieldResolver が `continuation_ambiguous` で abstain するため、p556 では折り返し行が `continuation_by_geometry` に上書きされ項の名称が折り返し前の断片のまま resolved になるため（どちらも production の挙動。変更しない）。

## continuation rule（source-only。MOF・金額 0・対象の filename / page / 名称を使わない）
対象: 既存 8.6pt candidate（frozen universe の `isCandidate`）の logical row L。各 page の column layout は production と同じ `observeColumnLayout`（自 page の見出し、無ければ前 page からの carry-forward と `layoutForPage` の corroboration）。
1. 基底名称: L の非空白 token から code token を除き、token の中心 x が layout の `name` 領域内のものを、physical row ごとに x 昇順に連結した行を作る（production の名称構成と同じ）。
2. continuation: cur = L として、同一 page の次の logical row `next` が、既存の凍結済み predicate（`observeIncompleteNameGuard` = A ∧ B ∧ ¬C ∧ ¬D。行間 0.75〜1.5 × 基準フォントサイズ・名称開始 x の差 0.25 × 基準フォントサイズ以内・code で始まらない・金額列に token なし）を満たす間、`next` の非空白 token のうち中心 x が `name` 領域内のものを physical row ごとに x 昇順に連結して名称に追記し（領域外の token＝右側の別セルは追記しない）、cur = next として繰り返す。満たさなくなった行、または page の末尾で終了する。
3. 発火 = 1 行以上追記したとき。発火した candidate は nameRaw = 行を `\n` で連結、nameNormalized = `normalizeKey`（凍結済み）、nameComplete = true。発火しない candidate の名称・code・anchor・deltaX は変更しない（byte-equivalent）。
4. 終了条件に MOF 名称との一致・名称の長さの上限・意味を使わない。新しい閾値を作らない（A / B の係数は既存定数の再利用）。
5. 対象外: 内閣府 `0.pdf` の profile candidate（名称は token から別 rule で構成済み。変更しない）。rotate・drawing-path・anchor の処理は変更しない。

## 検証 gate（結果を見て変更しない）
- 基底名称の同値性: rule が発火しない resolved candidate について、手順 1 の基底名称の正規化が現行の `nameNormalized` と一致する（実装が production の名称構成と同じであることの確認）。
- 発火した全 candidate の before name・追記した source text・after name・PDF / page / row provenance・発火理由・continuation token の bbox・連結行数を保存。
- 既存 717 の exact の loss 0、unrelated PDF の candidate identity・code・anchor / deltaX の変化 0、非発火 candidate の名称変化 0、source にない文字の補完 0、duplicate 0、provenance loss 0。
- negative evidence: baseline の `SOURCE_FULL_NAME_ABSENT` 5 項が exact にならない（なった場合は source token の連続性・離れた行 / 別項 / 別セルの誤連結の有無を確認し、source evidence で説明できなければ STOP）。
- 回収件数は実測（720 を GO 条件にも hard-code にもしない）。
