"""
完全一致・格分類 統合カバレッジ調査スクリプト

Step 1: public/data/dictionaries/ の全辞書（完全一致 + 正規表現）
Step 2: 格パターン（法人格分類）

実行:
  python3 scripts/analyze-label-coverage.py
"""

import csv
import os
import re
import sys
from collections import defaultdict

# ─────────────────────────────────────────────────────────────
# パス設定
# ─────────────────────────────────────────────────────────────
REPO_ROOT      = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_CSV      = os.path.join(REPO_ROOT, 'data', 'result', 'recipients_without_total.csv')
DICT_DIR       = os.path.join(REPO_ROOT, 'public', 'data', 'dictionaries')
OUTPUT_CSV     = os.path.join(REPO_ROOT, 'data', 'result', 'uncovered_recipients.csv')
OUTPUT_REPORT  = os.path.join(REPO_ROOT, 'data', 'result', 'label_coverage_report.txt')


class _Tee:
    """stdout と同時にファイルへ書き出すラッパー"""
    def __init__(self, *streams):
        self._streams = streams

    def write(self, data: str) -> None:
        for s in self._streams:
            s.write(data)

    def flush(self) -> None:
        for s in self._streams:
            s.flush()

# ─────────────────────────────────────────────────────────────
# 府省庁スキーマ: name 列を持たない辞書の抽出対象列
# ─────────────────────────────────────────────────────────────
MINISTRY_SCHEMA_COLS = {
    'ministry_names.csv':       ['ministry', 'bureau', 'division', 'section', 'office', 'team', 'unit'],
    'ministry_from_ichiran.csv': ['ministry', 'bureau', 'bureau_alias', 'section'],
    'ministry_supplement.csv':  ['ministry', 'bureau', 'bureau_alias', 'section'],
}

