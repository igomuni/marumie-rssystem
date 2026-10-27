/**
 * RS の事業ごとに、予算・執行の執行額（2-1）と、支出先の支出額（5-1 のうち担当組織から出た分）を比べる。
 *
 * 使用法: npx tsx scripts/analyze-rs-execution-vs-spending.ts [YEAR...]   # 既定: 2024 2025
 * 入力: public/data/sankey-svg-{YEAR}-graph.json(.gz)（generate-sankey-svg-data.ts の出力。予算は前年度の budgetSummary、支出は project-spending の value）
 * 出力: tests/fixtures/rs-execution-vs-spending/{YEAR}.csv（ずれる事業だけ）、summary.json（全事業の分類の件数）
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

type Node = { id: string; name: string; type: string; value: number; projectId?: number; ministry?: string; budgetSummary?: { fiscalYear: number; executedAmount: number | null; totalBudget: number | null } };

const readGraph = (year: string): { nodes: Node[] } => {
  const plain = path.join('public', 'data', `sankey-svg-${year}-graph.json`);
  return JSON.parse(fs.existsSync(plain) ? fs.readFileSync(plain, 'utf8') : zlib.gunzipSync(fs.readFileSync(`${plain}.gz`)).toString('utf8'));
};

/** 分類。比 = 支出 ÷ 執行 */
const classify = (ex: number | null, sp: number): string => {
  if (ex === null) return '執行額なし';
  if (ex === 0 && sp === 0) return '両方0';
  if (ex === 0) return '執行0・支出あり';
  const r = sp / ex;
  if (Math.abs(r - 1) <= 0.005) return '一致（±0.5%）';
  if (Math.abs(r - 1) <= 0.05) return '±5%以内';
  return r < 1 ? '支出が少ない（5%超）' : '支出が多い（5%超）';
};
const SHOWN = new Set(['執行0・支出あり', '支出が少ない（5%超）', '支出が多い（5%超）']);
const cell = (v: string | number | null) => { const s = v === null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

const years = process.argv.slice(2).length ? process.argv.slice(2) : ['2024', '2025'];
const outDir = path.join('tests', 'fixtures', 'rs-execution-vs-spending');
fs.mkdirSync(outDir, { recursive: true });
const summary: Record<string, unknown> = {};
for (const year of years) {
  const nodes = readGraph(year).nodes;
  const spending = new Map(nodes.filter(n => n.type === 'project-spending').map(n => [n.projectId, n.value]));
  const counts: Record<string, number> = {};
  const rows: (string | number | null)[][] = [];
  let budgetYear: number | null = null;
  for (const b of nodes.filter(n => n.type === 'project-budget')) {
    const ex = b.budgetSummary?.executedAmount ?? null; const sp = spending.get(b.projectId) ?? 0;
    budgetYear ??= b.budgetSummary?.fiscalYear ?? null;
    const c = classify(ex, sp); counts[c] = (counts[c] ?? 0) + 1;
    if (!SHOWN.has(c)) continue;
    const ratio = ex ? sp / ex : null;
    // 千倍の疑い: 支出が執行（執行が 0 なら歳出予算現額）の 500〜2000 倍
    const base = ex || b.budgetSummary?.totalBudget || 0;
    const thousand = base > 0 && sp / base >= 500 && sp / base <= 2000 ? 1 : 0;
    rows.push([b.projectId ?? null, b.name, b.ministry ?? '', ex, sp, ratio === null ? null : Number(ratio.toFixed(4)), c, b.budgetSummary?.totalBudget ?? null, thousand]);
  }
  rows.sort((a, b) => (b[4] as number) - (a[4] as number));
  const header = ['予算事業ID', '事業名', '府省庁', '執行額', '支出額（担当組織から）', '支出÷執行', '分類', '歳出予算現額', '千倍の疑い'];
  fs.writeFileSync(path.join(outDir, `${year}.csv`), [header, ...rows].map(r => r.map(cell).join(',')).join('\n') + '\n');
  summary[year] = { budgetFiscalYear: budgetYear, projects: nodes.filter(n => n.type === 'project-budget').length, counts, thousandSuspects: rows.filter(r => r[8] === 1).length };
}
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify(summary));
