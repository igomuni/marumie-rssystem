/**
 * P1 outlier failure isolation の final decision と control comparison（事前登録 P1_Outlier_Failure_Isolation_Protocol §6・§7）。
 * source-only 分類（packet）と visual evidence から D1〜D4 を機械的に決める（visual を実施した outlier は visual を優先し、source と矛盾する場合は STOP）。
 * 使い方: npx tsx scripts/pipeline-v2/decide-budget-request-p1-outliers.ts
 * 出力: tests/fixtures/budget-request-p1-outlier/2024/final-decision.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const OUT = path.join('tests', 'fixtures', 'budget-request-p1-outlier', '2024');
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const PACKET_SHA = 'de126ad5cc897f7298d586b079286392aed2b1fa696dd9f45eff7c63309733a8';
const FREEZE_SHA = 'db22a783aa02a0b6c35f0962f270fccfad5256a14027136c09306d72a9aade5a';
const read = (f: string) => fs.readFileSync(path.join(OUT, f));
if (sha(read('source-evidence-packet.json')) !== PACKET_SHA || sha(read('population-freeze.json')) !== FREEZE_SHA) throw new Error('frozen artifact が一致しない（STOP）');
const packet = JSON.parse(read('source-evidence-packet.json').toString('utf8')) as { packets: { role: string; id: string; geometry: { bounds: Record<string, number>; rowLocalFeatures: Record<string, string> }; projectionContext: { frozen: Record<string, unknown> }; pageLocalStructure: { rel: number; raw: string; codeShaped: boolean }[]; drawing: { nearestHorizontalRuleAtOrAboveCandidateTop: { y: number } | null; nearestHorizontalRuleAtOrBelowCandidateBottom: { y: number } | null; frame: unknown }; adjacentPages: Record<string, { currentProjectedTitleRaw: string | null; alternativeProjectedTitleRaw: string | null; alternativeBasis: string | null } | null>; sourceOnlyClassification: { classification: string } }[] };
const visual = JSON.parse(read('visual-evidence.json').toString('utf8')) as { inspections: { role: string; id: string; visualClassification: string }[] };
const freeze = JSON.parse(read('population-freeze.json').toString('utf8')) as { outliers: { id: string }[]; controls: { outlierId: string; controlId: string }[]; selection: { outlierRows: number; dominantRows: number } };
const src = new Map(packet.packets.map(p => [p.id, p]));
const vis = new Map(visual.inspections.map(v => [v.id, v.visualClassification]));
const rows = freeze.outliers.map(o => {
  const s = src.get(o.id)!.sourceOnlyClassification.classification, v = vis.get(o.id) ?? null;
  const sourceSide = s === 'SOURCE_HEADER_POSITION_SUPPORTED' ? 'header' : s === 'SOURCE_BODY_OR_TABLE_POSITION_SUPPORTED' ? 'body' : 'ambiguous';
  const visualSide = v === null ? null : v === 'VISUAL_HEADER_POSITION_SUPPORTED' ? 'header' : v === 'VISUAL_BODY_OR_TABLE_POSITION_SUPPORTED' ? 'body' : 'ambiguous';
  if (visualSide !== null && sourceSide !== 'ambiguous' && visualSide !== 'ambiguous' && visualSide !== sourceSide) throw new Error(`source と visual が矛盾（STOP）: ${o.id}`);
  return { id: o.id, source: s, visual: v, final: visualSide ?? sourceSide };
});
const n = (k: string) => rows.filter(r => r.final === k).length;
const decision = rows.length !== 2 ? 'INCONCLUSIVE' : n('ambiguous') > 0 ? 'P1_OUTLIERS_UNRESOLVED' : n('body') === 2 ? 'P1_OUTLIERS_BODY_TABLE_SUPPORTED' : n('header') === 2 ? 'P1_OUTLIERS_HEADER_SUPPORTED' : 'P1_OUTLIERS_MIXED';
const rule = { P1_OUTLIERS_BODY_TABLE_SUPPORTED: 1, P1_OUTLIERS_HEADER_SUPPORTED: 2, P1_OUTLIERS_MIXED: 3, P1_OUTLIERS_UNRESOLVED: 4, INCONCLUSIVE: 5 }[decision];
const control = freeze.controls[0].controlId;
const axis = (id: string) => { const p = src.get(id)!; const b = p.geometry.bounds; const prev = p.pageLocalStructure.filter(r => r.rel < 0).slice(-2).map(r => r.raw), next = p.pageLocalStructure.filter(r => r.rel > 0).slice(0, 2).map(r => r.raw); return { top: { yMin: b.yMin, yMax: b.yMax, topBin: p.geometry.rowLocalFeatures.topBin }, xExtent: { xMin: b.xMin, xMax: b.xMax }, width: b.xMax - b.xMin, firstCodeRelation: p.projectionContext.frozen.relativePosition, tableRuleRelation: { frame: p.drawing.frame, nearestHorizontalRuleAbove: p.drawing.nearestHorizontalRuleAtOrAboveCandidateTop?.y ?? null, nearestHorizontalRuleBelow: p.drawing.nearestHorizontalRuleAtOrBelowCandidateBottom?.y ?? null }, precedingRows: prev, followingRows: next, adjacentPageTitleStructure: Object.fromEntries(Object.entries(p.adjacentPages).map(([k, v]) => [k, v ? { currentTitle: v.currentProjectedTitleRaw, alternativeTitle: v.alternativeProjectedTitleRaw, basis: v.alternativeBasis } : null])), sourceOnlyClassification: p.sourceOnlyClassification.classification, visualClassification: vis.get(id) ?? null }; };
const out = {
  schema: 'budget-request-p1-outlier-final-decision/v0', note: 'P1 は human GT ではない。P2 を誤検出と仮定しない。MOF・manual contract は未使用。predicate・threshold・production は未変更。結果を見て閾値を調整していない',
  frozen: { populationFreezeSha256: FREEZE_SHA, sourceEvidencePacketSha256: PACKET_SHA, visualEvidenceSha256: sha(read('visual-evidence.json')) },
  population: { p1DominantRows: freeze.selection.dominantRows, outlierRows: freeze.selection.outlierRows }, outcomes: rows, decision, rule,
  controlComparison: { control, outliers: freeze.outliers.map(o => ({ id: o.id, ...axis(o.id) })), controlRow: axis(control) },
};
const text = `${JSON.stringify(out, null, 1)}\n`;
fs.writeFileSync(path.join(OUT, 'final-decision.json'), text);
console.log(JSON.stringify({ sha: sha(text), rows, decision }, null, 1));
