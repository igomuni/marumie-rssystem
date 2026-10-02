# DocumentHierarchy v2 Failure Isolation 結果

**判定: A = `STOP` / B = `GO` / v2-AB candidate = `STOP`**。実験計画（`…_v2_FailureIsolation_実験計画.md`、コミット `be472f4`）で事前登録した成功条件・stop condition を、結果を見て変えずに機械判定した。

- **A（ヘッダ衝突）= STOP**: development（METI）と holdout（環境省）では v1 の失敗を解消したが、holdout（農水省復興特会）で**本物の要求を1件誤除外**した（stop condition「本物の見出しを消す」）。誤除外の原因はこの実験で設計した規則の欠陥（後述）。
- **B（single-organization）= GO**: development 3件と holdout で根が placed になり depth が回復。regression は v1 と完全一致。false parent は増えない。
- **AB = STOP**: A が STOP のため。B は単独で成立するが、ヘッダの根レベルが左に出る文書では B 単独は効かない（合成テストで確認。実PDFの組み合わせは未検証）。

## Hypotheses / Pre-observation contract

- Hypothesis A: ページ上下端に反復して現れる page-header/footer 型の行を hierarchy level の形成対象から除外できれば、METI detail の偽 root cluster が消え、level が戻り、063/080 の level_gap が解消する。除外は placement からだけで、行は消さず理由（exclusionEvidence）を残す。evidence は `page_edge_row` / `vertical_repetition` / `page_number_sequence` の3種で、**2種以上**で除外。
- Hypothesis B: `minClusterSupport` を下げず、document-local な等間隔階段（run 3クラスタ以上、根側の1段分）を根拠に、支持1の根クラスタを placed にできる。
- v1 baseline・allowed/forbidden evidence・variant・development/regression/holdout・指標・成功条件・stop は、v2 実装前にコミット（`be472f4`）。追加holdout用GT（環境省・農水省復興特会）も v2 の出力を見る前に固定。v2 の実装は規則を固定した後（`d755a7d`）、holdout は**固定後に初めて**実行した。

## Variants / Inputs / GT boundary

variant: `v1`（既存）/ `v2-off-off`（v1と同値）/ `v2-A` / `v2-B` / `v2-AB`。v2 は別モジュール（`budget-request-document-hierarchy-v2.ts`）の experimental option で、v1 の実装・artifact・fixture・既存GTは変更していない。実験: development = METI detail（A）、METI 組織035・MEXT 組織030・MHLW 組織070 の narrow（B）／regression = MHLW summary・detail、METI summary、MEXT summary・detail、METI detail p9–103／holdout = 環境省 detail（A）、農水省復興特会 detail（B）。入力は SourceToken / TableGeometry / LogicalRow のみ。推論側（v2モジュール・ランナー）はGT・評価・凍結層をimportせず、GTのコード値・名称・省庁名・固定pt・固定割合を埋め込まない（静的テストで確認）。GTを読むのは評価CLIだけ。

## v1 baseline の再現

#364 の正式結果・posthoc 診断（METI/MEXT の summary・detail・narrow の12セル、事前固定 × posthoc）と **全て一致**。METI detail の posthoc は exact 80/82・false 0/82・unresolved 2/82・depth 0/87。MHLW detail は 35/35。`v2-off-off` は全実験・両照合で v1 と一致。

## Metrics（x/N。主は posthoc 照合を全variantに同一適用。事前固定の照合も artifact に併記）

### Development — A: METI detail（GT 87ノード・82エッジ）

| variant | exact | false | unresolved | not found | ancestor | depth | matched | excluded | GT内excluded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v1 | 80/82 | 0/82 | 2/82 | 0/82 | 78/82 | **0/87** | 87/87 | 0 | 0 |
| v2-A | **82/82** | 0/82 | **0/82** | 0/82 | **82/82** | **87/87** | 87/87 | 2 | 0 |
| v2-B | 80/82 | 0/82 | 2/82 | 0/82 | 78/82 | 0/87 | 87/87 | 0 | 0 |
| v2-AB | 82/82 | 0/82 | 0/82 | 0/82 | 82/82 | 87/87 | 87/87 | 2 | 0 |

