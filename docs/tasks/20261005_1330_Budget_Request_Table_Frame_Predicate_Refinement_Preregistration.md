# 概算要求PDF table-frame relation による header predicate refinement — 事前登録（full evaluation の前に固定）

P1 outlier failure isolation（branch `research/budget-request-p1-outlier-failure-isolation`、`4f1bcf2`）の後続。直前研究の source-only な table-frame relation（page header は table frame より上側、P1 outlier 2 row は frame の内側）が、frozen full population に対して再現可能な refinement rule になるかを、preregistration → implementation freeze → frozen evaluation の順で検証する。production（title extractor・DocumentHierarchy・FieldResolver・recordKind・item detector）は変更しない。P1 / P2 は human GT ではなく、P2 を「誤検出」と仮定しない。P1 の retention を recall、P2 の rejection を false-positive removal と呼ばず、GT ではなく structural separation として扱う。MOF・manual contract は使わない。

## 1. 仮説
H1: 直前研究の frozen table-frame classifier をそのまま full frozen population に適用すると、P1 dominant の大部分は header position、P1 outlier 2 row は body/table position、P2 の substantial な部分も body/table position に構造的に分離される。H0: P1 dominant も多数除外される、P2 の separation が弱い、frame unavailable が支配的、または regression が生じる。negative result も保存する。

## 2. One change
frozen alternative projection の target candidate に、table-frame relation に基づく source-only eligibility condition を 1 つだけ追加する。変更しない: frozen label-shaped predicate・normalization・`prefix(inner)` shape・top-band rule・first-code-row の定義・P1〜P5 の定義・current projection・page segmentation・SourceToken / TableGeometry / LogicalRow・FieldResolver / DocumentHierarchy / recordKind / item detector・MOF matcher・rotate・manual contract・corpus・raw PDF・upstream artifact。複数 feature の探索・threshold の sweep・結果を見た tuning はしない。

## 3. 再利用する table-frame rule（変更しない）
`scripts/pipeline-v2/lib/budget-request-p1-outlier.ts`（SHA-256 `9cb749d2…e5d4`）の `frameOf` と `classifyPosition`、および frame の入力となる long な垂直 rule（`budget-request-rule-line-anchor.ts` の `mergeVerticalRules`・`longRules`、長さが page 高さの 0.5 倍以上、`39454c20…2262`）。frame = long な垂直 rule の [最小 yMin, 最大 yMax] と [最小 x, 最大 x]、許容 0.5pt。candidate の bbox は frozen universe の `bounds`。分類: `SOURCE_HEADER_POSITION_SUPPORTED`（yMax ≤ frameTop + 0.5）／`SOURCE_BODY_OR_TABLE_POSITION_SUPPORTED`（bbox が frame の内側）／`SOURCE_POSITION_AMBIGUOUS`（frame なし、または frame を跨ぐ）。この classifier は outlier packet に閉じておらず純関数なので、refactor は行わない（同一コードを full population に適用する。意味・閾値は不変）。outlier 2 + control の再現 test（outlier 1・2 → body/table、control → header）を implementation freeze に含める。

## 4. 事前固定する population と eligibility rule
- Primary: frozen alternative projection の target 2,537 page（`population-manifest.json` の C2、recovered 2,532 / unresolved 5）。
- Candidate diagnostic: frozen universe 14,675 row（P1 2,532・P2 1,786・P3 534・P4 5,572・P5 4,251。定義は変更しない）。P1 は dominant 2,530 と outlier 2 を別表にする。
- Regression: current nonblank 6,195 page、既存の C3 / C4 / C5 等の non-target class。
- Eligibility rule: alternative projection が採用する candidate（現行 projection が blank の page の最初の code row で label-shaped のもの）が、frozen table-frame classifier で `SOURCE_HEADER_POSITION_SUPPORTED` の場合だけ採用する。body/table・ambiguous・frame unavailable・geometry unavailable は fail-closed（採用せず blank のまま）。現行 projection が nonblank の page は変更しない。同一 page に複数の eligible candidate があれば一意に決めず abstain（alternative は最初の code row 1 つだけを対象とするため通常は発生しないが、test で固定する）。
- 禁止 fallback: 隣接 page の frame・別 page の frame・label bridge・request x / layout variant の fallback・title text の意味・組織名辞書・MOF・manual contract・human judgement・runtime rule への P1/P2 label の利用。

