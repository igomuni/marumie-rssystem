# 明細表 ↔ MOF 突合 X anchor carry（直前の項の行を持つ DETAIL まで戻って項を持ち越す）— development preregistration

状態: **契約（実行前に固定）。** 結果は別の task doc に書く。閾値なし、記述のみ。昇格・matched はなし。
**位置づけ（重要）: これは post-hoc development hypothesis。** X carry-forward（#451）で失敗した220行を見て着想した規則なので、**その220行での結果は development evidence であり、confirmatory validation ではない。** 高い一致率が出ても、それだけで K2（項の持ち越し）を採用しない。採用前に、独立な validation set（別所管・別 source 群の hold-out、または別年度）が要る。
前提: #451（上方向の最初の `NN[N] 名称` 行を項として持ち越す規則は棄却）。J1、eligible の定義、入力 hash guard は変えない。O の一般化・H1 全体は PAUSED のまま。

## 規則（事前固定。MOF の値は anchor の探索に一切使わない）
- 対象 DETAIL T に「immediate X」（直前の行が `CODE3`/`CODE2` で `^([0-9]{2,3}) (.+)$` に合う）が無いとき、同じ source の行順で T より上を探し、**自身の直前の行が immediate X となる、直近の先行 DETAIL D** を anchor DETAIL とする。
- D の直前の行の名称部を `X_anchor` とし、T に持ち越す。D が無ければ anchor なし。
- 「直前の DETAIL の X を再帰的に推測する」ことはしない。必ず source 上で immediate X を直接持つ DETAIL まで戻る。
- `X_anchor` を取った後で初めて MOF と `sectionName == X_anchor` の exact で比較する。正規化・部分一致・NFKC・金額・辞書・O は使わない。

## 集計（development set = J1 単一694のうち immediate X が無い220行、および J1 複数215のうち immediate X が無い121行）
- anchor 取得可 / 不可。
- anchor までの DETAIL 数（T の1つ上から D まで、D を含む）の分布: 1 / 2 / 3〜5 / 6以上。
- anchor 行（D の直前の行）から T までの物理 `row_index` 距離の分布: 1〜5 / 6〜20 / 21〜100 / 101以上。T と D の間にある行（D から T の1つ前まで）の `row_type` 別の行数と、`NN[N] 名称` に合う `CODE3`/`CODE2`（途中の区分）の行数。
- **単一220:** `sectionName == X_anchor` の行数を、anchor までの DETAIL 数の区分ごと、所管ごと（hold-out の設計用）に示す。不一致の例を各区分から最大5件、行コードとともに列挙する。
- **複数121:** `sectionName == X_anchor` を満たす J1 候補の数（0 / 1 / 2+）を同じ区分ごとに示す。1件でも matched に昇格しない。1件になる行の候補の `col4Raw` が末尾2桁と一致する数（K3 の記述。独立な裏付けではない）。
- 対照として、immediate X がある単一474行・複数94行は、本規則では対象外（結果は K2 と同じ）。

## 禁止・限界
- 結果を見て規則を変えない。変種は新しい事前登録とし、同じ220行・121行を validation として再利用しない。
- 一致は記述で、項であることの確認ではない。昇格・正規化の採否は別。
