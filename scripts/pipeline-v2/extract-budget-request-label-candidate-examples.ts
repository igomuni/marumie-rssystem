/**
 * post-freeze（comparison / decision の後）の deterministic representative examples（`id` の辞書順の先頭）。新しい rule は追加しない。
 * 使い方: npx tsx scripts/pipeline-v2/extract-budget-request-label-candidate-examples.ts
 * 出力: tests/fixtures/budget-request-label-candidate/2024/representative-examples.json
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

const OUT = path.join('tests', 'fixtures', 'budget-request-label-candidate', '2024');
interface Cand { id: string; raw: string; normalized: string; bounds: unknown; tokenIndexes: number[]; frozen: { population: string; relativePosition: string }; features: { rowLocal: Record<string, string> }; projection: { shapes: { firstShapeStage: string; digitRemovalDependent: boolean } } }
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const u = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(OUT, 'candidate-universe.json.gz'))).toString('utf8')) as { candidates: Cand[] };
const by = (p: string) => u.candidates.filter(c => c.frozen.population === p).sort((a, b) => cmp(a.id, b.id));
const view = (c: Cand) => ({ id: c.id, raw: c.raw, normalized: c.normalized, bounds: c.bounds, tokenIndexes: c.tokenIndexes, firstShapeStage: c.projection.shapes.firstShapeStage, digitRemovalDependent: c.projection.shapes.digitRemovalDependent, topBin: c.features.rowLocal.topBin, firstTokenXBin: c.features.rowLocal.firstTokenXBin });
const P1 = by('P1_projected_same_row'), P2 = by('P2_ambiguity_additional_after_code');
const classes: Record<string, unknown> = {};
for (const k of [...new Set(P2.map(c => `${c.projection.shapes.firstShapeStage}|digitDep=${c.projection.shapes.digitRemovalDependent}`))].sort()) classes[k] = P2.filter(c => `${c.projection.shapes.firstShapeStage}|digitDep=${c.projection.shapes.digitRemovalDependent}` === k).slice(0, 3).map(view);
// overlap のある feature（topBin: P1 と P2 が共有する値）の class の先頭 3
const p1Top = new Set(P1.map(c => c.features.rowLocal.topBin)), p2Top = new Set(P2.map(c => c.features.rowLocal.topBin));
const shared = [...p1Top].filter(v => p2Top.has(v)).sort();
const overlap = Object.fromEntries(shared.map(v => [`topBin=${v}`, { P1: P1.filter(c => c.features.rowLocal.topBin === v).slice(0, 3).map(view), P2: P2.filter(c => c.features.rowLocal.topBin === v).slice(0, 3).map(view) }]));
const out = { schema: 'budget-request-label-candidate-examples/v0', note: 'post-freeze の deterministic sample（id の辞書順）。人間判断（本文・header 等）は付けない。新しい rule は追加しない', P1_first5: P1.slice(0, 5).map(view), P2_first5: P2.slice(0, 5).map(view), P2_byNormalizationClass_first3: classes, overlapFeature_topBin_sharedValues_first3: overlap };
fs.writeFileSync(path.join(OUT, 'representative-examples.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify(out, null, 1).slice(0, 3500));
