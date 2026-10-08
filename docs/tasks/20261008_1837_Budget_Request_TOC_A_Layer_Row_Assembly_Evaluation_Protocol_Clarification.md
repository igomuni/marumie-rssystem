# FY2024 概算要求 TOC A 層 row assembly — Evaluation Protocol Clarification

機械可読な正本: `tests/fixtures/budget-request-toc-row-assembly/2024/evaluation-protocol-clarification.json`（status `STOP_PROTOCOL_AMENDMENT_REQUIRED`。contract は**凍結していない**）。

## 結論（review 後）

**`STOP_PROTOCOL_AMENDMENT_REQUIRED`。** #391 は alignment を「row-start token + column + column 内順序」と frozen している。下の row 対応案は column と順序を key から外しており、clarification ではなく amendment に当たる。#391 の alignment では `WRONG_COLUMN_ASSIGNMENT` を独立に評価できる対応付けが定義されていなかった、という protocol design failure の発見として保存する。amendment は #391 を改変せず独立した研究単位で設計する。header zone の扱いは #391 のまま（右 column の row を含む行が統合され severe になれば parser hypothesis の正当な失敗＝STOP_SAFETY で、protocol 側で緩和しない）。`PLAIN_ROW → NOT_COMPARABLE` は方向として妥当だが amendment と一体のため未採用。以下は amendment 設計の入力案。

**本 unit は comparison contract の固定のみ。held-out への parser 実行 0、GT との比較なし、評価なし。** parser・GT・preregistration・membership・implementation freeze は変更していない。judgment = `STOP_PROTOCOL_AMENDMENT_REQUIRED`（一回限りの formal evaluation はまだ始めない）。

## schema 確認（値は見ていない）

- GT は visual のみで記録しており、**lineIndex / span / rawSlice を持たない**。よって span・raw slice による物理対応は schema 上できない。
- 共通 primitive は file・page・row-start token（request 番号 / marker + code）・page ref・column（parser が主張するときのみ）。
- token を持たない `PLAIN_ROW` は共通 primitive から一意な identity を作れない（page ref は重複し、parser は UNSPLIT）。

## 決めたこと

- **PLAIN_ROW**: parser kind への mapping は作らない。全 row-level metric で `NOT_COMPARABLE`（`WRONG_ROW_START_CLASSIFICATION` も対象外）。parser 側の TITLE_OR_HEADING / UNKNOWN_ABSTAINED も同様に対応 GT class が無く NOT_COMPARABLE。parser の RESOLVED OTHER_CODE は GT class が無いので UNRESOLVED（severe に数えない）。
- **row 対応**: REQUEST は (file, page, request 番号)、MARKER は (file, page, marker, code, page ref, 出現順)。**column と順序は identity key に入れず、対応後の比較属性**にする（入れると wrong column が欠落＋余剰に化け、severe を判定できなくなるため）。比較用の等価は空白畳み・ハイフン 3 種・括弧 2 種のみ（#391 の文字クラスと同じ）。
- **四状態**（CORRECT / INCORRECT / ABSTAINED / UNRESOLVED）は不変。`NOT_COMPARABLE` は直交する適用可否で、四状態にも分子・分母にも入れず、parser abstention とも GT UNRESOLVED とも別カウント。
- **GT row の outcome 判定順**: page abstain → ABSTAINED／UNSPLIT なのに GT 右 column あり → UNRESOLVED（`NO_EVIDENCE_BUT_VISUAL_RIGHT_PRESENT`）／key 一致 → column 一致で CORRECT・不一致で INCORRECT（WRONG_COLUMN、severe。UNSPLIT は column 非主張）／key 不一致で他 unit の rawSlice に token を含む → 統合として FALSE_POSITIVE（severe）／abstained unit に含む → ABSTAINED／それ以外 → 非 severe の欠落。
- **fragment**: owner 対応後に `fragments[orderInOwner-1]` で対応。GT の fragment 数を超える attach、または別 owner の GT fragment と一意に text 一致する attach は WRONG_FRAGMENT_ATTACHMENT（severe）。text 一致率は descriptive のみ。
- **provenance**: parser の全 unit・fragment を Raw Text と機械照合（GT 不要）。不一致は PROVENANCE_MISMATCH（severe）。
- **descriptive coverage**: page resolution / physical-row / comparable-row classification / fragment attachment の分子・分母を固定。閾値は `UNRESOLVED_ACCEPTANCE_THRESHOLD` のまま。
- **GO/STOP**: #391 のまま（severe ≥ 1 → STOP_SAFETY、hash 不一致・汚染・評価後の rule 変更 → STOP_PROTOCOL）。

## 未解決・要確認

- #391 の frozen alignment と本案の差は amendment（上記 STOP）。
- 統合検出（rawSlice への token 包含）は、preregistered header zone rule により TITLE_OR_HEADING が右 column の row を含む構造的ケースがあれば、評価で severe になり得る。rule の帰結であり緩和しない。
- PLAIN_ROW に関する parser の誤りは本評価で検出されない（limitation）。
- 同一 agent が GT を作成している（記憶としての GT 知識は排除できない）。独立検証ではない。
