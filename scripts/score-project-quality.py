"""
事業別 支出先データ品質スコア計算

5軸評価:
  1. 支出先名の品質 (valid_ratio)       重み 40%
  2. 法人番号の記入率 (cn_fill_ratio)    重み 20%
  3. 予算・支出バランス (gap_ratio)       重み 20%
  4. ブロック構造の妥当性                 重み 10%
  5. 支出先名不明率の抑制（「その他」行の割合） 重み 10%

実行:
  python3 scripts/score-project-quality.py [--limit N]

出力:
  data/result/project_quality_scores.csv
"""

import csv
import json
import unicodedata
import collections
import argparse
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
BUDGET_CSV = REPO_ROOT / 'data' / 'year_2024' / '2-1_RS_2024_予算・執行_サマリ.csv'
SPEND_CSV  = REPO_ROOT / 'data' / 'year_2024' / '5-1_RS_2024_支出先_支出情報.csv'
BLOCK_CSV  = REPO_ROOT / 'data' / 'year_2024' / '5-2_RS_2024_支出先_支出ブロックのつながり.csv'
DICT_CSV   = REPO_ROOT / 'data' / 'result' / 'recipient_dictionary.csv'
OUT_CSV    = REPO_ROOT / 'data' / 'result' / 'project_quality_scores.csv'
OUT_JSON   = REPO_ROOT / 'public' / 'data' / 'project-quality-scores.json'

def to_int(s):
    try:    return int(str(s).replace(',', '').strip())
    except: return 0

def normalize(s):
    return unicodedata.normalize('NFKC', s)

