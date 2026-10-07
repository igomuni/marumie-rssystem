# 概算要求 TOC Physical Row Reconstruction — A 層 最小 Failure Isolation

observation / failure isolation のみ（A 層: column segmentation・physical row assembly・wrapped fragment ownership・raw page 参照）。**TOC parser・preregistration・frozen GT・B 層（階層 carry）は未着手**。development 観測であり held-out でも formal evaluation でもない。

## Pre-flight

main `b0a1f651`、#389 は squash merge（head `8c74ad9` と main の tests/scripts/docs 差分なし）。Raw Text digest `7c6d2dce…c4052`・Page Classification digest `39464fc7…` 一致（frozen builder 再実行、conformance mismatch 0）。TOC 82 = DIRECT 55 + INHERITED 27（55 PDF）。#389 の inventory / ledger / boundary evidence / result doc が main に存在。

## 手順（commit 順）

commit 1 `604db7b`: candidate inventory + development sample の fixture 化（**新規 render 前**）。commit 2（本 commit）: visual observation ledger・post-hoc 補助分析・taxonomy・result・本 doc。sample membership・rule は commit 1 の後に変更していない。

## Phase A0 — explored の統合

PR-3A explored TOC 19 と #389 explored 12 の和 = 28 page、render 済みは 13（PR-3A 3 + #389 10）。新規 sample の denominator = 82 − 28 = 54。

## sample（DEVELOPMENT_EXPLORATION）

seed `budget-request-toc-physical-row-failure-isolation-dev-20261008`、stratum ごとに hash 順の先頭 1（publisher 重複を避ける）、全 stratum を満たす最小集合に pruning。**新規 6 page + RECHECK 4 page = 10 page を render**（全て Raw Text も確認。raw のみの page は 0）。10 page の publisher: clb・env・jinji・maff・mext・mhlw・mlit・mof・reconstruction。

- 新規 6: env p3（H-A2 右 column に折返し）・jinji p3（H-A1 右 row evidence なしだが body 28 行＝false-empty risk）・mhlw p7（右 row あり・開始 column 複数・header token あり）・mlit p6（H-A2 右のみ raw 行 ≥3）・mlit p7（右が左より長い非対称）・reconstruction p3（H-A2 左に複数折返し）。
- RECHECK 4（#389 で circled request number が確認された既知 4 case を母集団として ledger の tag から再現）: clb p3・maff p5・mext p5・mof p2。理由: H-A3 の row 開始との関係を確認するため。新規 denominator には含めない。
- machine で候補が 0 だった stratum（pool 0）: header の 2 つ目の `要求` 欠落 + 右 row あり（#389 で見た 1 page 以外に未探索 page なし）・boundary 近傍で token が切れる行・左右同時折返し行・右 column の折返しに先行 owner がない行。→ これらは「machine candidate 不在」であり、corpus に存在しない証明ではない。

## H-A1 — column boundary / right-empty

- 10 page 中: **PAGE_LOCAL_BOUNDARY_MULTIPLE_CANDIDATES 8**（右 column を使う page。右 row の開始 index が request-number row と `（marker）` row の 2 値）、**NOT_APPLICABLE_RIGHT_EMPTY 2**（clb p3・jinji p3、視覚確認済み）、UNIQUE 0・NO_SAFE_BOUNDARY_EVIDENCE 0・AMBIGUOUS 0。
- **post-hoc 補助分析**（`boundary-band-evidence.json`、観測量のみ）: 右 row を持つ 38 page で、右 row の開始 character index は row 種別ごとに page 内の spread が 0（61）・1（11）・2（1）。**display width（全角 2 cell）換算では spread が 0〜30 と大きく散る**ため、Raw Text の列は character index grid 上で ±2 に収まる。request row と marker row の間は 6〜10（7 が 23 page）。左 page 参照と右 row 開始の間の空白は最小 1（10 page）で、**空白幅だけでは境界を取れず、row-start token（request-number / marker）の検出が必要**。
- 右 column の left edge は「ref 風の数字 + 空白 + row-start token」の行の右側開始 index の page 内最小（request-number 種別）で、visual の右 column 開始と一致した（render 10 page）。ただし request row が右 column に 1 つも無く marker row だけの page では offset（約 7）を使う根拠が無く、固定値にはできない（abstain 条件）。
- right-empty: 右 row evidence 無し（machine）＋ 視覚で右 column 空、が 2/2。false-empty は 0 件観測。ただし残りの未視認 page（右 row evidence なしの 44 page 中 視覚確認は PR-3A / #389 / 本 PR で重複を除いて計 6 page（maff 230901-6 p4・clb p3・mlit 復興 p3・ndl p2・soumu 000901375 p3・jinji p3））での false-empty は未確認の residual risk。
- **boundary 決定に階層 semantics は不要**だった。

## H-A2 — wrapped fragment ownership

- render 10 page 上の machine fragment candidate 行は左 11・右 7（7 page に出現）。全 page で fragment は **自分の column の、直前の同 column row の直下**に x 位置で一意に帰属した（UNIQUE_PREVIOUS_ROW 7 page、MULTIPLE 0、NO_SAFE_OWNER 0）。fragment が `（marker）` row の名称の折返しである場合も同様。fragment 行ごとの個別判定ではなく page 単位の目視（行単位の adjudication はしていない）。
- **同一 raw 行に左右の折返しが同時に載る case: machine candidate は全 82 page で 0、sample でも 0 → `NOT_OBSERVED_IN_TARGETED_SAMPLE`**（corpus に存在しないとは結論しない）。左の折返しと右の row 開始が同一 raw 行に載る case は env p3 等で観測したが、これは同時折返しではなく、右の row 開始で境界が分かるため左右の分離は可能。
- raw 順: **各 column 内では raw の行順が visual 順と単調に一致**（RAW_SOURCE_ORDER_CONFLICT 0）。column 間は y で interleave され row 単位では対応しない（mlit p6・p7 では右 row が左が空の raw 行に載る）。reading order は column 分割後に各 column の raw 順で得られる。

