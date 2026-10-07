# 概算要求 Cover Structure v0 — Visual GT Freeze

## 最終判定（訂正済み）: PROTOCOL_INVALID / STOP

当初 `READY_FOR_IMPLEMENTATION` と記載したがレビューで訂正した。

**invalid reason**: visual GT 作成時、header の title と SECTION_REFERENCE の label（総表・明細表・定員表）の文字列を page ごとに visual transcription せず、freeze script の定数（`TITLE_PARTS`・`SECTION`）から全 page に stamp した。したがって preregistered の P1 Character Fidelity と atomic-field coverage（title・section label を atomic field として denominator に含めることを Commit 1 で freeze 済み）の GT としては不十分で、frozen GT protocol を満たしたとは扱わない。parser implementation 前に発見されたため parser-conditioned contamination はない。

訂正方針: preregistration（Commit 1 `9b6f5ac`）・candidate fixture・既存 visual GT fixture は**変更しない**（P1 から外す・再 transcription で差し替える、はいずれも preregistration / GT の事後変更に当たるため採らない）。どこまで正しく作れて、どこで protocol を破ったかを研究履歴として残す。

区別:
- crop 不足による同一 page の再 render: **execution note**（render adequacy のため。preregistered source boundary への違反なし。protocol deviation ではない）。
- title / section label の constant stamp: **GT protocol invalidity**。
- multiline name 0 件: limitation（frozen 55 では continuation rule を評価不能。PR-3A の development 14 page の multiline 例は development regression に使えるが formal validation には使わない）。
- PARTIAL / UNRESOLVED 0 件: abstention safety = **NOT_EVALUATED**（将来 55 件で GO 条件を満たしても abstention safety を検証済みとしない）。
- schema adequacy: 観測上は問題なし。ただし `READY_FOR_IMPLEMENTATION` の根拠には使わない。

次に実装する場合は formal frozen evaluation ではなく **Cover Structure v0 implementation + development/descriptive regression** として扱う（既観測の PR-3A 14 page・本 55 page は held-out にならない。formal validation が必要なら未観測 corpus・新年度を別研究単位で）。確認できるのは implementation fidelity・determinism・観測済み FY2024 data 上の character/structure regression・conservative abstention behavior まで。fresh held-out generalization・formal H-COVER-v0 GO・multiline の held-out validation・abstention safety validation は主張しない。

Cover parser 未実装・未評価。preregistration（commit `9b6f5ac`、doc `20261007_2310_…_Preregistration.md`）は GT 作成後も変更していない。TOC 作業・MOF・printed→physical page 変換は未着手。

## Pre-flight

main `3dd69989`、#386 は squash merge（head `44a996b` と main で tests/scripts/docs 差分なし）。Raw Text digest `7c6d2dce…c4052`・Page Classification digest `39464fc7…` 一致（frozen builder 再実行、conformance mismatch 0）。working tree clean。

## Frozen candidates（Commit 1）

COVER 69 − PR-3A explored COVER 14 = **55**。overlap 0・duplicate 0・hash mismatch 0・2 回生成で同一。candidate digest `c1181949…d346`。Commit 1 まで candidate page は render・目視していない。

## Visual protocol

55 page を 90dpi で page 上部のみ render し、`sha256("blind-cover|{filePath}|{physicalPage}")` 昇順の連番で 1 枚ずつ目視。見せたのは render 画像と連番のみ（Raw Text・parser output・PR-3A taxonomy・manifest 由来文字列・MOF/RS は見ていない。OCR 不使用）。title と section label は各 page の render 領域には写っていたが、文字列は page ごとに書き起こしていない（全 page で同一に見えたという印象に基づき、freeze script の定数を stamp した）。name の字間空白は記録せず見える文字のみを parts に入れた（比較は whitespace 除去、preregistration §4 のとおり）。

開示: PR-3A の `development-explored-pages.json` と inventory は、candidate ではない page の情報であり、GT 作成中に candidate の `firstNonEmptyLines` は読んでいない。最初に render した 1 枚目は crop が小さく、同じ page を crop し直して再 render した（同一 page の再表示で、先に別の page を見ていない）。これは execution note であり protocol deviation ではない。title / section label の constant stamp は上記の最終判定のとおり別に protocol invalidity。

## GT counts（実測）

- 55 row 全て visualStatus = RESOLVED（PARTIAL 0・UNRESOLVED 0）。source hash 不一致 0。
- header code: 2 桁 32・4 桁 23。entries: SECTION_REFERENCE は総表・明細表が全 page、定員表（3.）ありが 21。SCOPE_REFERENCE は 1 個の page が 47、2〜5 個の page が計 7、12 個の page が 1（国土交通省）。marker は（会計）23 page・（組織）32 page。
- **multiline name の page は 0**（PR-3A で観測した折返し・語途中分断はこの 55 page には現れなかった。出たのは development 側の page のみ）。
- printed page 参照が数字のみでないもの 4（国立国会図書館 cover の `国` `国(国)` prefix 付き 4 entry）。string のまま保持。
- 括弧は全角・半角が混在して見える header（例: `(エネルギー需給勘定)` の外側が半角に見える等）がある。GT は見えた文字で記録し、字幅の区別は preregistration §4 の列挙（`（`≡`(`・`）`≡`)`）で吸収する。

## schema adequacy

55 page 全てが preregistered schema（header + SECTION_REFERENCE / SCOPE_REFERENCE）で losslessly に表現できた。新しい Cover family・表現不能な field は無し。**SCHEMA_ADEQUATE**。ただし multiline name が 0 件のため、continuation rule（preregistration §5）の評価力はこの GT では**検証できない**（rule の誤りも誤動作も検出されない）。これは limitation として明記する。UNRESOLVED/PARTIAL も 0 件で、abstain の safety も GT では測れない。

## 当初の判定（上記で訂正）

当初は READY_FOR_IMPLEMENTATION としていたが、title / section label を page ごとに transcription していない事実により PROTOCOL_INVALID / STOP に訂正した。

parser implementation・parser evaluation・TOC PR-3C・MOF reconciliation: NOT STARTED。
