# MOF FY2025 P0 — V1 の凍結と canonical jikou adapter の FY2024 同値確認 — preregistration

状態: **契約（実行前に固定）。** 結果は別の task doc に書く。X anchor の一致率は見ない。FY2025 への適用は本 P0 の範囲外で、GO になったら次の段階として行う。
前提: 別年度 validation の P0（#453）と FY2025 corpus の凍結（#455）。方針は「V1 を source of truth として凍結し、V2 相当は derived artifact とする。adapter は FY2024 で既存 V2 と同値であることを確かめてから凍結し、FY2025 にはコードを変えずに適用する」（ChatGPT 案、ユーザー経由）。

## 入力（hash で固定）
- V1 FY2024: `public/data/mof-jikou-2024.json.gz`（git 管理）SHA-256 `c9d9db1be311181d35e73a79d1d0e97ec0959ec3acc07ef16646fe3ae4ad1070`
- V1 FY2025: `public/data/mof-jikou-2025.json.gz`（git 管理）SHA-256 `634a4166e84590dd1320691519f6a2bc4b5212d613c5fdbce1cb6a382ba686a5`（本 P0 では hash の固定だけ。中身は読まない）
- V2 FY2024: `data/normalized/mof/fy2024/budget-jikou.jsonl` SHA-256 `a63f50504c821ad7aff9fe1c96c80635dda978ea0870976d15f9bc9735d3ef7e`（過去の事前登録で凍結済みの値と同じ）
- 補足: V2 は V1 から作ったものではない。同じ MOF 予算書 XML から、凍結済み parser v0（`lib/mof-budget-xml-items.ts`）で別に生成された。したがって同値になれば、独立な2つの経路が一致したことになる。

## adapter（事前固定。名前の付け替えと絞り込みだけ）
- 絞り込み: `items[]` のうち `documentId == "{Y}11001"`（一般会計・当初予算）。
- 写像（V1 → canonical）: `ministry`・`organization`・`specialAccount`・`subAccount`・`agency`・`sectionCode`・`sectionName` は同名でそのまま。`jikouName ← name`、`col4Raw ← majorExpenseCode`、`amountYen ← amount`、`previousAmountYen ← previousAmount`、`differenceYen ← difference`、`page ← page`、`sourceUrl ← sourceUrl`、`accountType ← accountType`。
- 値は一切変えない（trim・NFKC・型変換・補完をしない）。写像元のキーが欠けている、または値が null のときは補完せずに STOP する。
- V1 から作れない V2 のフィールドは比較しない（あらかじめ除外）: `recordId`、`parentSectionId`、`sectionNaturalKey`、`jikouNameLines`、`nameQtCount`、`nameGaiji`、`amountsRawThousand`、`sourceAmountColumns`、`sourceLocator` の `row`/`rowNo`/`sourceSha256`。

## 比較（FY2024）
- V2 側は、上の canonical フィールドを V2 から取り出す（`page ← sourceLocator.page`、`sourceUrl ← source.sourceUrl`。ほかは同名）。
- record-level 同値: canonical フィールドの組の**多重集合**が V1 adapter 出力と V2 で完全に一致すること（件数を含む）。join key は使わない。
- 差分があれば、フィールド別の値の多重集合の差（両方向の合計）と、それぞれの側にしかない組の例を最大10件示す（failure isolation の入口にとどめ、ここで原因の判断はしない）。

## 判定（事前固定）
- **GO:** 多重集合が完全一致。adapter のスクリプトを SHA-256 で凍結し、次の段階で FY2025 V1 にコードを変えずに適用する。
- **STOP:** 1件でも差分がある。adapter は直さず、差分を failure isolation してから研究判断に戻る。
- FY2025 適用時に、FY2025 にしか要らない処理（キーの欠落、型の違いなど）が出たら、その時点で STOP して研究判断に戻る。
- X anchor の一致率は、FY2025 の MOF artifact を凍結するまで計算しない。

## 実装
- `python3 -I scripts/research/mof-v1-jikou-adapter.py compare-fy2024 [V2 dir]`（標準出力は JSON）。adapter はこのファイルの関数 `adapt(items, year)` だけとし、FY2025 にはこのファイルを変えずに別のサブコマンド（次の段階で追加するのではなく、本 P0 で `emit` として同時に用意し、本 P0 では実行しない）で適用する。
- 入力の hash が上の値と違えば、比較せずに STOP する。