## H-A3 — circled request number

- 既知 4 case を含む **10 page 中 9 page で丸囲みの request number を視認**（mlit p6 のみ無し）。`①`・`⑨①` 等の丸囲みで、raw では plain digit（digit 自体は残る）。**丸囲みは稀ではなく、同一 page の plain digit の request number と同じ row 構造（左端 column・同じ x 揃え・直後に `NN-NN` code と page 参照）を持つ**。
- request-number token の列は raw で連番に欠落なし（10 page で gap 0）。→ **BOUNDARY_STILL_OBSERVABLE 9/9**、BLOCKED 0・AMBIGUOUS 0。row の開始は digit + code の pattern で観測でき、丸囲み style の喪失は **row assembly を阻害せず character/style fidelity の limitation**。丸囲みの意味・復元・推測はしない（`ROW_ASSEMBLY_NON_BLOCKING_FIDELITY_LOSS`）。

## NEW_RISK_FAMILY（1 件、bounded）

jinji `900024096.pdf` p3 に、`（項）`/request-number の下に indent された **3 桁 code + name + page 参照の行**（`001 既定定員に伴う経費 3`）があり、marker も request number も持たない。machine regex で全 82 page 中 1 page のみ。末尾 page 参照を持つため wrap fragment とは区別できるが、row-start 種別（request-number / marker / title）だけでは認識できない。→ operation family では「row 種別を `OTHER_CODE` として raw のまま保持」または abstain とする。

## candidate operation family（A 層。parser spec ではない）

1. page-local column evidence: 「ref 風の末尾数字 + 空白 + row-start token（request-number / marker）」の行から、row 種別ごとの右 row 開始 index を集める。
2. region segmentation: 右 column left edge = request-number 種別の開始 index の最小（jitter ≤2 の band）。右 row evidence が無ければ「右 column 使用の evidence なし」（right-empty ではなく no-evidence として abstain 可能な状態）。
3. fragment の column assignment: 各行を band で左右に分割し、境界をまたぐ token があれば abstain。
4. row-start 検出: request-number・marker・title・（OTHER_CODE として raw 保持）。
5. wrap attachment: row-start も末尾 page 参照も持たない segment を、同 column の直前 row に付ける。直前 row が一意に無い・同一 raw 行に左右の fragment が載る場合は attach せず abstain。
6. raw page 参照: 末尾の ref token（prefix `エ` 等を含む）を raw のまま保持。
7. provenance: file/hash/page/raw 行番号/source order。丸囲み・PUA は復元しない。
8. 階層 parent は付けない。publisher 非依存・固定 column index 非依存・辞書非依存・MOF/RS 非依存。

## abstention 条件

境界をまたぐ token・request-number 種別の右 row が無く marker row のみ・右 row evidence なしの page の right-empty 断定・wrap fragment の owner が一意でない・同一 raw 行の左右 fragment・未知の row-start 種別（OTHER_CODE 以外の形）・required evidence が階層 semantics に依存する場合。

## failure taxonomy

COLUMN_BOUNDARY_MULTIPLE_CANDIDATES 8、COLUMN_BOUNDARY_NO_SAFE_EVIDENCE 0、RIGHT_EMPTY_AMBIGUOUS 0、CROSS_COLUMN_FRAGMENT_AMBIGUOUS 0、WRAPPED_FRAGMENT_OWNER_AMBIGUOUS 0、RAW_SOURCE_ORDER_CONFLICT 0、CIRCLED_REQUEST_NUMBER_REPRESENTATION_LOSS 9、ROW_BOUNDARY_REPRESENTATION_BLOCKED 0、NEW_RISK_FAMILY 1。#389 taxonomy との対応は `failure-taxonomy.json`（#389 artifact は不変）。

## 判定

**READY_FOR_TOC_ROW_ASSEMBLY_PREREG**（TOC の A 層 row assembly の formal preregistration を次に設計してよい、という意味のみ。parser GO ではない）。H-A1〜H-A3 は development 観測の範囲で bounded、固定 column・publisher 固有値・階層 semantics なしで operation family と abstention 条件を書ける。

## unresolved（preregistration の入力・abstention 条件として扱う）

- 同一 raw 行の左右同時折返し（corpus に存在しないとは言えない）。
- 右 row evidence 無しの page での false-empty（視覚確認 6 page のみ）。
- request row が右 column に無い（marker row のみの）page での boundary。
- 未探索 stratum の pool 0 / 小規模（header の `要求` 欠落 + 右 row あり は #389 の 1 page のみ）。
- OTHER_CODE row（sub rows）が他 FY・他 publisher で増える可能性。
- PUA（本 PR の対象外、#389 のまま）。B 層（階層 carry）は一切未着手。

## claim boundary

TOC parser 完成・82/82 parse 可・82/82 two-column・same-line interleave 82/82・固定 column 境界の存在・階層復元・INHERITED 27/27 が前 page state を要する・wrapped ownership の corpus 全体での解決・丸囲み番号の復元・PUA の復元・future FY・held-out validation・production readiness・MOF 対応は主張しない。machine（82 page）と visual（render 10 page + 既往 13）を区別した。
