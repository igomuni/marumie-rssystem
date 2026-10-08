# FY2024 概算要求 TOC A 層 row assembly — Evaluation Protocol Amendment

機械可読な正本: `tests/fixtures/budget-request-toc-row-assembly/2024/evaluation-protocol-amendment.json`（status `EVALUATION_PROTOCOL_AMENDMENT_FROZEN`）。

**評価手順のみの post-preregistration amendment。** #391 preregistration・#392 GT・#393 parser・membership は不変、held-out parser 実行 0、formal evaluation 0、個別 GT 値の閲覧なし。judgment = `READY_FOR_TOC_ROW_ASSEMBLY_ONE_SHOT_FROZEN_EVALUATION_AFTER_AMENDMENT`（次 unit で一回限りの evaluation を始めてよい、のみ。SAFETY_PASS・correctness・production GO ではない）。

## なぜ amendment か

#391 は alignment を「row-start token + column + column 内順序」と frozen した。column を identity に含めると wrong-column が「欠落 + 余剰」になり、#391 自身の severe `WRONG_COLUMN_ASSIGNMENT` を独立に判定できない（#394 の STOP）。契機は protocol の論理的不整合で、held-out の結果ではない（発見時点で held-out 実行 0・evaluation 0）。上書きするのは `gtProtocol.alignment` の前半のみ。#391 の原本は残す。

## 変更後の対応

- **identity**: REQUEST = (file, page, request 番号)、MARKER = (file, page, marker, code)。column・順序・page ref は identity に入れず、対応後に比較する属性。
- **duplicate**: occurrence や順序による個別 pairing はしない。同一 key の GT 件数 n と parser 件数 m を group で比較する（m>n → 余剰は FALSE_POSITIVE、m<n → 不足は欠落 / ABSTAINED）。column は対応済み min(n,m) 件の多重集合で比較（不一致数 = WRONG_COLUMN。UNSPLIT は column 非主張）。
- **fallback なし**。token containment は対応を作らず、統合検出（FALSE_POSITIVE）と未対応 GT row の state 説明にだけ使う evidence-only predicate。header zone の unit も例外なく対象。UNSPLIT page の page-level family（#391 の `NO_EVIDENCE_BUT_VISUAL_RIGHT_PRESENT`）は header zone 専用の例外ではない。
- **PLAIN_ROW**: mapping なし。row 存在・column・分類・fragment owner は `NOT_COMPARABLE`。検出の穴（PLAIN_ROW どうしの同一行統合・分割）は明記。parser の unit は raw line 単位で、統合が起き得るのは同一行の左右のみ。token-keyed 側があれば検出できるため重大な穴とは判断せず limitation とした。
- **severe 4 種は不変**（検出方法のみ具体化）。fragment は owner が 1:1 group のときのみ数で対応（text 一致による別 owner 判定は不採用）。provenance は Raw Text との機械照合。
- **`WRONG_ROW_START_CLASSIFICATION`**: kind は token で定義されるため identity 不一致と区別できず、独立計測できない（`NOT_COMPARABLE` と報告）。
- **pass の条件**: severe 0 かつ UNRESOLVED の severe 候補（OTHER_CODE unit の出現・AMBIGUOUS_OWNER_GROUP）が 0 のときのみ `SAFETY_PASS_COVERAGE_REPORTED`。それ以外は `REVIEW_REQUIRED` で、判定不能を pass にしない。
- 閾値は `UNRESOLVED_ACCEPTANCE_THRESHOLD` のまま。

## #394 提案の扱い

REQUEST identity ACCEPT / MARKER identity MODIFY（page ref・occurrence を外す）/ column・order 除外 ACCEPT / occurrence REJECT / normalization ACCEPT / PLAIN_ROW NOT_COMPARABLE ACCEPT / OTHER_CODE ACCEPT（pass をブロック）/ FALSE_POSITIVE 検出 MODIFY（二次判定を evidence-only に分離）/ fragment MODIFY / provenance ACCEPT / descriptive metrics MODIFY / header-zone 救済 OUT_OF_SCOPE。

## 未解決

数値閾値、PLAIN_ROW どうしの統合・分割の検出不能、n≥2 group で個別行を特定できないこと、同一 agent が GT を作成したこと。reviewer 確認: UNSPLIT page の family 適用が header zone の例外に当たらないか。
