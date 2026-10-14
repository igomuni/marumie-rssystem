# 別年度 validation P0 — 年度選定と DL の eligibility inventory

状態: 調査（read-only、実装・取得・評価なし）。結論: **validation 年度は FY2025（令和7年度概算要求）の1年度に固定することを提案する。** 選定は構造条件だけで行い、X anchor の一致率は一切見ていない。FY2025 は MOF の概算要求リンク一覧に FY2024 と同じ構造（府省庁等29のリンク）があり、到達可否の分布も同じ。ただし概算要求書 PDF の manifest が FY2025 には無く（FY2024 のみ。URL は人間確認済みのものだけで推測しない）、取得は manifest 作成から始まる。
対象の規則は #452 の X anchor carry（immediate X 規則も含む）を**無変更で固定**。ユーザー合意で確定する（本 doc は案）。

## 1. 年度選定の条件（結果を見る前に固定）
1. MOF の「各府省の概算要求書…公開ページへのリンク先一覧」ページ（`…/budget/fy{Y}/{Y}gaisangaiyo_link.html`）が存在し、FY2024 と同じ構造であること。
2. MOF 側に、`ministry` / `organization` / `sectionName` / 事項名 / `col4Raw` 相当を持つ事項レベルの当初予算データが、同年度で用意できること。
3. 概算要求書 PDF の取得が、FY2024 と同じ「manifest で固定した人間確認済み URL」の方式でできること。
- 選定規則: 上を満たす FY2024 以外の年度のうち、FY2024 に最も近い年度（近いほど書式・府省庁の構成が近い）。結果（一致率）は見ない。

## 2. 棚卸し（2026-10-14 時点、curl の HTTP ステータスと jq で確認）

| 年度 | リンク一覧ページ | 外部リンク | MOF 事項データ（V1 `mof-jikou-{Y}.json`、一般会計・当初予算） | 概算要求 manifest |
|---|---|---|---|---|
| FY2022 | 404 | — | 有 | 無 |
| FY2023 | 404 | — | 有 | 無 |
| FY2024 | 200 | 29 | 有（1,256行、V2 `budget-jikou.jsonl` の元） | 有（83 target） |
| **FY2025** | **200** | **29** | **有（1,287行、18所管）** | 無 |
| FY2026 | 404 | — | 有 | 無 |

- 404 は URL の名前（`{Y}gaisangaiyo_link.html`）で試した結果で、他の名前の一覧ページがある可能性は網羅的には調べていない。FY2022/2023/2026 は、この形式の一覧が無いことしか言えない。
- FY2025 のリンク一覧の中身は FY2024 とほぼ同じ構造（国会・裁判所・会計検査院・内閣・各府省庁・復興庁・デジタル庁など29リンク）。到達可否も同じ分布（22件200、5件403、2件404 ＝ FY2024 と同数）。403 は FY2024 でも manual-required としていた bot 遮断系と見られる（jftc・法務・外務・経産・防衛）。404 は参議院・内閣官房で FY2024 と同じ。
- MOF 事項データの注意: **V2 の `budget-jikou.jsonl` は FY2024 しか無い。** FY2025 は V1 の `public/data/mof-jikou-2025.json`（MOF 予算書 Web 帳票の XML 由来、`data/download_old/mof_2025/xml` に1,150ファイル）がある。validation では、これを V2 と同じ形に整えるか、V1 を hash で固定して使うか、事前に決める必要がある（別の決定）。

## 3. 提案する流れ（ChatGPT 案どおり。ユーザー合意で確定）
1. **年度の固定:** FY2025。理由は上の規則（構造条件のみ）。
2. **manifest 作成（DL pipeline の入口）:** MOF のリンク一覧の29リンクから、各府省庁の FY2025 概算要求書 PDF の URL を、人間確認で `fy2025-budget-request-manifest.ts` に固定する（URL を推測しない。FY2024 の `verificationStatus` の考え方を踏襲）。取得できなかった・manual-required の source も、除外せず状態として残す。
3. **取得:** 既存の `download-budget-requests.ts` に FY2025 の manifest を渡して実行（`data/download/` に原本、manifest に URL・SHA-256・結果）。FY2024 の原本・凍結物は変更しない。
4. **corpus の凍結:** 取得集合（欠落・no-text-layer を含む）を、評価前に hash で固定。
5. **primitive の無変更適用:** plain text → 明細表 CSV を、FY2024 と同じ pipeline で（コード変更なし）。
6. **MOF 側の固定:** FY2025 の事項データを hash で固定（V1 を使うか V2 化するかは別途）。
7. **最後に初めて** X anchor validation（`sectionName == X_anchor` の exact、immediate X と anchor carry を分離、O・正規化・K3 による救済なし）。

## 4. 注意・限界
- 概算要求書の PDF は、府省庁ごとの掲載ページから探す人手の作業が大きい（FY2024 は 32 source / 82 PDF）。FY2025 でも同規模の見込みで、manual-required が出る。
- FY2025 の書式が FY2024 と同等かは、PDF を取得して text layer を調べるまで分からない（この段階では見ていない）。違いが大きい場合は、それ自体を結果として残し、規則は調整しない。
- 閾値は置かない（記述的 validation）。置くなら、別年度のデータを見る前に決める。

## 5. 次のステップ（ユーザーの合意が要る）
- 年度（FY2025）の固定、規則（#452 の無変更）の固定。
- 合意後: FY2025 manifest 作成の作業計画（Worker に dispatch するか、このセッションで進めるか）。