# ─────────────────────────────────────────────────────────────
# Step 2: 格パターン定義（L1大分類, L2中分類, 正規表現）
# 出典: docs/tasks/20260223_0807_格による支出先法人格分類設計.md §3
# ─────────────────────────────────────────────────────────────
KAKU_PATTERNS = [
    ('民間企業',      '株式会社',          r'株式会社|[（(]株[）)]'),
    ('民間企業',      '有限会社',          r'有限会社|[（(]有[）)]'),
    ('民間企業',      '合同会社',          r'合同会社|[（(]合[）)]'),
    ('民間企業',      '合資会社',          r'合資会社'),
    ('民間企業',      '合名会社',          r'合名会社'),
    ('独立行政法人等', '国立研究開発法人',  r'国立研究開発法人'),
    ('独立行政法人等', '独立行政法人',      r'独立行政法人'),
    ('大学法人',      '国立大学法人',      r'国立大学法人'),
    ('大学法人',      '公立大学法人',      r'公立大学法人'),
    ('大学法人',      '学校法人（大学）',  r'学校法人.*大学|大学.*学校法人'),
    ('公益法人・NPO', '公益社団法人',      r'公益社団法人|[（(]公社[）)]'),
    ('公益法人・NPO', '公益財団法人',      r'公益財団法人|[（(]公財[）)]'),
    ('公益法人・NPO', '一般社団法人',      r'一般社団法人|[（(]一社[）)]'),
    ('公益法人・NPO', '一般財団法人',      r'一般財団法人|[（(]一財[）)]'),
    ('公益法人・NPO', '特定非営利活動法人', r'特定非営利活動法人|NPO法人'),
    ('協同組合等',    '農業協同組合',      r'農業協同組合'),
    ('協同組合等',    '漁業協同組合',      r'漁業協同組合'),
    ('協同組合等',    '森林組合',          r'森林組合'),
    ('協同組合等',    '消費生活協同組合',  r'消費生活協同組合'),
    ('協同組合等',    '共済組合',          r'共済組合'),
    ('協同組合等',    '商工会議所',        r'商工会議所'),
    ('協同組合等',    '商工会',            r'商工会'),
    ('協同組合等',    '連合会',            r'連合会'),
    ('協同組合等',    '年金基金',          r'年金基金'),
    ('学校法人',      '学校法人',          r'学校法人'),
    ('医療・福祉法人', '社会医療法人',     r'社会医療法人'),
    ('医療・福祉法人', '医療法人',         r'医療法人'),
    ('医療・福祉法人', '社会福祉法人',     r'社会福祉法人'),
    ('医療・福祉法人', '赤十字',           r'赤十字'),
    ('その他法人',    '宗教法人',          r'宗教法人'),
    ('その他法人',    '管理組合法人',      r'管理組合法人'),
    # ── 専門職法人（士業法人）────────────────────────────────────
    ('専門職法人',    '監査法人',          r'監査法人'),
    ('専門職法人',    '弁護士法人',        r'弁護士法人'),
    ('専門職法人',    '税理士法人',        r'税理士法人'),
    ('専門職法人',    '司法書士法人',      r'司法書士法人'),
    ('専門職法人',    '社会保険労務士法人', r'社会保険労務士法人'),
    ('専門職法人',    '弁理士法人',        r'弁理士法人'),
    ('専門職法人',    '行政書士法人',      r'行政書士法人'),
    ('専門職法人',    '土地家屋調査士法人', r'土地家屋調査士法人'),
    # ── 特殊法人・特別の法人（設置法から名称に法人格が出ないもの）────
    ('大学法人',      '大学共同利用機関法人', r'大学共同利用機関法人'),
    ('その他法人',    '更生保護法人',      r'更生保護法人'),
    ('その他法人',    '技術研究組合',      r'技術研究組合'),
    # ── 地方公共法人（公社・公団等）──────────────────────────────
    ('地方公共法人',  '土地開発公社',      r'土地開発公社'),
    ('地方公共法人',  '住宅供給公社',      r'住宅供給公社'),
    ('地方公共法人',  '高速道路公社',      r'高速道路公社'),
    ('地方公共法人',  '道路公社',          r'道路公社'),
    ('地方公共法人',  '港務局',            r'港務局'),
    # ── 地方公共団体（特別地方公共団体等）────────────────────────
    # 市区町村: ○○県○○市 形式（先頭から都道府県+市区町村で完結する名称）
    ('地方公共団体',  '市区町村',          r'^[^\s]{2,5}(?:都|道|府|県)[^\s]{2,10}(?:市|区|町|村)$'),
    ('地方公共団体',  '広域連合',          r'広域連合'),
    ('地方公共団体',  '企業団',            r'企業団(?!体)'),
    ('地方公共団体',  '一部事務組合',      r'事務組合'),
    # ── 保険組合・再開発組合・事業協同組合 ────────────────────────
    ('協同組合等',    '保険組合',          r'健康保険組合|保険組合'),
    ('協同組合等',    '再開発組合',        r'再開発組合|土地区画整理組合'),
    ('協同組合等',    '事業協同組合',      r'事業協同組合'),
    # ── コンソーシアム・共同体 ────────────────────────────────
    ('コンソーシアム・共同体', '共同企業体', r'共同企業体|協働企業体'),
    ('コンソーシアム・共同体', 'JV',        r'JV$'),
    ('コンソーシアム・共同体', '共同提案体', r'共同提案体'),
    ('コンソーシアム・共同体', '共同研究体', r'共同研究体'),
    ('コンソーシアム・共同体', '共同事業体', r'共同事業体'),
    ('コンソーシアム・共同体', '共同体',     r'共同体'),
    ('コンソーシアム・共同体', '受託企業体', r'受託企業体'),
    ('コンソーシアム・共同体', 'コンソーシアム', r'コンソーシアム'),
    # ── 協議会 ──────────────────────────────────────────────
    ('協議会',        '協議会',            r'協議会'),
    # ── 実行委員会等 ─────────────────────────────────────────
    ('実行委員会等',  '実行委員会',        r'実行委員会'),
    ('実行委員会等',  '運営委員会',        r'運営委員会'),
    ('実行委員会等',  '組織委員会',        r'組織委員会'),
    # ── その他（集合・プレースホルダー） ──────────────────────
    ('その他（集合）', 'プレースホルダー', r'^その他$|^その他の支出先$|^その他支出先$|^その他の支出$|^その他契約$'),
    # ── 民間企業（集合） ──────────────────────────────────────
    ('民間企業',      '民間企業（集合）',  r'その他民間|^その他事業者$|その他[（(]?[0-9]+社[）)]?|その他[0-9]+社'),
    # ── 医療機関（集合） ──────────────────────────────────────
    ('医療・福祉法人', '医療機関（集合）', r'^その他.*(?:医療機関|補装具業者|補装具の制作業者)'),
    # ── 漁業者（集合） ────────────────────────────────────────
    ('協同組合等',    '漁業者',            r'^その他.*漁業者'),
]

