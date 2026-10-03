/**
 * H1 scope-completion audit — P0/P1: #367 P3 凍結母集団の guard 発火 unit 全集合 F から、P3 時点の凍結 Visual GT の 43 unit（L）を
 * 構造 identity（documentKey:page:logicalRowIndex）で除いた U = F \ L を作り、blind 作業リストとして出力する。
 * 母集団・文脈・resolver 呼び出しは evaluate-budget-request-incomplete-name-guard.ts と同一。PDF 本文の判読・GT ラベルは使わない。
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-h1-guard-fire-worklist.ts --gt-freeze-commit=587a477
 * 出力: tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/h1-scope-completion-worklist.json（決定的）
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { listExtractionTargets } from './lib/budget-request-extraction';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';
import { observeDocumentHierarchyV2 } from './lib/budget-request-document-hierarchy-v2';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens } from './lib/budget-request-pdf-page';
import { buildTableGeometry } from './lib/budget-request-table-geometry';
import { resolveFields, type FieldResolverPageInput, type FieldResolverResult } from './lib/budget-request-field-resolver';
import { FIELD_RESOLVER_RUNS, HIERARCHY_B_ONLY_OPTIONS } from './lib/budget-request-field-resolver-runs';
import type { HeldoutManifest } from './lib/budget-request-field-resolver-heldout-manifest';
import { verifyFreeze } from './lib/budget-request-field-resolver-freeze';
import { GUARD_PREDICATE_VERSION } from './lib/budget-request-incomplete-name-guard-evaluator';

const DIR = path.join('tests', 'fixtures', 'budget-request-field-resolver', 'incomplete-name-guard-v0');
const OUT = path.join(DIR, 'h1-scope-completion-worklist.json');
export const H1_WORKLIST_SCHEMA = 'budget-request-incomplete-name-guard-h1-worklist/v0';
const sha256 = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const readJson = <T>(f: string): T => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const stop = (m: string) => { console.error(`STOP: ${m}`); process.exitCode = 1; };

interface WorkUnit { unitId: string; canonicalUrl: string; physicalPage: number; code: string; anchorYPt: [number, number] }

async function main() {
  const freezeCommit = process.argv.find(a => a.startsWith('--gt-freeze-commit='))?.slice('--gt-freeze-commit='.length);
  if (!freezeCommit) return stop('--gt-freeze-commit が必要');
  const frozen = [
    path.join(DIR, 'sample.json'), path.join(DIR, 'visual-gt.json'), path.join(DIR, 'gt-worklist.json'), path.join(DIR, 'baseline-artifacts.json'),
    'docs/tasks/20261003_1321_FieldResolver_v0_Incomplete_Name_Safety_Guard_Preregistration.md',
    'docs/tasks/20261003_1437_FieldResolver_v0_Incomplete_Name_Safety_Guard_Preregistration_Supplement.md',
    'scripts/pipeline-v2/lib/budget-request-logical-row.ts',
  ];
  const fv = verifyFreeze(freezeCommit, frozen);
  if (!fv.allMatch) return stop(`凍結成果物が ${freezeCommit} と一致しない`);
  const p3 = readJson<{ resolverSourceSha256: string; differential: { records: number; fired: number }; sample: { sha256: string }; visualGt: { sha256: string } }>(path.join(DIR, 'p3-evaluation.json'));
  const resolverSha = sha256('scripts/pipeline-v2/lib/budget-request-field-resolver.ts');
  if (resolverSha !== p3.resolverSourceSha256) return stop('resolver のソースが P3 評価時と一致しない');

  const sampleFile = readJson<{ sample: { documentKey: string; canonicalUrl: string; page: number }[] }>(path.join(DIR, 'sample.json'));
  const gtFile = readJson<{ units: { unitId: string }[] }>(path.join(DIR, 'visual-gt.json'));
  const labeled = new Set(gtFile.units.map(u => u.unitId));

  const targets = listExtractionTargets(getBudgetRequestManifest(2024));
  const pathOf = (url: string) => targets.find(t => t.canonicalUrl === url)!.localPath;
  const pageInput = async (url: string, n: number): Promise<FieldResolverPageInput> => {
    const ex = await extractPageTokens(pathOf(url), n);
    const geometry = buildTableGeometry(ex.tokens, ex.page);
    return { meta: ex.page, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.page, geometry) };
  };

  // P3 評価 CLI と同一の文脈列挙。unit identity は documentKey:page:logicalRowIndex
  const fired: WorkUnit[] = [];
  let records = 0;
  const collect = (key: string, canonicalUrl: string, pages: FieldResolverPageInput[], hierarchy: ReturnType<typeof observeDocumentHierarchyV2> | null) => {
    const off: FieldResolverResult = resolveFields({ pages, hierarchy });
    const on: FieldResolverResult = resolveFields({ pages, hierarchy, incompleteNameGuard: true });
    off.records.forEach((a, j) => {
      const b = on.records[j];
      records++;
      if (JSON.stringify(a.rowLocal.name) === JSON.stringify(b.rowLocal.name)) return;
      fired.push({
        unitId: `${key}:${a.anchor.page}:${a.anchor.logicalRowIndex}`, canonicalUrl, physicalPage: a.anchor.page,
        code: a.rowLocal.code.value?.raw ?? '', anchorYPt: [Math.round(a.anchorBBox.yMin * 10) / 10, Math.round(a.anchorBBox.yMax * 10) / 10],
      });
    });
  };
  for (const r of FIELD_RESOLVER_RUNS) {
    const pages: FieldResolverPageInput[] = [];
    for (let n = r.pages[0]; n <= r.pages[1]; n++) pages.push(await pageInput(r.canonicalUrl, n));
    collect(r.documentKey, r.canonicalUrl, pages, r.hierarchy ? observeDocumentHierarchyV2(r.hierarchy.view, pages, HIERARCHY_B_ONLY_OPTIONS) : null);
  }
  const manifest = readJson<HeldoutManifest>(path.join('tests', 'fixtures', 'budget-request-field-resolver', 'heldout-v0', 'manifest.json'));
  for (const d of manifest.documents) for (const p of d.pages) collect(d.documentId, d.canonicalUrl, [await pageInput(d.canonicalUrl, p.physicalPage)], null);
  const added = [...new Map(sampleFile.sample.filter(s => s.documentKey.endsWith('-additional')).map(s => [`${s.documentKey}#${s.page}`, s])).values()];
  for (const s of added) collect(s.documentKey, s.canonicalUrl, [await pageInput(s.canonicalUrl, s.page)], null);

  const ids = fired.map(f => f.unitId);
  const F = new Set(ids);
  const L = [...F].filter(id => labeled.has(id));
  const U = fired.filter(f => !labeled.has(f.unitId)).sort((a, b) => (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0));
  const invariants = {
    records: records === p3.differential.records, F65: F.size === 65 && fired.length === 65 && p3.differential.fired === 65,
    unique: F.size === fired.length, L27: L.length === 27, U38: U.length === 38,
    union: L.length + U.length === F.size, disjoint: U.every(u => !labeled.has(u.unitId)),
    labeledAllInF: [...labeled].filter(id => F.has(id)).length === L.length,
  };
  console.log(JSON.stringify({ records, F: F.size, firedRaw: fired.length, L: L.length, U: U.length, invariants }, null, 1));
  if (Object.values(invariants).some(v => !v)) return stop('P0 invariant 不成立（出力しない）');

  const out = {
    schema: H1_WORKLIST_SCHEMA,
    provenance: {
      researchPurpose: '#367 scope-completion audit',
      parentExperiment: 'FieldResolver v0 incomplete-name safety guard P3',
      populationDefinition: 'frozen P3 guard-fire population（P3 凍結評価 CLI と同一の文脈・resolver・guard on/off で name が変化した record 全て）',
      derivation: 'U = F \\ L（L = F ∩ visual-gt.json の 43 unit = 27 件。identity は documentKey:page:logicalRowIndex の完全一致。43 unit のうち guard 非発火の 16 件は F に含まれない）',
      guardFireCount: 65, previouslyLabeledCount: 27, auditUnitCount: 38,
      baseFreezeCommit: freezeCommit,
      predicateVersion: GUARD_PREDICATE_VERSION,
      resolverSourceSha256: resolverSha,
      inputArtifacts: {
        sample: { path: path.join(DIR, 'sample.json'), sha256: sha256(path.join(DIR, 'sample.json')) },
        visualGt: { path: path.join(DIR, 'visual-gt.json'), sha256: sha256(path.join(DIR, 'visual-gt.json')) },
        p3Evaluation: { path: path.join(DIR, 'p3-evaluation.json'), sha256: sha256(path.join(DIR, 'p3-evaluation.json')) },
        baselineArtifacts: { path: path.join(DIR, 'baseline-artifacts.json'), sha256: sha256(path.join(DIR, 'baseline-artifacts.json')) },
      },
      canonicalOrdering: 'unitId の辞書順（昇順・内容に依存しない）',
      excludedFields: 'baselineName・guard 出力・predicate 値・reasonCode・stratum・予測ラベルは含めない（GT anchoring 回避）',
    },
    units: U,
  };
  nodeBudgetRequestFs.writeAtomic(OUT, Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'));
  console.log(`wrote ${OUT} sha256=${sha256(OUT)}`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