v2-A は `100 経（中）`（p104）・`102 経（中）`（p106）の2行だけを除外（3種の evidence が全て成立）。組織は level 1 に戻り、項 `063`/`080` の `level_gap` は解消（level_gap 9→0）。B 単独は効かない（isolation 成立）。

### Development — B: single-organization narrow

| 実験（GTノード） | v1 exact / unres / depth | v2-A | v2-B | v2-AB |
| --- | --- | --- | --- | --- |
| METI 組織035（5） | 2/4・2/4・0/5 | v1と同じ | **4/4・0/4・5/5** | 4/4・0/4・5/5 |
| MEXT 組織030（32） | 17/31・14/31・0/32 | v1と同じ | **31/31・0/31・32/32** | 31/31・0/31・32/32 |
| MHLW 組織070（16） | 9/15・6/15・0/16 | v1と同じ | **15/15・0/15・16/16** | 15/15・0/15・16/16 |

false parent は全 variant で 0。根は lattice-supported（支持1、右隣に run 3クラスタ以上、1段分の差）として placed。A 単独は効かない（isolation 成立）。

### Regression（全て v1 と完全一致）

| 実験 | v1 = v2-A = v2-B = v2-AB（exact / depth） |
| --- | --- |
| MHLW summary | 35/35・37/37 |
| MHLW detail | 35/35・37/37 |
| METI summary | 82/82・87/87（事前固定の照合は 34/82・52/87、全variantで同じ） |
| MEXT summary | 182/182・186/186（事前固定は 62/182・105/186） |
| MEXT detail | 46/46・48/48 |
| METI detail p9–103（ヘッダ衝突より前） | 78/78・83/83 |

除外は全て 0、false parent の増加なし、全 variant の全指標（両照合）が v1 と一致。

### Additional holdout（規則固定後に初めて実行）

| 実験 | variant | exact | false | unresolved | not found | ancestor | depth | matched | excluded | GT内excluded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 環境省 detail（A。GT 84ノード・81エッジ） | v1 | 58/81 | 0 | 23/81 | 0 | 36/81 | 0/84 | 84/84 | 0 | 0 |
| | v2-A | **81/81** | 0 | **0** | 0 | 81/81 | **84/84** | 84/84 | 45 | **0** |
| | v2-B | 58/81 | 0 | 23/81 | 0 | 36/81 | 0/84 | 84/84 | 0 | 0 |
| | v2-AB | 81/81 | 0 | 0 | 0 | 81/81 | 84/84 | 84/84 | 45 | 0 |
| 農水省復興特会 detail（B。GT 36ノード・35エッジ） | v1 | 27/35 | 0 | 8/35 | 0 | 0/35 | 0/36 | 36/36 | 0 | 0 |
| | v2-A | 26/35 | 0 | 8/35 | **1/35** | 0/35 | 0/36 | 35/36 | 1 | **1** |
| | v2-B | **35/35** | 0 | **0** | 0 | 35/35 | **36/36** | 36/36 | 0 | 0 |
| | v2-AB | 34/35 | 0 | 0 | 1/35 | 34/35 | 35/36 | 35/36 | 1 | **1** |

環境省: v2-A は偶数頁ヘッダ45行を全て除外（3種の evidence が全て成立）。level 別の件数が 3/35/46 で GT の組織・項・要求の数に一致し、GT内の誤除外は0。B 単独は効かない。農水省復興特会: v2-B が根（組織が1つ）を placed にして depth 36/36、exact 35/35。一方 **v2-A / v2-AB は GT 内の要求を1件除外**した。

## A の失敗（STOP の根拠）

