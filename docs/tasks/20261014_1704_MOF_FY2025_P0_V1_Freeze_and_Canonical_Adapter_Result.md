# MOF FY2025 P0 — V1 の凍結と canonical jikou adapter の FY2024 同値確認 — 結果

状態: 結果（事前登録どおり実行）。結論: **GO。** FY2024 では、V1 adapter の出力と既存 V2 `budget-jikou.jsonl` が、canonical 15 フィールドの組の多重集合で完全に一致した（1,256 = 1,256、片側だけの組は 0）。adapter を凍結する。FY2025 への適用と X anchor の評価はまだ行っていない。

事前登録: `docs/tasks/20261014_1704_MOF_FY2025_P0_V1_Freeze_and_Canonical_Adapter_Preregistration.md`（commit `a0fbfa9`。比較の実行前に commit した）。

## 凍結値
- adapter: `scripts/research/mof-v1-jikou-adapter.py` SHA-256 `ea08c9c546d325171f1f3a9fb2241821eb37ddf89eb8e6271f9883d0c2f0e00b`
- V1 FY2024: `public/data/mof-jikou-2024.json.gz` `c9d9db1b…ad1070`
- V1 FY2025: `public/data/mof-jikou-2025.json.gz` `634a4166…ba686a5`（hash を固定しただけで、中身は読んでいない）
- V2 FY2024: `budget-jikou.jsonl` `a63f5050…d3ef7e`

## 結果（`python3 -I scripts/research/mof-v1-jikou-adapter.py compare-fy2024`）
- 件数: V1 adapter 1,256 / V2 1,256。どちらも組の重複はない（unique 1,256）。
- multisetEqual: true。onlyV1 = 0、onlyV2 = 0。
- フィールド別の値の多重集合の差: 15 フィールドすべて 0（`ministry`・`organization`・`sectionCode`・`sectionName`・`jikouName`・`col4Raw`・3つの金額・`page`・`sourceUrl` ほか）。
- V2 は V1 を経由せず、同じ XML から parser v0 で作られている。独立な2つの経路が、比較した範囲で一致したことになる。

## 限界
- 比較していないフィールド（`recordId`・`parentSectionId`・`jikouNameLines`・`nameGaiji`・`sourceLocator.rowNo` など。事前登録で除外）は、V1 adapter の出力には無い。FY2025 の matcher がこれらを使う場合は、別途判断が要る。
- FY2024 で同値だったことは、FY2025 の V1 生成が正しいことの保証ではない。同じ generator（`generate-mof-jikou-data.ts`）で作られたことが前提になる。

## 次（未着手。ユーザーの GO が要る）
- `emit 2025` で FY2025 の canonical artifact を作り、hash で凍結する。adapter のファイルは変えない。FY2025 にしか要らない処理が出たら STOP。
- その後に初めて、凍結した FY2024 の明細表 pipeline を FY2025 corpus（#455）に適用し、X anchor validation に進む。
