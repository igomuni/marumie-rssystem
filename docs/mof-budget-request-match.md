# MOF 予算書（項・事項・目）× 概算要求（TOC・総表・明細表）の突合

MOF の予算書の項・事項・目（[mof-archive-csv.md](mof-archive-csv.md)）と、概算要求の目次（TOC）・総表・明細表（[budget-request-toc-pdf-native-csv.md](budget-request-toc-pdf-native-csv.md)、[budget-request-total-table-csv.md](budget-request-total-table-csv.md)、[budget-request-detail-table-csv.md](budget-request-detail-table-csv.md)）を、名称とコードで対応づける。対象は FY2024（令和6年度）、FY2025（令和7年度）、FY2026（令和8年度）の一般会計・特別会計。

- 実装: `scripts/pipeline-v2/build-mof-budget-request-match.ts`（runner）、`scripts/pipeline-v2/lib/mof-budget-request-match.ts`（木・名称キー・金額の読み取り）
- 出力（git 管理）: `tests/fixtures/mof-budget-request-match/{2024,2025,2025_teishutsu,2026}/`（`manifest.json` に SHA-256）。ディレクトリ名は MOF の版: `2024`＝令和6年度（提出時）、`2025_teishutsu`＝令和7年度の提出時、`2025`＝令和7年度の成立後、`2026`＝令和8年度（提出時）。概算要求は FY2024 が `2024`、FY2025 が後の 2 つ、FY2026 が `2026` と対になる。
- 旧い突合（J1＋K2、[budget-request-detail-table-mof-match.md](budget-request-detail-table-mof-match.md)）とは別系統。置き換えてはいない。

```bash
# 入力: tests/fixtures/budget-request-csv/{year}/{toc,total-table,detail-table}/sources/*.csv と tests/fixtures/mof-archive-csv/{version}/
npx tsx scripts/pipeline-v2/build-mof-budget-request-match.ts <2024|2025|2026> <2023|2024|2025|2025_teishutsu|2026> <out-dir>
```

## 原則
- **名称は空白を除いた完全一致**。比較の前に、幅の統一だけをする（全角の ASCII 相当 → ASCII、半角カナ・約物 → 全角）。それ以外の正規化・部分一致・読み替えはしない。
- **金額は対応づけに使わない。** 一致後の整合の診断の列（`amount_diff` など）にだけ使う。概算要求（要求時）と予算書は別時点の額で、不一致は失敗ではない。
- 候補が複数のときは**絞らず**、候補ごとに 1 行ずつ記録する。
- 上位の層が一意に対応しなかったときは、下位は探さない（`PARENT_UNMATCHED`）。

## 層
| 層 | 概算要求側 | MOF 側 | 根拠 |
|---|---|---|---|
| M0 主体 | 明細表の `CONTEXT`、TOC の（所管／会計／勘定／組織） | 所管・組織・特別会計・勘定 | 名称の完全一致 |
| M1 項 | 項（TOC の `（項）`、または下記の位置の木） | 項（kou） | 範囲の中での項名の完全一致。コードは使わない（概算要求の 3 桁は MOF の項コードと一致しない） |
| M2 事項 | 項に続く事項（`NN‑NN 名称`） | 事項（jikou） | 一致した MOF の項の中での事項名の完全一致。`NN‑NN` の後半＝主要経費別分類コードを裏づけの列に記録（除外しない） |
| M3 目 | 明細表の目（`NNNNN‑X‑YY‑ZZZZ 名称`） | 目（moku） | 一致した MOF の項の中で、**項ごとに集約**してから対応づける |

- M3 の集約: MOF の目は項単位で事項の列がなく、項内の複数の事項にまたがる目の合計になり得る。概算要求の目の行を（主要経費2桁＋目的別3桁、`X`、目別 `YY`、目名）で足し合わせ、MOF の目に多対一で対応づける。`X` の桁数で読みが決まる: 4 桁＝財政法＋経済性質別＋使途別（一般会計）、3 桁＝経済性質別＋使途別、1 桁＝使途別（特別会計）。最後の 4 桁 `ZZZZ` に対応する MOF の列はなく、比べない。
- 一般会計は（所管, 組織, 項名）、特別会計は（特別会計, 勘定, 項名）で MOF の項を探す。復興庁の共管など、同じ名称が複数あれば複数候補になる。

## 概算要求側の階層の決め方
1. **TOC を持つ source:** TOC の見出し（`（所管）`・`（会計）`・`（組織）`・`（勘定）`・`（項）`）だけで決める（`hierarchy = toc`）。
2. **文書セット:** 目次・総表・明細表が別 PDF に分かれる文書（文部科学省など）。TOC を持たない source を、同じファミリー（source 名の末尾の数字を除いた共通部分）の TOC の source に、項（コード＋名称）の一致で付ける（付く先がちょうど 1 つのとき）。付いた組は `sets.csv`。
3. **TOC のない source で総表がある（`hierarchy = position`）:** 総表の行の並びから木を作る。項＝`CODE3` の次が `DETAIL`、勘定＝`HIER` の先頭が 1 桁、会計＝`HIER` の先頭が 2 桁で名称が MOF の特別会計名に一致するもの。**組織は使わない**ので、一般会計は所管の範囲で項名を探す（同名が複数の組織にあれば複数候補）。明細表だけの source は、同じファミリーでこの木に付ける。
4. **総表も TOC もない明細表だけの source（`hierarchy = position_detail`）:** 自分の明細表の行の並びから、同様に木を作る（項＝`CODE3` の次が `DETAIL`、勘定＝`CODE1`、会計＝`CODE2` の 2 桁で特別会計名に一致）。
- 会計の種類（一般／特別）と所管・特別会計は、その source の最初の明細表の `CONTEXT`（`NN 〇〇所管`／`NNNN 〇〇特別会計`）から取る。`CONTEXT` がなければ対象外（`no_context`）。
- 位置による規則は、TOC を正解として評価した（項: 取りこぼし 0〜2・余分約 2〜3%、勘定・会計: 完全一致。組織の規則は余分が多く不採用）。