KAKU_COMPILED = [(l1, l2, re.compile(pat)) for l1, l2, pat in KAKU_PATTERNS]
SEPARATORS    = re.compile(r'[・、]')


# ─────────────────────────────────────────────────────────────
# ヘルパー
# ─────────────────────────────────────────────────────────────
def to_cho(yen: int) -> str:
    return f'{yen / 1e12:.2f}兆円'


def pct(num: int, denom: int) -> str:
    return f'{num / denom * 100:.1f}%' if denom else '0.0%'


def is_skip_target(name: str) -> bool:
    """
    共同企業体等の合算名称を検出してスキップ対象とする。
    条件: 区切り文字(・ or 、)を含み、かつ区切られた複数セグメントの
         うち 2 セグメント以上に格ワードがマッチする。
    """
    if not SEPARATORS.search(name):
        return False
    segments = SEPARATORS.split(name)
    kaku_segments = sum(
        1 for seg in segments
        if any(pat.search(seg) for _, _, pat in KAKU_COMPILED)
    )
    return kaku_segments >= 2


# ─────────────────────────────────────────────────────────────
# 辞書の読み込み
# ─────────────────────────────────────────────────────────────
def load_dictionaries(dict_dir: str):
    """
    戻り値:
      dict_exact : {filename: set[str]}         完全一致セット
      dict_regex : {filename: list[re.Pattern]}  正規表現リスト
    """
    dict_exact: dict[str, set] = {}
    dict_regex: dict[str, list] = {}

    for fname in sorted(os.listdir(dict_dir)):
        if not fname.endswith('.csv'):
            continue

        fpath = os.path.join(dict_dir, fname)
        exact_set: set[str] = set()
        regex_list: list = []

        with open(fpath, encoding='utf-8') as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames or []

            if 'name' in fieldnames:
                # 標準スキーマ
                has_match_type = 'match_type' in fieldnames
                for row in reader:
                    name = row.get('name', '').strip()
                    if not name:
                        continue
                    if has_match_type and row.get('match_type', '').strip() == 'regex':
                        try:
                            regex_list.append(re.compile(name))
                        except re.error as e:
                            print(f'  [WARN] regex compile error in {fname}: {name!r} ({e})',
                                  file=sys.stderr)
                    else:
                        exact_set.add(name)

            elif fname in MINISTRY_SCHEMA_COLS:
                # 府省庁スキーマ
                for row in reader:
                    for col in MINISTRY_SCHEMA_COLS[fname]:
                        val = row.get(col, '').strip()
                        if val:
                            exact_set.add(val)

        dict_exact[fname] = exact_set
        dict_regex[fname] = regex_list

    return dict_exact, dict_regex


