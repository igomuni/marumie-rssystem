# FY2025: 確認済みの項で MOF と照合する（所管＋項名＋事項名）— preregistration

状態: **契約（実行前に固定）。** 結果は別の task doc に書く。照合の結果は記述のみで、J1 複数の行の昇格（MATCHED 化）はしない。
前提: #465（FY2025 の項を TOC＋総表で付け、明細表の X と照合。一致 1,477）、#461（J1 単一への K2 の実装）、#457（MOF FY2025 canonical）。
決定: ユーザーが方針に合意（CONTEXT なしの 79 事項は対象外、J1 複数の昇格は記述のみ、#461 との整合は STOP 条件つきの acceptance check）。

## 入力（凍結値と照合。1つでも違えば何も計算せずに STOP）
- 明細表: `data/work/budget-request-csv/2025/detail-table`（output-manifest `0bdeeb37…`）
- 項の候補: `tests/fixtures/detail-table-toc-total-sections/2025/section-candidates.csv`（`cd5ea2ae…`、#465）
- #461 の出力: `data/work/budget-request-csv/2025/detail-table-mof-match`（output-manifest `5b17a565…`）
- MOF canonical: `data/normalized/mof/fy2025/budget-jikou-v1-canonical.jsonl`（`9c0a878b…`）

## 母集団（固定）
- 一般会計の DETAIL 行（明細表の最初の CONTEXT が `NN 〇〇所管`）で、次の2つを満たすもの:
  - TOC＋総表が項を出している（`CANDIDATE_CSV_CONSISTENT`）。
  - その項コード・項名が、明細表の X（immediate X、無ければ anchor carry。#452 の規則）と一致している（#465 の「一致」）。
- 期待する件数は 957（#465 の結果。一致しなければ STOP）。
- 対象外（件数を出す）: CONTEXT のない source（`OUT_OF_SCOPE_NO_CONTEXT`）、特別会計（`OUT_OF_SCOPE_SPECIAL_ACCOUNT`）、TOC＋総表と X が一致しない・片方しかない行、TOC＋総表が項を出していない行。

## 照合（固定）
- 所管 = 明細表の2桁 CONTEXT から取った名称（#461 と同じ）。項名 = #465 で確認した項名（TOC＋総表の `section_name`）。事項名 = 明細表の DETAIL 行のコードを除いた名称（#461 の `detail_name`）。
- MOF キー = `(ministry, sectionName, jikouName)` の exact。項コード（sectionCode）は使わない。正規化・NFKC・部分一致・金額・組織・K3・O は使わない。
- 結果: 候補数 0 / 1 / 2+。

## 集計（記述）
- 母集団を、#461 の status（`K2_SUPPORTED` / `AMBIGUOUS_J1_MULTI` / `UNRESOLVED_J1_NO_CANDIDATE` / `UNRESOLVED_SECTION_MISMATCH` / `UNRESOLVED_NO_X`）× 新しい候補数（0 / 1 / 2+）で集計する。x_source（immediate / anchor）別にも出す。
- J1 複数だった行について、候補数 0 / 1 / 2+ の件数を出す。**1 件になっても MATCHED に昇格しない。** 昇格してよいかは、結果を見たあとの別の研究判断とする。
- #461 で J1 複数かつ K2 で1候補になった 147 行のうち、母集団に入る（＝項が TOC＋総表で独立に確認できる）行数と、入らない行数を出す。

## acceptance check（実装・データ経路の整合。精度評価ではない）
- #461 で `K2_SUPPORTED` だった母集団の行は、新しい照合がちょうど1候補を返し、その MOF の記録（`organization, sectionCode, sectionName, jikouName, col4Raw`）が #461 の出力と一致しなければならない。**1件でも違えば（0候補、2+候補、別の記録）STOP。** J1 へ fallback せず、規則の変更・正規化の追加もしない。
- 事前に分かっている性質（実行前に書く）: 母集団の条件上、確認済みの項名は X と等しい。したがって新しい候補数は、#461 の `k2_candidates` と**すべての行で等しくなるはず**。これは設計上の恒等式で、等しくない行が1つでもあれば実装・データ経路の誤りとして STOP する。この場合、本実験で新しく分かることは「J1 複数や K2 で1候補になる行のうち、項が TOC＋総表で独立に確認できる行の数」であり、MOF の記録の正しさを新たに示すものではない。

## 結果の扱い
- 結果を見て、母集団・規則・照合キーを変えない。変種は新しい事前登録とする。
- 昇格（production の resolution）、CONTEXT なしの 79 事項（TOC の所管の利用）、特別会計 441 事項は本 Task の範囲外。
- 凍結するもの: 行ごとの結果 CSV と集計 JSON（`tests/fixtures/detail-table-mof-section-match/2025/`）。
