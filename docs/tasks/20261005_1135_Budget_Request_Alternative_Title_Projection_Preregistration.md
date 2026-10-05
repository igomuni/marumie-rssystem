# 概算要求PDF source-only alternative title projection — mechanism inventory・事前登録・population freeze

blank title ordering inventory（branch `research/budget-request-page-header-blank-title-ordering-inventory`、`373e7b4`）の後続。対象は `label_and_code_same_row` という単一の projection failure mechanism だけ（one change only）。production の title extractor・DocumentHierarchy・FieldResolver・recordKind・item detector は変更しない。blank に前後 page の label を補完しない・blank を bridge しない・label の意味を解釈しない・manual contract / layout 境界 / MOF / 組織名辞書を alternative projection に使わない。前回の post-freeze counterfactual（label segment 400 など）は参考値で、採用も一致の要求もしない。

## P0. 現行 projection の mechanism（code evidence、read-only）
- logical row: `resolveLogicalRows` の `logicalRowCandidates`。row ごとに `visualTokenIndexes` の非空白 token の rawText 列（`texts`）・token index・physical row index を保持（`scripts/pipeline-v2/project-budget-request-header-labels.ts`）。x = 先頭 token の `bbox.xMin`、y = row の `bbox.yMin`（ordering inventory で保持）。
- 現行の code row 判定: `classifyRow(texts) !== 'other'`（`lib/budget-request-header-label.ts`。`request`・`plain3`・`plain3_only`・`hyphen` のいずれか）。「最初の code row」= `rows.findIndex(...)`。title 行 = それより前の row。first title line = title 行の先頭 1 行。title 行が 0 → `observed_blank` / `no_title_row`、先頭行が空 → `empty_row`、normalized が空（数字のみ）→ `digits_only`。それ以外は `observed_nonblank`（raw = token の rawText を空白 1 つで連結、normalized = NFKC → 空白・数字（`\d`）除去）。
- ordering inventory の code-shaped 判定（先頭 token が `^\d{3}$`）と label-shaped 判定（row の bbox.yMin < page 高さ × 0.2 かつ normalized が `^([^()]+)\(([^()]+)\)$`）は `lib/budget-request-title-ordering.ts` の `evidenceOf`。`label_and_code_same_row` は、最初の label-shaped row が最初の code-shaped（3 桁先頭）row と同じ row の page。現行の「最初の code row」（classifyRow）は request・hyphen の code row も含むので、両者の「最初の code row」は一致しない場合がある（本研究では現行定義を優先して alternative を定義し、不一致は M2 の unresolved として数える）。
- same-row の label を取り出す既存 primitive: 既存の normalization（NFKC・空白・数字の除去）だけで row 全体から label の normalized が一意に決まる（例: raw `100 内（消）` → normalized `内(消)`）。substring / regex / token rule の追加は不要（STOP 条件 `ALTERNATIVE_RULE_NOT_SPECIFIABLE_FROM_FROZEN_EVIDENCE` に該当しない）。raw label は row の raw（ページ番号を含む。現行 projection の raw も `文（文） 1053` のようにページ番号を含む）をそのまま保持する。

## P1. alternative rule（唯一の変更）
現行 projection が `observed_blank` を返す page で、現行の最初の code row が同時に frozen label-shaped predicate（上端帯・`prefix(inner)` 形）を満たす場合に限り、その row を丸ごと title として projection する（`firstTitleRaw` = その row の raw、`firstTitleNormalized` = 既存の normalization、basis = `label_on_first_code_row`、refs = その row の logicalRowIndex と tokenIndexes）。現行が `observed_nonblank` の page は現行の出力のまま（basis `before_first_code_row`）。それ以外は現行と同一。
禁止: code row より後ろの row の探索、前後 page からの補完、blank bridge、majority vote、manual contract・layout 境界・MOF・組織名辞書の参照、`source_label_absent` / `label_shape_unrecognized` / `cutoff_other` の救済、rotate 対応。複数候補: projection の対象は最初の code row 1 つだけで、page に他の label-shaped row があっても無視する（fail-closed ではなく単一）。ambiguity は下記 M4 で数える。

