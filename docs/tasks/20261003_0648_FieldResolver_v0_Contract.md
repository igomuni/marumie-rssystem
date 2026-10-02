# FieldResolver v0 Contract

FieldResolver v0 の **Contract（仕様）**。このタスクでは FieldResolver 本体を実装しない。Contract・Golden Samples・評価方針を、PoC 実装の前に固定する。Golden は `…_FieldResolver_v0_Golden_Samples.md` と `tests/fixtures/budget-request-field-resolver/v0/`。DocumentHierarchy（SourceToken → TableGeometry → LogicalRow → DocumentHierarchy）は **CLOSED** で、最終採用は B only（`lattice-supported` + header collision は観測のみ）。この文書はその結果を**入力条件**として受け取り、再調整しない。

## 1. responsibility（責務）

既存の structural evidence と SourceToken の provenance から、予算項目の field を**安全に確定できるか**を field ごとに判定し、確定できる値だけを source-backed な field として返す。判断は「構造全体の確信度」ではなく **field ごとの evidence** で行う。

## 2. non-responsibility（責務ではないもの）

DocumentHierarchy の修復（wrong hierarchy を直す／欠けた親を推測する／nearest parent を選ぶ／名前・コードから階層を補完する）、GT・他ページ・他年度・一般知識・過去の会話・算術による値の補完、PDF にない意味の生成、金額の単位換算、publish/normalize、production schema、remark の意味解釈。

## 3. input contract

| 入力 | 内容 | 使い方 |
| --- | --- | --- |
| SourceToken | `rawText`・`bbox`・`index`・`page`・font 等 | 値と sign の根拠。rawText をそのまま保持 |
| TableGeometry | PhysicalRowCandidate・ColumnBand（意味ラベルなし） | 行・列の物理的な対応づけの根拠 |
| LogicalRowCandidate | 論理行（physical row の集合。continuation 判定を含む） | **record の anchor**（同一論理行 or 明確な continuation の範囲） |
| DocumentHierarchy artifact（B only） | `nodes[]`（`xIndentEvidence`・`sourceRowRefs`・`hierarchyResolutionContext`）、`edges[]`（`status`）、`headerCollisionObservation`（`edgeContexts`）、`indentClusters[].placementBasis`、`latticeDiagnostics` | **hierarchy-dependent な association にだけ**使う。row-local field の根拠にはしない |

使ってはならない入力: 評価用 GT（Golden・hierarchy GT）、`human-observations.json` 等の人間確認値、SpatialRegion / RegionRelation / SemanticRecordCandidate / RecordAnchor / PageTemplate（凍結層）、抽出テキストからの補正。推論側は GT を import・参照しない（静的テストで確認する。§14）。

### record boundary（1 record の単位）

- **record = anchor（LogicalRowCandidate）+ その SourceToken refs + 近傍の補助観測（auxiliary candidate）**。DocumentHierarchy の node は、anchor の `sourceRowRefs` と一致する場合に**参照として**付く（推論で関連づけない）。
- **record identity と hierarchy parent identity を同一視しない**。hierarchy node が unresolved / risky でも、anchor の row-local field は解決できる。見出し形状を持たない行（目・子目の明細行）は hierarchy node を持たず、hierarchy-dependent field は `not_applicable`。

## 4. output contract