## 5. Metrics（固定）
- Frame availability: P1〜P5 別に frame_available / frame_unavailable / frame_ambiguous（frame あり・跨ぎ）/ classification_available。
- Relation matrix: P1〜P5 × {header_position_supported, body_or_table_position_supported, ambiguous, unavailable}。P1 は dominant 2,530 と outlier 2 を別表。
- Primary page-level（2,537 page）: accepted（recovered で header）・rejected_body_or_table・rejected_ambiguous・rejected_unavailable・unresolved_existing_mechanism（5）・mismatch・source fidelity violation・provenance missing。
- Regression: current nonblank 6,195 page の変化数・non-target（C3 / C4 / C5）の変化数・current projection が変わった page 数・provenance loss・補完した source text 数。
- Determinism: 再実行で artifact の hash・accepted candidate の identity・page output が一致。

## 6. Decision gate（数値。未観測の full P1 / P2 distribution を見て決めない。根拠は既存 evidence と保守的な engineering gate）
- 閾値の根拠: 前研究では P1 の top bin が 0.02 に 2,530/2,532（99.9%）集中、control が header で frame の上側にあることを確認済み。P2 は top 0.08〜0.18 に分布（前研究）。本 phase の full 分布は未観測。保守的に次の値を採る。
- G1 P1 dominant retention（header と分類される割合）: D1 は ≥ 0.98、D2 の下限は ≥ 0.90。
- G2 P1 outlier 2/2 が body/table として除外される（D1・D2 の必須）。
- G3 P2 の structural separation（body/table と分類される割合）: D1 は ≥ 0.80、D2 の下限は ≥ 0.50。
- G4 coverage（14,675 candidate のうち header / body-table と分類でき、unavailable / ambiguous でない割合）: D1 は ≥ 0.90、D2 の下限は ≥ 0.50。
- G5 regression = 0（current nonblank・non-target・current projection の変化、provenance loss、補完した source text）、source fidelity violation = 0、provenance missing = 0、determinism、classifier reproduction（outlier 2 + control）。
- `TABLE_FRAME_REFINEMENT_SUPPORTED`（D1）: G1〜G5 すべて D1 の値を満たす。
- `TABLE_FRAME_REFINEMENT_PARTIALLY_SUPPORTED`（D2）: G5 が満たされ、G2 が満たされ、G1・G3・G4 が D2 の下限以上だが D1 に届かない項目がある。
- `TABLE_FRAME_REFINEMENT_NOT_SUPPORTED`（D3）: G5 のうち regression / fidelity / provenance が 0 でない、G2 を満たさない、または G1・G3・G4 のいずれかが D2 の下限未満。
- `STOP_INTEGRITY_FAILURE`（D4）: frozen hash / population count / provenance の不一致、determinism の失敗、classifier が直前研究の outlier 2 + control と同値でない。
判定の順序: D4 → D3 → D1 → D2。「高い」「substantial」「支配的」は上記の数値で評価する。

## 7. Frozen dependencies（再現して照合。不一致は STOP）
`candidate-universe.json.gz`（gz `429ad6c0…b776`）、`comparison-decision.json`（`fd90b142…ccda`）、P1 outlier の `population-freeze.json`（`db22a783…de5a`）・`source-evidence-packet.json`（`de126ad5…33a8`）・`final-decision.json`（`459b2175…aab7`）・`visual-evidence.json`（`86c27c45…361a`）、alternative projection の `alt-title-projection.json`（`cc071c77…c6cd`）・`primary-evaluation.json`（`79e5a63a…ff06`）・`population-manifest.json`（`ffac4a9d…c38d`）・実装 `17cb97ef…c892`。再現する値: universe 14,675・P1 2,532・P2 1,786・P3 534・P4 5,572・P5 4,251・ambiguous page 1,123・P1 dominant 2,530・outlier 2・target 2,537 page・recovered 2,532・unresolved 5・evaluable 9,145 page。

## 8. Commit 順序と STOP
A（本書）→ B（research-only の純関数・integrity test・outlier 2 + control の再現 test・評価 script の implementation freeze。full result に合わせて変更しない）→ C（full frozen population に一度だけ適用して artifact を freeze。結果後に rule / threshold / classifier を変更しない。measurement / aggregation の bug と research rule change は区別し、rule change が必要なら STOP または別 phase）→ D（result・INDEX。誤記の fix-up は可、rule / result / artifact は改変しない）。STOP: hash / count / identity の不一致・provenance の不一致・determinism の失敗・classifier の同値性が成り立たない・新しい意味ルールが必要になる・test failure。

## 9. 禁止・解釈の制約
production の title extractor / FieldResolver / DocumentHierarchy / recordKind / item detector・sparse・organization/root 修正・level_gap・rotate・fuzzy・MOF / manual contract の tuning・H2・fresh held-out・UI/API・PR は行わない。主張しない: header semantic correctness・P1 が正解・P2 が誤検出・precision / recall・DocumentHierarchy の correctness・item extraction accuracy・MOF reconciliation の改善・hierarchy recovery count・他年度・他様式への一般化。
