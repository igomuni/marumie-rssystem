/**
 * P1 geometry outlier の frozen selection（事前登録 P1_Outlier_Failure_Isolation_Protocol）。手で選ばず、frozen candidate universe から P1 の最頻 topBin を機械的に求め、異なる topBin の row を outlier とする。
 * control は outlier ごとに決定的に選ぶ（同一 PDF の P1 dominant row の id 辞書順先頭 → 同一 layout class（本研究では PDF の group 不使用のため省略）→ P1 dominant の id 辞書順先頭）。
 * 使い方: npx tsx scripts/pipeline-v2/select-budget-request-p1-outliers.ts
 * 出力: tests/fixtures/budget-request-p1-outlier/2024/population-freeze.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

const FX = 'tests/fixtures';
const OUT = path.join(FX, 'budget-request-p1-outlier', '2024', 'population-freeze.json');
const L = `${FX}/budget-request-label-candidate/2024`;
const FROZEN: Record<string, string> = {
  [`${L}/candidate-universe.json.gz`]: '429ad6c01c2e962c8a9eea65bcaac2c40fefed54cf941f6d08e90c00a26cb776', [`${L}/comparison-decision.json`]: 'fd90b14273218f8608e05022abdcdaa503df6f67ff834344201d5b14c5d0ccda',
  [`${L}/representative-examples.json`]: 'cf54c79fe040dd569eaec5249cab3854ff4daa2e1910f53d3c25e3181ba156d9', 'docs/tasks/20261005_1255_Budget_Request_P1_Outlier_Failure_Isolation_Protocol.md': '__PROTOCOL__',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
interface Cand { id: string; localPath: string; page: number; logicalRowIndex: number; tokenIndexes: number[]; raw: string; frozen: { population: string }; features: { rowLocal: Record<string, string> } }

const protocolPath = 'docs/tasks/20261005_1255_Budget_Request_P1_Outlier_Failure_Isolation_Protocol.md';
const protocolSha = sha(fs.readFileSync(protocolPath));
const hashes: Record<string, string> = {};
for (const [p, h] of Object.entries(FROZEN)) { if (p === protocolPath) { hashes[p] = protocolSha; continue; } const a = sha(fs.readFileSync(p)); if (a !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`); hashes[p] = a; }
const u = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${L}/candidate-universe.json.gz`)).toString('utf8')) as { accounting: { byPopulation: Record<string, number>; ambiguousPages: number }; candidates: Cand[] };
const p1 = u.candidates.filter(c => c.frozen.population === 'P1_projected_same_row').sort((a, b) => cmp(a.id, b.id));
if (p1.length !== 2532 || u.accounting.byPopulation.P2_ambiguity_additional_after_code !== 1786 || u.accounting.ambiguousPages !== 1123) throw new Error('P1 / P2 / ambiguous page が前研究の frozen 値と一致しない（STOP）');
const counts: Record<string, number> = {};
for (const c of p1) counts[c.features.rowLocal.topBin] = (counts[c.features.rowLocal.topBin] ?? 0) + 1;
const mode = Object.entries(counts).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0];
const dominant = p1.filter(c => c.features.rowLocal.topBin === mode[0]);
const outliers = p1.filter(c => c.features.rowLocal.topBin !== mode[0]);
if (dominant.length !== 2530 || outliers.length !== 2) throw new Error(`dominant ${dominant.length} / outlier ${outliers.length}（期待 2,530 / 2）（STOP）`);
const controls = outliers.map(o => {
  const samePdf = dominant.filter(c => c.localPath === o.localPath);
  const pick = samePdf.length ? { c: samePdf[0], rule: 'same_pdf_p1_dominant_first_by_id' } : { c: dominant[0], rule: 'p1_dominant_first_by_id' };
  return { outlierId: o.id, controlId: pick.c.id, rule: pick.rule };
});
const view = (c: Cand) => ({ id: c.id, localPath: c.localPath, page: c.page, logicalRowIndex: c.logicalRowIndex, tokenIndexes: c.tokenIndexes, raw: c.raw, topBin: c.features.rowLocal.topBin });
const text = `${JSON.stringify({
  schema: 'budget-request-p1-outlier-population/v0', note: 'selection は frozen universe から機械的。P1 は human GT ではない。P2 を誤検出と仮定しない',
  frozen: { hashes }, selection: { rule: 'P1 の最頻 topBin と異なる topBin の row', p1Rows: p1.length, modeTopBin: mode[0], dominantRows: dominant.length, outlierRows: outliers.length },
  outliers: outliers.map(view), controls: controls.map(c => ({ ...c, control: view(u.candidates.find(x => x.id === c.controlId)!) })),
  aggregateControl: { description: 'P1 dominant population 全件', rows: dominant.length },
}, null, 1)}\n`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text);
console.log(JSON.stringify({ sha256: sha(text), selection: { mode: mode[0], dominant: dominant.length, outliers: outliers.map(o => o.id), controls } }, null, 1));
