# FY2025 の明細表の事項に TOC＋総表で項を付ける（held-out）と、明細表の X との照合 — preregistration

状態: **契約（実行前に固定）。** 結果は別の task doc に書く。MOF との照合はしない。
前提: #463（FY2024 の試作。両方が項を出した 1,414 事項のうち 1,411 が明細表の X と一致）、#464（FY2025 の TOC・総表 CSV を凍結）。試作の規則は FY2024 で作ったので、FY2025 はこの方式にとって held-out。

## 入力（凍結値と照合）
- 明細表: `data/work/budget-request-csv/2025/detail-table`（output-manifest `0bdeeb37…`、#459）
- TOC: `data/work/budget-request-csv/2025/toc`（output-hashes `481e44e4…`、#464。宮内庁 `r07-03.pdf` は未変換）
- 総表: `data/work/budget-request-csv/2025/total-table`（output-manifest `9fb163ae…`、#464）

## 手順2: 項の付与（規則は変えない）
- `python3 -I scripts/research/resolve-detail-sections-via-toc-total.py --input data/work/budget-request-csv/2025 --output <dir>` を、スクリプトを変えずに実行する（SHA-256 `613f9b9582849e1cea165c0064ad8840402884fbae9113c6305e5da498b099ae`）。
- 2回実行して出力が同一であること。`section-candidates.csv` と `summary.json` を凍結する。
- スクリプト内の固定の目視6例は FY2024 の source なので、FY2025 では0件になる（正常）。`summary.json` の scope の文字列が「FY2024」のままなのは、スクリプトを変えないため。
- 記述: 状態別の件数（候補あり、総表が別の PDF、TOC に事項が無い など）、範囲別（一般会計・特別会計・CONTEXT なし）。

## 手順3: 明細表の X との照合（規則は #452 から変えない）
- 比較スクリプト `scripts/research/compare-toc-total-sections-with-detail-x.py` に、年度を選ぶ引数だけを足す（照合の規則は変えない）。入力の hash は、明細表の manifest と、手順2で凍結した `section-candidates.csv` の値で照合する。
- 記述: 両方が項を出した事項の数、項コードと項名がともに一致した数、不一致の全件（コード・名称・X の取り方）、片方だけが項を出した数。範囲別にも出す。
- **確認の基準（事前固定）:** 両方が項を出した事項での一致率が **95% 未満なら STOP**。次（MOF との照合）に進まず、不一致の failure isolation に戻る。95% 以上なら、「両方が一致した事項」を独立した2経路で確認できた項として、次の段に渡す。不一致の事項と、片方だけの事項は保留する。
- 結果を見て、規則・閾値・範囲を変えない。

## 次（本 Task の範囲外）
- 確認できた項で、所管＋項＋事項名による MOF との照合（J1 複数の絞り込みを含む）。別の事前登録で行う。
