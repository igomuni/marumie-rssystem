/**
 * table-frame refined projection を入力にした page-header structural gate（G1・G3・G4・G5）の再評価（事前登録 Refined_Header_Structural_Gate_Reevaluation_Protocol）。
 * 変更点は gate への入力 projection を alternative → refined に置き換えることだけ。gate の式・threshold・segment algorithm・manual contract は不変（manual は diagnostic のみ）。
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-refined-header-gates.ts
 * 出力: tests/fixtures/budget-request-refined-header-gates/2024/{refined-projection,structural-evaluation,transition-inventory}.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { hierarchyContractFor } from './lib/budget-request-corpus-plan';
import { decideRefined, evaluateGates, labelStarts, segmentStat, segmentsOf, type GatePdf } from './lib/budget-request-header-gates';
import type { Segment } from './lib/budget-request-header-label';

const FX = 'tests/fixtures';
const OUT = path.join(FX, 'budget-request-refined-header-gates', '2024');
const R = `${FX}/budget-request-table-frame-refinement/2024`, A = `${FX}/budget-request-alt-title-projection/2024`;
const P = {
  manifest: `${FX}/budget-request-full-corpus-baseline/2024/corpus-manifest.json`, current: `${FX}/budget-request-header-label/2024/header-label-projection.json`, alt: `${A}/alt-title-projection.json`, altEval: `${A}/segment-structural-evaluation.json`, altPrimary: `${A}/primary-evaluation.json`, population: `${A}/population-manifest.json`,
  refEval: `${R}/refined-evaluation.json`, relations: `${R}/candidate-frame-relations.json.gz`, universe: `${FX}/budget-request-label-candidate/2024/candidate-universe.json.gz`, layout: `${FX}/budget-request-layout-hierarchy-inventory/2024/layout-summary.json`, paired: `${FX}/budget-request-hierarchy-failure-isolation/2024/paired-manifest.json`,
  eligibility: 'scripts/pipeline-v2/lib/budget-request-table-frame-eligibility.ts', gatesLib: 'scripts/pipeline-v2/lib/budget-request-header-gates.ts', script: 'scripts/pipeline-v2/evaluate-budget-request-refined-header-gates.ts',
  protocol: 'docs/tasks/20261005_1355_Budget_Request_Refined_Header_Structural_Gate_Reevaluation_Protocol.md', labelProtocol: 'docs/tasks/20261005_0930_Budget_Request_Page_Header_Label_Segment_Protocol.md', labelCompare: 'scripts/pipeline-v2/compare-budget-request-header-labels.ts', altScript: 'scripts/pipeline-v2/evaluate-budget-request-alt-title-projection.ts',
};
const FROZEN: Record<string, string> = {
  [P.manifest]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a', [P.current]: '9ff3b970d403d37aea3562cc0eb87a3ee07fca92cbd3bc03986c79b7b9c402e5', [P.alt]: 'cc071c770fb51a3bf6500a1a01937bbc427283865e3143552ebd7cc5b988c6cd', [P.altEval]: '3eccc9ea6155d13290dd7dc3f25048ca00304eea1d7fed3115c4541323a7a005',
  [P.altPrimary]: '79e5a63ad474fbc0fdf497d59734072a97f1bfa58711346d53aadae75a6cff06', [P.population]: 'ffac4a9d68c7fc4a2cd7883ecb89ed2c5f6009026dcc2fd2d24b6792d981c38d', [P.refEval]: '9100df1316115fbff0b196bb577ace812cf2f133b68e855fa68cd05ee80bb9dd', [P.relations]: 'cfce15fe8fc529ccb3e32a949baf774edf79e0a9e6bad5c9567e3c645363936b',
  [P.universe]: '429ad6c01c2e962c8a9eea65bcaac2c40fefed54cf941f6d08e90c00a26cb776', [P.layout]: '67808613ed7d0a0e0ef7df7be736473a88159306417254100e6241fe69d63266', [P.paired]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1',
  [P.eligibility]: 'b43eab8b5e129b5755619c9ea3f037682a2d843dae8c4fbfb39535ab5bfffdf2', [P.protocol]: '649b6c44e1777d5cca1d07cc98bceac593a6b261ddb025bd4fc3c234a1173388', [P.labelProtocol]: 'fed6229169503ce7b1e167bba09a0dab35d67d72b1960cdc703386a1c55a5493',
  [P.labelCompare]: '658f0553b0f73c6cd2e06c75ba16decf3b0396eca730e0091e9066f3052f4676', [P.altScript]: 'de59c244b3fdab1dcfc1295002fb0f3347851d7b9fbc2f44e205b1e8c3dc997a',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;

interface AltPage { p: number; s: string; br: string | null; basis: string | null; raw: string | null; n: string | null; sh: (number | null)[] | null; ref: unknown }
interface AltPdf { localPath: string; accountType: string; publisherAuthority: string; group: string; pages: AltPage[] }
interface CurPdf { localPath: string; group: string; projection: { p: number; s: string; br: string | null; raw: string | null; n: string | null; sh: (number | null)[] | null; ref: unknown }[] }
const keyOf = (lp: string, p: number) => `${lp}|${p}`;

function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const alt = readJson<{ pdfs: AltPdf[] }>(P.alt).pdfs;
  const cur = readJson<{ pdfs: CurPdf[] }>(P.current).pdfs;
  const refEval = readJson<{ primaryPageLevel: Record<string, number>; regression: Record<string, number>; corpus: { evaluablePages: number }; integrity: { fidelityViolations: number; provenanceMissing: number }; p1: { dominant: { rows: number; headerPositionRetained: number } } }>(P.refEval);
  const rel = new Map((JSON.parse(zlib.gunzipSync(fs.readFileSync(P.relations)).toString('utf8')) as [string, string, string][]).map(r => [r[0], r[1]]));
  const universe = JSON.parse(zlib.gunzipSync(fs.readFileSync(P.universe)).toString('utf8')) as { candidates: { id: string; localPath: string; page: number; frozen: { population: string } }[] };
  const p1ByPage = new Map(universe.candidates.filter(c => c.frozen.population === 'P1_projected_same_row').map(c => [keyOf(c.localPath, c.page), c.id]));
  const curBy = new Map(cur.map(p => [p.localPath, new Map(p.projection.map(x => [x.p, x]))]));

  // ---- refined projection の導出（新しい rule なし。alt を基に、header position でなかった採用 page を current の出力に戻す）----
  const rejectedPages: { localPath: string; page: number; relation: string }[] = [];
  const refinedPdfs: AltPdf[] = alt.map(pdf => ({ ...pdf, pages: pdf.pages.map(x => {
    if (x.basis !== 'label_on_first_code_row') return x;
    const id = p1ByPage.get(keyOf(pdf.localPath, x.p));
    const relation = id ? rel.get(id) ?? 'unavailable' : 'no_p1_candidate';
    if (relation === 'header_position_supported') return x;
    rejectedPages.push({ localPath: pdf.localPath, page: x.p, relation });
    const c = curBy.get(pdf.localPath)!.get(x.p)!;
    return { p: x.p, s: c.s, br: c.br, basis: null, raw: c.raw, n: c.n, sh: c.sh, ref: c.ref };
  }) }));
  const accepted = alt.reduce((n, p) => n + p.pages.filter(x => x.basis === 'label_on_first_code_row').length, 0) - rejectedPages.length;
  const unresolved5 = readJson<{ M2: { unresolved: number } }>(P.altPrimary).M2.unresolved;

  // ---- population integrity（frozen な refined evaluation と照合）----
  const evaluable = refinedPdfs.reduce((n, p) => n + p.pages.filter(x => x.s === 'observed_nonblank' || x.s === 'observed_blank').length, 0);
  const curNonblank = cur.reduce((n, p) => n + p.projection.filter(x => x.s === 'observed_nonblank').length, 0);
  let nonblankChanged = 0, changedPages = 0;
  for (const pdf of refinedPdfs) for (const x of pdf.pages) { const c = curBy.get(pdf.localPath)!.get(x.p)!; if (c.s !== x.s || c.n !== x.n) { changedPages++; if (c.s === 'observed_nonblank') nonblankChanged++; } }
  const integrity = {
    evaluablePages: { derived: evaluable, frozen: refEval.corpus.evaluablePages }, currentNonblank: { derived: curNonblank, frozen: 6195 },
    accepted: { derived: accepted, frozen: refEval.primaryPageLevel.accepted }, rejectedBodyOrTable: { derived: rejectedPages.filter(r => r.relation === 'body_or_table_position_supported').length, frozen: refEval.primaryPageLevel.rejected_body_or_table },
    rejectedUnavailable: { derived: rejectedPages.filter(r => r.relation === 'unavailable').length, frozen: refEval.primaryPageLevel.rejected_unavailable }, unresolved: { derived: unresolved5, frozen: refEval.primaryPageLevel.unresolved_existing_mechanism },
    currentNonblankChanged: { derived: nonblankChanged, frozen: refEval.regression.currentNonblankChanged }, changedPagesVsCurrent: { derived: changedPages, frozen: refEval.regression.currentProjectionChangedTotal },
    fidelityViolations: refEval.integrity.fidelityViolations, provenanceMissing: refEval.integrity.provenanceMissing,
  };
  const eq = (o: { derived: number; frozen: number }) => o.derived === o.frozen;
  const integrityOk = eq(integrity.evaluablePages) && eq(integrity.currentNonblank) && eq(integrity.accepted) && eq(integrity.rejectedBodyOrTable) && eq(integrity.rejectedUnavailable) && eq(integrity.unresolved) && eq(integrity.currentNonblankChanged) && eq(integrity.changedPagesVsCurrent) && integrity.fidelityViolations === 0 && integrity.provenanceMissing === 0;

  // ---- gate 入力 ----
  const layoutSummary = readJson<{ perPdf: { localPath: string; ranges: { from: number; to: number }[] }[] }>(P.layout);
  const layout = new Map(layoutSummary.perPdf.map(p => [p.localPath, p.ranges]));
  const manifest = readJson<{ documents: { localPath: string; canonicalUrl: string }[] }>(P.manifest).documents;
  const paired = readJson<{ documents: { localPath: string; canonicalUrl: string; class: string }[] }>(P.paired).documents.filter(d => d.class === 'paired_evaluable');
  const contract = new Map(paired.map(d => [d.localPath, hierarchyContractFor(d.canonicalUrl)!.pages as [number, number]]));
  void manifest;
  const toGate = (pdfs: AltPdf[]): GatePdf[] => pdfs.map(p => ({ localPath: p.localPath, group: p.group, pages: p.pages.map(x => ({ p: x.p, s: x.s, n: x.n, sh: x.sh })) }));
  const curGate: GatePdf[] = cur.map(p => ({ localPath: p.localPath, group: p.group, pages: p.projection.map(x => ({ p: x.p, s: x.s, n: x.n, sh: x.sh })) }));
  const altGate = toGate(alt), refGate = toGate(refinedPdfs);
  const segsOf = (g: GatePdf[]) => new Map(g.map(p => [p.localPath, segmentsOf(p)]));
  const curSegs = segsOf(curGate), altSegs = segsOf(altGate), refSegs = segsOf(refGate);
  const gatesRef = evaluateGates(refGate, refSegs, layout, contract);
  const gatesAlt = evaluateGates(altGate, altSegs, layout, contract);
  const mextKey = [...contract.keys()].find(k => /mxt_kaikesou01-000031817_03\.pdf$/.test(k))!, mhlwKey = [...contract.keys()].find(k => /05-1b-01\.pdf$/.test(k))!;
  const counts = (g: GatePdf[]) => ({ observedNonblank: g.reduce((n, p) => n + p.pages.filter(x => x.s === 'observed_nonblank').length, 0), observedBlank: g.reduce((n, p) => n + p.pages.filter(x => x.s === 'observed_blank').length, 0) });
  const table = {
    current: { ...counts(curGate), ...segmentStat(curSegs), mextSegments: curSegs.get(mextKey)!.length, mhlwSegments: curSegs.get(mhlwKey)!.length },
    alternative: { ...counts(altGate), ...segmentStat(altSegs), mextSegments: altSegs.get(mextKey)!.length, mhlwSegments: altSegs.get(mhlwKey)!.length },
    refined: { ...counts(refGate), ...segmentStat(refSegs), mextSegments: refSegs.get(mextKey)!.length, mhlwSegments: refSegs.get(mhlwKey)!.length },
  };
  // frozen alt 評価との equivalence（移植した gate が frozen の値を再現するか）
  const altFrozen = readJson<{ reusedGates: { G4: { mextOtherTransitions: number; mhlwOtherTransitions: number }; G1: { allNonblankRatio: number } }; segmentComparison: { alternative: { labelSegments: number; allSegments: number } } }>(P.altEval);
  const equivalence = gatesAlt.G4.mextOtherTransitions === altFrozen.reusedGates.G4.mextOtherTransitions && gatesAlt.G4.mhlwOtherTransitions === altFrozen.reusedGates.G4.mhlwOtherTransitions && gatesAlt.G1.allNonblankRatio === altFrozen.reusedGates.G1.allNonblankRatio && table.alternative.labelSegments === altFrozen.segmentComparison.alternative.labelSegments && table.alternative.allSegments === altFrozen.segmentComparison.alternative.allSegments && table.current.labelSegments === 2818 && table.current.allSegments === 5482;
  const decision = decideRefined({ G1: gatesRef.G1.pass, G3: gatesRef.G3.pass, G4: gatesRef.G4.pass, G5: gatesRef.G5.pass }, integrityOk && equivalence);

  // ---- manual boundary diagnostic ----
  const stateAt = (g: GatePdf[], lp: string, page: number) => { const x = g.find(p => p.localPath === lp)!.pages.find(y => y.p === page); return x ? { status: x.s, label: x.s === 'observed_nonblank' ? x.n : null } : null; };
  const refBy = new Map(refinedPdfs.map(p => [p.localPath, new Map(p.pages.map(x => [x.p, x]))]));
  const manualDiag = ([['mext_start', mextKey, 'start'], ['mhlw_start', mhlwKey, 'start'], ['mhlw_end', mhlwKey, 'end']] as const).map(([k, lp, kind]) => {
    const [a, b] = contract.get(lp)!; const page = kind === 'start' ? a : b;
    const row = gatesRef.manual.find(m => m.localPath === lp)!;
    const e = refBy.get(lp)!.get(page)!;
    return { boundary: k, page, before: stateAt(refGate, lp, page - 1), at: stateAt(refGate, lp, page), after: stateAt(refGate, lp, page + 1), segmentRelation: kind === 'start' ? (row.startIsLabelSegmentStart ? 'label_segment_start' : 'not_segment_start') : (row.endIsLabelSegmentEnd ? 'label_segment_end' : 'not_segment_end'), layoutBoundary: kind === 'start' ? row.startLayoutBoundary : row.endLayoutBoundary, provenance: { basis: e.basis, ref: e.ref }, alternativeAt: stateAt(altGate, lp, page) };
  });

  // ---- G4 transition inventory（fail 時）と changed-page inventory ----
  const startsSet = (segsBy: Map<string, Segment[]>, lp: string) => new Map(labelStarts(segsBy.get(lp)!).map(s => [s.from, s.state]));
  const g4Inventory = gatesRef.G4.pass ? null : [mextKey, mhlwKey].map(lp => {
    const [a, b] = contract.get(lp)!;
    const segs = refSegs.get(lp)!;
    const aStarts = startsSet(altSegs, lp), cStarts = startsSet(curSegs, lp);
    const rows = labelStarts(segs).filter(s => s.from !== a && s.from !== b + 1).map(s => { const prev = segs[segs.indexOf(s) - 1] ?? null; return { page: s.from, beforeKind: prev?.kind ?? null, beforeLabel: prev?.kind === 'label' ? prev.state : null, beforeState: prev?.state ?? null, afterLabel: s.state, transitionType: prev?.kind === 'label' ? 'direct_label_to_label' : prev ? `after_${prev.kind}` : 'pdf_start', inAlternative: aStarts.get(s.from) === s.state, inCurrent: cStarts.get(s.from) === s.state, newInRefined: aStarts.get(s.from) !== s.state }; });
    return { localPath: lp, manual: [a, b], count: rows.length, transitions: rows };
  });
  const changed = rejectedPages.map(r => {
    const aPage = alt.find(p => p.localPath === r.localPath)!.pages.find(x => x.p === r.page)!, nPage = refBy.get(r.localPath)!.get(r.page)!;
    return { localPath: r.localPath, page: r.page, tableFrameRelation: r.relation, old: { status: aPage.s, label: aPage.n, basis: aPage.basis }, new: { status: nPage.s, label: nPage.n }, labelSegmentsBefore: altSegs.get(r.localPath)!.filter(s => s.kind === 'label').length, labelSegmentsAfter: refSegs.get(r.localPath)!.filter(s => s.kind === 'label').length };
  });

  const out = sortDeep({
    schema: 'budget-request-refined-header-structural-evaluation/v0', note: '入力 projection を alternative → refined に置き換えただけ。gate の式・threshold・segment algorithm は不変。manual contract は diagnostic のみ。label の意味は解釈しない',
    frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), implementation: { gatesLib: fileSha(P.gatesLib), script: fileSha(P.script) } },
    populationIntegrity: { ...integrity, ok: integrityOk, gateEquivalenceWithFrozenAlternativeEvaluation: equivalence }, segmentComparison: table,
    gates: { G1: gatesRef.G1, G3: gatesRef.G3, G4: gatesRef.G4, G5: gatesRef.G5 }, gatesOnAlternativeForEquivalence: { G4: gatesAlt.G4, G1: gatesAlt.G1 }, manualBoundaryDiagnostic: manualDiag, manualContractRows: gatesRef.manual,
    changedPagesAlternativeToRefined: { pages: changed.length, pdfs: new Set(changed.map(c => c.localPath)).size }, decision: decision.decision, rule: decision.rule,
  });
  const refinedText = `${JSON.stringify(sortDeep({ schema: 'budget-request-refined-title-projection/v0', note: 'frozen artifact から決定的に導出（新しい rule なし）。alternative を基に、header position でなかった採用 page を current の出力に戻す', pdfs: refinedPdfs.map(p => ({ localPath: p.localPath, accountType: p.accountType, group: p.group, pages: p.pages.map(x => ({ p: x.p, s: x.s, br: x.br, basis: x.basis, raw: x.raw, n: x.n, sh: x.sh, ref: x.ref })) })) }))}\n`;
  const invText = `${JSON.stringify(sortDeep({ schema: 'budget-request-refined-header-transition-inventory/v0', g4TransitionInventory: g4Inventory, changedPagesAlternativeToRefined: changed }), null, 1)}\n`;
  const text = `${JSON.stringify(out, null, 1)}\n`;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'refined-projection.json'), refinedText);
  fs.writeFileSync(path.join(OUT, 'structural-evaluation.json'), text);
  fs.writeFileSync(path.join(OUT, 'transition-inventory.json'), invText);
  console.log(JSON.stringify({ evalSha: sha(text), projectionSha: sha(refinedText), inventorySha: sha(invText), integrity: { ok: integrityOk, equivalence }, table, gates: { G1: gatesRef.G1.pass, G3: gatesRef.G3.pass, G4: gatesRef.G4, G5: gatesRef.G5.pass }, manualDiag, g4: g4Inventory?.map(x => ({ pdf: x.localPath.split('/').pop(), count: x.count, direct: x.transitions.filter(t => t.transitionType === 'direct_label_to_label').length, newInRefined: x.transitions.filter(t => t.newInRefined).length })), decision }, null, 1));
}
main();
