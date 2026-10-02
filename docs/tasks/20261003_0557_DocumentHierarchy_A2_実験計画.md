# DocumentHierarchy A2 実験計画（pre-registration。実装・実行しない）

このタスクで固定するのは A2 の仮説・primary rule・development / holdout・成功条件・stop だけ。**A2 の実装、A2 runner の実行、A2 holdout の観測、v2-A の再採点は行わない。** B+A2 の統合評価は、A2 単独が新規 holdout を通過した後の別実験（Future AB）。

## Background

v2-failure-isolation（`9a972e8`）で A = STOP, B = GO。v2-A は3種の GT-free evidence（`page_edge_row` / `vertical_repetition` / `page_number_sequence`）の2種以上でヘッダ行を除外する。METI（2行）と環境省（45行）では全て本物のページヘッダで、3種が全て成立した。しかし holdout で本物の見出しを誤除外した。B は MLIT 復興特会の追加 holdout で CONFIRMED-WITH-SCOPE（`18d1a7b`）。

## Observed failure（v2-A）

| 文書 | 除外された行 | `page_edge_row` | `vertical_repetition` | `page_number_sequence` | 実体 |
| --- | --- | --- | --- | --- | --- |
| 農水省復興特会 p13 | 要求 `56-65`（要求番号 `9`） | **false** | true | true（`9` = 13−4） | GT内の本物の要求（誤除外） |
| MLIT復興特会 p9 | コード `005` の本文行 | **false** | true | true（`005` を数値化して 9−4=5） | 本物の本文行（GT外。誤除外） |
| METI p104・p106 | `100 経（中）` `102 経（中）` | true | true | true | ページヘッダ（正しい除外） |
| 環境省（45行） | 偶数頁のヘッダ | true | true | true | ページヘッダ（正しい除外） |

原因: ①`page_number_sequence` のオフセットは最上/最下行の数字から推定するのに、**判定は候補行内の任意の数字だけのtoken**に適用した。②数値化で先頭の0を許した（`005`=5）。③`vertical_repetition` は表の見出し行も満たす（見出し行は表の同じ位置に出る）。2種の多数決が、ページ端ではない行でも偶然成立した。

## Development set（A2 の規則設計に使ってよい観測済みの文書のみ）

- Header-positive: METI detail（`100 経（中）`・`102 経（中）`、2行）、環境省 detail（既知のヘッダ45行）。
- Critical negative: 農水省復興特会（GT内の要求1件。誤除外してはならない）、MLIT復興特会（GT外の本文行 `005` 1件。誤除外してはならない。**MLIT は B の holdout であり A2 の holdout ではない。v2-A の誤除外を開示した上で development に加える**）。
- Regression: MHLW（summary・detail・narrow）、MEXT（summary・detail・narrow）、METI（summary・detail 正常部分 p9–103・narrow）、既に観測済みの normal range。

## Hypothesis A2

ページヘッダの identity は、「ページ端の行である」ことを**前提（domain）**として初めて成立する。頁番号の連番という証拠は、page-edge の行の中だけで評価すべきで、ページ端でない行には適用しない。そうすれば、METI・環境省のヘッダは同じように除外でき、農水省・MLIT の本文行は除外されない。

## Primary rule（1つだけ。holdout で複数を走らせて良い方を採る計画は禁止）

**A2 = page-edge-domain header identity**。見出し候補行 R（v1 と同じ形）をページ p の hierarchy placement から除外するのは、**次の3つが全て成立するとき**だけ。

1. **(D) domain**: R が p の最も上、または下端が最も下の論理行である（v2-A の `page_edge_row` と同じ定義。割合の閾値なし）。
2. **(N) page-number token**: R が、数字だけの token T を持ち、T の文字列が「p + o」の**正準な10進表記**（先頭に0を持たない `0|[1-9][0-9]*`）と**完全に一致**する。o は文書の頁番号オフセットで、v2-A と同じ方法（各ページの最上/最下行の、正準な10進表記の数字だけの token について（値−物理ページ）の多数決。**過半数のページ**で共通する差。ビューのページ数が3未満なら評価不能）で推定する。
3. **(Y) repeated y-band**: R の yMin の単一連結クラスタ（許容差=TableGeometry の行クラスタリング許容差）が**過半数のページ**に行を持つ（ページ数3未満は評価不能）。

それ以外の候補行は eligible のまま。除外した行は消さず、`hierarchyEligibility: 'excluded'`・`exclusionEvidence`（D・N・Y を記録）・sourcePage・sourceRowRefs・sourceTokenRefs・bbox を残す（silent drop 禁止）。

