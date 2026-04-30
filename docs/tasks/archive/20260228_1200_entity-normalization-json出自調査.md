# entity-normalization.json 出自調査

## 背景・問題意識

`generate-entity-labels.py` のソースが `entity-normalization.json`（23,867件）であるのに対して、
`analyze-label-coverage.py` のソースである `recipients_without_total.csv`（26,192件）と
**2,325件の乖離** があることが判明した。本調査はその原因を明らかにする。

---

## entity-normalization.json の生成元

### 生成スクリプト

```
scripts/generate-entity-dict.ts（npm run generate-entity-dict）
```

### 入力ソース

```
data/year_2024/5-1_RS_2024_支出先_支出情報.csv（Shift_JIS）
```

※ `rs2024-structured.json` を経由せず、正規化済み CSV を直接読む。

### 処理フロー

```
CSV 読み込み
  │
  ├─ Step 1: ルールベース分類（信頼度高）
  │    ├─ 名称プレフィックス: (株), (有), (一財) など
  │    ├─ 正式法人格: 株式会社, 独立行政法人 など（前置き）
  │    ├─ 地方公共団体: 末尾が「都道府県」「市区町村」
  │    ├─ 国の機関キーワード: 農政局, 刑務所 など
  │    └─ 法人種別コード: 101, 201, 301-305, 401, 499
  │         ※ 399（混在型）は除外
  │
  ├─ Step 2: LLM 分類（ルールベース未マッチのみ）
  │    └─ Claude Haiku で entityType と displayName を判定
  │         ※ ANTHROPIC_API_KEY 未設定時はスキップ → 未収録になる
  │
  └─ 最終マージ（ルールベース > LLM で上書き）
       └─ 出力: public/data/entity-normalization.json
```

### 出力フォーマット

```json
{
  "株式会社カタルチア": {
    "displayName": "カタルチア",
    "entityType": "民間企業"
  },
  "カタルチア東京支店": {
    "displayName": "カタルチア東京支店",
    "entityType": "民間企業",
    "parentName": "カタルチア"
  }
}
```

- **キー**: `spendingName`（正規化前・生の支出先名）
- **displayName**: 法人格を除去した表示名（正規化後）
- **entityType**: 7分類（民間企業 / 地方公共団体 / 国の機関 / 独立行政法人 / 公益法人・NPO / 外国法人 / その他）
- **parentName**: 支店・支社の場合のみ付与

---

## 件数比較

| ファイル | 件数 | 単位 |
|---------|------|------|
| `recipients_without_total.csv` | 26,192件 | ユニーク spendingName（実際の支出データ） |
| `entity-normalization.json` | 23,867件 | ユニーク spendingName（スクリプト生成） |
| **差分** | **2,325件** | entity-normalization.json に未収録の支出先名 |

---

## 2,325件が欠落する原因

### 原因 1: LLM 分類がスキップされた名称（主因）

ルールベースにヒットしない支出先名は LLM で分類されるが、
`ANTHROPIC_API_KEY` が設定されていない環境では LLM がスキップされ、
`needsLLM[]` に積まれたまま **entity-normalization.json に収録されない**。

対象となりやすい名称例：
- 個人名・仮称: `弁護士A`, `医師B`
- 短い名称: `AA社`, `DD社`
- 特殊記号を含む: `(ペルー)`, 括弧・スラッシュ混在など

### 原因 2: 法人種別コード 399 の除外

`CORPORATE_TYPE_MAP` に 399（混在型）が含まれていないため、
コード 399 のみを根拠に分類できる名称はルールベースに引っかからず、
LLM もスキップされると未収録になる。

### 原因 3: パイプラインの時間差

`entity-normalization.json` と `rs2024-structured.json` は
別のスクリプトが別のタイミングで生成するため、
CSV データの更新後に片方だけ再生成した場合に不整合が生じる。

---

## ラベリングへの影響

```
rs2024-structured.json（実際の支出）
  ├─ entity-normalization.json に収録（23,867件）
  │    └─ entity-labels.json でラベル付与可能（最大 86.9%）
  └─ entity-normalization.json に未収録（2,325件）
       └─ entity-labels.json にエントリなし → v2 UI で「ラベルなし」に分類される

実質カバレッジ ≈ 80.1%（analyze-label-coverage.py 計測値と一致）
```

### 現状の指標の読み方

| 指標 | 数値 | 分母 | 意味 |
|-----|------|------|------|
| `generate-entity-labels.py` カバレッジ | 86.9% | entity-normalization.json（23,867件） | ラベル辞書内の網羅率 |
| `analyze-label-coverage.py` カバレッジ | 80.1% | 実際の支出データ（26,192件） | **実質的な件数カバレッジ** |
| v2 UI「件数カバレッジ」 | ≈ 80% | rs2024-structured.json のユニーク数 | UI に表示される実績値 |

---

## 対処方針（オプション）

### A: `generate-entity-labels.py` のソースを rs2024-structured.json に変更

- メリット: 分母が揃い、カバレッジ数値が一致する
- デメリット: rs2024-structured.json は 96MB と大きく、読み込みに時間がかかる

### B: `entity-normalization.json` の欠落 2,325件を補完

- `npm run generate-entity-dict` を ANTHROPIC_API_KEY 付きで再実行し、LLM 分類の抜けを埋める
- メリット: entity-normalization.json 自体が完全になる（v1 UI の entityType 分類にも恩恵）
- デメリット: LLM API コストがかかる

### C: 現状のまま運用（許容）

- 件数カバレッジは約 80%（金額ベースでは 98.4%）
- 未収録 2,325件は「ラベルなし」として明示される
- ドキュメントで乖離を把握済みであれば、実運用上は問題は小さい
