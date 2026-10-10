/**
 * B 層 column continuity visual review の sample 選定（analysis-only）。#412 census と #411 sample の identity だけを読む。PDF には触れない。
 * 使い方: npx tsx scripts/pipeline-v2/analyze-budget-request-toc-b-column-continuity-sample.ts [--freeze-fixture] [--locators <out.json>]
 * --freeze-fixture: review-sample-manifest.json を書く。--locators: blind reviewer 用 locator を書く（repo 外のパス推奨。selection には使わない）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import type { PageOut } from './lib/budget-request-toc-row-assembly';
import { SELECTION_ALGORITHM, cmpPage, eligiblePages, leftLastKind, pageKey, selectSample, type CensusPageLike } from './lib/budget-request-toc-b-column-continuity-sample';

const FX = (...p: string[]) => path.join('tests', 'fixtures', ...p);
const CENSUS = FX('budget-request-toc-b-layer-scope-continuity-failure-isolation', '2024', 'census.json');
const CENSUS_SHA = 'c86db4878927403ee8419ced5e623b262730b33ddb26c69b5a847e562001a978';
const OUT = FX('budget-request-toc-b-layer-column-continuity-visual-failure-isolation', '2024', 'review-sample-manifest.json');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const argVal = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const sortObj = (o: Record<string, number>) => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));
const count = (xs: string[]) => sortObj(xs.reduce((a: Record<string, number>, k) => ((a[k] = (a[k] ?? 0) + 1), a), {}));

type CPage = CensusPageLike & { pageState: string };
const cbuf = fs.readFileSync(CENSUS);
if (sha256Hex(cbuf) !== CENSUS_SHA) throw new Error('STOP: census sha256 mismatch');
const census = JSON.parse(cbuf.toString('utf8')) as { pages: CPage[] };
const sample411 = read<{ samples: { sampleId: string; localPdfPath: string; physicalPage: number }[] }>(FX('budget-request-toc-b-layer-problem-observation', '2024', 'observation-sample.json'));
const EXCL_IDS = ['BS-01', 'BS-03', 'BS-06'];
const excluded = EXCL_IDS.map(id => { const s = sample411.samples.find(x => x.sampleId === id); if (!s) throw new Error(`STOP: ${id} missing`); return s; });

const p2 = census.pages.filter(p => p.flags.P2);
const eligible = eligiblePages(census.pages, excluded);
if (p2.length !== 25) throw new Error(`STOP: P2 != 25 (${p2.length})`);
if (excluded.filter(e => p2.some(p => pageKey(p) === pageKey(e))).length !== 3) throw new Error('STOP: excluded not all in P2');
if (eligible.length !== 22) throw new Error(`STOP: eligible != 22 (${eligible.length})`);

const picked = selectSample(eligible);
const sample411All = new Set(sample411.samples.map(pageKey));
const manifest = {
  schema: 'budget-request-toc-b-column-continuity-review-sample-manifest/v1',
  selectionAlgorithm: SELECTION_ALGORITHM,
  sourceCensus: { path: CENSUS.split(path.sep).join('/'), sha256: CENSUS_SHA },
  population: { p2Pages: p2.length, excludedBy411: excluded.length, eligible: eligible.length },
  excluded: excluded.map(e => { const c = p2.find(p => pageKey(p) === pageKey(e))!; return { sampleId411: e.sampleId, localPdfPath: e.localPdfPath, physicalPage: e.physicalPage, partition: c.partition }; }),
  eligibleComposition: {
    byPartition: count(eligible.map(p => p.partition)), byClassifierSource: count(eligible.map(p => p.classifierSource)),
    byLeftLastKind: count(eligible.map(p => String(leftLastKind(p)))), byStratum: count(eligible.map(p => `${p.classifierSource}/${leftLastKind(p)}`)),
    byRightRequestsBeforeFirstItem: count(eligible.map(p => String(p.q2!.rightRequestsBeforeFirstItem))),
  },
  samples: picked.map((s, i) => ({
    sampleId: `CC-${String(i + 1).padStart(2, '0')}`, localPdfPath: s.page.localPdfPath, physicalPage: s.page.physicalPage,
    pdfSha256: (s.page as unknown as { pdfSha256: string }).pdfSha256, partition: s.page.partition, classifierSource: s.page.classifierSource,
    aLayerPageState: s.page.pageState, leftStreamLastSemanticKind: leftLastKind(s.page), rightLeadingRequestCount: s.page.q2!.rightRequestsBeforeFirstItem,
    selectionStratum: s.stratum, selectionReason: s.reason, overlap411: sample411All.has(pageKey(s.page)),
  })),
  coverage: { strataFilled: [...new Set(picked.filter(s => s.stratum !== 'TOP_RIGHT_REQUESTS').map(s => s.stratum))].sort(), partitions: count(picked.map(s => s.page.partition)) },
};
if (manifest.samples.some(s => s.overlap411)) throw new Error('STOP: overlap with #411');
if (manifest.samples.length > 6 || new Set(manifest.samples.map(s => pageKey(s))).size !== manifest.samples.length) throw new Error('STOP: size/dup');
const text = JSON.stringify(manifest, null, 2) + '\n';
console.log(`manifest sha256 ${sha256Hex(Buffer.from(text))}`);
console.log(JSON.stringify({ population: manifest.population, composition: manifest.eligibleComposition, coverage: manifest.coverage }, null, 1));
for (const s of manifest.samples) console.log(s.sampleId, s.localPdfPath, s.physicalPage, s.partition, s.classifierSource, s.leftStreamLastSemanticKind, s.rightLeadingRequestCount, s.selectionStratum);
if (process.argv.includes('--freeze-fixture')) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, text); }

const loc = argVal('--locators');
if (loc) {
  // selection 後に作る blind locator。stratum・classifierSource・left 情報・選定理由は含めない。
  const parser = new Map(read<{ pages: PageOut[] }>(FX('budget-request-toc-full-corpus-status', '2024', 'full-corpus-h1-output.json')).pages.map(p => [pageKey(p), p]));
  const locators = manifest.samples.map(s => {
    const rows = parser.get(pageKey(s))!.rows.filter(r => r.column === 'RIGHT').sort((a, b) => a.provenance.lineIndex - b.provenance.lineIndex);
    const firstMarker = rows.findIndex(r => r.rowKind === 'MARKER_ROW');
    const lead = (firstMarker < 0 ? rows : rows.slice(0, firstMarker)).filter(r => r.rowKind === 'REQUEST_NUMBER_ROW');
    if (lead.length !== s.rightLeadingRequestCount) throw new Error(`STOP: locator count mismatch ${s.sampleId} ${lead.length} vs ${s.rightLeadingRequestCount}`);
    return {
      sampleId: s.sampleId, pdf: s.localPdfPath, physicalPage: s.physicalPage,
      target: lead.map(r => ({ rowStartTokenRaw: r.rowStartTokenRaw, titleExcerpt: (r.titleRaw ?? '').slice(0, 30), lineIndex: r.provenance.lineIndex })),
    };
  });
  fs.writeFileSync(loc, JSON.stringify({ note: 'target = 右 column 内で最初の marker 行より前に並ぶ REQUEST 行', locators }, null, 2) + '\n');
  console.log(`locators ${locators.length} -> ${loc}`);
}
