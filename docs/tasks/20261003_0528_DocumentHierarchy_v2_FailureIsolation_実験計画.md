# DocumentHierarchy v2 Failure Isolation 実験計画（pre-observation contract）

PR #364 までで確認した v1 の推論側の失敗2つを、**独立した仮説として切り分けて**検証する。v2 を統合実装して「全部直った」とは言わない。A と B はそれぞれ単独で効果が出るか、互いに干渉しないかを variant 比較で見る。この計画は v2 の規則を実装する前にコミットする。printedPageRefCandidate の1–3桁対応は対象外（Future Experiment C）。

## v1 baseline（比較対象。上書きしない）

schema `budget-request-document-hierarchy-poc/v1`、`indentClusterGapFactor=0.25`、`minClusterSupport=2`（`budget-request-document-hierarchy.ts` は変更しない）。#364 の既知値を再現できること: METI detail の posthoc 照合で exact 80/82・false 0/82・unresolved 2/82・depth 0/87、MHLW 15/15・20/20。これを壊した場合は改善ではなく regression として扱う。

## Hypothesis A — Header Collision

ページ上下端に**反復して現れる page-header/footer 型の行**を、階層 level の形成対象から除外できれば、METI detail の偽 root cluster（x≈37.98）が消え、主階段が本来の level に戻り、`063`/`080` の `level_gap` が解消する。

- 除外は「見出し候補行の hierarchy placement からの除外」であり、**行は消さない**（`hierarchyEligibility: 'excluded'` と `exclusionEvidence` を node に残す。silent drop 禁止）。
- 禁止: 3桁だから／`経（中）`だから／METIだから、の規則。固定の y 割合（`y<8%` 等）を METI に合わせて調整すること。

**GT-free evidence（3種。単独では決めない。2種以上で除外）**

| evidence | 定義（ドキュメント内部の量だけ） |
| --- | --- |
| `page_edge_row` | その論理行が当該ページで最も上（またはy下端が最も下）の行である（上/下に他の論理行が無い）。割合閾値は使わない |
| `vertical_repetition` | 全ページの論理行の yMin を単一連結クラスタリング（許容差=TableGeometry の行クラスタリング許容差。新しい閾値は作らない）し、その行のクラスタが**過半数のページ**に行を持つ（view のページ数が3未満なら評価不能=証拠なし） |
| `page_number_sequence` | 各ページの最上/最下行の「数字だけのtoken」について（値−物理ページ番号）を数え、**過半数のページ**で共通する差（=頁番号のオフセット）があるとき、その行が「値=物理ページ+オフセット」のtokenを持つ（ページ番号は物理ページと一定の差で単調増加する、という性質のみ。コード値・語は見ない） |

除外条件: 見出し候補行（v1 と同じ形A/B）のうち、上の evidence が **2種以上**成立した行。過半数は「多数決」という定義上の値で、METI に合わせた調整値ではない。

## Hypothesis B — Single-Organization

`minClusterSupport=2` を `1` に下げるのではなく、**document-local な indentation lattice**（複数のインデント段が等間隔の階段をなす）を根拠に、支持1件の根クラスタを placed にできる。

- `minClusterSupport=1` で解決したことにしない。「一番左だから根」「コード035だから組織」「最初の3桁だから根」は禁止。固定pt幅は使わない。
- **lattice-supported placement**: 支持が `minClusterSupport` 未満のクラスタ C を、次の全てを満たすときだけ placed にする: ①C のxが**全ての placed クラスタより左**（根側）、②C の右隣の placed クラスタ R0 から始まり、連続する隣接差が互いに許容差（=v1のクラスタ許容差 `clusterGap`）以内の **placed クラスタの run が3つ以上**（R0,R1,R2…。規則的な階段の存在=repeated lattice support）、③C と R0 の差が run の隣接差の中央値と許容差以内（階段の1段分）。
- 満たさなければ v1 と同じく unplaced。placement の根拠は `indentClusters[].placementBasis`（`support` / `lattice_supported` / `unplaced`）と `latticeEvidence`（step・run のクラスタ）に残す。