```ts
type FieldStatus = 'resolved' | 'blank' | 'unresolved' | 'ambiguous' | 'not_observed' | 'not_applicable';

interface FieldResult<V> {
  status: FieldStatus;
  value: V | null;              // resolved のときだけ非null。それ以外は必ず null（blank も 0 にしない）
  reasonCode: string | null;    // 非 resolved の理由（§6）
  evidence: FieldEvidence | null; // resolved / blank のとき必須
  candidates?: FieldEvidence[]; // ambiguous のとき、混ぜずに全候補を保持
}
interface FieldEvidence {
  page: number;
  sourceTokenRefs: number[];     // SourceToken.index（空白・罫線を除く、値を構成するtoken）
  sourceRowRefs: { logicalRowIndex: number; physicalRowIndexes: number[] }[];
  rawText: string;               // 元tokenの文字列（補正しない。複数tokenなら順序つき）
  associationClass: 'same_row' | 'continuation' | 'auxiliary' | 'unrelated';
  bboxUnion: { xMin: number; yMin: number; xMax: number; yMax: number };
}
interface AmountValue {
  magnitudeRaw: string;          // 例 "14,591,637"（カンマを含む表示のまま。符号記号は含めない）
  magnitudeNumeric: number;      // 桁区切りカンマを除いた整数。表示単位のまま（単位換算しない）
  explicitZero: boolean;         // 表示された "0" のときだけ true
}
interface RecordFieldResolution {
  anchor: { page: number; logicalRowIndex: number };
  recordKind: 'organization' | 'item' | 'request' | 'detail_line';   // 出典の形から。意味の確定ではない（§9 の hierarchy は別）
  rowLocal: {
    code: FieldResult<{ raw: string }>;
    name: FieldResult<{ raw: string; normalized: string }>;
    previousBudget: FieldResult<AmountValue>;
    requestedBudget: FieldResult<AmountValue>;
    difference: FieldResult<AmountValue>;
    previousBudgetSign: FieldResult<{ raw: '△' | '▲' | '-' }>;
    requestedBudgetSign: FieldResult<{ raw: '△' | '▲' | '-' }>;
    differenceSign: FieldResult<{ raw: '△' | '▲' | '-' }>;
  };
  hierarchyDependent: {
    parentItemAssociation: FieldResult<{ parentNodeRef: string }>;
    parentOrganizationAssociation: FieldResult<{ parentNodeRef: string }>;
  };
  auxiliaryEvidenceRefs: { class: AuxiliaryClass; sourceTokenRefs: number[]; page: number }[]; // 値としては解決しない。参照のみ
  pageUnitLabel: FieldResult<{ raw: string }>;   // ページ上に印字された単位表記（"(単位:千円)" 等）。ページに無ければ not_observed
}
type AuxiliaryClass = 'remark_text' | 'breakdown_table' | 'history_table' | 'ruled_table' | 'inline_label_number';
```

型は設計案で、実装・schema の確定ではない。

## 5. field scope（v0 の対象）

既存の fixture・human observation・Golden の実態（Golden Samples 文書の棚卸し）を確認して固定した。実装都合で増減させない。

| 区分 | field | 備考 |
| --- | --- | --- |
| row-local | `code`（組織・項・要求・明細コードを区別せず「行の先頭コード」の raw） | 要求番号（丸数字等）は v0 の対象外（§17） |
| row-local | `name`（raw と、文字間の空白除去・折返し行の連結を行った normalized） | 折返しは continuation の根拠があるときだけ連結。無ければ ambiguous |
| row-local | `previousBudget` / `requestedBudget` / `difference` | PDF に**表示された**値だけ。difference は計算しない |
| row-local | `previousBudgetSign` / `requestedBudgetSign` / `differenceSign` | 実際に表示された記号 token だけ（§8-1） |
| row-local | `pageUnitLabel` | ページ上に印字されているときだけ。金額の単位換算・推定はしない |
| hierarchy-dependent | `parentItemAssociation`（要求→項）/ `parentOrganizationAssociation`（項→組織。要求→組織は 2-hop の合成） | §9 の policy に従う |
| 参照のみ | `auxiliaryEvidenceRefs` | remark・積算・過年度表・罫線表・行内ラベル数字。**値としては解決しない**（§13） |

## 6. status model

`null` 一種類にしない。`status` を持つ。

| status | 意味 | `value` | 例 |
| --- | --- | --- | --- |
| `resolved` | source・視覚上に値があり、row-local / hierarchy の安全条件を満たす | 値 | 金額 `42,331,005`、明示の `0`、記号 `△` |
| `blank` | 対象のセルが**視覚的に空欄**であると、行・列の evidence から確認できる | null | 項の見出し行の金額欄、前年度が空欄の行 |
| `unresolved` | 値がある（または有りうる）が、安全に確定できない | null | 根拠が不足 |
| `ambiguous` | 複数の候補があり1つに決められない | null（候補は `candidates`） | 折返し名称が複数の行にまたがる等 |
| `not_observed` | evidence が観測されない（記号が表示されていない等）。**存在しない／正の値だと推定しない** | null | 差額の記号がない金額、ページに無い単位表記 |
| `not_applicable` | その行の種類に関係のない field | null | blank の金額の記号、見出し形状を持たない行の hierarchy field |

reason code の例（実装時に確定）: `no_amount_token_in_cell`・`header_collision_strong_evidence`・`hierarchy_level_gap`・`hierarchy_unresolved`・`multiple_candidates`・`continuation_not_supported`・`outside_v0_scope`。

## 7. provenance requirements

resolved / blank の field は必ず `evidence` を持つ（`sourceTokenRefs`・`sourceRowRefs`・`page`・`rawText`・`associationClass`・`bboxUnion`）。normalized value を作っても raw evidence を失わない（例: `rawText "14,591,637"` → `magnitudeNumeric 14591637`、`sourceTokenRefs [...]`）。blank は「空欄であること」の evidence として、その行・列の位置を示す参照（行の refs と列の band）を持つ。

## 8. invariants（不変の安全条件）

