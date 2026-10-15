#!/usr/bin/env python3
"""tests/fixtures/ の各ディレクトリと scripts/ の各 file について、大きさ・参照元・履歴の日付を数える（記述のみ。判定しない）。

  python3 -I scripts/research/inventory-repo-artifacts.py <out-dir>

数え方の定義は docs/tasks の同名 Contract に先に書いてある。出力: fixtures.csv, scripts.csv, summary.json。
"""
import collections, csv, json, os, re, subprocess, sys

OUT = sys.argv[1]
git = lambda *a: subprocess.check_output(['git', *a], text=True)
files = git('ls-files').splitlines()
head = git('rev-parse', 'HEAD').strip()
TEXT = ('.ts', '.tsx', '.py', '.mjs', '.js', '.mts', '.json', '.md', '.yml', '.yaml', '.sh', '.toml')


def text(f):
    try:
        if os.path.getsize(f) > 400_000: return None
        return open(f, encoding='utf-8', errors='ignore').read()
    except OSError: return None


# 参照元の集合（本文を読む対象）。tests/fixtures/・public/data/・docs/tasks/ の中身は「コード・docs の参照元」には数えない
GROUPS = {
    'code': lambda f: f.endswith(TEXT) and not f.endswith('.md') and not f.startswith(('tests/fixtures/', 'public/data/', 'docs/tasks/', 'docs/inventory/')) and '.test.' not in f,
    'test': lambda f: f.endswith(TEXT) and '.test.' in f,
    'docs_md': lambda f: f.endswith('.md') and f.startswith(('docs/', '.claude/')) and not f.startswith(('docs/tasks/', 'docs/inventory/')) or f in ('CLAUDE.md', 'README.md'),
    'task_doc': lambda f: f.startswith('docs/tasks/') and f.endswith('.md'),
}
corpus = {g: {f: text(f) for f in files if pred(f)} for g, pred in GROUPS.items()}
corpus = {g: {f: t for f, t in d.items() if t is not None} for g, d in corpus.items()}

# 履歴（最初と最後の commit 日）
first, last = {}, {}
cur = None
for line in git('log', '--format=%x00%cs', '--name-only', '--no-renames').splitlines():
    if line.startswith('\x00'): cur = line[1:]
    elif line.strip():
        last.setdefault(line, cur); first[line] = cur


def refs(token, own):
    r = {}
    for g, d in corpus.items():
        r[g] = sorted(f for f, t in d.items() if token in t and not own(f))
    return r


fx = collections.defaultdict(list)
for f in files:
    if f.startswith('tests/fixtures/') and f.count('/') >= 3: fx[f.split('/')[2]].append(f)
os.makedirs(OUT, exist_ok=True)
with open(f'{OUT}/fixtures.csv', 'w', encoding='utf-8', newline='') as fh:
    w = csv.writer(fh, lineterminator='\n')
    w.writerow(['dir', 'files', 'bytes', 'extensions', 'first_commit', 'last_commit', 'code_refs', 'test_refs', 'docs_md_refs', 'task_doc_refs', 'sample_refs'])
    for d, fl in sorted(fx.items()):
        r = refs(d, lambda f, d=d: f.startswith(f'tests/fixtures/{d}/'))
        sample = (r['code'] + r['test'] + r['docs_md'])[:3]
        w.writerow([d, len(fl), sum(os.path.getsize(f) for f in fl), ' '.join(sorted({os.path.splitext(f)[1] for f in fl})), min(first[f] for f in fl), max(last[f] for f in fl),
                    len(r['code']), len(r['test']), len(r['docs_md']), len(r['task_doc']), ';'.join(sample)])

sc = [f for f in files if f.startswith('scripts/') and f.endswith(('.ts', '.py', '.mjs', '.sh', '.js')) and '.test.' not in f]
pkg = text('package.json') or ''
with open(f'{OUT}/scripts.csv', 'w', encoding='utf-8', newline='') as fh:
    w = csv.writer(fh, lineterminator='\n')
    w.writerow(['path', 'bytes', 'lines', 'first_commit', 'last_commit', 'has_sibling_test', 'in_package_json', 'code_refs', 'test_refs', 'docs_md_refs', 'task_doc_refs', 'sample_refs'])
    for f in sc:
        base = os.path.basename(f); stem = re.sub(r'\.[a-z]+$', '', base)
        tok = stem if f.startswith('scripts/pipeline-v2/lib/') else base  # lib は import されるので拡張子なしの名前、それ以外は呼び出される名前
        r = refs(tok, lambda x, f=f: x == f)
        # lib の拡張子なしの名前は短い一般語に当たりやすい。「/名前」か「./名前」で始まる形だけを数える
        if f.startswith('scripts/pipeline-v2/lib/'):
            pat = re.compile(r'[/.]' + re.escape(stem) + r'[\'"]')
            r = {g: sorted(x for x, t in corpus[g].items() if x != f and pat.search(t)) for g in corpus}
        sibling = any(os.path.exists(f'{os.path.splitext(f)[0]}.test{e}') for e in ('.ts', '.mjs', '.js'))
        w.writerow([f, os.path.getsize(f), sum(1 for _ in open(f, encoding='utf-8', errors='ignore')), first[f], last[f], int(sibling), int(base in pkg),
                    len(r['code']), len(r['test']), len(r['docs_md']), len(r['task_doc']), ';'.join((r['code'] + r['test'] + r['docs_md'])[:3])])

fxr = list(csv.DictReader(open(f'{OUT}/fixtures.csv', encoding='utf-8'))); scr = list(csv.DictReader(open(f'{OUT}/scripts.csv', encoding='utf-8')))
zero = lambda x: x['code_refs'] == '0' and x['test_refs'] == '0' and x['docs_md_refs'] == '0'
json.dump({'git_head': head, 'fixture_dirs': len(fxr), 'fixture_bytes': sum(int(x['bytes']) for x in fxr), 'fixture_dirs_without_code_test_docs_refs': sum(1 for x in fxr if zero(x)),
           'fixture_bytes_without_refs': sum(int(x['bytes']) for x in fxr if zero(x)),
           'script_files': len(scr), 'script_bytes': sum(int(x['bytes']) for x in scr), 'scripts_without_code_test_docs_refs': sum(1 for x in scr if zero(x)),
           'scripts_without_refs_and_not_in_package_json': sum(1 for x in scr if zero(x) and x['in_package_json'] == '0')},
          open(f'{OUT}/summary.json', 'w', encoding='utf-8'), indent=1)
open(f'{OUT}/summary.json', 'a').write('\n')
print(open(f'{OUT}/summary.json').read())
