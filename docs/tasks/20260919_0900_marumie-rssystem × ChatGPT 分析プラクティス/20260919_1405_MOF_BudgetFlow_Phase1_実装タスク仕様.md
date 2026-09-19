# MOF Budget Flow Phase 1 実装タスク仕様

作成日: 2026-09-19  
対象リポジトリ: `igomuni/marumie-rssystem`  
対象ブランチ確認時: `fix/integrated-sankey-tab-persist`

## 1. 目的

既存の Integrated Sankey を変更せず、財務省（MOF）の当初予算・補正予算・決算を時系列の「予算イベント」として観測できる検証用ページ `/budget-flow` を新設する。

今回の目的は新ページの見栄えではなく、以下を検証可能なデータモデルとして実装することである。

1. 当初・補正・決算で「項」の集合が変化する理由を追跡できること
2. `項コード` を恒久的な同一性IDとみなさないこと
3. 原典レコードと「実質的に同一の項」という推定を分離すること
4. 現行 Integrated Sankey の結果を残し、後から旧モデルとの差分を検証できること
5. Phase 1 では、2024年度について今回の分析で確定した「決算のみ254項」の構造を説明可能にすること

## 2. 重要な前提

### 2.1 既存 Integrated Sankey は変更しない

既存:

- `/integrated-sankey`
- `app/lib/integrated-sankey.ts`
- `/api/integrated-sankey`

は比較対象として維持する。

Phase 1 のために既存ロジックの意味を変更しない。

### 2.2 既存 MOF raw/normalized データを再利用する

`generate-mof-kou-moku-data.ts` が生成する `mof-kou-moku-{YEAR}.json` を入力の中心とする。

既存処理ではMOF配布CSVから、

- 当初予算
- 補正予算
- 決算

を取り込んでいる。

決算については少なくとも以下の値を保持する既存構造を利用する。

- 歳出予算額
- 前年度繰越額
- 予備費使用額
- 流用等増△減額
- 予算決定後移替増△減額
- 歳出予算現額
- 支出済歳出額
- 翌年度繰越額
- 不用額

Phase 1 では、raw ingestion を作り直すのではなく、その後段に新しい意味層を追加する。

## 3. 現行モデルとの違い

現行 Integrated Sankey は概ね、

```text
当初予算額
  +
補正予算の difference
  ↓
section.amount
  ↓
MOF目 ↔ RS事業
```

としている。

このモデルは当初＋補正後の予算を見る用途では有効だが、

- 前年度繰越
- 予備費
- 流用
- 移替
- 行政移管
- 決算
- 項コード変更

を「項の履歴」として表現するモデルではない。

新 `/budget-flow` はこれらを別の予算イベントとして扱う。

## 4. Phase 1 の対象範囲

対象年度:

- 2024年度

対象データ:

- 当初予算
- 補正予算第1号
- 決算

Phase 1 で最低限扱う関係:

- exact match
- 項コード差
- 補正第1号で新設・計上
- 前年度繰越
- 行政移管
- 所管・組織展開
- 既知の移替関係

Phase 1 ではRS事業・支出先への接続を主目的としない。

## 5. 2024年度の期待値

今回のMOF一次資料横断分析で得た基準値を regression fixture として利用する。

### 5.1 決算のみ254項の最終分類

| 分類 | 件数 | 比率 |
|---|---:|---:|
| 所管・組織展開（移替・繰越・行政移管等） | 173 | 68.1% |
| 項コード差（実質同一項） | 51 | 20.1% |
| 補正第1号で新設・計上 | 23 | 9.1% |
| 前年度繰越＋行政移管（厚労省→国交省） | 4 | 1.6% |
| 前年度繰越のみ（当年度歳出予算額0） | 3 | 1.2% |
| 合計 | 254 | 100% |

注意:

- 上記は相互排他的な最終分類。
- 173項の内部には、公式移替表で確認できるものと、繰越・行政移管等で説明されるものが含まれる。
- 「決算のみ254項 = 新規政策254件」ではない。

### 5.2 補正側からの逆方向検証

補正第1号の項数: 997項。

分析上、

- `外N目` あり: 433項
- `外N目` なし: 564項
- 564項中、当初に存在するが金額0円: 37項
- 当初に項自体が存在しない: 25項

当初に存在しなかった25項のうち24項は決算にも存在し、そのうち23項が上記「補正第1号で新設・計上」23項と一致した。

この23件一致をテスト可能な期待値として残す。

## 6. 新規データモデル

### 6.1 Source record と Canonical identity を分離する

原典に存在する1レコードと、年度内で実質的に同じ項と判断した概念を別オブジェクトにする。