1. **Sign**: `△` `▲` `-` は、実際に source token / 視覚 evidence として確認できるときだけ確定する。**推定しない**（previous=100・requested=80 でも `differenceSign = "△"` と推定しない。見出し `(B-A)` や大小関係から推測しない）。記号が表示されていなければ `not_observed`（正の値の確定ではない）。記号は金額欄の左端に、数字から離れて印字されることがある（その場合も、同じ金額セルの記号として記録できるのは、同じ列・同じ行の evidence があるときだけ）。**行の備考内の `△27人` のような記号は金額の符号ではない**。
2. **Blank**: 空欄を `0` にしない。区別: 明示の 0（`resolved` の `explicitZero`）／blank／`not_observed`／`unresolved`／`not_applicable`。
3. **Difference**: `requestedBudget − previousBudget` を計算して欠けた difference を補完しない。PDF に表示された difference だけが解決対象。
4. **Invisible / missing**: 視覚的・source-level の evidence がない値を、一般知識・他ページ・他年度・過去の会話・hierarchy・算術・隣接行から補完しない。
5. **Raw preservation**: 解決値は元 token への provenance を保持する。
6. **Row-local first**: field ごとに evidence で判断し、「parent が unresolved ならすべて null」にしない。
7. **wrong parent より unresolved**: hierarchy-dependent な association は、安全でなければ確定しない。

## 9. hierarchy consumption policy

これは DocumentHierarchy の規則ではなく **FieldResolver の policy**。DocumentHierarchy は再判定しない。入力は B only の artifact（`edges[].status`、`nodes[].hierarchyResolutionContext`）。

**strong header-collision evidence** = `observedEvidenceKinds` が2種以上で `page_edge_row` を含む node（DocumentHierarchy の引き継ぎ契約と同じ定義）。**edge が risky** = その edge の child または parent が strong header evidence を持つ。

| 状態 | 判定 | hierarchy-dependent field | row-local field |
| --- | --- | --- | --- |
| **Safe** | `status = resolved_by_indent_sequence` かつ edge が risky でない | 解決してよい候補（`resolved`） | evidence が十分なら解決 |
| **Explicitly unresolved** | `unresolved` / `level_gap` / `ambiguous` | **確定しない**（`unresolved` / `ambiguous`） | **evidence が十分なら解決する**（捨てない） |
| **Resolved but risky** | `resolved_by_indent_sequence` だが edge が risky（strong header evidence が child か parent に関係） | **safe と同等に扱わない**。`ambiguous` / `unresolved` | evidence が十分なら解決 |

- 合成（要求→組織の2-hop）は、**全ての hop が Safe** のときだけ解決する。1 hop でも Explicitly unresolved / risky なら確定しない。
- 既知の evidence（DocumentHierarchy の結果。FieldResolver の判断材料）: こども家庭庁 false parent 6/37、環境省 2、防衛省 11。いずれも「strong header の node を親とする `resolved` の edge」。
- strong evidence は「衝突のある4文書だけに現れ、衝突のない11実験では 0」だった（偽陽性の確認は DocumentHierarchy 側の記録）。ただし FieldResolver はこの evidence を hierarchy の再判定には使わない（policy の入力としてのみ使う）。

## 10. row-local vs hierarchy-dependent

- **Row-local**: 同じ LogicalRow、または明確な continuation の範囲で完結する field。`code` / `name` / `previousBudget` / `requestedBudget` / `difference` / 各 sign / `pageUnitLabel`。
- **Hierarchy-dependent**: 親子関係や別 region との対応が必要な field。`parentItemAssociation` / `parentOrganizationAssociation` / remark・積算との対応（cross-row の補助観測との関連づけ）。
- Golden Samples は両方を意図的に含める（Golden Samples 文書の coverage matrix）。

## 11. source association policy

値が合っていても、**別の表から拾った値は failure**。同じ数字がページ上に複数あっても、値一致だけでは exact としない。evidence の `associationClass` は4種: `same_row`（同じ論理行）／`continuation`（折返し・明確な継続行）／`auxiliary`（備考・積算・過年度表などの補助領域）／`unrelated`（無関係な表）。**amount / sign / code / name の field は `same_row`（name は `continuation` を含む）だけを根拠にしてよい**。`auxiliary` / `unrelated` 由来の値は、確定の根拠にしない。評価では、Golden の「期待する source の種類（class）」と出力の evidence を照合する。

## 12. normalization boundary

許す（normalization）: 金額の桁区切りカンマの除去による整数化（raw を保持）、名称の文字間の空白除去と、continuation が根拠づける折返し行の連結（raw を保持）。
**normalization ではない（禁止）**: blank → 0、sign の推定、difference の計算、unit の推定・換算、他ページ・他の値からの補完、符号付き数値（`△` を負の数にする等）の生成（v0 は `magnitudeNumeric` と `sign` を別に返し、符号付き数値は作らない）。

