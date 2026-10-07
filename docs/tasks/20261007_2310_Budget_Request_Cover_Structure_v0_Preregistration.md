# 概算要求 Cover Structure v0 — Preregistration

Cover parser 未実装・未評価。本 doc と frozen candidate fixture は **candidate page を 1 枚も render / 目視する前**に commit する。以後、仮説・schema・比較規則・許容 operation・coverage の定義・評価基準を GT 後に変更しない（必要なら PROTOCOL_INVALID / STOP）。

## 1. 背景（PR-3A の観測のみ）

PR-3A（development exploration 33 page、うち COVER 14）で観測した Cover の構造: header 行（`<code> <name>`、code は 2 桁と 4 桁、name は letter-spaced と詰まった形が混在、括弧書きは任意）、title 行（`令和６年度歳出概算要求書`）、参照ブロック（`1.` 総表・`2.` 明細表・`（組織）code name` または `（会計）code name`・`3.` 定員表〔任意〕。各行は leader dots と末尾の printed page 参照）、multiline name（折返しは 1 行目の leader/参照を持たず、語の途中で分断される例あり）、cover bundle ごとに printed page が restart。TOC・Summary・Detail は本 PR の対象外。

## 2. 仮説 H-COVER-v0

> FY2024 acquired corpus で Page Classification v0 が COVER と routing した text-observable Cover page について、Raw Text と source provenance だけを入力とする deterministic parser は、Cover page の header と reference/scope entry block を、文字を補完せず source order を保った structured observation として復元できる。

corpus 固有の仮説であり、future FY・unseen publisher への generalization、open-set page classification safety、printed page と physical page の relation は claim しない。曖昧なら abstain（null / PARTIAL / UNRESOLVED）を許す。

## 3. schema contract（freeze）

```ts
type CoverObservation = {
  source: { filePath: string; fileSha256: string; physicalPage: number; textSha256: string };
  status: 'RESOLVED' | 'PARTIAL' | 'UNRESOLVED';
  header: { codeRaw: string | null; textRawParts: string[]; titleRawParts: string[]; status: Status };
  entries: CoverEntry[]; // source order（上から下）
};
type CoverEntry =
  | { kind: 'SECTION_REFERENCE'; ordinalRaw: string | null; labelRawParts: string[]; printedPageRefRaw: string | null; status: Status }
  | { kind: 'SCOPE_REFERENCE'; markerRaw: string | null; codeRaw: string | null; nameRawParts: string[]; printedPageRefRaw: string | null; status: Status };
```

- `header.codeRaw` は header 行の先頭の数字 token、`textRawParts` は同行の残りの visible text（letter-spaced の空白は parts 内にそのまま保持）、`titleRawParts` は title 行。
- `ordinalRaw` は `1.` 等の visible な番号、`markerRaw` は `（組織）` `（会計）` 等 visible な括弧付き marker（括弧を含めた見えたまま）。code の意味・marker の意味は解釈しない。
- `physicalPage`（source）と `printedPageRefRaw` は別 field。`publisherAuthority` は schema に含めず、cover の header・scope name と混ぜない。
- status: RESOLVED = その record の全 field が可視で帰属が一意、PARTIAL = 一部 field が null または帰属が曖昧、UNRESOLVED = 読めない。CoverObservation の status は header と全 entry が RESOLVED なら RESOLVED、読める entry が 1 つも無ければ UNRESOLVED、それ以外 PARTIAL。
- label が視覚的に総表・明細表・定員表であることは保持してよいが、SUMMARY/DETAIL/STAFFING の physical section との relation は作らない。

## 4. 比較規則（freeze）

- 生の raw parts は書き換えず保持する。
- **comparisonCharacterSequence** = parts を source order で連結 → Unicode whitespace（`/\s/u`、全角空白 U+3000 を含む）のみ除去。評価専用で、source raw は書き換えない。
- 追加で許す等価は次の **列挙のみ**（visual GT が字幅を判別できない文字の class）: 数字 `０-９` ≡ `0-9`、括弧 `（` ≡ `(`、`）` ≡ `)`。これ以外（NFKC・句読点置換・hyphen 置換・文字置換・辞書補完・語の推測・欠落文字の挿入）は禁止。
- `printedPageRefRaw`・code・marker・ordinal の比較も同じ規則（whitespace 除去と上記の列挙のみ）。

## 5. parser が使ってよい operation family（freeze。実装は本 PR で行わない）

Cover page 内のみ・Raw Text の行順・先頭末尾 whitespace と連続 whitespace・leader dots pattern・明示的な visible label / marker / ordinal・visible code token・source order の block grouping・以下の continuation rule。

