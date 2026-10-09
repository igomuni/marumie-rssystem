/**
 * TOC 82 page の right-band evidence「rejected request token」census（analysis-only・read-only・parser 不変）。
 * 使い方: npx tsx scripts/pipeline-v2/analyze-budget-request-toc-a2-right-band-evidence.ts [--raw-text-root <dir>] [--anchors-only] [--freeze-fixture]
 * raw-text-root 既定: data/work/budget-request-raw-text/2024（PDF は開かない。JSONL の sha256 を commit 済み manifest と照合してから使う）
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import { assembleTocPageH1 } from './lib/budget-request-toc-row-assembly-h1';
import type { TocPageInput } from './lib/budget-request-toc-row-assembly';
import { CLASSIFICATIONS, SUB_BREAKDOWNS, censusPage, type PageStateName } from './lib/budget-request-toc-a2-right-band-evidence';

const argv = process.argv;
const FREEZE = argv.includes('--freeze-fixture');
const ANCHORS_ONLY = argv.includes('--anchors-only');
const rootIdx = argv.indexOf('--raw-text-root');
const RAW_ROOT = rootIdx >= 0 ? argv[rootIdx + 1] : path.join('data', 'work', 'budget-request-raw-text', '2024');
const LOGICAL_ROOT = 'data/work/budget-request-raw-text/2024';
const FX = (...p: string[]) => path.join('tests', 'fixtures', ...p);
const OUT = FX('budget-request-toc-a2-right-band-evidence-failure-isolation', '2024');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const stop = (m: string): never => { throw new Error(`STOP: ${m}`); };

interface StatusPage {
  localPdfPath: string; physicalPage: number; partition: string; classifierSource: 'DIRECT' | 'INHERITED'; pdfSha256: string; textSha256: string;
  pageState: PageStateName; rightBandEdge: number | null; rightBandEvidenceCount: number; pageAbstentionReason: string | null; h1: { triggerLines: unknown[] };
}
interface RawPage { text: string; textSha256: string; nonEmptyLines: { lineIndex: number; text: string }[] }

const status = read<{ pages: StatusPage[] }>(FX('budget-request-toc-full-corpus-status', '2024', 'full-corpus-status.json')).pages;
if (status.length !== 82) stop(`status pages ${status.length}`);
const manifest = read<{ documents: { localPdfPath: string; artifactPath: string; artifactSha256: string }[] }>(FX('budget-request-raw-text', '2024', 'raw-text-manifest.json'));
const docs = new Map(manifest.documents.map(d => [d.localPdfPath, d]));
const verified = new Map<string, string>();
const cache = new Map<string, RawPage[]>();
function pagesOf(pdf: string): RawPage[] {
  let r = cache.get(pdf);
  if (r) return r;
  const d = docs.get(pdf) ?? stop(`no manifest doc ${pdf}`);
  const buf = fs.readFileSync(path.join(RAW_ROOT, d.artifactPath));
  const sha = sha256Hex(buf);
  if (sha !== d.artifactSha256) stop(`artifact sha256 mismatch ${d.artifactPath}`);
  verified.set(d.artifactPath, sha);
  r = buf.toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as RawPage);
  cache.set(pdf, r);
  return r;
}

function run(p: StatusPage) {
  const pg = pagesOf(p.localPdfPath)[p.physicalPage - 1] ?? stop(`no raw page ${key(p)}`);
  if (pg.textSha256 !== p.textSha256 || sha256Hex(pg.text) !== p.textSha256) stop(`textSha256 mismatch ${key(p)}`);
  const input: TocPageInput = { localPdfPath: p.localPdfPath, pdfSha256: p.pdfSha256, physicalPage: p.physicalPage, textSha256: p.textSha256, classifierSource: p.classifierSource, text: pg.text, nonEmptyLines: pg.nonEmptyLines };
  const rerun = assembleTocPageH1(input);
  if (rerun.pageState !== p.pageState || rerun.pageAbstentionReason !== p.pageAbstentionReason || rerun.rightBandEdge !== p.rightBandEdge) stop(`H1 rerun differs from status ${key(p)}`);
  const c = censusPage(pg.nonEmptyLines, { pageState: p.pageState, pageAbstentionReason: p.pageAbstentionReason });
  if (c.acceptedEvidenceCount !== p.rightBandEvidenceCount) stop(`accepted evidence ${c.acceptedEvidenceCount} != status ${p.rightBandEvidenceCount} ${key(p)}`);
  if (c.acceptedNotInAnyToken !== 0) stop(`acceptedNotInAnyToken ${key(p)}`);
  return c;
}

// ---- anchors（H4 / H5 / H6）: #404 の observations.json と照合 ----
const obs = read<{ pages: { id: string; localPdfPath: string; physicalPage: number; evidence: { requestTokenCandidatesAll: number; countedEvidence: number; notCountedByReason: { firstTokenOnLine: number }; requestTokenStartHistogram: Record<string, { all: number; counted: number }>; countedEvidenceDetail: { lineIndex: number; charIndex: number }[] } }[] }>(
  FX('budget-request-toc-human-review-failure-isolation', '2024', 'observations.json'));
const anchorResults = ['H4', 'H5', 'H6'].map(id => {
  const o = obs.pages.find(x => x.id === id) ?? stop(`no observation ${id}`);
  const sp = status.find(s => key(s) === key(o)) ?? stop(`anchor not in status ${id}`);
  const c = run(sp);
  const fto = c.lineStart0Candidates + c.rightOnlyCandidates;
  const obsHist: Record<string, number> = {};
  for (const [k, v] of Object.entries(o.evidence.requestTokenStartHistogram)) obsHist[k] = v.all;
  const myHist: Record<string, number> = {};
  for (const t of c.tokens) myHist[t.charIndex] = (myHist[t.charIndex] ?? 0) + 1;
  const acc = c.tokens.filter(t => t.accepted).map(t => `${t.lineIndex}:${t.charIndex}`);
  const obsAcc = o.evidence.countedEvidenceDetail.map(t => `${t.lineIndex}:${t.charIndex}`);
  const match = c.requestTokenCandidatesAll === o.evidence.requestTokenCandidatesAll && c.acceptedEvidenceCount === o.evidence.countedEvidence && fto === o.evidence.notCountedByReason.firstTokenOnLine
    && JSON.stringify(myHist) === JSON.stringify(obsHist) && JSON.stringify(acc) === JSON.stringify(obsAcc);
  return { id, localPdfPath: o.localPdfPath, physicalPage: o.physicalPage, all: c.requestTokenCandidatesAll, accepted: c.acceptedEvidenceCount, acceptedAt: acc, firstTokenOnLine: fto, startHistogramAll: myHist, rightOnly: c.rightOnlyCandidates, rightOnlyHistogram: c.rightOnlyStartHistogram, classification: c.classification, matchesObservations404: match };
});
for (const a of anchorResults) console.log(JSON.stringify(a));
if (anchorResults.some(a => !a.matchesObservations404)) stop('anchor mismatch vs observations.json');
const byId = Object.fromEntries(anchorResults.map(a => [a.id, a]));
if (byId.H4.classification === 'A2_LIKE_REJECTED_RIGHT_ONLY' || byId.H6.classification === 'A2_LIKE_REJECTED_RIGHT_ONLY' || byId.H4.accepted !== 1 || byId.H6.accepted !== 1 || byId.H4.rightOnly !== 0 || byId.H6.rightOnly !== 0) stop('H4/H6 anchor is not A1-like');
if (byId.H5.classification !== 'A2_LIKE_REJECTED_RIGHT_ONLY' || byId.H5.rightOnly !== 30 || JSON.stringify(byId.H5.rightOnlyHistogram) !== JSON.stringify({ 55: 30 })) stop('H5 anchor is not A2');
if (ANCHORS_ONLY) process.exit(0);

// ---- census ----
const humanId = new Map(obs.pages.map(o => [key(o), o.id]));
const sorted = [...status].sort((a, b) => cmp(key(a), key(b)));
const pages = sorted.map(p => {
  const c = run(p);
  return {
    localPdfPath: p.localPdfPath, physicalPage: p.physicalPage, partition: p.partition, currentPageState: p.pageState, currentPageAbstentionReason: p.pageAbstentionReason,
    rightBandResolved: p.pageState === 'ASSEMBLED_SPLIT', acceptedEvidenceCount: c.acceptedEvidenceCount, requestTokenCandidatesAll: c.requestTokenCandidatesAll,
    rejectedCount: c.rejectedCount, rejectedByReason: c.rejectedByReason, lineStart0Candidates: c.lineStart0Candidates, rightOnlyCandidates: c.rightOnlyCandidates,
    rightOnlyStartHistogram: c.rightOnlyStartHistogram, dominantRightOnlyWindow: c.dominantRightOnlyWindow, a2Pattern: c.a2Pattern,
    h1TriggerCount: p.h1.triggerLines.length, classification: c.classification, subBreakdown: c.subBreakdown, knownHumanReviewId: humanId.get(key(p)) ?? null,
    rightOnlyCandidateLines: c.tokens.filter(t => t.rejectReason === 'FIRST_TOKEN_ON_LINE_RIGHT_ONLY').map(t => [t.lineIndex, t.charIndex]),
  };
});
if (pages.length !== 82 || new Set(pages.map(key)).size !== 82) stop('coverage');
const count = <T extends string>(xs: T[]) => Object.fromEntries([...new Set(xs)].sort().map(k => [k, xs.filter(x => x === k).length]));
const parts = count(pages.map(p => p.partition));
const nested = Object.fromEntries(CLASSIFICATIONS.map(cl => {
  const ps = pages.filter(p => p.classification === cl);
  return [cl, { pages: ps.length, subBreakdown: Object.fromEntries(SUB_BREAKDOWNS.map(s => [s, ps.filter(p => p.subBreakdown === s).length])), byPartition: count(ps.map(p => p.partition)) }];
}));
const total = (f: (p: (typeof pages)[number]) => number) => pages.reduce((s, p) => s + f(p), 0);
if (total(p => 1) !== 82 || Object.values(nested).reduce((s, v) => s + v.pages, 0) !== 82) stop('classification total');
const doc = {
  schema: 'budget-request-toc-a2-right-band-evidence-census/v0',
  note: 'analysis-only 観測。right-only-line candidate は raw line の機械的ラベルで visual な right column を意味しない。parser / H1 / GT / 評価 contract は変更していない',
  input: { rawTextRoot: LOGICAL_ROOT, manifest: 'tests/fixtures/budget-request-raw-text/2024/raw-text-manifest.json', verifiedArtifactSha256: Object.fromEntries([...verified].sort(([a], [b]) => cmp(a, b))), populationFixture: 'tests/fixtures/budget-request-toc-full-corpus-status/2024/full-corpus-status.json' },
  anchors: anchorResults,
  summary: {
    pages: 82, byPartition: parts, byPageState: count(pages.map(p => p.currentPageState)), acceptedEvidenceDistribution: count(pages.map(p => String(p.acceptedEvidenceCount))),
    totals: { requestTokenCandidatesAll: total(p => p.requestTokenCandidatesAll), accepted: total(p => p.acceptedEvidenceCount), rejected: total(p => p.rejectedCount), lineStart0Candidates: total(p => p.lineStart0Candidates), rightOnlyCandidates: total(p => p.rightOnlyCandidates), nonFirstNotPrecededRejected: total(p => p.rejectedByReason.NOT_FIRST_NOT_PRECEDED_BY_DIGITS_WS) },
    pagesWithRightOnlyCandidates: pages.filter(p => p.rightOnlyCandidates > 0).length,
    classification: nested,
  },
  pages,
};
const out = `${JSON.stringify(doc, null, 1)}\n`;
if (FREEZE) fs.writeFileSync(path.join(OUT, 'census.json'), out);
console.log(JSON.stringify({ outSha256: sha256Hex(out), summary: doc.summary }));