### この規則を選んだ理由（development の証拠のみ）

- 4つの観測（METI・環境省の47行は正しい除外、農水省・MLITの2行は除外してはならない）は、`page_edge_row` の有無だけで完全に分かれる（前者は全て true、後者は両方 false）。
- 選択肢の比較: (R1) `pageEdge AND (repeatedY OR pageSequence)`、(R2) 上の A2（`pageEdge` を domain にし、N と Y を両方要求）。development の4観測では R1 と R2 は区別できない（どちらも同じ結果）。**判断の根拠は安全側の原則**: 「false parent を作らない > 正しい level > unresolved を減らす」。R1 は、ページ端に反復する見出し（例: 全ページの先頭行が見出しの文書）を、頁番号を持たなくても除外しうる。R2 は頁番号の token という「ヘッダであることの直接の証拠」を要求するので、誤除外の余地が最も小さい。取り残したヘッダは level_gap / unresolved を生むが false parent は生まない（v1 の挙動）。
- 正準な10進表記の完全一致は、MLIT の `005` のような先頭0つきの数値化を排除するための development 由来の条件。

### 反証可能性（実装前に固定する予測）

- P1: METI で v2-A と同じ2行（p104・p106）、環境省で同じ45行を除外し、GTノードの除外は0。指標は v2-A と一致（METI exact 82/82・depth 87/87、環境省 exact 81/81・depth 84/84）。
- P2: 農水省復興特会・MLIT復興特会で除外は0（v1 と完全一致）。
- P3: regression の全実験で v1 と完全一致。
- 規則が誤っていることを示す観測: GT 内の hierarchy ノードを除外する／ページ端の行が (N)(Y) を満たす本物の見出しである／N や Y を満たさないページヘッダが取り残されて hierarchy を壊す（後者は「不完全」で、「危険」ではない。成功条件で区別する）。

## Allowed / Forbidden evidence

Allowed: SourceToken / TableGeometry / LogicalRow、論理行のページ内での位置（最上/最下の順位）、y帯の文書内の反復（過半数）、数字だけの token の文字列と物理ページ番号との関係。
Forbidden: GT、コード値・省庁名・組織名・要求番号の lookup、固定pt値・固定割合の閾値（`y<8%` 等）、holdout 文書の観測に基づく調整、凍結層（SpatialRegion / RegionRelation / SemanticRecordCandidate / RecordAnchor / PageTemplate）、金額の解釈。

## Thresholds

新しい閾値は作らない。使うのは: 「過半数」（>50%。多数決という定義上の値）、「ページ数3以上」（多数決が意味を持つ最小）、y帯クラスタの許容差（既存の行クラスタリング許容差）、正準な10進表記（形式の定義）。holdout 固有の閾値は禁止。値は development の観測から決めていない（v2-A から変更なし）。

## Holdout（規則固定後に初めて観測）

候補メタデータは `tests/fixtures/budget-request-document-hierarchy/2024/a2-holdout-candidates.json` に封印状態で記録。

| id | 文書 | 頁数 | 状態 |
| --- | --- | --- | --- |
| `mod-general-detail` | 防衛省 一般会計 `https://www.mod.go.jp/j/budget/gaisan/r6/gaisanyoukyu.pdf` | 540 | sealed（strict） |
| `cfa-general-detail` | こども家庭庁 一般会計 `https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/585bb95a/20230907_policies_budget_04.pdf` | 147 | sealed（strict） |

選定に使った情報は外形のみ: canonical URL、省庁、年度、manifest の登録（概算要求書・一般会計）、頁数、ファイルサイズ、物理p104以降に3桁の印字頁が現れうること、取得可能性。**MLIT復興特会（B の holdout）・MAFF復興特会・METI・環境省は A2 holdout にしない。** 予備: 公正取引委員会（140頁）、警察庁 一般会計（112頁）。いずれも未観測。

## Contamination（開示）

