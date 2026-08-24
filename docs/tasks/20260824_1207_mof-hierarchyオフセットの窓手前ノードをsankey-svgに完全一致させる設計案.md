# mof-hierarchy オフセットの窓手前ノードを /sankey-svg に完全一致させる設計案

## 前提・経緯

[20260822_2133_MOF事項別内訳の階層サンキー実装案.md](20260822_2133_MOF事項別内訳の階層サンキー実装案.md) で実装した TopN/オフセットは、
窓の**手前**（rank 0..offset-1）と**末尾**（rank offset+limit..）の両方を同じ1つの集約ノードにまとめている（2ゾーン方式）。

ユーザーからの指摘：オフセットで窓の手前に外れたノードが集約ノードの件数・金額に混ざるのは `/sankey-svg` と違う。
B案（/sankey-svg 完全一致）を採用する方針で合意済み。本書はその具体的な対応案。

**訂正**: 初版では「調整は事業ノード1階層だけに限定され、所管・予算総計は動かない」と書いたが、これは誤り。
実機検証で訂正した（下記）。

## 実機検証：予算総計・所管も実際に動く

`/sankey-svg` トップ画面（絞り込み無し）で「支出先」のオフセットを1件だけ進めると：

| | 予算総計 | 厚生労働省 |
|---|---|---|
| オフセット前 | 147.63兆円 | 93.33兆円 |
| オフセットで1件送った後 | 117.59兆円 | 63.29兆円 |

ランク1位の支出先（「基礎年金給付に必要な経費」の先、約30兆円）が窓から外れたことで、**予算総計・所管の
合計の両方が同じだけ減っている**。ユーザーからのスクリーンショットで確認し、自分でも操作して再現した。

初版の「実機検証」は、URLパラメータ `?ro=1&ot=r` を直接開いて確認したもので、これは `/sankey-svg` 側の
初期表示のバグ（URLからのオフセット復元が効かない）を踏んでいて、実際には何も変わっていない画面を見ていた。
画面上のプルダウン操作 → 「次へ」ボタンで再現すると、上記のとおりはっきり変わる。誤った手順で「変わらない」
と結論していた。

コード上の裏付け（`app/lib/sankey-svg-filter.ts:478-491`）：

```ts
const ministryBudgetValue = new Map<string, number>();
for (const n of allNodes) {
  if (n.type === 'project-budget' && n.ministry) {
    // ...
    if (aboveWindowBudgetIds.has(n.id)) continue;   // 窓の手前は丸ごと除外
    const adjValue = projectAdjustedBudget.get(n.id) ?? n.value;  // 調整後（縮めた）値
    ministryBudgetValue.set(n.ministry, (ministryBudgetValue.get(n.ministry) || 0) + adjValue);
  }
}
```

所管の合計そのものが「窓の手前を除いた調整後の値」の積み上げで作られている。`total → 所管` のエッジ
（629行目）もこの `ministryBudgetValue` を使うので、根（予算総計）まで自然に伝播する。つまり `/sankey-svg`
は最初から「隠した分は全階層に効く」設計であり、1階層だけに閉じ込めているわけではなかった。

## CLAUDE.md の固定値との関係

CLAUDE.md の「総予算 = 151,120,000,000,000円」は、**絞り込み無しの既定表示**でのデータ全量を指す事実であって、
「どんな絞り込みをしても画面の数字が変わらない」という UI 上の不変条件ではない。`/sankey-svg` 自身も既定表示
（オフセット0）では真の全量を出し、ユーザーがオフセットを操作したときだけ変わる。mof-hierarchy も同じ扱いで
矛盾しない——既定表示（TopN・オフセットとも既定値）では今までどおり151.12兆円のまま。

## 採用する方式：厳密な木の性質を使い、隠した分をそのまま祖先へ累積させる

`mof-hierarchy` の各ノードの `amount` は元々「子の合計」として積み上げてある（`buildFullNodeMap`）。
なので `/sankey-svg` のように「上流ノードの値を専用ロジックで再集計する」必要はなく、**窓の手前で隠した
ノードの金額を、その直近の実祖先から根（予算合計）まで、経路上のノード全部から引くだけ**でよい。
木構造なので「子の合計を親が持つ」を保ち続ける形で自然に conservation が保たれる
（親 = 表示している子の合計、という不変条件そのものは崩さない。崩れる／変わるのは「全量」の値そのもの）。

`/sankey-svg` との対応:

