# 概算要求 Cover Structure v0 — Visual GT Freeze

Cover parser 未実装・未評価。preregistration（commit `9b6f5ac`、doc `20261007_2310_…_Preregistration.md`）は GT 作成後も変更していない。TOC 作業・MOF・printed→physical page 変換は未着手。

## Pre-flight

main `3dd69989`、#386 は squash merge（head `44a996b` と main で tests/scripts/docs 差分なし）。Raw Text digest `7c6d2dce…c4052`・Page Classification digest `39464fc7…` 一致（frozen builder 再実行、conformance mismatch 0）。working tree clean。

## Frozen candidates（Commit 1）

COVER 69 − PR-3A explored COVER 14 = **55**。overlap 0・duplicate 0・hash mismatch 0・2 回生成で同一。candidate digest `c1181949…d346`。Commit 1 まで candidate page は render・目視していない。

## Visual protocol

55 page を 90dpi で page 上部のみ render し、`sha256("blind-cover|{filePath}|{physicalPage}")` 昇順の連番で 1 枚ずつ目視。見せたのは render 画像と連番のみ（Raw Text・parser output・PR-3A taxonomy・manifest 由来文字列・MOF/RS は見ていない。OCR 不使用）。title は全 page 共通の見える文字列で、name の字間空白は記録せず見える文字のみを parts に入れた（比較は whitespace 除去、preregistration §4 のとおり）。

開示（protocol deviation 候補）: PR-3A の `development-explored-pages.json` と inventory は、candidate ではない page の情報であり、GT 作成中に candidate の `firstNonEmptyLines` は読んでいない。最初に render した 1 枚目は crop が小さく、同じ page を crop し直して再 render した（同一 page の再表示で、先に別の page を見ていない）。他の逸脱はなし。

## GT counts（実測）

- 55 row 全て visualStatus = RESOLVED（PARTIAL 0・UNRESOLVED 0）。source hash 不一致 0。
- header code: 2 桁 32・4 桁 23。entries: SECTION_REFERENCE は総表・明細表が全 page、定員表（3.）ありが 21。SCOPE_REFERENCE は 1 個の page が 47、2〜5 個の page が計 7、12 個の page が 1（国土交通省）。marker は（会計）23 page・（組織）32 page。
- **multiline name の page は 0**（PR-3A で観測した折返し・語途中分断はこの 55 page には現れなかった。出たのは development 側の page のみ）。
- printed page 参照が数字のみでないもの 4（国立国会図書館 cover の `国` `国(国)` prefix 付き 4 entry）。string のまま保持。
- 括弧は全角・半角が混在して見える header（例: `(エネルギー需給勘定)` の外側が半角に見える等）がある。GT は見えた文字で記録し、字幅の区別は preregistration §4 の列挙（`（`≡`(`・`）`≡`)`）で吸収する。

## schema adequacy

55 page 全てが preregistered schema（header + SECTION_REFERENCE / SCOPE_REFERENCE）で losslessly に表現できた。新しい Cover family・表現不能な field は無し。**SCHEMA_ADEQUATE**。ただし multiline name が 0 件のため、continuation rule（preregistration §5）の評価力はこの GT では**検証できない**（rule の誤りも誤動作も検出されない）。これは limitation として明記する。UNRESOLVED/PARTIAL も 0 件で、abstain の safety も GT では測れない。

## 判定

**READY_FOR_IMPLEMENTATION**（preregistration は GT 前に commit、contamination 0、candidate 全件 freeze、schema adequate、hash 整合）。ただし上記 limitation（multiline・abstain が GT に無い）を前提とし、implementation は開始しない。

parser implementation・parser evaluation・TOC PR-3C・MOF reconciliation: NOT STARTED。
