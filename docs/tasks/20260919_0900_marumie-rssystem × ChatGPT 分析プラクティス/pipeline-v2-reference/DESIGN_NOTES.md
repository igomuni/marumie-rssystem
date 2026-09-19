# Reference run findings (uploaded raw data)

今回のアップロード原本に対して参照実装を実行した時点の主な観測値です。

## FY2024 MOF 項数

`項コード + 項名` をsource-preserving identityとして数えると:

| phase | general | special | agency | total |
|---|---:|---:|---:|---:|
| initial | 784 | 250 | 22 | 1,056 |
| supplement #1 | 799 | 200 | - | 999 |
| settlement | 978 | 272 | 22 | 1,272 |

項名を含めずコード中心で数えると:

| phase | general | special | agency | total |
|---|---:|---:|---:|---:|
| initial | 784 | 248 | 22 | 1,054 |
| supplement #1 | 799 | 198 | - | 997 |
| settlement | 978 | 270 | 22 | 1,270 |

差の2項は東日本大震災復興特別会計の項コード再利用によるものです。

このため、従来の 1,054 / 997 / 1,270 は原本行の欠落ではなく、**コード中心identityで2項が畳み込まれた結果**として再現できます。

## FY2024 決算式

8,358目を検証し、左右両式とも不一致0件でした。

## FY2025 提出→成立

提出版と成立版の両方が存在する一般会計・特別会計だけを比較しています。政府関係機関は提出版原本が今回の入力にないため「追加」と誤判定しないよう比較対象外です。

- 差額がある item group: 17
- 一般会計: 14
- 特別会計: 3
- net: -356,655,880,000円

## RS 2-2

- review 2024: 55,609 rows
- review 2025: 70,915 rows

review 2024 の中には FY2021〜2024、review 2025 の中には FY2021〜2025 が含まれるため、reviewYear と fiscalYear は別軸で保持する必要があります。

## Exact MOF↔RS diagnostic link

- review 2024 → FY2024: linked projects 4,673
- review 2025 → FY2024: linked projects 4,537
- review 2025 → FY2025: linked projects 4,851

これは参照実装の完全一致診断値で、既存V1との一致を強制していません。特に review 2025 → FY2024 はV1側のデータsnapshot/identity規則と差がないか確認対象です。
