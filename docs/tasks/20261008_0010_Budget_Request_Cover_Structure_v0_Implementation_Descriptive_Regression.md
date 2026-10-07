# 概算要求 Cover Structure v0 — Implementation と Development / Descriptive Regression

**This result is not a held-out or formal validation of H-COVER-v0.** PR #387 の visual GT は PROTOCOL_INVALID / STOP（title と SECTION label を freeze script の定数から stamp）であり、FY2024 COVER 69 page は全て既観測（PR-3A 14 + #387 の 55）。本 PR は implementation + development/descriptive regression。

## Pre-flight

main `6dc47961`、#387 は squash merge（head `e2af427` と main の tests/scripts/docs 差分なし）。Raw Text digest `7c6d2dce…c4052`・Page Classification digest `39464fc7…` 一致（frozen builder 再実行、conformance mismatch 0）。COVER 69 = PR-3A explored 14 + #387 candidate 55（partition 一致）。

## source boundary

parser（`scripts/pipeline-v2/lib/budget-request-cover-structure.ts`）は 1 page の Raw Text `nonEmptyLines` と source provenance だけを入力とし、visual GT・PR-3A fixture・manifest・path・辞書・他 page を参照しない（test がコード検査: `visual-gt`・`development-explored`・`structure-inventory`・`frozen-candidates`・manifest 参照が production code に無いこと）。builder も Raw Text manifest・Raw Text pages・Page Classification 出力のみ。GT は regression script（別ファイル）だけが読む。

## parser

preregistration §3 の contract と §5 の operation family（行順・whitespace 除去・leader dots・visible な ordinal/marker/code・source-order grouping・preregistered continuation rule）の literal implementation。header は先頭行（`<code> <text>`）、title は whitespace を除いて `令和…要求書` となる行、SECTION は `N.` + label + leader dots + page 参照、SCOPE は marker + code + name + leader dots + page 参照。continuation rule: SCOPE の直後の行が marker・ordinal・leader dots・末尾 page 参照のいずれも持たなければ nameRawParts の追加 part（語途中の分断は連結しない）。どの field にも分類できない行は `unclassifiedLines` に残し status を PARTIAL にする。**新しい heuristic の追加なし・contract deviation なし**（commit 1 `6d4665b` の後 parser code は無変更）。

## 69 page full-corpus result

69 page 全て RESOLVED（PARTIAL 0・UNRESOLVED 0）、parser error 0、provenance mismatch 0、unclassified line を持つ page 0。2 回生成で output digest 同一（`5a8a8b97…1aef`）。entry 構造: SSC 37、SSCS 22（定員表あり）、残りは複数 scope の page（最大 12 scope）。multiline scope name の page は 2（cao `0.pdf` p10・mhlw `05-1b-01.pdf` p1。いずれも PR-3A の development 14 page）。

## 55 page descriptive comparison（visual GT は参照のみ）

visual GT のうち page ごとに visual 入力した field（header code・header text・scope marker/code/name・printed page ref・entry の kind 順・定員表の有無）を比較。title・SECTION ordinal・SECTION label は定数 stamp のため比較対象外（parser は抽出する）。比較は preregistration §4 の comparisonCharacterSequence（whitespace 除去 + 列挙した全角/半角のみ）。

- 比較 atomic field 581 → 一致 580・不一致 1・abstain 0（descriptive match rate 99.83%。**formal な accuracy / coverage ではない**）。
- entry の kind 順・数: 55/55 一致、wrong-entry attachment 0。invented-character 候補 1（下記の不一致と同一）。
- **不一致 1 件の原因**: mext `…000031817_01.pdf` p1 の scope name。parser（Raw Text 由来）は `文部科学本省所轄機関`、visual GT は `文部科学省所轄機関`。事後に同じ page を再 render して確認したところ、render は `文部科学本省所轄機関` で、**parser が正しく visual GT の転記ミス（「本」の脱落）**。GT は protocol-invalid であり、本 PR でも書き換えていない（fixture 無変更）。invented-character 候補の判定は「parser の文字が GT に無い」だけの機械判定なので、この件は GT 側の誤りによる。
- 事後確認はこの 1 page の局所 render のみで、他 page の GT は再確認していない。

## PR-3A development 14 page

COVER 14 page 全て RESOLVED。multiline scope name は 2 case（cao p10: `科学技術・イノベーション` + `推進事務局`、mhlw p1: `国立障害者リハビリテーシ` + `ョンセンター`）で、preregistered continuation rule の構造どおりに parts 化され、語途中の分断は連結・補完されていない。この 2 case は Raw Text 観測による regression（transcription 付き GT ではない）で、pass/fail の基準は「rule の構造に従った分割」。pass 2・fail 0・abstain 0。

## abstention analysis

PARTIAL / UNRESOLVED は発生しなかった。したがって abstention path は実データでは 1 件も通っていない（synthetic test のみ）。

## limitations / claim boundary

- formal H-COVER-v0 validation: NOT PERFORMED。fresh held-out generalization: NOT EVALUATED。multiline の held-out validation: NOT EVALUATED（multiline case は development の 2 件のみ）。abstention safety validation: NOT EVALUATED。
- title・SECTION label・ordinal は visual 比較をしていない。
- 55 page の GT 比較は parser の確認であって GT の確認ではない（GT に転記ミスが 1 件あった）。
- Cover と他 section の relation・printed page → physical page 変換・TOC・search・MOF は未着手。

## final engineering judgment

**IMPLEMENTATION_CONFORMANT_WITH_LIMITATIONS**: preregistered contract と operation boundary に忠実、決定的、provenance 整合、production code は GT / development fixture を参照せず、新 heuristic なし、wrong-entry attachment 0・実際の invented character 0。limitation は上記（abstention が実データで未走行、multiline 2 case、GT の protocol invalidity）。H-COVER-v0 GO を意味しない。