## P1. frozen evaluation population（`population-manifest.json`、SHA-256 `ffac4a9d…c38d`）
primary scope = current projection で評価可能な 9,145 page（rotate=90 の 754 page は対象外）。membership は Phase A の frozen artifact（`page-ordering-inventory.json` `9eb910a8…ddc3`）から決定的に作り、alternative projection の結果で変更しない。C1 current_nonblank 6,195（regression control）／C2 target_same_row 2,537（唯一の target）／C3 cutoff_other 70／C4 source_label_absent 194／C5 label_shape_unrecognized 149（C3〜C5 は救済対象外）。

## P1. 指標（結果を見る前に固定）
- M1 regression: C1 の各 page で current と alternative の status・raw・normalized・provenance・page identity が完全一致（changed・missing・extra = 0）。
- M2 target recovery: C2 の各 page について、alternative が `label_on_first_code_row` で projection し、かつ raw と normalized がその page 自身の Phase A の frozen label evidence（同一 row の raw・normalized）と一致 → recovered。projection されない → unresolved。projection されたが Phase A の evidence と不一致 → mismatch。前後 page との一致は recovery の定義に使わない。
- M3 non-target preservation: C3・C4・C5 のうち alternative で status が変わった page 数（期待 0）。
- M4 ambiguity: alternative が projection した page で、同じ page に normalized が projection と異なる label-shaped row が他にある page 数（C2 ambiguous）。1 page に複数の label candidate・provenance が一意でない場合も数える。
- M5 determinism: 同一入力で再実行し artifact の hash 一致。
- M6 source fidelity: projection された raw が source の row の token の rawText の連結に一致、normalized が既存 normalization の出力、補完・推測・neighbor copy が 0。

## P1. decision rule
- `ALTERNATIVE_PROJECTION_SUPPORTED`: M1 changed = 0、C2 の 2,537 page がすべて recovered（unresolved・mismatch = 0）、C2 ambiguous = 0、M3 = 0、provenance missing = 0、deterministic rerun が一致。
- `ALTERNATIVE_PROJECTION_PARTIALLY_SUPPORTED`: M1 changed = 0 かつ source fidelity が保たれ、C2 に unresolved / ambiguous / mismatch が残る（失敗を分類し、rule を拡張しない）。
- `ALTERNATIVE_PROJECTION_REJECTED`: M1 を壊す、non-target の status を変える、source にない label を生成する、ambiguity を source evidence だけで解消できない、determinism を満たさない、のいずれか。
- `INCONCLUSIVE`: frozen dependency・evaluation artifact に問題があり評価不能（STOP して報告）。

## P4 / P5（primary decision の後）
P4: alternative projection で label segment を再構成（blank bridge・neighbor fill なし、同じ segmentation rule）し、observed_nonblank・observed_blank・label segment 数（current 2,818）・全 segment 数（5,482）・直接 label→label transition（96）・同 label の非連続な再出現（2,554）・mext（904）・mhlw（911）を current と比較する。前回の counterfactual 値は参考値で、一致を要求しない。
P5: 前回の page-header structural inventory の gate（G1・G3・G4・G5、discovery / non-discovery、layout relation、manual contract relation、境界特異性、mext / mhlw の定義）を、alternative projection に変更せずそのまま再適用する。機械的に適用できない構造上の理由があれば `STRUCTURAL_GATE_NOT_REUSABLE` として理由を記録し、新しい threshold を作らない。manual contract は P5 で初めて diagnostic として参照する（alternative の生成には使わない）。

## 出力 artifact に含めるもの
preregistration の hash・implementation の hash・input hashes・corpus counts・C1〜C5 の counts・M1〜M6・decision・失敗例の deterministic sample（`(class, localPath, page)` の辞書順先頭）・output hash。結果を見て implementation を修正せず、予期しない failure は negative result としてそのまま freeze する。

## 禁止・限界
production の title extractor / DocumentHierarchy / FieldResolver / recordKind / item detector・range-local detector・rule-line detector・MOF・rotate=90・frozen artifact の書き換えは行わない。label の意味・organization との関係・manual contract が正解か・label だけで DocumentHierarchy を生成できるか・sparse・full-corpus hierarchy の precision / recall は主張しない。