```ts
export interface BudgetFlowSourceItem {
  id: string;
  fiscalYear: number;
  budgetType: string;

  accountType: string;
  ministry: string;
  organization: string;
  specialAccount?: string;
  subAccount?: string;

  sectionCode: string;
  sectionName: string;

  amount: number;
  previousAmount?: number;
  difference?: number;

  sourceUrl?: string;
  page?: number | null;
}

export interface CanonicalBudgetItem {
  id: string;
  fiscalYear: number;
  displayName: string;

  sourceItemIds: string[];
  events: BudgetEvent[];
  relations: BudgetItemRelation[];
}
```

### 6.2 Relation

```ts
export type BudgetItemRelationType =
  | 'same_item'
  | 'code_changed'
  | 'renamed'
  | 'transferred'
  | 'administrative_transfer'
  | 'carried_over'
  | 'split'
  | 'merged'
  | 'cross_account';

export interface BudgetItemRelation {
  id: string;
  fromSourceItemId: string;
  toSourceItemId: string;
  type: BudgetItemRelationType;

  evidence: {
    method:
      | 'exact-key'
      | 'same-scope-same-name'
      | 'official-transfer-table'
      | 'settlement-columns'
      | 'supplement-match'
      | 'manual-fixture';
    confidence: 'exact' | 'strong' | 'inferred';
    sourceUrl?: string;
    note?: string;
  };
}
```

### 6.3 Budget Event

```ts
export type BudgetEventType =
  | 'initial_budget'
  | 'supplement_added'
  | 'supplement_reduced'
  | 'carryover_in'
  | 'reserve_use'
  | 'reallocation'
  | 'transfer_in'
  | 'transfer_out'
  | 'administrative_transfer'
  | 'current_budget'
  | 'spent'
  | 'carryover_out'
  | 'unused';

export interface BudgetEvent {
  id: string;
  type: BudgetEventType;
  amount: number;

  sourceItemId: string;
  sourceBudgetType: string;

  counterpartySourceItemId?: string;

  provenance: {
    sourceType: 'mof-csv' | 'mof-xml' | 'mof-pdf' | 'derived';
    sourceUrl?: string;
    page?: number | null;
    note?: string;
  };
}
```

## 7. 同一性判定ルール

### Level A: exact

同一会計・所管・組織/会計・勘定・項コード・項名が一致。

これは自動で同一項としてよい。

### Level B: same scope + same name + code difference

同一の会計範囲・所管・組織で項名が一致し、項コードだけ異なる場合。

`code_changed` としてrelationを作成する。

項コードを上書きして1つに潰さず、source record は両方保存する。

### Level C: supplement-created

当初に対応項が存在せず、補正第1号に出現し、決算側に対応する場合。

`supplement_added` event と relation を生成する。

2024年度では最終分類23項との一致をfixtureで検証する。

### Level D: carryover

当年度の `歳出予算額 = 0` で、`前年度繰越額 > 0` の場合、当年度新規予算とみなさない。

`carryover_in` event を生成する。

### Level E: administrative transfer

決算列や公式資料から、元所管の減額と移管先の増額が対応する場合。

`administrative_transfer` relation/event として保持する。

Phase 1 では既知fixtureを優先し、一般化できないものを推測で自動結合しない。

### Level F: official transfer

財務省公式移替表で確認できる関係は `official-transfer-table` を evidence とする。

Phase 1 では既に分析済みの2024年度fixtureを利用してよい。

## 8. 禁止する推論

以下だけを根拠に自動で同一項としない。

- 項コードだけが同じ
- 項名だけが同じ
- 金額だけが同じ
- 決算で新しく出現した
- `予算決定後移替増△減額` が0だから移替ではない
- 決算にあるから当年度新設である

曖昧なケースは `unresolved` として残せる設計にする。

## 9. 金額検証

決算について、入力データが必要列を持つ場合は以下の恒等式を検証する。

```text
歳出予算額
+ 前年度繰越額
+ 予備費使用額
+ 流用等増△減額
+ 予算決定後移替増△減額
= 歳出予算現額
```

および、

```text
歳出予算現額
= 支出済歳出額
+ 翌年度繰越額
+ 不用額
```

列定義に存在しない項目を推測で追加しない。

検証結果は item ごとに、

```ts
validation: {
  currentBudgetEquation: 'pass' | 'fail' | 'not-applicable';
  settlementEquation: 'pass' | 'fail' | 'not-applicable';
  delta?: number;
}
```

として保持してよい。

## 10. 新規ファイル案

原則として以下を新規追加する。

```text
types/mof-budget-flow.ts

scripts/generate-mof-budget-flow-data.ts

app/lib/mof-budget-flow.ts
app/lib/api/mof-budget-flow-loader.ts

app/api/budget-flow/route.ts

app/budget-flow/page.tsx
app/budget-flow/components/...

tests または既存規約に沿ったテストファイル
```