- 窓の**手前**（rank 0..offset-1）: 完全に非表示。集約にも入れない。金額は祖先全員から引く
- **窓**: そのまま表示
- **末尾**（rank offset+limit..）: 1つの集約ノードにまとめる（今の mof-hierarchy と同じ、変更無し）

## 変更点（app/lib/mof-hierarchy-sankey.ts）

列ごとの残す/隠す判定のところ（271-311行目付近）を3分岐にする。

```text
現状: rankable を [0, start) ∪ [start, start+limit) ∪ [start+limit, end) に分け、
      [start, start+limit) だけ kept、それ以外はまとめて others へ

変更後:
  beforeWindow = rankable[0, start)            → 非表示（others に入れない。kept にも入れない）
  window       = rankable[start, start+limit)  → kept（現状どおり）
  tail         = rankable[start+limit, end)    → others へ（現状どおり）
```

`beforeWindow` の各ノードについて、`skipPassThroughAncestors` と同じ要領で直近の実祖先を求め、そこから
`parentId` を辿って `ROOT_ID`（予算合計）まで、経路上のすべてのノードの `amount` から `beforeWindow` ノードの
`amount` を引く。複数の `beforeWindow` ノードが経路を共有する場合はそれぞれの分をすべて引く（単純に
「祖先の `amount` -= 隠した子の `amount`」をループで積み重ねればよい。祖先の `amount` を直接書き換えるので、
以降の出力（`sankeyNodes` の `value`、`links` の `value`、`metadata.total`）はこの縮めた値を自然に使う）。

処理順序の注意: 列は `ministry → organization → subAccount → section → item` の順で処理する。ある列で
`beforeWindow` を引いた結果、その列自身の `amount` はもう「表示上の値」になっているので、**さらに下流の列の
ランキング（`rankable` のソート）には影響させてはいけない**——`/sankey-svg` も支出先のランキングは各支出先
自身の真の値で行い、上流の縮小とは無関係。今の実装は各ノードの `amount` を `buildFullNodeMap` 時点の値で
一度だけセットし、以降ランキングに使う値と表示に使う値を分けていないので、**ランキング専用に「元の
amount」を別途保持**する必要がある（`Building` に `rawAmount` を足し、ソートは常に `rawAmount` を使う。
表示・親への加減算は `amount` を使う）。

`others`（集約）側の変更は無い。`tail` だけを対象にする今のロジックがそのまま使える
（`beforeWindow` は最初から候補から除くので、集約走査のループには入らない）。

## columnCounts・metadata への影響

`columnCounts[column]` は「候補件数」（`rankable.length`）のままでよい。分母は変えない（既存の
documented cascading 挙動として説明済み）。

`metadata.total` は根ノード（`ROOT_ID`）の縮小後 `amount` を使う（自然にそうなる。既定表示では
オフセットが無いので今までどおり151.12兆円）。

`metadata.notes` に一言足す：「表示位置をずらして窓の手前に外れた分は、集約にも合計にも含みません
（/sankey-svg と同じ扱いです）」。

## テスト方針（test-first）

1. `app/lib/mof-hierarchy-sankey.test.ts` に失敗するユニットテストを先に書く：
   - 事項3件を持つ1つの項で、TopN=1・offset=1 にすると、rank0（手前）の事項は `sankey.nodes` に**存在せず**、
     `others`（事項集約）の `aggregatedCount` にも**含まれない**こと
   - その項の親（項ノード自身）・組織・所管・`metadata.total` が、隠した事項の金額ぶんだけ**それぞれ**
     減っていること（1階層だけでなく全階層に伝播することの確認）
   - ランキング（どの事項が窓に入るか）は、他の列の縮小と無関係に、常に各事項自身の真の金額で決まること
2. `tests/e2e/mof-hierarchy.spec.ts` にユーザー repro を再現する回帰テストを追加：
   初期表示で事項のオフセットを「次へ」押下 → 消えたノードが集約の件数・金額に現れないこと、かつ
   予算合計・所管の表示金額が減ること
3. 両方が現行実装に対して赤であることを確認してから実装し、緑にする

## 見送った案（記録）

- **調整を1ホップに限定する案（初版の結論）**: 実機検証が誤っていたことが判明したため撤回。
  `/sankey-svg` は実際には祖先全員に伝播させており、1ホップ限定は完全一致にならない
- **見た目だけ変える案**: 集約ノードの名前・ツールチップの文言をいじるだけでは、金額・件数が
  「窓の手前を含んでしまっている」という実質は直らないため見送り
