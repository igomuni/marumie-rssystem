# MOF 特別会計 歳出事項別内訳 — 行の種類の実例（記述）の契約

状態: 実行前に commit する。特別会計の parser に足す行の文法を事前登録する前の、**記述だけ**の段階。解釈（どの列が何か）は、この段階では結論にしない。

- 対象: inventory（`tests/fixtures/mof-xml-structure-inventory/files.csv`）で `title_for_list` が `歳出事項別内訳` のファイル（FY2024 32、FY2025 成立後 34、FY2025 提出時 34）。SHA-256 が inventory と一致しなければ STOP。
- 方法: データ行を行キー（`p{頁}-{行}.{n}`）でまとめ、列の構成（signature）ごとに、行数・ファイル数・先頭3つの実例（セルの内容。空白除去・先頭40文字）を `row-classes.csv` に出す。`scripts/research/describe-mof-special-row-classes.py`（実行前に commit）。
- 判定・閾値はない。出力は版ごとの signature の一覧と実例。次の段階（行の文法の事前登録）の入力にする。
- 次の段階の論点（この段階では決めない）: 各 signature の意味、`3.1` と `3.2` の違い、組織の行（`1.1` 単独・`1.3`＋金額）の扱い、前年度の列がない勘定、説明欄の表（食糧管理勘定）。