# ─────────────────────────────────────────────────────────────
# 入力 CSV の読み込み
# ─────────────────────────────────────────────────────────────
def load_recipients(input_csv: str):
    """
    戻り値:
      name_amount : {支出先名: 金額合計（円）}
      name_meta   : {支出先名: {'count': int, 'type_codes': set[str], 'first_cn': str}}
    """
    name_amount: dict[str, int]  = defaultdict(int)
    name_meta:   dict[str, dict] = defaultdict(
        lambda: {'count': 0, 'type_codes': set(), 'first_cn': ''}
    )
    with open(input_csv, encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get('支出先名', '').strip()
            if not name:
                continue
            try:
                amount = int(row.get('金額', '0').replace(',', ''))
            except ValueError:
                amount = 0
            name_amount[name] += amount
            meta = name_meta[name]
            meta['count'] += 1
            tc = row.get('法人種別', '').strip()
            if tc:
                meta['type_codes'].add(tc)
            cn = row.get('法人番号', '').strip()
            if cn and not meta['first_cn']:
                meta['first_cn'] = cn
    return dict(name_amount), dict(name_meta)


# ─────────────────────────────────────────────────────────────
# 推定区分ヒント（未カバー分析用）
# ─────────────────────────────────────────────────────────────
_AGG_PAT = re.compile(
    r'^その他|民間事業者|事業主|受給者|農業者|被保険者|利水者|漁業者|林業者|'
    r'入居者|入所者|補助対象者|助成対象|支給対象|酪農事業者|上位\d+者|'
    r'^業務経費$|^示達$|^地方公共団体$|^民間企業$|^民間事業者等$|^支援対象者$|'
    r'ほか\d+件|以降\d+者|補助事業$'
)
_TYPE_HINT = {
    '101': '国の機関（101）',
    '201': '地方公共団体（201）',
    '301': '民間企業（301）', '302': '民間企業（302）',
    '303': '民間企業（303）', '304': '民間企業（304）', '305': '民間企業（305）',
    '399': '設立登記法人（399）',
    '401': '外国会社等（401）',
    '499': 'その他法人（499）',
}

def infer_hint(name: str, type_codes: set, first_cn: str) -> str:
    if _AGG_PAT.search(name):
        return '集合・汎用名称'
    for tc, hint in _TYPE_HINT.items():
        if tc in type_codes:
            return hint
    if not first_cn:
        return '法人番号なし'
    return '（法人番号あり・種別不明）'


# ─────────────────────────────────────────────────────────────
# メイン
# ─────────────────────────────────────────────────────────────
def main():
    # ── 存在確認 ──────────────────────────────────────────────
    if not os.path.exists(INPUT_CSV):
        print(f'エラー: 入力ファイルが見つかりません: {INPUT_CSV}', file=sys.stderr)
        print('  npm run normalize && npm run generate-structured を先に実行してください',
              file=sys.stderr)
        sys.exit(1)

    # ── レポートファイルへの同時出力 ───────────────────────────
    _orig_stdout = sys.stdout
    _report_file = open(OUTPUT_REPORT, 'w', encoding='utf-8')
    sys.stdout   = _Tee(_orig_stdout, _report_file)

    # ── データ読み込み ─────────────────────────────────────────
    print('読み込み中...', end=' ', flush=True)
    name_amount, name_meta = load_recipients(INPUT_CSV)
    dict_exact, dict_regex = load_dictionaries(DICT_DIR)
    print('完了')

    all_names    = list(name_amount.keys())
    total_count  = len(all_names)
    total_amount = sum(name_amount.values())

    # ══════════════════════════════════════════════════════════
    # Step 1: 完全一致辞書マッチング
    # ══════════════════════════════════════════════════════════
    dict_hit_names: dict[str, set] = {}  # fname -> set of matched names

    for fname in dict_exact:
        exact_set  = dict_exact[fname]
        regex_list = dict_regex.get(fname, [])
        hits: set[str] = set()
        for name in all_names:
            if name in exact_set:
                hits.add(name)
            elif regex_list and any(p.fullmatch(name) for p in regex_list):
                hits.add(name)
        dict_hit_names[fname] = hits

    # aggregate_names の exact/regex 内訳（表示用）
    agg_fname     = 'aggregate_names.csv'
    agg_exact_hits: set[str] = set()
    agg_regex_hits: set[str] = set()
    if agg_fname in dict_exact:
        for name in all_names:
            if name in dict_exact[agg_fname]:
                agg_exact_hits.add(name)
            elif dict_regex.get(agg_fname) and any(
                    p.fullmatch(name) for p in dict_regex[agg_fname]):
                agg_regex_hits.add(name)

    # 全辞書の和集合
    s1_hit_names: set[str] = set()
    for hits in dict_hit_names.values():
        s1_hit_names |= hits
    s1_count  = len(s1_hit_names)
    s1_amount = sum(name_amount[n] for n in s1_hit_names)

    # ══════════════════════════════════════════════════════════
    # Step 2: 格パターンマッチング
    # ══════════════════════════════════════════════════════════
    skipped_names = {n for n in all_names if is_skip_target(n)}
    target_names  = [n for n in all_names if n not in skipped_names]

    l1_hits:   dict[str, set] = defaultdict(set)
    l2_hits:   dict[str, set] = defaultdict(set)
    label_cnt: dict[str, int] = {}   # name -> L2 ラベル数

    for name in target_names:
        matched = [(l1, l2) for l1, l2, pat in KAKU_COMPILED if pat.search(name)]
        for l1, l2 in matched:
            l1_hits[l1].add(name)
            l2_hits[l2].add(name)
        label_cnt[name] = len(matched)

    s2_hit_names: set[str] = set()
    for hits in l2_hits.values():
        s2_hit_names |= hits
    s2_count  = len(s2_hit_names)
    s2_amount = sum(name_amount[n] for n in s2_hit_names)

    # ── コンソーシアム・共同体バイパス: is_skip_target 対象でも適用 ──
    # 「A社・B社共同企業体」形式は複合名称としてスキップされるが、
    # 実態は単一の支出先（コンソーシアム）のため、共同.*体を含む場合は明示的に適用する。
    _CONSORTIUM_SUBS = [
        ('共同企業体',   re.compile(r'共同企業体|協働企業体')),
        ('共同提案体',   re.compile(r'共同提案体')),
        ('共同研究体',   re.compile(r'共同研究体')),
        ('共同事業体',   re.compile(r'共同事業体')),
        ('共同体',       re.compile(r'共同体')),
        ('コンソーシアム', re.compile(r'コンソーシアム')),
    ]
    _CONSORTIUM_ANY = re.compile(r'共同企業体|協働企業体|共同提案体|共同研究体|共同事業体|共同体|コンソーシアム')
    kigyotai_bypass = {n for n in skipped_names if _CONSORTIUM_ANY.search(n)}
    for name in kigyotai_bypass:
        l1_hits['コンソーシアム・共同体'].add(name)
        for l2_label, pat in _CONSORTIUM_SUBS:
            if pat.search(name):
                l2_hits[l2_label].add(name)
                break
    if kigyotai_bypass:
        s2_hit_names |= kigyotai_bypass
        s2_count  = len(s2_hit_names)
        s2_amount = sum(name_amount[n] for n in s2_hit_names)

    # ラベル数分布
    dist = {0: 0, 1: 0, 2: 0}
    for name in target_names:
        c = label_cnt.get(name, 0)
        dist[min(c, 2)] += 1

    # ══════════════════════════════════════════════════════════
    # 合算・未カバー
    # ══════════════════════════════════════════════════════════
    union_names   = s1_hit_names | s2_hit_names
    overlap_names = s1_hit_names & s2_hit_names
    union_count   = len(union_names)
    union_amount  = sum(name_amount[n] for n in union_names)

    uncovered = sorted(
        ((name_amount[n], n) for n in all_names if n not in union_names),
        reverse=True
    )

    # ══════════════════════════════════════════════════════════
    # レポート出力
    # ══════════════════════════════════════════════════════════
    SEP = '─' * 58

    print()
    print('=== 完全一致・格分類 統合カバレッジレポート ===')
    print(f'入力: {INPUT_CSV}')
    print(f'ユニーク支出先名: {total_count:,}件 / 総金額: {to_cho(total_amount)}')

    # ── Step 1 ───────────────────────────────────────────────
    print()
    print(SEP)
    print('Step 1: 完全一致辞書')
    print(SEP)
    print('[辞書別ヒット数（辞書間重複含む）]')

    for fname in sorted(dict_hit_names.keys()):
        hits     = dict_hit_names[fname]
        h_count  = len(hits)
        h_amount = sum(name_amount[n] for n in hits)
        extra    = ''
        if fname == agg_fname:
            extra = f'  (exact: {len(agg_exact_hits)}件 / regex: {len(agg_regex_hits)}件)'
        print(f'  {fname:<38s}: {h_count:5,}件  {to_cho(h_amount)}{extra}')

    print()
    print('[Step 1 合計（辞書間重複除外）]')
    print(f'  件数カバレッジ: {s1_count:,}件 / {total_count:,}件 = {pct(s1_count, total_count)}')
    print(f'  金額カバレッジ: {pct(s1_amount, total_amount)}')

    # ── Step 2 ───────────────────────────────────────────────
    print()
    print(SEP)
    print(f'Step 2: 格パターン（スキップ {len(skipped_names):,}件除く {len(target_names):,}件対象、共同.*体は全件適用）')
    print(SEP)

    L1_ORDER = [
        '民間企業', '公益法人・NPO', '協同組合等', '独立行政法人等',
        '大学法人', '学校法人', '医療・福祉法人', 'その他法人',
        '専門職法人', '地方公共法人', '地方公共団体', 'コンソーシアム・共同体', '協議会', '実行委員会等',
        'その他（集合）',
    ]
    print('[L1大分類別]')
    for l1 in L1_ORDER:
        hits = l1_hits.get(l1, set())
        if hits:
            print(f'  {l1:<18s}: {len(hits):6,}件  {to_cho(sum(name_amount[n] for n in hits))}')

    print()
    print('[L2中分類別（件数降順）]')
    for l2, hits in sorted(l2_hits.items(), key=lambda x: -len(x[1])):
        print(f'  {l2:<22s}: {len(hits):6,}件  {to_cho(sum(name_amount[n] for n in hits))}')

    # コンソーシアム・共同体の複合名称内訳
    consortium_l2 = (
        l2_hits.get('共同企業体', set()) | l2_hits.get('JV', set()) |
        l2_hits.get('共同提案体', set()) | l2_hits.get('共同研究体', set()) |
        l2_hits.get('共同事業体', set()) | l2_hits.get('共同体', set())
    )
    cs_comp  = consortium_l2 & skipped_names   # バイパス適用分（A社・B社形式）
    cs_plain = consortium_l2 - skipped_names   # 通常マッチ分（名称単体）
    if consortium_l2:
        print(f'  ↳ コンソーシアム内訳 単体: {len(cs_plain):,}件 {to_cho(sum(name_amount[n] for n in cs_plain))}'
              f' / 複合（A社・B社形式）: {len(cs_comp):,}件 {to_cho(sum(name_amount[n] for n in cs_comp))}')

    print()
    print('[ラベル数分布]')
    print(f'  0ラベル（格なし）: {dist[0]:6,}件  {pct(dist[0], len(target_names))}')
    print(f'  1ラベル          : {dist[1]:6,}件  {pct(dist[1], len(target_names))}')
    print(f'  2ラベル以上      : {dist[2]:6,}件  {pct(dist[2], len(target_names))}')

    print()
    print('[Step 2 合計]')
    print(f'  件数カバレッジ: {s2_count:,}件 / {total_count:,}件 = {pct(s2_count, total_count)}')
    print(f'  金額カバレッジ: {pct(s2_amount, total_amount)}')

    # ── 合算 ─────────────────────────────────────────────────
    print()
    print(SEP)
    print('Step 1 ∪ Step 2 合算')
    print(SEP)
    print(f'  件数カバレッジ: {union_count:,}件 / {total_count:,}件 = {pct(union_count, total_count)}')
    print(f'  金額カバレッジ: {pct(union_amount, total_amount)}')
    print(f'  重複（両ステップでヒット）: {len(overlap_names):,}件')

    # ── 未カバー 上位件 ──────────────────────────────────────
    top_n = 20
    print()
    print(SEP)
    print(f'未カバー 上位{top_n}件（金額降順）')
    print(SEP)
    for amount, name in uncovered[:top_n]:
        print(f'  {to_cho(amount)}  {name}')

    # ── 未カバー 推定区分別サマリー ───────────────────────────
    hint_summary: dict[str, dict] = defaultdict(lambda: {'count': 0, 'amount': 0})
    for amount, name in uncovered:
        meta = name_meta.get(name, {})
        hint = infer_hint(name, meta.get('type_codes', set()), meta.get('first_cn', ''))
        hint_summary[hint]['count']  += 1
        hint_summary[hint]['amount'] += amount

    print()
    print(SEP)
    print('未カバー 推定区分別サマリー（金額降順）')
    print(SEP)
    for hint, stats in sorted(hint_summary.items(), key=lambda x: -x[1]['amount']):
        print(f'  {hint:<28s}: {stats["count"]:5,}件  {to_cho(stats["amount"])}')

    # ── CSV 出力 ──────────────────────────────────────────────
    with open(OUTPUT_CSV, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow([
            '支出先名', '金額合計（円）', '件数', '法人種別コード', '法人番号', '推定区分'
        ])
        for amount, name in uncovered:
            meta      = name_meta.get(name, {})
            type_str  = ','.join(sorted(meta.get('type_codes', set())))
            first_cn  = meta.get('first_cn', '')
            hint      = infer_hint(name, meta.get('type_codes', set()), first_cn)
            writer.writerow([name, amount, meta.get('count', 0), type_str, first_cn, hint])

    print()
    print(f'未カバー CSV:    {OUTPUT_CSV}  ({len(uncovered):,}件)')
    print(f'カバレッジレポート: {OUTPUT_REPORT}')
    print()

    sys.stdout = _orig_stdout
    _report_file.close()


if __name__ == '__main__':
    main()