## 13. remarks / breakdown policy

v0 で最も過剰解釈しやすい領域。Golden の evidence は、「物理的に右側にあること」が意味（備考）を決めないことを示した（MHLW p1268・p1555 の右側は、5年度の予算・決算の表と罫線表で、行の金額ではない。MEXT p876 の右側は積算表）。したがって:

- **semantic な remark text を field として解決しない**。`auxiliaryEvidenceRefs`（class + sourceTokenRefs）として provenance つきで参照するだけ。
- **physical right side ≠ semantic remark**。物理的に備考列にある token を、自動的に remark・内訳・金額として扱わない。補助領域の数字（`職員厚生経費 177`、`計 464( 464)` 等）は、core row の amount field の根拠にしない（空欄の amount を埋めない）。
- `（要求要旨）` のような行内ラベルの近くの本文は `remark_text` の候補として参照を返してよいが、本文の解釈・分類はしない。

## 14. static boundary（GT contamination）

```text
SourceToken / TableGeometry / LogicalRow / DocumentHierarchy artifact
        ↓
   FieldResolver  →  FieldResolver output
------------------------------------------
Golden GT  →  Evaluator
```

推論モジュールは Golden fixture・hierarchy GT・`human-observations.json` を import・参照しない。Golden は評価・テストだけが読む。DocumentHierarchy の再実行・再調整（A3・B+A2 再評価・header 規則の再設計・Future Experiment C）は、このタスクでも次の PoC でも行わない。hierarchy failure を FieldResolver の実装中に観測したら、記録し・provenance を残し・unresolved / risky のままにする。

## 15. evaluation metrics

Golden の各 field の状態は 3 種に分ける: **resolvable**（GT が `resolved` または `blank`）／**non-resolvable**（GT が `not_observed` / `not_applicable` / 方針上 resolved にしてはならない）。出力の各 field を次に分類する。

| 区分 | 定義 |
| --- | --- |
| exact resolved | 出力 `resolved` かつ value・normalization が GT と一致し、source association の class が期待どおり |
| exact blank | 出力 `blank` で GT も `blank` |
| **false resolved** | 出力が `resolved` / `blank` なのに、GT が non-resolvable、または value が GT と違う（誤値・誤った blank）。**最重要の failure** |
| wrong normalization | raw は一致、normalized（整数化・名称の連結）が違う |
| wrong source association | value は一致するが、evidence が `auxiliary` / `unrelated` の token、または期待と違う行 |
| unresolved / ambiguous / not observed | 出力が非 resolved。GT が resolvable なら recall loss、GT が non-resolvable なら正しい棄権 |

主要指標: **false-resolve rate** = false resolved ÷（出力が `resolved` / `blank` の field 数）。precision = exact ÷ resolved 出力。safe coverage = exact ÷ GT resolvable。評価表は field 別（`field | GT resolvable | exact | false resolved | unresolved | ambiguous | precision | safe coverage`）と context 別（normal row／auxiliary-heavy／hierarchy unresolved／resolved + header risk／blank／explicit sign／explicit zero）。値一致だけでは exact としない（§11）。

## 16. success / failure philosophy

優先順位: ①false resolve を避ける ②wrong source association を避ける ③provenance を保持する ④safe resolved coverage を上げる。`unresolved` は必ずしも failure ではない。**GT で解決可能な field を unresolved にしたら recall loss、GT で解決不能な field を resolved にしたら safety failure。** v0 の最初の目標は coverage の最大化ではなく、**PDF に表示されていない意味を作らないこと**。

## 17. known limitations / explicitly deferred

- Golden は小さい（8ページ・20 target）で、**視覚確認はアシスタント（AI）がレンダリング画像を読んだもの**。人間による確認は未実施（Golden Samples 文書）。
- 「前年度・要求額はあるが差額が表示されない行」は現在の Golden に見つかっていない（NOT FOUND IN CURRENT GOLDEN SET。v0 PoC の評価対象外）。
- hierarchy-dependent field の評価は、凍結済みの hierarchy artifact がある範囲（METI p9・p10・p96、MHLW p1555、こども家庭庁 p136）だけ。MHLW p1268・MEXT p876 は対象外。
- `pageUnitLabel` は、ページに印字されている場合だけ。単位の推定・換算はしない。
- **deferred（今回も v0 でもやらない）**: 要求番号（丸数字等）の field、remark の semantic 解決、金額の単位換算、符号付き数値の生成、ページをまたぐ continuation、総表（summary）ページの field、他省庁への展開、normalize/publish pipeline、production schema、FieldResolver 本体の実装（次タスクの PoC）。
