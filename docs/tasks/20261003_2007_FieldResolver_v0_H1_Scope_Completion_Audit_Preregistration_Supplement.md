# FieldResolver v0 H1 scope-completion audit 事前登録の補遺

2026-10-03。H1 事前登録（`20261003_2001_…_Preregistration.md`、commit `4ad66c4`）§7 のラベル定義にあった曖昧さを、38 件の PDF を見る前に解消する。**38 件の PDF は未確認。** 原本の事前登録は書き換えず、本補遺で追加固定する。

## 指摘された曖昧さ

1. §7 の「baseline resolution の外側に」という文言が、§9（GT 作成者に baseline name/value を見せない）と読み合わせると、baseline output の参照を要求するように読める。
2. `complete` の「追加文字が確認できない」が、「続きが無いと視覚的に判断できた」と「続きかどうか確認できなかった」（本来は `unclear`）の両方に読める。

## 補遺（§7 の解釈を以下に固定）

- H1 の 3 ラベルは、#367 の Visual GT と同じ視覚的意味で用いる。
  - `complete_on_current_logical_row`: 対象名称が当該行で完結しており、直下に同一名称の続きが無いと**視覚的に判断できる**場合のみ。
  - `incomplete_continues_below`: 直下に同一名称の続きがあると視覚的に判断できる。
  - `unclear`: 続きの有無、または続きの所属（同一 record か、備考欄か、次 record か）を視覚的に判断できない。
- 「baseline resolution の外側」は、GT 作成者が baseline output を参照することを意味しない。GT 作成者は §9 のとおり baseline name/value・guard 出力を見ない。
- 「確認できない」は `complete` の根拠にならない。続きの有無を判断できないときは `unclear` とする。

## 変更しないもの

H1 仮説（§6）、GO / STOP / INCONCLUSIVE（§11）、38 件の worklist（`caefc62`、SHA-256 `fa9a3abe…7028c`）、visual-only 規則（§8）、blind protocol（§9）。