## 出力
| ファイル | 内容 |
|---|---|
| `m0-entities.csv` | 主体の対応（`request_source`, `level`, `request_code_name`, `request_name`, `mof_key`, `status`, `reason`） |
| `m1-kou.csv` | 項。概算要求側（`request_source`, `toc_kou_idx`, `request_code3`, `request_name`, `request_page`）、MOF 側（`mof_row`, `mof_name`）、`candidate_count`, `status`, `reason`, 診断の金額（`request_amount`, `mof_amount`, `amount_diff`）、`request_scope`, `hierarchy` |
| `m2-jikou.csv` | 事項。`request_no`, `request_code`（`NN-NN`）, `mof_kou_row`, `mof_jikou_row`, `class_code_agrees`（後半 `NN` が主要経費別分類コードと一致）ほか |
| `m3-moku.csv` | 目（集約後）。`code_main_purpose`, `code_x`, `code_item`, `request_rows`, `request_sum`, `mof_kou_row`, `mof_moku_row`, `mof_amount`, `amount_diff` ほか |
| `unmatched-mof-{kou,jikou,moku}.csv` | 概算要求側のどの行にも対応づかなかった MOF の行。`reason`（`no_request_row`／`kou_matched_no_request_row`／`kou_not_matched`）と `ministry`, `organization`, `special_account`, `sub_account` |
| `sets.csv` | 文書セットで付いた組（`toc_source`, `attached_source`） |
| `request-no-toc.csv` | 木を作れなかった source の行（`OUT_OF_SCOPE`／`no_toc`）。現在は 0 行 |
| `summary.json` | 層ごとの `status` の件数、MOF の網羅、概算要求側の自己整合、入力の SHA-256 |

`status`: `MATCHED`（MOF の候補が 1 つ）、`AMBIGUOUS`（2 つ以上。候補ごとに 1 行）、`NO_CANDIDATE`（名称が一致する候補なし）、`PARENT_UNMATCHED`（上位が一意に対応せず探していない）、`OUT_OF_SCOPE`（`no_context` など）。MOF の行の id は `{表}:{行番号}`（例 `kou-general:37`、行番号は CSV のデータ行の 1 始まり）。

## 現在の結果（概算要求の行のうち MOF に一意に対応した割合）
| 層 | FY2024 × MOF 2024 | FY2025 × MOF 提出時（成立後も同数） |
|---|---|---|
| 項 | 1,043／1,101 | 1,085／1,150 |
| 事項 | 1,593／1,704 | 1,654／1,776 |
| 目（集約後） | 7,406／7,858 | 7,618／8,168 |

FY2026（令和8年度）× MOF 2026（提出時）: 項 1,112／1,175、事項 1,673／1,795、目（集約後）7,660／8,317。複数候補は 0。MOF の行のうち対応づいた割合は、項 93.9%、事項 93.0%、目 90.0%。

MOF の行のうち対応づいた割合: 項 約 93〜94%、事項 約 91〜92%、目 約 85〜89%。事項の主要経費コードの一致は 99.8% 以上。

FY2024 の数値は、凍結済みの PDF corpus（82 PDF）に、後から取得した 60 PDF（内閣府の明細表 49 本とエネルギー対策特別会計の表紙・総表、文部科学省のエネルギー対策特別会計、金融庁の分割 9 本）の補遺を加えたもの。補遺は `tests/fixtures/budget-request-pdf-corpus/2024/pdf-corpus-freeze-supplement-*.json` に記録し、凍結記録（`raw-text-manifest.json` など）は変更していない。補遺の PDF は plain text（`--corpus=` 付き）から総表・明細表の CSV まで作り（`tests/fixtures/budget-request-csv/2024-supplement/`）、突合 runner が `{year}-supplement` を同じ入力として読む。表紙・目次の CSV は、補遺の PDF では作っていない（凍結済みの構造 inventory が必要なため）。MOF の行の網羅は、項 92.9%（961／1,034）、事項 90.9%（1,469／1,616）、目 87.8%（6,976／7,943）。補遺を加える前は、目 85.1%（6,757／7,943）。金融庁の分割 9 本も文字層がなく（描画パス型）、CSV は作れていない。

## 限界と注意
- 一致しなかった行の大半は、MOF の同じ範囲に名称がないもの（概算要求の項目が予算案で統合・改称・新設された等）。全角／半角の違いは幅の統一で一致にしている。
- FY2024 の法務省・金融庁の PDF は文字層がなく（描画パス型）、概算要求側が取れていないため、突合に載っていない。
- 同じ MOF の行が複数の概算要求の source から対応づくことがある（電源開発促進勘定を複数の省庁の PDF が載せる等）。
- 概算要求の目を MOF の目に対応づけたあと、集約した合計と MOF の金額が一致する割合は約 4 割。概算要求と予算書の時点の違いによる。