## Allowed / Forbidden evidence

Allowed（引き続き）: SourceToken / TableGeometry / LogicalRow、x位置・y位置・行の形・文書順・ページ遷移・ページ内の相対位置・ページ間の反復。
Forbidden: 評価GT、コード値・省庁名・組織名・要求番号・期待depthの lookup、固定pt値、凍結層（SpatialRegion / RegionRelation / SemanticRecordCandidate / RecordAnchor / PageTemplate）、金額の解釈。推論コードがGT fixtureや評価モジュールをimportしないことをテストで確認する。

## Variants（独立に評価。v2-ABだけ走らせて結論としない）

| variant | headerCollisionHandling | singletonRootPlacement |
| --- | --- | --- |
| v1 | （既存 `observeDocumentHierarchy`） | |
| v2-off/off | off | off（v1と同値であること） |
| v2-A | observational-filter | off |
| v2-B | off | lattice-supported |
| v2-AB | observational-filter | lattice-supported |

v2 は v1 を破壊的に変更せず、別モジュールの experimental options として実装する（schema `budget-request-document-hierarchy-poc/v2-experimental`）。

## 入力（実験・範囲）

| id | 文書 | view | 物理ページ | 役割 |
| --- | --- | --- | --- | --- |
| `meti-detail` | METI | detail | 9–106 | **development A** |
| `meti-detail-narrow` | METI | detail | 66–81（組織035） | **development B** |
| `mext-detail-narrow` | MEXT `_03` | detail | 1045–1259（組織030） | **development B** |
| `mhlw-detail-narrow` | MHLW | detail | 1555–1602（組織070のみ） | **development B** |
| `mhlw-summary` | MHLW | summary | 19–20 | regression |
| `mhlw-detail` | MHLW | detail | 1555–1700 | regression（normal/holdout） |
| `meti-summary` | METI | summary | 5–8 | regression |
| `mext-summary` | MEXT `_02` | summary | 1–8 | regression |
| `mext-detail` | MEXT `_03` | detail | 1045–1339 | regression |
| `meti-detail-pre-header` | METI | detail | 9–103（ヘッダ衝突より前の正常部分） | regression |
| `env-detail` | 環境省 `000157010.pdf`（193頁、3組織） | detail | 21–193 | **holdout A**（規則固定後） |
| `maff-fukko-detail` | 農水省 復興特会 `230901-4.pdf`（21頁、組織1つ） | detail | 7–20 | **holdout B**（規則固定後） |

URL: METI/MEXT/MHLW は #364・#363 と同じ。環境省 `https://www.env.go.jp/content/000157010.pdf`、農水省復興特会 `https://www.maff.go.jp/j/budget/attach/pdf/230901-4.pdf`。holdout は規則を固定した後に初めて v2 を実行する（それまでは v1 も実行しない）。選定理由: 全省庁が同じ書式で、印字頁が100を超える文書（環境省は印字頁が最大189）で偶数頁ヘッダが3桁の頁番号+略称になる／農水省復興特会は組織が復興庁の1つだけ。それぞれ A・B の仮説に直接関係する。

## 評価GT（評価専用。v2 実行前に固定）

既存GT（MHLW 37ノード、METI 87、MEXT 186）は変更しない。今回追加（目次から機械的に転記。独立チェック: 要求番号が連続・頁が単調・全項に要求あり）: 環境省 `env-toc-hierarchy-gt.json`（3組織/35項/46要求=84ノード）、農水省復興特会 `maff-fukko-toc-hierarchy-gt.json`（1組織/8項/27要求=36ノード）。明細の物理ページ=印字頁+4（両文書。ページ上端の印字から確認）。

## 評価方法