# ── 1. 辞書ロード ──
print('辞書ロード中...')
dict_map = {}
with open(DICT_CSV, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        dict_map[r['name']] = r['valid'] == 'True'
print(f'  辞書: {len(dict_map):,}件')

# ── 2. 予算サマリ（予算年度2023, 会計区分=空の合計行） ──
print('予算サマリ ロード中...')
exec_by_pid = {}    # pid -> exec_amount
budget_by_pid = {}  # pid -> budget_amount (歳出予算現額合計)
with open(BUDGET_CSV, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        if r['予算年度'] == '2023' and r['会計区分'].strip() == '':
            pid = r['予算事業ID']
            exec_by_pid[pid] = to_int(r['執行額(合計)'])
            budget_by_pid[pid] = to_int(r['計(歳出予算現額合計)'])
print(f'  予算年度2023合計行: {len(exec_by_pid):,}事業')

# ── 3. ブロック接続グラフ（5-2 CSV）から再委託深度を算出 ──
print('ブロック接続グラフ ロード中...')
# pid -> list of (src_block, dst_block, from_org:bool)
block_links_by_pid = collections.defaultdict(list)
with open(BLOCK_CSV, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        pid = r['予算事業ID'].strip()
        src_block = r['支出元の支出先ブロック'].strip()
        dst_block = r['支出先の支出先ブロック'].strip()
        from_org = r['担当組織からの支出'].strip().upper() == 'TRUE'
        block_links_by_pid[pid].append((src_block, dst_block, from_org))

def calc_redelegation_depth(pid_links):
    """BFSでルート（担当組織からの支出=TRUE）からの最大深度を算出"""
    children = collections.defaultdict(list)
    roots = set()
    for src, dst, from_org in pid_links:
        if from_org:
            roots.add(dst)
        else:
            children[src].append(dst)
    if not roots:
        return 0
    max_depth = 0
    visited = set()
    queue = collections.deque((r, 0) for r in roots)
    while queue:
        node, depth = queue.popleft()
        if node in visited:
            continue
        visited.add(node)
        max_depth = max(max_depth, depth)
        for child in children.get(node, []):
            queue.append((child, depth + 1))
    return max_depth

redelegation_by_pid = {}
root_blocks_by_pid = {}  # pid -> set of root block letters (e.g. {'A', 'I', 'H'})
for pid, links in block_links_by_pid.items():
    depth = calc_redelegation_depth(links)
    redelegation_by_pid[pid] = depth
    # ルートブロック（担当組織からの直接支出先）を記録
    roots = set()
    for src, dst, from_org in links:
        if from_org:
            roots.add(dst)
    root_blocks_by_pid[pid] = roots

releg_counts = collections.Counter(redelegation_by_pid.values())
print(f'  ブロック接続: {sum(len(v) for v in block_links_by_pid.values()):,}行, {len(block_links_by_pid):,}事業')
print(f'  再委託深度分布: { {k: releg_counts[k] for k in sorted(releg_counts)} }')

# 5-2に登場するすべてのブロック（source / dest 両方）を記録
blocks_in_5_2_by_pid = collections.defaultdict(set)
for pid, links in block_links_by_pid.items():
    for src, dst, _ in links:
        if src:
            blocks_in_5_2_by_pid[pid].add(src)
        if dst:
            blocks_in_5_2_by_pid[pid].add(dst)

# 5-1のブロック一覧を事前スキャンして「孤立ブロック」（5-2に未記載）を検出
# ※ルートとして補完はしない（リンクが辿れないため根拠がない）
print('5-1の孤立ブロックを検出中...')
orphan_blocks_by_pid = collections.defaultdict(set)  # pid -> set of orphan block_nos
with open(SPEND_CSV, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        pid = r['予算事業ID'].strip()
        block_no = r['支出先ブロック番号'].strip()
        if not block_no:
            continue
        # 5-2にエントリがあるPIDで、当該ブロックが5-2に未記載の場合のみ検出
        if pid in blocks_in_5_2_by_pid and block_no not in blocks_in_5_2_by_pid[pid]:
            orphan_blocks_by_pid[pid].add(block_no)
orphan_count = sum(len(v) for v in orphan_blocks_by_pid.values())
print(f'  孤立ブロック: {orphan_count}件 ({len(orphan_blocks_by_pid)}事業)')

# ── 4. 支出先データ ──
print('支出先データ ロード中...')

class ProjectStats:
    __slots__ = [
        'pid', 'name', 'ministry', 'bureau', 'division', 'section', 'office', 'team', 'unit',
        'valid_count', 'invalid_count',
        'cn_filled', 'cn_empty',
        'spend_total', 'spend_net_total',
        'block_names', 'has_redelegation', 'redelegation_depth',
        'block_amounts', 'recipient_amounts_by_block',
        'orphan_block_count',
        'other_true', 'other_false',
        'row_count',
    ]
    def __init__(self, pid, name, ministry, bureau, division, section, office, team, unit):
        self.pid = pid
        self.name = name
        self.ministry = ministry
        self.bureau = bureau
        self.division = division
        self.section = section
        self.office = office
        self.team = team
        self.unit = unit
        self.valid_count = 0
        self.invalid_count = 0
        self.cn_filled = 0
        self.cn_empty = 0
        self.spend_total = 0
        self.spend_net_total = 0  # ルートブロックのみの実質支出額
        self.block_names = set()
        self.has_redelegation = False
        self.redelegation_depth = 0
        self.block_amounts = {}          # block_no -> block_amount
        self.recipient_amounts_by_block = collections.defaultdict(int)  # block_no -> sum of recipient amounts
        self.orphan_block_count = 0     # 5-2に未記載の孤立ブロック数
        self.other_true = 0
        self.other_false = 0
        self.row_count = 0

projects = {}  # pid -> ProjectStats

with open(SPEND_CSV, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        pid = r['予算事業ID']
        recipient_name = r['支出先名'].strip()
        block_no = r['支出先ブロック番号'].strip()
        block_name = r['支出先ブロック名'].strip()

        if pid not in projects:
            projects[pid] = ProjectStats(
                pid, r['事業名'], r['府省庁'].strip(),
                r.get('局・庁', '').strip(), r.get('部', '').strip(),
                r.get('課', '').strip(), r.get('室', '').strip(),
                r.get('班', '').strip(), r.get('係', '').strip(),
            )
        ps = projects[pid]

        # ブロックヘッダー行（支出先名が空でブロック名がある）
        if block_name and block_no:
            ps.block_names.add(block_name)
            block_amt = to_int(r.get('ブロックの合計支出額', ''))
            if block_amt:
                ps.block_amounts[block_no] = block_amt
        # 支出先行（支出先名がある）
        if not recipient_name:
            continue

        ps.row_count += 1

        # 軸1: 支出先名品質
        if recipient_name in dict_map:
            if dict_map[recipient_name]:
                ps.valid_count += 1
            else:
                ps.invalid_count += 1

        # 軸2: 法人番号記入率
        cn = r.get('法人番号', '').strip()
        if cn:
            ps.cn_filled += 1
        else:
            ps.cn_empty += 1

        # 金額（支出先の合計支出額を優先、なければ金額）
        amt = to_int(r.get('支出先の合計支出額', ''))
        if amt:
            ps.spend_total += amt
            if block_no:
                ps.recipient_amounts_by_block[block_no] += amt
                # ルートブロックのみ実質支出額に加算（再委託先は二重計上なので除外）
                roots = root_blocks_by_pid.get(pid, set())
                if block_no in roots:
                    ps.spend_net_total += amt

        # 軸5: その他支出先フラグ
        other_flag = r.get('その他支出先', '').strip().upper()
        if other_flag == 'TRUE':
            ps.other_true += 1
        elif other_flag == 'FALSE':
            ps.other_false += 1

print(f'  事業数: {len(projects):,}')

# 5-2グラフから再委託情報・孤立ブロック情報をProjectStatsに反映
for pid, ps in projects.items():
    depth = redelegation_by_pid.get(pid, 0)
    if depth > 0:
        ps.has_redelegation = True
        ps.redelegation_depth = depth
    # 5-2データがない事業はルートブロック情報なし → 全額を実質支出とみなす
    if pid not in root_blocks_by_pid:
        ps.spend_net_total = ps.spend_total
    # 孤立ブロック数を反映
    ps.orphan_block_count = len(orphan_blocks_by_pid.get(pid, set()))

# ── 5. スコア計算 ──
# (section numbers: 1=dict, 2=budget, 3=block-graph, 4=spending, 5=scores)
print('スコア計算中...')

def clamp(v, lo=0, hi=100):
    return max(lo, min(hi, v))

def calc_scores(ps):
    scores = {}

    # 軸1: 支出先名品質 (0-100)
    dict_total = ps.valid_count + ps.invalid_count
    if dict_total > 0:
        scores['valid_ratio'] = ps.valid_count / dict_total
        scores['axis1'] = clamp(scores['valid_ratio'] * 100)
    else:
        scores['valid_ratio'] = None
        scores['axis1'] = None  # 辞書突合対象がない場合はスコアなし

    # 軸2: 法人番号記入率 (0-100)
    cn_total = ps.cn_filled + ps.cn_empty
    if cn_total > 0:
        scores['cn_fill_ratio'] = ps.cn_filled / cn_total
        scores['axis2'] = clamp(scores['cn_fill_ratio'] * 100)
    else:
        scores['cn_fill_ratio'] = None
        scores['axis2'] = None

    # 軸3: 予算・支出バランス (0-100)
    exec_amt = exec_by_pid.get(ps.pid, 0)
    budget_amt = budget_by_pid.get(ps.pid, 0)
    scores['budget_amount'] = budget_amt
    scores['exec_amount'] = exec_amt
    scores['spend_total'] = ps.spend_total
    scores['spend_net_total'] = ps.spend_net_total
    if exec_amt > 0:
        gap = abs(exec_amt - ps.spend_net_total) / exec_amt
        scores['gap_ratio'] = gap
        # gap=0 → 100点, gap>=1 → 0点（線形）
        scores['axis3'] = clamp((1 - gap) * 100)
    elif ps.spend_net_total == 0 and exec_amt == 0:
        scores['gap_ratio'] = 0
        scores['axis3'] = 100  # 両方ゼロは整合
    else:
        scores['gap_ratio'] = None
        scores['axis3'] = None

    # 軸4: ブロック構造 (0-100)
    # 基礎点100から減点方式:
    #   - 再委託深度1: -10
    #   - 再委託深度2: -20
    #   - 再委託深度3: -30
    #   - 再委託深度4+: -40
    #   - ブロック合計と支出先合計の不整合: -30 (1つ以上のブロックで20%超の乖離)
    axis4 = 100
    if ps.has_redelegation:
        axis4 -= min(40, ps.redelegation_depth * 10)

    # ブロック内整合性チェック
    block_inconsistent = 0
    for bno, bamt in ps.block_amounts.items():
        ramt = ps.recipient_amounts_by_block.get(bno, 0)
        if bamt > 0 and abs(bamt - ramt) / bamt > 0.2:
            block_inconsistent += 1
    if block_inconsistent > 0:
        axis4 -= min(30, block_inconsistent * 10)

    scores['axis4'] = clamp(axis4)
    scores['block_count'] = len(ps.block_names)
    scores['has_redelegation'] = ps.has_redelegation
    scores['redelegation_depth'] = ps.redelegation_depth

    # 軸5: 支出先名不明率の抑制 (0-100)
    # 「その他支出先=TRUE」= 支出先名が「その他」（具体名不明の残額集計行）
    other_total = ps.other_true + ps.other_false
    if other_total > 0:
        other_ratio = ps.other_true / other_total
        scores['other_flag_ratio'] = other_ratio
        # ratio=0 → 100点, ratio>=0.5 → 0点（線形）
        scores['axis5'] = clamp((1 - other_ratio / 0.5) * 100)
    else:
        scores['other_flag_ratio'] = 0
        scores['axis5'] = 100  # フラグ自体がない場合は問題なし

    # 総合スコア（重み付き平均、Noneの軸は除外して再配分）
    weights = [
        ('axis1', 40),
        ('axis2', 20),
        ('axis3', 20),
        ('axis4', 10),
        ('axis5', 10),
    ]
    total_weight = 0
    weighted_sum = 0
    for axis_key, w in weights:
        v = scores.get(axis_key)
        if v is not None:
            weighted_sum += v * w
            total_weight += w

    if total_weight > 0:
        scores['total_score'] = round(weighted_sum / total_weight, 1)
    else:
        scores['total_score'] = None

    return scores

# ── 5. CSV出力 ──
fieldnames = [
    '予算事業ID', '事業名', '府省庁', '局・庁', '部', '課', '室', '班', '係',
    '支出先行数', 'valid数', 'invalid数', 'valid率',
    'CN記入数', 'CN未記入数', 'CN記入率',
    '予算額', '執行額', '支出先合計額', '実質支出額', '乖離率',
    'ブロック数', '再委託有無', '再委託階層',
    '支出先名不明率',
    '軸1_支出先名品質', '軸2_法人番号記入率', '軸3_予算支出バランス',
    '軸4_ブロック構造', '軸5_支出先名不明率抑制',
    '総合スコア',
]

def fmt_pct(v):
    if v is None: return ''
    return f'{v*100:.1f}%'

def fmt_score(v):
    if v is None: return ''
    return f'{v:.1f}'

# Sort by PID
sorted_pids = sorted(projects.keys(), key=lambda x: to_int(x))

# Apply limit if specified
parser = argparse.ArgumentParser()
parser.add_argument('--limit', type=int, default=0, help='Limit number of projects (0=all)')
args = parser.parse_args()

if args.limit > 0:
    sorted_pids = sorted_pids[:args.limit]
    print(f'  --limit {args.limit}: 先頭{args.limit}事業のみ処理')

results = []
for pid in sorted_pids:
    ps = projects[pid]
    sc = calc_scores(ps)
    results.append({
        '予算事業ID': ps.pid,
        '事業名': ps.name,
        '府省庁': ps.ministry,
        '局・庁': ps.bureau,
        '部': ps.division,
        '課': ps.section,
        '室': ps.office,
        '班': ps.team,
        '係': ps.unit,
        '支出先行数': ps.row_count,
        'valid数': ps.valid_count,
        'invalid数': ps.invalid_count,
        'valid率': fmt_pct(sc['valid_ratio']),
        'CN記入数': ps.cn_filled,
        'CN未記入数': ps.cn_empty,
        'CN記入率': fmt_pct(sc['cn_fill_ratio']),
        '予算額': sc['budget_amount'],
        '執行額': sc['exec_amount'],
        '支出先合計額': sc['spend_total'],
        '実質支出額': sc['spend_net_total'],
        '乖離率': fmt_pct(sc['gap_ratio']),
        'ブロック数': sc['block_count'],
        '再委託有無': 'あり' if sc['has_redelegation'] else 'なし',
        '再委託階層': sc['redelegation_depth'],
        '支出先名不明率': fmt_pct(sc['other_flag_ratio']),
        '軸1_支出先名品質': fmt_score(sc['axis1']),
        '軸2_法人番号記入率': fmt_score(sc['axis2']),
        '軸3_予算支出バランス': fmt_score(sc['axis3']),
        '軸4_ブロック構造': fmt_score(sc['axis4']),
        '軸5_支出先名不明率抑制': fmt_score(sc['axis5']),
        '総合スコア': fmt_score(sc['total_score']),
    })

with open(OUT_CSV, 'w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(results)

# ── JSON出力（UI用） ──
json_items = []
for pid in sorted_pids:
    ps = projects[pid]
    sc = calc_scores(ps)
    json_items.append({
        'pid': ps.pid,
        'name': ps.name,
        'ministry': ps.ministry,
        'bureau': ps.bureau,
        'division': ps.division,
        'section': ps.section,
        'office': ps.office,
        'team': ps.team,
        'unit': ps.unit,
        'rowCount': ps.row_count,
        'validCount': ps.valid_count,
        'invalidCount': ps.invalid_count,
        'validRatio': sc['valid_ratio'],
        'cnFilled': ps.cn_filled,
        'cnEmpty': ps.cn_empty,
        'cnFillRatio': sc['cn_fill_ratio'],
        'budgetAmount': sc['budget_amount'],
        'execAmount': sc['exec_amount'],
        'spendTotal': sc['spend_total'],
        'spendNetTotal': sc['spend_net_total'],
        'gapRatio': sc['gap_ratio'],
        'blockCount': sc['block_count'],
        'orphanBlockCount': ps.orphan_block_count,
        'hasRedelegation': sc['has_redelegation'],
        'redelegationDepth': sc['redelegation_depth'],
        'unknownNameRatio': sc.get('other_flag_ratio', 0),
        'axis1': sc['axis1'],
        'axis2': sc['axis2'],
        'axis3': sc['axis3'],
        'axis4': sc['axis4'],
        'axis5': sc['axis5'],
        'totalScore': sc['total_score'],
    })

with open(OUT_JSON, 'w', encoding='utf-8') as f:
    json.dump(json_items, f, ensure_ascii=False)

print(f'\n出力: {OUT_CSV}')
print(f'  JSON: {OUT_JSON} ({len(json_items):,}件, {OUT_JSON.stat().st_size / 1024:.0f}KB)')
print(f'  事業数: {len(results):,}')

# ── サマリー表示 ──
scored = [r for r in results if r['総合スコア']]
if scored:
    scores_list = [float(r['総合スコア']) for r in scored]
    avg = sum(scores_list) / len(scores_list)
    print(f'  平均スコア: {avg:.1f}')
    print(f'  最高: {max(scores_list):.1f}  最低: {min(scores_list):.1f}')

    # スコア分布
    bins = [(90, 100), (80, 89.9), (70, 79.9), (60, 69.9), (50, 59.9), (0, 49.9)]
    print('\n  スコア分布:')
    for lo, hi in bins:
        cnt = sum(1 for s in scores_list if lo <= s <= hi)
        bar = '#' * (cnt * 40 // len(scores_list)) if scores_list else ''
        print(f'    {lo:>3.0f}-{hi:>5.1f}: {cnt:>5,}件  {bar}')

    # 下位10事業
    print(f'\n  総合スコア 下位10事業:')
    bottom = sorted(scored, key=lambda r: float(r['総合スコア']))[:10]
    print(f'    {"PID":>5} {"スコア":>6} {"府省庁":<18} {"事業名"}')
    for r in bottom:
        print(f'    {r["予算事業ID"]:>5} {r["総合スコア"]:>6} {r["府省庁"]:<18} {r["事業名"][:40]}')

    # 上位10事業
    print(f'\n  総合スコア 上位10事業:')
    top = sorted(scored, key=lambda r: float(r['総合スコア']), reverse=True)[:10]
    print(f'    {"PID":>5} {"スコア":>6} {"府省庁":<18} {"事業名"}')
    for r in top:
        print(f'    {r["予算事業ID"]:>5} {r["総合スコア"]:>6} {r["府省庁"]:<18} {r["事業名"][:40]}')
