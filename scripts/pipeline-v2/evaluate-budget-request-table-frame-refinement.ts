/**
 * table-frame relation による header predicate refinement の frozen evaluation（事前登録 Table_Frame_Predicate_Refinement_Preregistration）。
 * full frozen population（universe 14,675 row・target 2,537 page・current nonblank 6,195 page 他）に一度だけ適用する。classifier（frameOf / classifyPosition）・gate は変更しない。
 * 使い方: node --max-old-space-size=8192 --import tsx scripts/pipeline-v2/evaluate-budget-request-table-frame-refinement.ts
 * 出力: tests/fixtures/budget-request-table-frame-refinement/2024/{refined-evaluation.json,candidate-frame-relations.json.gz}
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { extractDrawingPrimitives, type OpsTable } from './lib/budget-request-drawing-primitives';
import { longRules, mergeVerticalRules } from './lib/budget-request-rule-line-anchor';
import { decideRefinement, relationOf } from './lib/budget-request-table-frame-eligibility';

const FX = 'tests/fixtures';
const OUT = path.join(FX, 'budget-request-table-frame-refinement', '2024');
const L = `${FX}/budget-request-label-candidate/2024`, A = `${FX}/budget-request-alt-title-projection/2024`, O = `${FX}/budget-request-p1-outlier/2024`;
const P = {
  manifest: `${FX}/budget-request-full-corpus-baseline/2024/corpus-manifest.json`, universe: `${L}/candidate-universe.json.gz`, comparison: `${L}/comparison-decision.json`,
  freeze: `${O}/population-freeze.json`, packet: `${O}/source-evidence-packet.json`, outlierDecision: `${O}/final-decision.json`, visual: `${O}/visual-evidence.json`,
  alt: `${A}/alt-title-projection.json`, primary: `${A}/primary-evaluation.json`, population: `${A}/population-manifest.json`, projection: `${FX}/budget-request-header-label/2024/header-label-projection.json`,
  classifier: 'scripts/pipeline-v2/lib/budget-request-p1-outlier.ts', rules: 'scripts/pipeline-v2/lib/budget-request-rule-line-anchor.ts', altLib: 'scripts/pipeline-v2/lib/budget-request-alt-title-projection.ts',
  eligibility: 'scripts/pipeline-v2/lib/budget-request-table-frame-eligibility.ts', script: 'scripts/pipeline-v2/evaluate-budget-request-table-frame-refinement.ts', prereg: 'docs/tasks/20261005_1330_Budget_Request_Table_Frame_Predicate_Refinement_Preregistration.md',
};
const FROZEN: Record<string, string> = {
  [P.manifest]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a', [P.universe]: '429ad6c01c2e962c8a9eea65bcaac2c40fefed54cf941f6d08e90c00a26cb776', [P.comparison]: 'fd90b14273218f8608e05022abdcdaa503df6f67ff834344201d5b14c5d0ccda',
  [P.freeze]: 'db22a783aa02a0b6c35f0962f270fccfad5256a14027136c09306d72a9aade5a', [P.packet]: 'de126ad5cc897f7298d586b079286392aed2b1fa696dd9f45eff7c63309733a8', [P.outlierDecision]: '459b2175d6e2ba4ae2ccd487c2c7c5c6789e37bdc4968a72ce6ca732c6d6aab7', [P.visual]: '86c27c452cbfd37e6847a690a8b0d61fc07b8205b0625136802d6808cf0d361a',
  [P.alt]: 'cc071c770fb51a3bf6500a1a01937bbc427283865e3143552ebd7cc5b988c6cd', [P.primary]: '79e5a63ad474fbc0fdf497d59734072a97f1bfa58711346d53aadae75a6cff06', [P.population]: 'ffac4a9d68c7fc4a2cd7883ecb89ed2c5f6009026dcc2fd2d24b6792d981c38d', [P.projection]: '9ff3b970d403d37aea3562cc0eb87a3ee07fca92cbd3bc03986c79b7b9c402e5',
  [P.classifier]: '9cb749d2a3b80f1e71ff3993f9db77e57c723f552c56e1ea5d3a88a11637e5d4', [P.rules]: '39454c20ea706dfd2a61eb1b455dec656383696fe2a538165fb94c535725e262', [P.altLib]: '17cb97efb9861bb2b14f6103f1ebf640e23cc322d66417c6fa0a91bff9f6dbf4', [P.prereg]: 'edc182c8b44d6b1159f040628223cea81be53e44081f7e350ee0fcf68ea13216',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);

interface Cand { id: string; localPath: string; page: number; tokenIndexes: number[]; raw: string; bounds: { xMin: number; xMax: number; yMin: number; yMax: number }; frozen: { population: string } }
interface Doc { localPath: string; sha256: string }

async function relations(cands: Cand[], docs: Doc[]) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const OPS = pdfjs.OPS as unknown as OpsTable;
  const root = path.join('node_modules', 'pdfjs-dist');
  const byPdf = new Map<string, Map<number, Cand[]>>();
  for (const c of cands) { if (!byPdf.has(c.localPath)) byPdf.set(c.localPath, new Map()); const m = byPdf.get(c.localPath)!; if (!m.has(c.page)) m.set(c.page, []); m.get(c.page)!.push(c); }
  const out = new Map<string, ReturnType<typeof relationOf>>();
  for (const d of docs) {
    const pages = byPdf.get(d.localPath); if (!pages) continue;
    if (fileSha(d.localPath) !== d.sha256) throw new Error(`PDF の hash 不一致（STOP）: ${d.localPath}`);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(d.localPath)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
    try {
      for (const [n, cs] of [...pages.entries()].sort((a, b) => a[0] - b[0])) {
        const page = await doc.getPage(n);
        const ol = await page.getOperatorList();
        const height = page.view[3] - page.view[1];
        const long = longRules(mergeVerticalRules(extractDrawingPrimitives(ol.fnArray as number[], ol.argsArray as unknown[], OPS, page.view as number[])), height).map(r => ({ x: r.x, yMin: r.yMin, yMax: r.yMax }));
        for (const c of cs) out.set(c.id, relationOf(c.bounds, long));
        page.cleanup();
      }
    } finally { await doc.destroy(); }
  }
  return out;
}

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const docs = [...(JSON.parse(fs.readFileSync(P.manifest, 'utf8')) as { documents: Doc[] }).documents].sort((a, b) => cmp(a.localPath, b.localPath));
  const u = JSON.parse(zlib.gunzipSync(fs.readFileSync(P.universe)).toString('utf8')) as { accounting: { byPopulation: Record<string, number>; ambiguousPages: number; evaluablePages: number }; candidates: Cand[] };
  const bp = u.accounting.byPopulation;
  const countsOk = u.candidates.length === 14675 && bp.P1_projected_same_row === 2532 && bp.P2_ambiguity_additional_after_code === 1786 && bp.P3_nonambiguous_additional_after_code === 534 && bp.P4_before_first_code === 5572 && bp.P5_other === 4251 && u.accounting.ambiguousPages === 1123 && u.accounting.evaluablePages === 9145;
  const freeze = JSON.parse(fs.readFileSync(P.freeze, 'utf8')) as { outliers: { id: string }[]; controls: { controlId: string }[]; selection: { dominantRows: number; outlierRows: number } };
  const pop = JSON.parse(fs.readFileSync(P.population, 'utf8')) as { counts: Record<string, number>; members: Record<string, Record<string, number[]>> };
  const primary = JSON.parse(fs.readFileSync(P.primary, 'utf8')) as { classes: { C2_target_same_row: { pages: number; recovered: number; unresolved: number; ambiguous: number } } };
  const c2 = primary.classes.C2_target_same_row;
  const integrityOk = countsOk && freeze.selection.dominantRows === 2530 && freeze.selection.outlierRows === 2 && c2.pages === 2537 && c2.recovered === 2532 && c2.unresolved === 5 && pop.counts.C1_current_nonblank === 6195;

  const rel1 = await relations(u.candidates, docs);
  const rel2 = await relations(u.candidates, docs); // determinism（同一入力の再実行）
  const relSerial = (m: Map<string, ReturnType<typeof relationOf>>) => JSON.stringify([...m.entries()].sort((a, b) => cmp(a[0], b[0])).map(([k, v]) => [k, v.relation, v.frameAvailable, v.classification, v.reason]));
  const deterministic = relSerial(rel1) === relSerial(rel2);

  const outlierIds = new Set(freeze.outliers.map(o => o.id));
  const controlIds = new Set(freeze.controls.map(c => c.controlId));
  // classifier reproduction（直前研究と同じ分類）
  const packet = JSON.parse(fs.readFileSync(P.packet, 'utf8')) as { packets: { id: string; sourceOnlyClassification: { classification: string } }[] };
  const classifierReproduced = packet.packets.every(p => { const r = rel1.get(p.id); return !!r && r.classification === p.sourceOnlyClassification.classification; });

  const relations3: Record<string, Record<string, number>> = {}, availability: Record<string, Record<string, number>> = {};
  const matrix = (pk: string, r: ReturnType<typeof relationOf>) => { (relations3[pk] ??= {}); inc(relations3[pk], r.relation); (availability[pk] ??= {}); inc(availability[pk], r.frameAvailable ? 'frame_available' : 'frame_unavailable'); if (r.relation === 'ambiguous') inc(availability[pk], 'frame_ambiguous'); if (r.relation === 'header_position_supported' || r.relation === 'body_or_table_position_supported') inc(availability[pk], 'classification_available'); };
  let p1Dominant = 0, p1DominantHeader = 0;
  for (const c of u.candidates) {
    const r = rel1.get(c.id)!;
    const pk = c.frozen.population.slice(0, 2);
    matrix(pk, r); matrix('all', r);
    if (pk === 'P1') { if (outlierIds.has(c.id)) matrix('P1_outlier', r); else { matrix('P1_dominant', r); p1Dominant++; if (r.relation === 'header_position_supported') p1DominantHeader++; } }
  }
  const outliersExcluded = freeze.outliers.filter(o => rel1.get(o.id)?.relation === 'body_or_table_position_supported').length;
  const p2 = u.candidates.filter(c => c.frozen.population.startsWith('P2'));
  const p2Body = p2.filter(c => rel1.get(c.id)?.relation === 'body_or_table_position_supported').length;
  const classified = u.candidates.filter(c => ['header_position_supported', 'body_or_table_position_supported'].includes(rel1.get(c.id)!.relation)).length;

  // primary page-level（target 2,537 page）と regression
  const alt = JSON.parse(fs.readFileSync(P.alt, 'utf8')) as { pdfs: { localPath: string; pages: { p: number; s: string; basis: string | null; raw: string | null; n: string | null; ref: unknown }[] }[] };
  const cur = JSON.parse(fs.readFileSync(P.projection, 'utf8')) as { pdfs: { localPath: string; projection: { p: number; s: string; raw: string | null; n: string | null }[] }[] };
  const altBy = new Map(alt.pdfs.map(p => [p.localPath, new Map(p.pages.map(x => [x.p, x]))]));
  const curBy = new Map(cur.pdfs.map(p => [p.localPath, new Map(p.projection.map(x => [x.p, x]))]));
  const p1ByPage = new Map(u.candidates.filter(c => c.frozen.population === 'P1_projected_same_row').map(c => [`${c.localPath}|${c.page}`, c]));
  const page: Record<string, number> = { target: 0 };
  let fidelity = 0, provMissing = u.candidates.filter(c => !c.localPath || !c.page || c.tokenIndexes.length === 0).length, provenanceLoss = 0, synthesized = 0, changedOutsideAccepted = 0, changedNonblank = 0, changedNonTarget = 0, currentChanged = 0;
  const targetPages = new Set<string>();
  for (const [lp, ps] of Object.entries(pop.members.C2_target_same_row)) for (const p of ps) targetPages.add(`${lp}|${p}`);
  const nonTarget = new Set<string>();
  for (const k of ['C3_cutoff_other', 'C4_source_label_absent', 'C5_label_shape_unrecognized']) for (const [lp, ps] of Object.entries(pop.members[k])) for (const p of ps) nonTarget.add(`${lp}|${p}`);
  const acceptedPages = new Set<string>();
  for (const key of [...targetPages].sort()) {
    page.target++;
    const c = p1ByPage.get(key);
    const a = altBy.get(key.split('|')[0])!.get(Number(key.split('|')[1]))!;
    if (!c) { inc(page, 'unresolved_existing_mechanism'); continue; }
    if (c.raw !== a.raw) { inc(page, 'mismatch'); fidelity++; continue; }
    const r = rel1.get(c.id)!;
    if (r.relation === 'header_position_supported') { inc(page, 'accepted'); acceptedPages.add(key); if (!a.ref) provenanceLoss++; }
    else if (r.relation === 'body_or_table_position_supported') inc(page, 'rejected_body_or_table');
    else if (r.relation === 'ambiguous') inc(page, 'rejected_ambiguous');
    else inc(page, 'rejected_unavailable');
  }
  // refined status と current の比較（全 evaluable page）
  for (const d of docs) {
    const am = altBy.get(d.localPath)!, cm = curBy.get(d.localPath)!;
    for (const [p, a] of am) {
      const k = `${d.localPath}|${p}`;
      const c0 = cm.get(p)!;
      if (c0.s === 'unavailable_rotate90') continue;
      const refinedStatus = a.basis === 'label_on_first_code_row' && !acceptedPages.has(k) ? 'observed_blank' : a.s;
      const refinedRaw = a.basis === 'label_on_first_code_row' && !acceptedPages.has(k) ? null : a.raw;
      if (refinedStatus !== c0.s || refinedRaw !== c0.raw) { currentChanged++; if (!acceptedPages.has(k)) changedOutsideAccepted++; }
      if (c0.s === 'observed_nonblank' && (refinedStatus !== c0.s || refinedRaw !== c0.raw)) changedNonblank++;
      if (nonTarget.has(k) && refinedStatus !== 'observed_blank') changedNonTarget++;
      if (acceptedPages.has(k) && a.raw !== p1ByPage.get(k)!.raw) synthesized++;
    }
  }
  const facts = { integrityOk, classifierReproduced, deterministic, p1DominantRetention: p1Dominant ? p1DominantHeader / p1Dominant : 0, outliersExcluded, outliersTotal: freeze.outliers.length, p2BodyShare: p2.length ? p2Body / p2.length : 0, coverage: classified / u.candidates.length, regressionChanged: changedNonblank + changedNonTarget + changedOutsideAccepted, fidelityViolations: fidelity, provenanceMissing: provMissing, provenanceLoss, synthesizedText: synthesized };
  const decision = decideRefinement(facts);
  const relationsText = JSON.stringify([...rel1.entries()].sort((a, b) => cmp(a[0], b[0])).map(([id, r]) => [id, r.relation, r.reason.slice(0, 80)]));
  const gz = zlib.gzipSync(Buffer.from(`${relationsText}\n`, 'utf8'), { level: 9 });
  const evalText = `${JSON.stringify(sortDeep({
    schema: 'budget-request-table-frame-refinement-evaluation/v0', note: 'P1 / P2 は human GT ではない。structural separation であり precision / recall ではない。MOF・manual contract 未使用',
    frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), implementation: { eligibility: fileSha(P.eligibility), script: fileSha(P.script) } },
    corpus: { evaluablePages: u.accounting.evaluablePages, candidates: u.candidates.length, populations: bp }, frameAvailability: availability, relationMatrix: relations3,
    p1: { dominant: { rows: p1Dominant, headerPositionRetained: p1DominantHeader }, outliers: { rows: freeze.outliers.length, excludedAsBodyOrTable: outliersExcluded, ids: [...outlierIds] }, controlReproduced: [...controlIds].every(id => rel1.get(id)?.relation === 'header_position_supported') },
    p2: { rows: p2.length, bodyOrTable: p2Body }, primaryPageLevel: page,
    regression: { currentNonblankChanged: changedNonblank, nonTargetChanged: changedNonTarget, currentProjectionChangedOutsideAcceptedTarget: changedOutsideAccepted, currentProjectionChangedTotal: currentChanged, provenanceLoss, synthesizedSourceText: synthesized },
    integrity: { frozenCountsAndHashes: integrityOk, classifierReproduced, deterministicRerun: deterministic, provenanceMissing: provMissing, fidelityViolations: fidelity, candidateRelationsSha256: sha(gz) },
    facts, gates: decision.gates, decision: decision.decision, rule: decision.rule,
  }), null, 1)}\n`;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'candidate-frame-relations.json.gz'), gz);
  fs.writeFileSync(path.join(OUT, 'refined-evaluation.json'), evalText);
  console.log(JSON.stringify({ evalSha: sha(evalText), relationsSha: sha(gz), facts, decision, page, availability, relationMatrix: relations3 }, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