- 照合: #364 で定義済みの同じ matcher を**全variantに同一適用**。v2 比較の主は `posthoc` 照合（`nameOnly`+`ordinalTiebreak`。#364で定義済み。照合の曖昧さと推論の失敗を混ぜないため）。事前固定の照合も併記。v2 の結果を見て照合をさらに変えた場合は `posthoc-v2-diagnostic` の別キーにし、事前比較を上書きしない。summary の照合モードは #364 と同じ（METI/MEXT は `codeName`、MHLW は `pageRef`）。
- 指標（各variant、x/N）: exact parent / false parent / unresolved / not found / ancestor exact / depth exact / nodes matched / GT外 candidate 数 / excluded header candidate 数 / unplaced cluster・node 数 / level_gap 数。v1 との差分を明示。
- **v1 baseline 再現**: v1・v2-off/off が #364 の正式結果・posthoc 診断と一致する。

## 成功条件（結果を見て変更しない）

**A（development = `meti-detail`、posthoc 照合）**: v2-A で ①depth exact ≥ 90%（87ノード中79以上）かつ exact parent ≥ 90%・false parent ≤ 5% ②`063`/`080` の親が `resolved_by_indent_sequence`（level_gap 解消）③**GT内ノードで excluded になったものが 0**（本物の見出しを消していない）④x≈37.98 のクラスタが level を形成しない。さらに ⑤v2-B 単独では METI detail の depth が90%に届かない（B が A を直さない）。holdout A（`env-detail`）で v2-A: depth ≥ 90%・false ≤ 5%（v1 が壊れていれば改善、壊れていなければ regression なし）。

**B（development = 3つの narrow）**: v2-B で ①根が placed（組織のノードが level 1）②depth exact ≥ 90% ③unresolved が 0 または v1 より減少 ④false parent が v1 より増えない。さらに ⑤v2-A 単独では narrow の depth が90%に届かない（A が B を直さない）。holdout B（`maff-fukko-detail`）で v2-B: depth ≥ 90%・exact ≥ 90%（v1 が壊れていれば改善）。

**regression**: 全 regression 実験で、v2-A / v2-B / v2-AB の各指標（exact・false・unresolved・not found・ancestor・depth・nodes matched）が **v1 と完全一致**（改善・悪化とも「変化」として扱う。METI detail の header collision 実験を除く。この実験は development A）。`meti-detail-pre-header` も v1 と一致。

**判定**: `GO`=その仮説の成功条件を全て満たす／`STOP`=stop condition に該当／`INCONCLUSIVE`=どちらでもない（holdout が適用外、など）。v2-AB は A と B がともに GO で、AB の development・holdout・regression が各単独の効果の和に一致するとき `GO`。

## stop conditions（該当したら無理に完成させない）

A: header と本物の見出しを GT-free evidence で区別できない／page-top/bottom 除外が本物の見出しを消す（GT内ノードの excluded が1件でもある）／METI専用の規則や METI に合わせた閾値調整が必要。
B: 支持1の根とノイズクラスタを document-local evidence で区別できない（lattice placement で false root / false parent が増える）／固定pt幅・特定省庁レイアウトへの依存／narrow を直すと normal range が regression する。
共通: GTを見ないと規則選択できない／凍結層に戻らないと成立しない／provenance を維持できない／false parent が増える。STOP は失敗ではなく重要な結果。

## contamination の開示

A・B の規則は、v1 の失敗（METI p104・p106 の `100 経（中）`、narrow range の根 unplaced）を観察した後に設計した（development）。regression の各実験は #363・#364 で v1 の結果を既に見ている。holdout（環境省・農水省復興特会）は、目次・ページ上端の印字文字列と頁数だけを確認し、v1・v2 の出力は一度も見ていない。閾値は「過半数」「ドキュメント内の行クラスタ許容差（v1の既存値）」「run 3クラスタ」だけで、METI の正解値に合わせた調整は行わない。

## 今回やらないこと

printedPageRefCandidate の1–3桁対応（Future Experiment C として記録のみ）、最終 schema、FieldResolver、最終SemanticRecord、金額の解釈、凍結層の復活、全省庁一括、`data/derived` への昇格、PR作成。research repo は変更しない。
