# MOF 未一致 59 項の source failure-class inventory — Result

Written for: 本研究チェーンの次フェーズ判断者。

## 結論

**残り 59 項を source evidence で分類した結果、通常の text / geometry で追加回収を検討できる項は 0 件、representation support が必要な項は 37 件、source full name absent は 5 件、unresolved は 16 件（ほかに F7 が 1 件）でした。** F3（source に項として存在するが candidate に入らない）と F4（candidate はあるが名称で exact にならない）はいずれも 0 件。次研究 Route は **C**（representation blocker 支配）。

## 1. baseline 再現

前回 after（既存 candidate 973 + 内閣府 profile 65、continuation 発火 9 件の名称更新を適用）を同じ突合関数で再計算し、MOF 784・exact 725・unmatched 59・文科省 unmatched 5 と所管別件数を再現（identity は `baseline.json`）。「子ども・子育て支援年金特別会計へ繰入」は unmatched に残っていない。

## 2. 59 項の所管別

法務省 35・内閣府 9（内閣本府 4・金融庁 2・沖縄総合事務局 1・消費者庁 1・日本学術会議 1）・文部科学省 5・国土交通省 3・財務省 2・外務省 1・環境省 1・経済産業省 1・防衛省 1・厚生労働省 1。

## 3. failure class / recoverability（`unmatched-59-summary.json`）

| failure class | 項数 | recoverability |
|---|---:|---|
| F1 `REPRESENTATION_BLOCKED` | 37 | `REQUIRES_NEW_REPRESENTATION_SUPPORT` 37 |
| F2 `SOURCE_FULL_NAME_ABSENT` | 5 | `NOT_CURRENTLY_RECOVERABLE_FROM_SOURCE` 5 |
| F7 `OTHER_EVIDENCED` | 1 | `UNRESOLVED` |
| F0 `UNRESOLVED` | 16 | `UNRESOLVED` |
| F3 / F4 / F5 / F6 | 0 | — |

`RECOVERABLE_WITH_CURRENT_TEXT_GEOMETRY` = **0**、`REQUIRES_NEW_REPRESENTATION_SUPPORT` = 37、`NOT_CURRENTLY_RECOVERABLE_FROM_SOURCE` = 5、`UNRESOLVED` = 17。

## 4. 確認の方法（新しい抽出 rule は無い）

全 82 PDF を既存の pdf.js 抽出（rotate ≠ 0 は表示向きに正規化する既存の経路）で token 化し、59 項の MOF 正規化名称を page の token 連結 text から検索した（名称が単一 token の全体一致か・名称セル内の折り返しか・同じ行の左隣が plain 3 桁 code か・現行 candidate / universe row との関係を記録）。PDF の representation は 79 PDF が `TEXT_GEOMETRY_AVAILABLE`、2 PDF が `DRAWING_PATH_TEXT`、1 PDF が `TEXT_PRESENT_UNICODE_UNRESOLVED`。59 項のうち名称ヒットが 1 件以上あるのは 3 項だけで、同じ所管の PDF で item らしい行（左隣に plain 3 桁 code、一般会計）として見つかった項は 0 件（ヒット 2 項は他所管の同名の項。1 項は後述の F7）。

## 5. F1: representation blocker（37 項）

| PDF | representation | 項数（所管レベルのみ） |
|---|---|---:|
| `data/download/moj.go.jp/content/001402818.pdf`（737 page） | `DRAWING_PATH_TEXT`（token 0・font 0・画像なし・path 大量） | 35 |
| `data/download/fsa.go.jp/common/budget/yosan/6youkyuu-2/01.pdf`（77 page） | `DRAWING_PATH_TEXT` | 2 |

**item レベルの assignment は 0 件**（名称が読めないため、項がその PDF の何 page にあるかは示せない）。F1 は「同じ所管の PDF のうち読める PDF に名称ヒットが無く、所管の PDF に text が読めないものがある」という所管レベルの証拠だけに基づく（法務省だから全件、という推定ではなく、読める法務省 PDF `001402819` に名称ヒットが無いことを確認したうえでの記述。assignment は PARTIAL）。金融庁 2 項は MOF 上は内閣府所管。

## 6. F2: `SOURCE_FULL_NAME_ABSENT`（5 項、全件）

文部科学省: 国立研究開発法人防災科学技術研究所施設整備費（052）・独立行政法人国立青少年教育振興機構施設整備費（008）・国立研究開発法人日本原子力研究開発機構施設整備費（046）・独立行政法人教職員支援機構施設整備費（010）・独立行政法人日本スポーツ振興センター施設整備費（108）。前回までの独立確認（`_03.pdf`）と一致し、今回の全 82 PDF 走査でも文科省の PDF に exact ヒットは 0。令和 6 年度金額 0 は判定に使っていない（因果は未確定のまま）。

## 7. F7（1 項）と unresolved（F0、16 項）

- F7: 経済産業省・資源エネルギー庁「エネルギー需給構造高度化対策費」（088）。同名が同じ所管の**特別会計** PDF（`eneju_o.pdf`）に item らしい行として存在するが、一般会計の項と同一とは断定しない。
- F0（16 項。読める同所管 PDF に exact ヒットが無く、「不在」を示す positive evidence も無い）: 環境省 022 脱炭素成長型経済構造移行推進エネルギー対策特別会計へ繰入／内閣府（内閣本府）287 物価高騰対応地方創生推進費・191 原子力災害対策費・285 孤独・孤立対策推進費・288 地方創生地域産業基盤整備事業推進費／内閣府（沖縄総合事務局）103 沖縄災害復旧事業工事諸費／内閣府（消費者庁）164 食品衛生基準政策費／内閣府（日本学術会議）081 日本学術会議／国土交通省 075 独立行政法人海技教育機構施設整備費・257 船舶交通安全基盤災害復旧事業費・377 上下水道一体効率化・基盤強化推進事業費／防衛省 009 令和6年度甲Ⅵ型警備艦建造費／外務省 011 独立行政法人国際交流基金施設整備費／財務省 065 貨幣回収準備資金へ繰入・018 原油価格・物価高騰対策及び賃上げ促進環境整備対応予備費／厚生労働省 198 昭和館施設費。近傍の text（名称の先頭 / 末尾 8 文字を含む token。分類には使っていない記述）が見つかる項もあり（例: 国際交流基金「運営費」、財務省 018 の近い名称「新型コロナウイルス感染症及び原油価格・物価高騰対策予備費」）、名称が別の表現で記載されている可能性があるが、同一性は推測で認定していない。

## 8. 使用した source PDF

走査した全 82 PDF（path・SHA-256・page 数・rotate・representation・assigned する MOF row は `source-pdf-inventory.json`）。59 項の分類に直接関わった blocker は上の 2 PDF のみ。

## 9. 次研究 Route

**Route C**（F3 = 0・F4 = 0、F1 37 > unresolved 16）: drawing-path 型 PDF（法務省 `001402818.pdf` 737 page・金融庁 `6youkyuu-2/01.pdf` 77 page）の文字認識を別研究で扱う。routing は A → B → C → D の優先順で 1 つだけ。F0 の 16 項は、名称の別表現が疑われる項について、PDF 側の項目録（総表）との突き合わせが次の課題になりうる（今回は実装しない）。

## 10. validation / Git

baseline 725 / 784・unmatched 59・inventory の duplicate 0・missing 0・provenance 欠落 0（全行に `evidenceRefs`）、走査・inventory・summary の再実行で byte 一致、tsc・lint・full vitest、production と `data/download/` の変更なし。
