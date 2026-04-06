# /sankey-svg 高オフセット時に事業(予算)集約ノードが消える 修正計画

> 作成日: 2026-04-07
> 対象ファイル: `app/lib/sankey-svg-filter.ts`

---

## 目的

ユーザーが支出先オフセットを高い値（例: 7495）に設定したとき、事業(予算)列の集約ノードが消えてしまい、事業(支出)列の集約ノードが宙に浮いた状態になる問題を解消する。

---

## 現象

支出先オフセット = 7495 のとき:
- `__agg-project-spending` ノードは表示される（支出先tail列へのエッジあり）
- `__agg-project-budget` ノードが消える

これにより事業(予算)列に集約ノードが存在せず、対称性が崩れる。

---

## 根本原因

`filterTopN`（`app/lib/sankey-svg-filter.ts`）において、`__agg-project-budget` の生成条件が `otherProjectWindowTotal > 0`（集約事業のウィンドウ内支出合計 > 0）になっている。

```typescript
// L167-173（現在）
if (otherProjectWindowTotal > 0 || otherProjectTailTotal > 0) {
  if (otherProjectWindowTotal > 0) {   // ← この条件が問題
    nodes.push({ id: '__agg-project-budget', ... });
  }
  nodes.push({ id: '__agg-project-spending', ... });
}
```

オフセットが高くなるとウィンドウには非常に小額の支出先しか入らず、集約事業（otherProjects）はそれらへの支出がゼロになる。その結果:

- `otherProjectWindowTotal = 0`（ウィンドウ内支出ゼロ）
- `otherProjectTailTotal > 0`（tail支出はある）

→ `__agg-project-spending` は生成されるが `__agg-project-budget` は生成されない。

同じく ministry→`__agg-project-budget` エッジの生成も `otherProjectWindowTotal > 0` を条件にしているため（L225-236）、こちらも同様に作成されない。

---

## 影響範囲

支出先オフセットが以下の条件を満たすとき発生:
- 集約事業（otherProjects）のウィンドウ内支出がゼロになる程度に高い
- かつ tail 支出はまだ存在する

ウィンドウサイズ（topRecipient）が 100 の場合、支出先ランク上位の集約事業はオフセット数千番台で発生しやすい。

---

## 修正方針

`__agg-project-budget` ノードの生成条件を `otherProjectWindowTotal` から切り離し、`otherProjectBudgetTotal`（集約事業の予算額合計 > 0）と、`__agg-project-spending` が生成される条件の論理積にする。

### 変更1: `__agg-project-budget` ノード生成条件

```diff
-変更前: if (otherProjectWindowTotal > 0)
+変更後: if (otherProjectBudgetTotal > 0)
```

ただし `__agg-project-spending` が生成されない場合（`otherProjectWindowTotal = 0 && otherProjectTailTotal = 0`）は `__agg-project-budget` も不要なので、外側の `if` 文の中に含める形は維持する。

### 変更2: ministry→`__agg-project-budget` エッジ生成条件

L225 の `if (otherProjectWindowTotal > 0)` ガードを `if (otherProjectBudgetTotal > 0)` に変更する。

ただし、対象省庁ノードが現在のウィンドウに表示されていない（`wv = 0` で nodes に追加されていない）場合は、そのエッジは computeLayout で自動的にスキップされるため、余分な除外ロジックは不要。

### 変更なし

- `__agg-project-spending` の生成条件: `otherProjectWindowTotal > 0 || otherProjectTailTotal > 0`（現状維持）
- `__agg-project-budget → __agg-project-spending` エッジ: `otherProjectBudgetTotal > 0`（現状と同じ条件）

---

## エッジケース

| ケース | 期待する動作 |
|---|---|
| `otherProjectBudgetTotal = 0`（支出のみ事業のみ集約） | `__agg-project-budget` は生成しない |
| `otherProjectWindowTotal > 0`（通常ケース） | 従来通り両ノード生成 |
| `otherProjectWindowTotal = 0 && otherProjectTailTotal > 0`（高オフセット） | `__agg-project-budget`（予算あり）と `__agg-project-spending`（tail用）両方生成 |
| `otherProjects.length = 0` | 両ノード生成しない（`otherProjectBudgetTotal = 0` のため） |

---

## 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `app/lib/sankey-svg-filter.ts` | L168: `if (otherProjectWindowTotal > 0)` → `if (otherProjectBudgetTotal > 0)` / L225: 同様の条件変更 |

---

## 検証方法

```bash
npm run dev
# localhost:3002/sankey-svg
```

確認ポイント:
1. オフセット 7495 で `__agg-project-budget` が表示されること
2. オフセット 0 で従来通り動作すること
3. `npx tsc --noEmit` でエラーなし
