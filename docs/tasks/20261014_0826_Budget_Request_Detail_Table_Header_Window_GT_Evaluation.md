# 明細表: 表頭の窓による列配置の評価結果（凍結GT 140行）

状態: 評価完了。結論: **事前登録の判定は GO（RESOLVED 139件すべて正しい、誤配置0）。** 実装はまだ（別PR、ユーザー判断）。
入力 zip: `data/work/budget-request-plain-text.zip`（SHA-256 `268f1020…e533`、評価前に固定。スクリプトが検証し、一致で同じ結果 139/139 を再確認）。
GT: `final/gt.csv`（SHA-256 `66483999…97ea`、凍結 `gt-freeze.json`、pre-freeze review は ChatGPT が GO）。評価: `python3 -I scripts/research/evaluate-detail-table-window-gt.py`。

| 項目 | 件数 |
|---|---|
| GT の状態 | RESOLVED 139 / AMBIGUOUS 1（T013）/ UNREADABLE 0 |
| 窓の配置が GT と3列とも一致 | 139 / 139（precision 100%） |
| 誤配置 | 0 |
| 評価から除外 | 1（T013。GT は AMBIGUOUS。下の post-hoc erratum 参照） |

読み方と限界:
- 窓の配置は、GT 作成の時点で誰も見ていない（GT は画像のみ。A/B 不一致14件の adjudication も窓を見ていない）。評価は GT 凍結後の1回のみ。
- 対象は「窓だけで一意に決まる140行」で、残り345行（窓が重なる）は評価していない。実装するなら、一意に決まる行だけを置く一般規則で、残りは unresolved のまま。
- **post-hoc erratum（T013）:** T013 は評価時の GT では AMBIGUOUS として除外した。評価後のpost-hoc 確認で、annotator が同一文面の別行（`895` の3金額行）を取り違えた可能性が高いことが分かった。target 行（`920`）自体は2金額で、窓の予測と画像上の配置は一致していた。凍結GTと、事前登録の評価結果（139/139、GO）は変更しない。T013 専用の除外は不要（テキスト上、`895`〔3金額〕と `920`〔2金額〕は区別でき、T013だけを除く一般的根拠がない）。
- 次に決めること: 規則を足す実装PR（140行と、その継続行99行が増える見込み）。