出力:

```text
public/data/mof-budget-flow-2024.json
```

リポジトリの既存データ管理規約に合わせ、必要なら `.json.gz` をGit管理対象とする。

既存 `compress-data` / `decompress-data` の規約を確認して追加する。

## 11. Phase 1 UI

最初からSankeyを主画面にしない。

検証しやすさを優先する。

### 11.1 上部サマリー

表示例:

```text
2024年度

当初       xxx
補正第1号  xxx
決算       xxx

決算のみ   254

[Raw] [Canonical] [現行モデルとの差分]
```

### 11.2 項一覧

フィルター:

- 会計
- 所管
- 組織
- 項名
- relation type
- event type
- unresolvedのみ
- 金額範囲

### 11.3 項詳細

1つの CanonicalItem を選択すると、

```text
当初
 ↓
補正
 ↓
繰越 / 移替 / 行政移管
 ↓
予算現額
 ↓
支出
 ├─ 翌年度繰越
 └─ 不用
```

を時系列表示する。

各eventから原典情報を確認できるようにする。

### 11.4 Evidence panel

必須。

表示するもの:

- raw source record
- 項コード
- 項名
- 所管/組織
- budget type
- relation判定方法
- confidence
- source URL / page
- 判定理由

「なぜ同じ項として扱ったのか」をUIから確認できること。

## 12. 現行モデルとの差分表示

Phase 1 では最低限、現在の Integrated Sankey と新モデルの定義差をページ内に明示する。

```text
Integrated Sankey
  当初 + 補正差額を中心とする既存モデル

Budget Flow
  原典レコードを保持したまま
  当初・補正・繰越・移替・決算をイベントとして扱う検証モデル
```

旧ページを削除・置換しない。

## 13. Regression fixtures

今回の分析成果をfixture化する。

最低限以下をテストケースにする。

1. 情報通信技術調達等適正・効率化推進費
   - 当初の集中計上
   - 補正後金額
   - 決算で複数所管へ展開
   - 公式移替表との対応

2. 科学技術イノベーション創造推進費
   - 移替元/移替先
   - 同一項名集計で移替が相殺するケース

3. 水道施設災害復旧事業費
   - 厚労省側の前年度繰越
   - 厚労省側の移替減
   - 国交省側の移替増

4. 生活基盤施設耐震化等対策費
   - 同上

5. 東日本大震災復興関係
   - 項コード差だが実質同一項となるケース

6. 防衛力強化資金へ繰入
   - 補正第1号で計上
   - 名称差の扱いを確認

7. 補正新設23項
   - 最終分類23件と一致すること

## 14. Phase 1 完了条件

以下をすべて満たしたらPhase 1完了とする。

- `/budget-flow` が既存 `/integrated-sankey` と独立して動作する
- 既存 Integrated Sankey の結果を変更していない
- 2024年度の当初・補正第1号・決算を読み込める
- raw source record と canonical identity が分離されている
- 項コード差を同一性の根拠の1つとして扱える
- 補正新設をイベントとして扱える
- 前年度繰越を当年度新設と誤認しない
- 行政移管をrelationとして表現できる
- 254件について分類結果を機械的に集計できる
- 254件の分類合計が254になる
- 補正新設23件のfixtureと一致する
- 金額恒等式を検証できる
- Evidence panel から判定根拠を確認できる
- unresolved を無理に自動分類しない
- `npm test` / 対象テスト / build が通る

## 15. Phase 1 では実施しないこと

- 既存 Integrated Sankey の全面置換
- RS事業との新方式での完全再接続
- 支出先まで含めた新Sankey完成
- 全年度への一般化
- PDF全文解析をランタイムで実施
- AIによる曖昧項目の自動同一性判定
- 推定結果を原典値として上書き

## 16. Phase 2 以降

Phase 1でidentity/eventモデルを検証した後、

### Phase 2

財務省公式移替資料を構造化し、

```text
transfer_out → transfer_in
```

を明示的な金額edgeとして生成する。

### Phase 3

既存 `generate-mof-rs-kou-moku-linkage.ts` の成果を利用し、

```text
MOF Budget Flow
   ↓
MOF 目
   ↓
RS事業
   ↓
支出先
```

へ接続する。

その時点で初めて新しいSankey/Flow可視化を主機能として検討する。

---

## 実装担当への重要事項

このタスクの目的は「新しいページを作ること」ではなく、**既存モデルでは失われていた予算イベントと項の同一性を、検証可能な形で保持すること**である。

見た目を先に最適化しないこと。

まず2024年度fixtureとの一致、原典値の保持、判定根拠の可視化を優先する。

既存実装を壊して新モデルに置換せず、必ず別系統として実装する。
