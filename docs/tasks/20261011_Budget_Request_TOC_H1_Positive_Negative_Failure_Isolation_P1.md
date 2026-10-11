# FY2024 概算要求TOC — H1 Positive / Negative Control Failure Isolation P1

## 目的

PR #418でPDF目視により同一項目の継続と分類されたH1 31件を既知Positiveとして固定し、FY2024 TOC全82物理ページからRaw Text構造が近いNegative / near-miss対照を事前固定した手順で探索する。Raw Textだけで所有関係を区別できるか、不足するsource evidenceは何かを観測する。

本研究はpost-hoc development分析であり、精度・汎化を評価しない。ここで目視した候補・ページを未使用のheld-outデータとして扱わない。GT作成、parser/regex/assemblyの変更、最終TOC CSV生成、本番接続は禁止する。

## Source / fixed conditions

- PR #416: Column Segmentation / Primitive Extraction v1
- PR #417: Minimal Assembly v0
- PR #418: Ownership Failure Isolation P0
- 固定Positive: #418のH1 / SAME_ITEM 31観測。ID・primitive・provenanceを維持する。
- 母集団: structure inventory上のTOC 82物理ページ、55 PDF（DIRECT 55 / INHERITED 27）。
- Source of truth: frozen #416/#417 outputs、#418 classification、manifest照合済みPlain Text、PDF原本。
- Negative探索、pair shape、sample、visual review、feature比較の契約: `tests/fixtures/budget-request-toc-h1-control-analysis/2024/preregistration.md`。

## Discovery / review policy

最初に82ページの全 ordered `title_page → later title_only_candidate` pairを機械的に列挙し、#417のexact H1 pairs、固定near-shape strata、out-of-shape pairsを分類する。候補集合・選択ペア・件数・canonical hashをPDF Ownership review前にcommitする。N1 exact-shape setが固定Positive 31件と一致するならN1不在は定義上の制約であり、安全性の証拠にしない。N2–N5はnear/other controlsでありmatched-shape negativesではない。

選ばれたnear controlsはRaw Textを先に確認し、その後PDFを目視する。Ownershipとevidence sufficiencyを別軸で記録し、観察事実と解釈を区別する。分類不能・意見不一致は保持し、多数決で解消しない。

## Freeze boundary

実装前に固定する対象はPositive inventory、Negative discovery procedure、classification contract、比較方法、provenanceである。これらは自動Assembly規則ではない。候補母集団、sampling、hashのcanonical bytesを変更せず、#416/#417/#418 artifactsを変更しない。

## Expected outputs

Git管理下にPositive inventory、探索契約、全pair censusと選択一覧、Ownership/evidence review、feature比較、Failure isolation報告を保存する。監査可能な補助scriptのみ追加できる。Git管理外の再現用exportは`data/work/exports/`に保存し、入力・出力hashを記録する。

## Review status

前提確認とPositive inventoryを完了し、Discovery contractの独立read-onlyレビューが通過した。Positive inventoryと探索契約をfreezeするcommit後にのみnegative candidate enumerationを開始する。
