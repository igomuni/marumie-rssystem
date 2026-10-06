# Route C 事前登録 — drawing-path 型目次の項名・項 code 復元（37 項）

実装前の事前登録。Route C の実装・実行は本 doc の時点では未実施。freeze 後に本 doc と GT fixture を書き換えない。

## 1. 研究質問

drawing-path 型 PDF（法務省 `001402818.pdf`・金融庁 `6youkyuu-2/01.pdf`）の目次 page から、OCR を使わず PDF 内部の描画 primitive だけで、項 code と項名を誤りなく復元できるか。

対象は MOF 未一致 59 項のうち SUMMARY_REPRESENTATION_BLOCKED の 37 項（法務省 35・金融庁 2）。分類の根拠は `20261006_1050_…_Source_Side_Classification_Freeze.md`。

## 2. 責務分担

- Library（pdf.js 等）: primitive（path・transform・色）の取得のみ。
- RS（本リポジトリ）: 目次の構造（列・インデント・組織/項/事項/要求の区別）と評価。
- 文字の同一性（どの形がどの文字か）を、外部の認識器・学習済みモデル・辞書照合で与えることは OCR とみなし、本 Route では行わない。

## 3. Scope

- 目次 page のみ。法務省 p3–4、金融庁 p2。本文・総表・明細表は対象外。
- split: development = 法務省 35 項、held-out = 金融庁 2 項。
- 根拠（primitive 観測のみ。`tests/fixtures/budget-request-route-c-drawing-path/2024/primitive-observation.json`）: 法務省は rotate 90・producer JUST PDF 5・path は fill のみ（stroke 0）、金融庁は rotate 0・producer DocuWorks PDF Build 7.0.10・path ごとに save/restore と transform を伴う別表現。生成元と座標系が異なるため、法務省で作った手法が別の表現に通用するかを held-out で見られる。
- 復元を試した後に split を変更しない。

## 4. 観測された表現（事実）

| PDF | page | path 数 | distinct shape signature | signature 最大反復 | text/font/marked content/image/annotation/outline |
|---|---:|---:|---:|---:|---|
| moj | 3 | 1364 | 1319 | 32 | すべて 0 |
| moj | 4 | 616 | 588 | 12 | すべて 0 |
| fsa | 2 | 308 | 292 | 8 | すべて 0 |

ActualText・ToUnicode・フォント辞書・埋め込み添付が無い。同一文字が同一 path になっていない（signature がほぼ全て相異）。

## 5. 仮説 H-STOP（結果ではなく予測）

PDF 内部に文字の同一性を与える情報が無く、path の形も文字間で再利用されていないため、外部の認識を使わない限り G0（§8）を通らない。この場合は negative result を保存して STOP する。OCR は別の事前登録とする。

## 6. Endpoints

GT は `tests/fixtures/budget-request-route-c-drawing-path/2024/visual-gt.json`（視覚値は描画された PDF から転記。MOF 側の値で置換していない。正規化は NFKC＋空白除去のみ、実装前に固定）。

### Primary（各 /37）

- P1 項名 exact 復元数（visual 項名と正規化後 exact）
- P2 項 code exact 復元数（visual code と exact。MOF の code とは比較しない。MOF との code 一致は 0/37 で、MOF code は概算要求の code と別体系）
- P3 code と名称の対（同一 row で両方 exact）

### Safety（scope rows 107 行に対して。いずれも 0 でなければならない）

- 偽の項 row（GT に無い項の出力）
- 組織・項・事項・要求の混在
- 重複
- 欠落（GT row に対応する出力が無い）
- 文字の置換・欠落・挿入
- 読み順の破損
- page 割当の誤り

欠落は「出力しない」ことで安全側に倒れるため、欠落数は P1–P3 の分母側で別に報告し、置換・偽 row とは分けて数える。

## 7. No-leakage

入力に使わない: MOF の項名・MOF 一覧、凍結 37 項の list、期待 code、「37 個になるまで続ける」型の停止条件、fuzzy matching、他年度の PDF、人手転記。GT は評価でのみ参照する。

## 8. GO / STOP

- G0（同一性情報の存在）: 外部の認識器・ラベル源なしに、PDF 内部の情報だけで文字の同一性を与える手段が実装できること。無ければ negative result を保存して STOP（OCR 化して続行しない）。
- Gate S（安全）: development で safety endpoints のいずれかが 1 件でも違反なら STOP（置換 1 件でも不可）。
- GO（採択）: development・held-out の両方で P1 = P2 = P3 = 全件かつ safety 違反 0。
- PARTIAL: 安全違反 0 で一部のみ復元の場合は結果の報告のみとし、GO としない。復元率に対する閾値は、観測から導ける根拠が無いため置かない。
- 閾値や手法の変更は新しい事前登録とする。

## 9. 凍結する artifact

- `visual-gt.json`: 37 行の GT（split・出典 PDF・SHA-256・page・視覚値と MOF 値・exact 判定・転記根拠）と、scope rows 107 行（目次見出し 6・組織 10・項 37・要求 54）。
- `primitive-observation.json`: §4 の観測。

## 10. 本 doc 時点で実施していないこと

Route C の実装、文字復元の試行、OCR。