- **観測していないもの（封印）**: 防衛省・こども家庭庁について、ヘッダの文字列、本文ページのテキスト、x/y、インデントクラスタ、見出し候補、v1/v2 の出力。目次の内容も開いていない（候補調査で、最初の6頁にある（組織）行の数だけを数えた: 防衛省6、こども家庭庁2）。
- **観測済みで strict holdout にできないもの**: 外務省・農水省本省・総務省・裁判所・消費者庁について、前のタスクの候補調査で物理p110・111の先頭行（ヘッダ文字列）を見た。これらは holdout に使わない。
- development の観測が A2 設計に使われている（上記のとおり）。holdout の観測は規則固定前に行っていない。
- 想定: 全省庁が同じ書式（偶数頁のヘッダが左に印字頁+略称、頁の印字頁=物理−4）というのは、観測済みの7文書からの推測で、封印した文書では未確認（`NON-INFORMATIVE HOLDOUT` が起こりうる理由）。

## Success criteria（結果を見て変更しない）

**Development positive**: METI と環境省で、A2 が除外する行が v2-A と同じ（METI 2行、環境省 45行）。GTノードの除外 0。指標が v2-A と一致。
**Negative**: 農水省復興特会で GT 内の要求（`56-65`）を除外しない。MLIT復興特会で本文行（`005`）を除外しない（両文書とも除外 0）。GT hierarchy ノードの誤除外 0。false parent の増加 0。
**Regression**: 通常 range の全実験（MHLW・MEXT・METI の summary・detail・narrow、METI p9–103）で v1 と完全一致（改善・悪化とも「変化」）。
**Future holdout（`mod-general-detail`・`cfa-general-detail`、各文書ごと。GT は規則固定後・A2 の出力を見る前に、各文書の目次から作る）**:
- INFORMATIVE: v1 の depth exact が GTノード（detail 範囲内）の 90% 未満（ヘッダ衝突の症状）。このとき A2 で depth exact ≥ 90%、false parent の増加 0、GT hierarchy ノードの誤除外 0、exact parent は v1 以上、除外された全ての行が (D)(N)(Y) を満たすこと。
- NON-INFORMATIVE: v1 の depth exact が 90% 以上。このとき A2 は v1 と同じ指標で、除外された行が GT hierarchy ノードを含まない。結果は `NON-INFORMATIVE HOLDOUT` として記録し、成功とも失敗とも数えない。
- A2 の判定: development・negative・regression が全て成立し、INFORMATIVE な holdout が1件以上あり全て成立 → `GO`。誤除外・false parent 増加・規則変更の必要 → `STOP`。INFORMATIVE な holdout が無い → `INCONCLUSIVE`（規則は固定のまま）。

## Stop conditions

STOP: page-edge / header identity の条件で本物の見出しを除外する／GT-free evidence で区別できない／holdout 固有の閾値が必要／省庁・名称・コードの lookup が必要／false parent の増加／provenance の喪失／holdout を見た後の規則変更が必要。失敗しても同じ実験内で A3 相当へ修正しない。

## Metrics

v2 failure isolation と同じ指標を、同じ照合（posthoc を主、事前固定を併記）で全 variant に適用: exact parent / false parent / unresolved / not found / ancestor exact / depth exact / nodes matched（x/N）、GT外 candidate 数、excluded header candidate 数、unplaced cluster・node 数、level_gap 数。v1・v2-off-off・v2-A（STOP の基準）・v2-A2 を比較し、v1 との差分を示す。

## Provenance

除外した行も node として残す。少なくとも `hierarchyEligibility`、`exclusionEvidence`（D・N・Y の観測）、`sourcePage`、`sourceRowRefs`、`sourceTokenRefs`、`bbox`/x の evidence を保持する。silent drop 禁止。

## Implementation boundary（次のタスクが守ること）

- v2-A（STOP の記録）・v2-B・v1 は変更しない。A2 は v2 モジュールの**新しい option 値**（例: `headerCollisionHandling: 'page-edge-domain'`）として追加し、v2-A と並べて比較できるようにする。
- 順序: ①A2 の実装とテスト（development・negative・regression）を実行し、結果を記録・コミット → ②規則を固定 → ③holdout の GT を各文書の目次から作成してコミット（A2 の出力を見る前）→ ④holdout を初めて実行（規則は変更しない）。
- A2 の実装は、この計画の Primary rule と異なってはならない。計画を変更する場合は新しい pre-registration が要る。

## Future AB

B+A2 の統合評価は、A2 単独が新規 holdout を通過した後の別実験。B の根側条件のため、ヘッダの根レベルが左にあると B は効かない（A2 が先に除外する必要がある）。今回は AB の実装・再評価をしない。

## Future Experiment C

`printedPageRefCandidate` の4桁限定→1〜3桁対応は今回も触らない。A2 の page-number sequence（物理ページとの関係）と、総表の printedPageRefCandidate は別課題。
