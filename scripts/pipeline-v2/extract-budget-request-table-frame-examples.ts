/**
 * post-freeze（frozen evaluation の後）の representative examples。機械的規則: (population, relation) ごとの candidate id の辞書順先頭 3 件。人間判断なし・新しい rule なし。
 * 出力: tests/fixtures/budget-request-table-frame-refinement/2024/representative-examples.json
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
const D = path.join('tests', 'fixtures', 'budget-request-table-frame-refinement', '2024');
const U = 'tests/fixtures/budget-request-label-candidate/2024/candidate-universe.json.gz';
const freeze = JSON.parse(fs.readFileSync('tests/fixtures/budget-request-p1-outlier/2024/population-freeze.json', 'utf8')) as { outliers: { id: string }[] };
const outliers = new Set(freeze.outliers.map(o => o.id));
const rel = new Map((JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(D, 'candidate-frame-relations.json.gz'))).toString('utf8')) as [string, string, string][]).map(r => [r[0], { relation: r[1], reason: r[2] }]));
const u = JSON.parse(zlib.gunzipSync(fs.readFileSync(U)).toString('utf8')) as { candidates: { id: string; raw: string; bounds: unknown; frozen: { population: string } }[] };
const groups: Record<string, { id: string; raw: string; bounds: unknown; relation: string; reason: string }[]> = {};
for (const c of u.candidates) { const r = rel.get(c.id)!; const pk = outliers.has(c.id) ? 'P1_outlier' : c.frozen.population.slice(0, 2) === 'P1' ? 'P1_dominant' : c.frozen.population.slice(0, 2); (groups[`${pk}|${r.relation}`] ??= []).push({ id: c.id, raw: c.raw, bounds: c.bounds, relation: r.relation, reason: r.reason }); }
const out = { schema: 'budget-request-table-frame-examples/v0', note: 'post-freeze。(population, relation) ごとの id 辞書順の先頭 3 件。人間判断・visual は primary oracle ではない', examples: Object.fromEntries(Object.entries(groups).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, { count: v.length, first3: v.sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, 3) }])) };
fs.writeFileSync(path.join(D, 'representative-examples.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(Object.entries(out.examples).map(([k, v]) => `${k}: ${v.count}`).join('\n'));