**continuation rule（freeze）**: SCOPE_REFERENCE の次の non-empty line が、marker・ordinal・leader dots・末尾 page 参照のいずれも持たない場合、その行を直前の SCOPE_REFERENCE の nameRawParts の追加 part とする。上記に当てはまらない行（例: leader dots を持たないが何の entry か不明）は、その entry を PARTIAL とし、帰属を決めない。語の途中の分断は連結せず parts として保持する。

禁止: 前後 page・manifest・既知の府省/会計 dictionary・fuzzy matching・MOF・他年度・expected Cover list・GT lookup・publisher 固有の hardcode・source path からの文字生成・page 番号の算術による補完。

## 6. 評価条件（freeze。将来の implementation 評価用）

- **P1 Character Fidelity**: 解決した field の comparisonCharacterSequence が visual GT と一致。
- **P2 Structure Fidelity**: header の有無・entry 数・順序・kind・scope の marker/code・section label の grouping・multiline parts の所属・printedPageRefRaw の所属が GT と一致。page 単位で pass/fail。
- **P3 Provenance Fidelity**: filePath・fileSha256・physicalPage・textSha256 が一致。
- **Safety（0 であること）**: false resolved（GT が null/UNRESOLVED の field を parser が値あり）、invented character（GT に無い文字）、wrong-entry attachment（別 entry の printed page 参照や multiline part の付与）。dictionary による code/name 補完は safety failure。
- **atomic field と denominator（freeze）**: header は `codeRaw`・`textRawParts`・`titleRawParts` の 3、SECTION_REFERENCE は `ordinalRaw`・`labelRawParts`・`printedPageRefRaw` の 3、SCOPE_REFERENCE は `markerRaw`・`codeRaw`・`nameRawParts`・`printedPageRefRaw` の 4。parser の null / 空 parts は abstain。**coverage = (GT が非 null かつ parser が非 null で P1 一致の atomic field 数) / (GT が非 null の atomic field 数)**、**resolved precision = 一致数 / (GT が非 null かつ parser が非 null の atomic field 数)**。GT 後に denominator を変えない。
- **判定**: GO = safety failure 0・resolved precision 100%・P1/P2/P3 の resolved output の mismatch 0・coverage ≥ 95%。GO-WITH-SCOPE = safety failure 0・precision 100%・coverage < 95%・abstention が明示的かつ再現可能。STOP = safety failure の存在・wrong attachment / invented character・preregistration violation・source/hash mismatch。

## 7. frozen candidate

候補 = Page Classification v0 の COVER 全 page − PR-3A development-explored COVER page。`tests/fixtures/budget-request-cover-structure/2024/frozen-candidates.json`、generator `scripts/pipeline-v2/build-budget-request-cover-structure-candidates.ts`。実測: COVER 69・explored COVER 14・**frozen candidate 55**、overlap 0、duplicate 0、hash mismatch 0、2 回生成で同一、candidate digest `c1181949…d346`。fixture は key と hash のみで、label・Raw Text 本文を含まない。

## 8. Visual GT protocol（Commit 1 の後にのみ開始）

source PDF から 55 page を render し、rendered page と file/page key だけを見て GT を作る。候補 page の Raw Text・parser output・PR-3A taxonomy label・manifest 由来の期待文字列・MOF/RS・OCR・Route C・外部辞書・Web・他年度・他 page の同名文字列からの補完は使わない。見えない値は null、判別不能は UNRESOLVED、blank・語途中分断を一般知識で補わない。GT の schema は §3 と一致させる（`visual` 接頭辞付き名）。

開示: PR-3A の `structure-inventory.json` には候補 page の `firstNonEmptyLines` が含まれる。GT 作成中は候補についてこれを読まない。

## 9. 判定

READY_FOR_IMPLEMENTATION = preregistration が GT 観測前に commit 済み・candidate contamination 0・candidate 全件の GT freeze・schema adequate・protocol deviation 0・hash 整合。SCHEMA_INADEQUATE / STOP = §3 の schema で表現できない Cover family が出た（GT を見て schema を直して続行しない）。PROTOCOL_INVALID / STOP = GT 先見・contamination・hash mismatch・preregistration の事後書換え。READY でも implementation は開始しない。

## 10. 禁止事項

Cover parser の実装・評価、TOC、Summary/Detail/Staffing parser、Cover と他 section の relation、printed page→physical page の変換、search index、MOF、RS、OCR、Route C、Web 検索、外部辞書、GT 後の preregistration/schema 修正、historical artifact・PR-3A ledger・`data/download/` の変更。