- **Observed failure**: 農水省復興特会 p13 の要求 `56-65 水産資源管理対策…`（要求番号 `9`）が除外された。evidence は `vertical_repetition`（14ページ中8ページの y 帯）と `page_number_sequence`（offset −4、token `9`）の2種で、`page_edge_row` は成立していない。
- **原因（規則の設計欠陥）**: `page_number_sequence` は頁番号のオフセットを最上/最下行から推定する一方、**判定は候補行内の任意の数字だけのtoken**に適用した。要求番号 `9` が物理p13−4=9 と偶然一致し、さらに y 帯が過半数のページで反復（見出し行は表の同じ位置に出る）して、2種で除外条件を満たした。実験計画の規則どおりの結果で、規則そのものが「本物の見出しを消す」ことを防げていなかった。
- **v2 candidate（仮説。実装・再採点しない）**: ①`page_number_sequence` を、オフセット推定に使った最上/最下行の token に限る ②`page_edge_row` を必須の evidence にする（本物のヘッダ47行は3種が全て成立、誤除外の1件は2種だけ）。Risk of overfitting: 農水省復興特会1件に合わせた修正になりやすい。**農水省復興特会はすでに holdout として使ったため、この仮説を試すには新しい holdout が必要**。

## A+B interaction

AB は development・holdout で A または B 単独の効果と一致した（METI detail = A、narrow = B、環境省 = A）が、農水省復興特会では A の誤除外が加わって B 単独より悪化（34/35・depth 35/36）。合成テストでは、ヘッダ + 単一組織の文書で A 単独・B 単独はどちらも根を直せず、AB で初めて直る（B の「全ての placed クラスタより左」条件のため、ヘッダの根レベルが左にあると B が効かない）。実PDFの組み合わせは検証していない。

## False positives / Unresolved / Provenance / Determinism

- false parent: 全 variant・全実験で増えていない（v1 と同じか 0）。GT外 candidate は v2-A で METI 307→305（除外2）、環境省 425→380（除外45）。
- unresolved: A で METI 2→0・環境省 23→0、B で narrow 14/6/2→0、農水省復興特会 8→0。残る unresolved は根そのもの（親なし）。
- provenance: 除外した行も node として残り（`hierarchyEligibility: 'excluded'` + `exclusionEvidence`）、SourceToken / LogicalRow / PhysicalRow / x へ戻れる（テストで確認）。silent drop なし。lattice placement の根拠は `indentClusters[].placementBasis` / `latticeEvidence`。
- determinism: 12実験×5 variant の60 artifact を2回生成してバイト一致。評価 JSON も再生成。

## Limitations

- holdout は各1文書（環境省193頁・農水省復興特会14頁）。A の判定は誤除外1件で STOP だが、同じ文書で B は GO。母数は小さい。
- 農水省復興特会はすでに holdout として使った。A の修正案を試すには別の文書が要る。B のホールドアウトも1文書。
- B の lattice 規則は「run 3クラスタ以上」が必要で、小さな文書でインデント段が少ないと置けない（今回は置けた）。ヘッダ衝突がある文書では B 単独は効かず、A 相当の対策が前提。
- 評価の主は posthoc 照合（#364 で定義済み、全 variant に同一適用）。事前固定の照合は artifact に併記している。
- printedPageRefCandidate の1–3桁対応は今回やっていない。

## Stop-condition judgment

- A: **該当**（本物の見出しを消す。GT内excluded 1）。METI 専用の規則や閾値調整は不要だった（環境省・METI は同じ規則で成立）。
- B: 該当なし（false root・false parent の増加なし、固定pt・省庁依存なし、narrow を直しても normal range は regression なし）。
- 共通: GTを見て規則を選んでいない、凍結層に戻っていない、provenance は維持、false parent は増えていない。

## Recommendation

1. **B（lattice-supported）は単独で採用候補**。次は別の single-organization 文書（例: 国土交通省の復興特会 10頁）を新しい holdout として追加し、ヘッダのある single-organization 文書（印字頁100超）での B の挙動を確認する。
2. **A はそのままは採用しない**。誤除外の原因は特定できたが、修正案は「新しい holdout」で試す別実験として扱う（今回の holdout は使用済み）。
3. v2-AB は A の再設計後に組み合わせる。

## Future Experiment C — Summary Page Reference Observation

`printedPageRefCandidate` の4桁限定（METI・MEXT の総表の頁数は1–3桁）は、hierarchy resolver の改善とは分離して別実験で扱う。今回の v2-A / v2-B のいずれにも混ぜていない。
