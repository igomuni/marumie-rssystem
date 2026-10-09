/**
 * TOC 82 page の header zone「row-start token なしの E 以右 text」census（analysis-only・read-only・parser 不変）。
 * 使い方: npx tsx scripts/pipeline-v2/analyze-budget-request-toc-header-tokenless.ts [--raw-text-root <dir>] [--anchors-only] [--freeze-fixture <outDir>]
 * raw-text-root 既定: data/work/budget-request-raw-text/2024（PDF は開かない。JSONL の sha256 を commit 済み manifest と照合してから使う）
 * --freeze-fixture <outDir> を明示したときだけ <outDir>/census.json を書く
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import { assembleTocPageH1 } from './lib/budget-request-toc-row-assembly-h1';
import type { TocPageInput } from './lib/budget-request-toc-row-assembly';
import { h1TriggerCensus } from './lib/budget-request-toc-h1-formal-evaluation';
import { analyzeHeaderPage, type HeaderPage } from './lib/budget-request-toc-header-tokenless';

const argv = process.argv;
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const ANCHORS_ONLY = argv.includes('--anchors-only');
const FREEZE_DIR = argOf('--freeze-fixture');
const RAW_ROOT = argOf('--raw-text-root') ?? path.join('data', 'work', 'budget-request-raw-text', '2024');
const LOGICAL_ROOT = 'data/work/budget-request-raw-text/2024';
const FX = (...p: string[]) => path.join('tests', 'fixtures', ...p);
const read = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const stop = (m: string): never => { throw new Error(`STOP: ${m}`); };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface StatusPage {
  localPdfPath: string; physicalPage: number; partition: string; classifierSource: 'DIRECT' | 'INHERITED'; pdfSha256: string; textSha256: string;
  pageState: string; rightBandEdge: number | null; pageAbstentionReason: string | null; fragmentsAttached: number;
  h1: { triggerLines: number[]; negativeControlLines: number[] };
}
interface RawPage { text: string; textSha256: string; nonEmptyLines: { lineIndex: number; text: string }[] }
interface ManifestDoc { localPdfPath: string; artifactPath: string; artifactSha256: string; pageTextSha256?: string[] }

const status = read<{ pages: StatusPage[] }>(FX('budget-request-toc-full-corpus-status', '2024', 'full-corpus-status.json')).pages;
if (status.length !== 82) stop(`status pages ${status.length}`);
const queue = read<{ pages: (StatusPage & { candidateReasons: string[] })[] }>(FX('budget-request-toc-full-corpus-status', '2024', 'human-review-queue.json')).pages;
const manifest = read<{ documents: ManifestDoc[] }>(FX('budget-request-raw-text', '2024', 'raw-text-manifest.json'));
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
  const d = docs.get(p.localPdfPath) as ManifestDoc;
  if (d.pageTextSha256 && d.pageTextSha256[p.physicalPage - 1] !== p.textSha256) stop(`manifest pageTextSha256 mismatch ${key(p)}`);
  if (pg.textSha256 !== p.textSha256 || sha256Hex(pg.text) !== p.textSha256) stop(`textSha256 mismatch ${key(p)}`);
  const input: TocPageInput = { localPdfPath: p.localPdfPath, pdfSha256: p.pdfSha256, physicalPage: p.physicalPage, textSha256: p.textSha256, classifierSource: p.classifierSource, text: pg.text, nonEmptyLines: pg.nonEmptyLines };
  const h1 = assembleTocPageH1(input);
  if (h1.pageState !== p.pageState || h1.pageAbstentionReason !== p.pageAbstentionReason || h1.rightBandEdge !== p.rightBandEdge) stop(`H1 rerun differs from status ${key(p)}`);
  const c = h1TriggerCensus(pg.nonEmptyLines, h1);
  if (!eq(c.triggerLines, p.h1.triggerLines) || !eq(c.negativeControlLines, p.h1.negativeControlLines)) stop(`trigger/negativeControl differ from status ${key(p)}`);
  if (h1.rows.reduce((a, r) => a + r.fragments.length, 0) !== p.fragmentsAttached) stop(`fragmentsAttached differs from status ${key(p)}`);
  return { lines: pg.nonEmptyLines, h1, a: analyzeHeaderPage(pg.nonEmptyLines, h1) };
}

// ---- anchors（H2 / 訂正後 H7）: #404 の observations.json と照合（census 全体より先に実行）----
// ANCHOR_HUMAN_LINES は #404 の記録（H2: req18 の continuation / H7: req23 の 2 行目）が指す raw line。observations.json の titleUnits で実在を検証する
const ANCHOR_HUMAN_LINES: Record<string, number> = { H2: 10, H7: 8 };
type Obs = { id: string; localPdfPath: string; physicalPage: number; rightBandEdge: number; fragmentAttachments: { owner: { rowStartTokenRaw: string; lineIndex: number }; fragments: { lineIndex: number; charStart: number; charEnd: number; text: string }[] }[]; titleUnits: { column: string; lineIndex: number; slice: string }[] };
const obsFile = read<{ postReviewHumanCorrection: { id: string; machineOutputChanged: boolean }; pages: Obs[] }>(FX('budget-request-toc-human-review-failure-isolation', '2024', 'observations.json'));
if (obsFile.postReviewHumanCorrection.id !== 'H7' || obsFile.postReviewHumanCorrection.machineOutputChanged !== false) stop('H7 correction record');
const anchorResults = ['H2', 'H7'].map(id => {
  const o = obsFile.pages.find(x => x.id === id) ?? stop(`no observation ${id}`);
  const sp = status.find(s => key(s) === key(o)) ?? stop(`anchor not in status ${id}`);
  const { lines, h1, a } = run(sp);
  const humanLine = ANCHOR_HUMAN_LINES[id];
  const unit = o.titleUnits.find(t => t.column === 'UNSPLIT' && t.lineIndex === humanLine) ?? stop(`${id}: observations has no UNSPLIT title at line ${humanLine}`);
  const cand = a.candidates.find(c => c.lineIndex === humanLine) ?? stop(`${id}: no candidate at line ${humanLine}`);
  const machineAtt = h1.rows.flatMap(r => r.fragments.map(f => ({ owner: { rowStartTokenRaw: r.rowStartTokenRaw, lineIndex: r.provenance.lineIndex }, fragment: { lineIndex: f.provenance.lineIndex, charStart: f.provenance.charStart, charEnd: f.provenance.charEnd, text: f.textRaw } })));
  const obsAtt = o.fragmentAttachments.flatMap(x => x.fragments.map(f => ({ owner: { rowStartTokenRaw: x.owner.rowStartTokenRaw, lineIndex: x.owner.lineIndex }, fragment: { lineIndex: f.lineIndex, charStart: f.charStart, charEnd: f.charEnd, text: f.text } })));
  const match = {
    attachments: eq(machineAtt, obsAtt),
    attachedAtHumanLine: machineAtt.some(m => m.fragment.lineIndex === humanLine),
    candidateTextEqualsTitleSlice: cand.rightTextSha256 === sha256Hex(unit.slice.trim()) && cand.leftBlank,
    wholeLineTitle: cand.wholeLineTitleInOutput,
    afterTrigger: cand.primary === 'HEADER_TOKENLESS_AFTER_TRIGGER' && cand.knownFlagMatch,
    edge: a.edge === o.rightBandEdge,
    inKnownQueue: queue.some(q => key(q) === key(o) && q.candidateReasons.includes('KNOWN_TOKENLESS_FRAGMENT_RELEVANT')),
  };
  void lines;
  return { id, localPdfPath: o.localPdfPath, physicalPage: o.physicalPage, edge: a.edge, humanLine, candidateLines: a.candidates.map(c => c.lineIndex), triggerCount: a.triggerCount, firstTriggerOrder: h1TriggerCensus(lines, h1).triggerLines, machineAttachments: machineAtt, currentFragmentsAttached: a.currentFragmentsAttached, candidateAtHumanLine: cand, match };
});
for (const r of anchorResults) console.log(JSON.stringify(r));
for (const r of anchorResults) {
  const m = r.match;
  if (!m.attachments || m.attachedAtHumanLine || !m.candidateTextEqualsTitleSlice || !m.wholeLineTitle || !m.afterTrigger || !m.edge || !m.inKnownQueue) stop(`anchor mismatch ${r.id}`);
}
if (anchorResults[0].currentFragmentsAttached !== 2 || anchorResults[1].currentFragmentsAttached !== 1) stop('anchor attach counts differ from #404 records (H2: 2, H7: 1)');
if (ANCHORS_ONLY) process.exit(0);

// ---- census ----
const sorted = [...status].sort((a, b) => cmp(key(a), key(b)));
const pages = sorted.map(p => {
  const { a } = run(p);
  if (a.eDefined && a.headerZoneLineCountFromOutput !== a.headerZoneLineCount) stop(`header zone count differs from H1 output ${key(p)}`);
  if (a.headerZoneLineCountFromOutput !== null && a.headerZoneLineCountFromOutput !== a.headerZoneLineCount) stop(`header zone count differs from H1 output ${key(p)}`);
  if (a.candidates.some(c => !c.wholeLineTitleInOutput)) stop(`candidate not whole-line title ${key(p)}`);
  return { localPdfPath: p.localPdfPath, physicalPage: p.physicalPage, partition: p.partition, pageState: p.pageState, rightBandState: a.eDefined ? 'E_DEFINED' : 'E_UNDEFINED', ...a };
});
if (pages.length !== 82 || new Set(pages.map(key)).size !== 82) stop('coverage');
const count = <T extends string>(xs: T[]) => Object.fromEntries([...new Set(xs)].sort().map(k => [k, xs.filter(x => x === k).length]));
const sum = (ps: typeof pages, f: (p: (typeof pages)[number]) => number) => ps.reduce((s, p) => s + f(p), 0);
const allCands = pages.flatMap(p => p.candidates);
const summarize = (ps: typeof pages) => {
  const cands = ps.flatMap(p => p.candidates);
  const cp = ps.filter(p => p.candidates.length > 0);
  const by = (f: (c: (typeof allCands)[number]) => boolean) => ({ lines: cands.filter(f).length, pages: ps.filter(p => p.candidates.some(f)).length });
  return {
    pages: ps.length, byPageState: count(ps.map(p => p.pageState)), eDefinedPages: ps.filter(p => p.eDefined).length, eUndefinedPages: ps.filter(p => !p.eDefined).length,
    headerZoneLines: { eDefined: sum(ps.filter(p => p.eDefined), p => p.headerZoneLineCount), eUndefined: sum(ps.filter(p => !p.eDefined), p => p.headerZoneLineCount) },
    h1: { triggerLines: sum(ps, p => p.triggerCount), triggerPages: ps.filter(p => p.triggerCount > 0).length, negativeControlLines: sum(ps, p => p.negativeControlCount), negativeControlPages: ps.filter(p => p.negativeControlCount > 0).length, tokenlessWithoutTriggerPages: ps.filter(p => p.triggerCount === 0 && p.negativeControlCount > 0).length },
    candidates: { lines: cands.length, pages: cp.length },
    primary: { AFTER_TRIGGER: by(c => c.primary === 'HEADER_TOKENLESS_AFTER_TRIGGER'), WITHOUT_TRIGGER_CONTEXT: by(c => c.primary === 'HEADER_TOKENLESS_WITHOUT_TRIGGER_CONTEXT'),
      WITHOUT_TRIGGER_CONTEXT_noTriggerOnPage: { lines: sum(ps.filter(p => p.triggerCount === 0), p => p.candidates.length), pages: ps.filter(p => p.triggerCount === 0 && p.candidates.length > 0).length },
      WITHOUT_TRIGGER_CONTEXT_beforeFirstTrigger: { lines: sum(ps.filter(p => p.triggerCount > 0), p => p.candidates.filter(c => c.primary === 'HEADER_TOKENLESS_WITHOUT_TRIGGER_CONTEXT').length), pages: ps.filter(p => p.triggerCount > 0 && p.candidates.some(c => c.primary === 'HEADER_TOKENLESS_WITHOUT_TRIGGER_CONTEXT')).length } },
    flags: { KNOWN_FLAG_MATCH: by(c => c.knownFlagMatch), PAGE_REF_TOKENLESS: by(c => c.pageRefTokenless), OTHER_HEADER_TOKENLESS: by(c => c.otherHeaderTokenless) },
    existingKnownFlagPages: ps.filter(p => p.knownFlag).length,
    afterTriggerVsKnownFlag: { pagesWithAfterTriggerButNoFlag: ps.filter(p => p.candidates.some(c => c.primary === 'HEADER_TOKENLESS_AFTER_TRIGGER') && !p.knownFlag).length, pagesWithFlagButNoAfterTrigger: ps.filter(p => p.knownFlag && !p.candidates.some(c => c.primary === 'HEADER_TOKENLESS_AFTER_TRIGGER')).length },
    currentFragmentsAttached: sum(ps, p => p.currentFragmentsAttached),
    controls: {
      candidate_and_currentFragmentAttachment: ps.filter(p => p.diagnostic.hasCandidate && p.diagnostic.hasCurrentFragmentAttachment).length,
      candidate_and_noCurrentFragmentAttachment: ps.filter(p => p.diagnostic.hasCandidate && !p.diagnostic.hasCurrentFragmentAttachment).length,
      candidate_and_pageRef: ps.filter(p => p.diagnostic.hasCandidate && p.diagnostic.hasPageRefCandidate).length,
      candidate_and_h1Trigger: ps.filter(p => p.diagnostic.hasCandidate && p.diagnostic.hasTrigger).length,
      candidate_and_noH1Trigger: ps.filter(p => p.diagnostic.hasCandidate && !p.diagnostic.hasTrigger).length,
      noCandidate_eDefined: ps.filter(p => p.eDefined && !p.diagnostic.hasCandidate).length,
      noCandidate_eUndefined: ps.filter(p => !p.eDefined).length,
    },
    diagnosticKeys: count(ps.map(p => p.diagnostic.key)),
    mechanicallyAttachableFragments: 'NOT_DERIVED',
  };
};
const summary = summarize(pages);
const byPartition = Object.fromEntries([...new Set(pages.map(p => p.partition))].sort().map(k => [k, summarize(pages.filter(p => p.partition === k))]));
// 内部整合
const s = summary;
if (s.primary.AFTER_TRIGGER.lines + s.primary.WITHOUT_TRIGGER_CONTEXT.lines !== s.candidates.lines) stop('primary partition total');
if (s.primary.WITHOUT_TRIGGER_CONTEXT_noTriggerOnPage.lines + s.primary.WITHOUT_TRIGGER_CONTEXT_beforeFirstTrigger.lines !== s.primary.WITHOUT_TRIGGER_CONTEXT.lines) stop('without-context split total');
if (s.candidates.lines !== s.h1.negativeControlLines || s.candidates.lines !== allCands.length) stop('candidates != negativeControlLines');
if (Object.values(byPartition).reduce((x, v) => x + v.candidates.lines, 0) !== s.candidates.lines) stop('partition candidate total');
if (Object.values(s.diagnosticKeys).reduce((x, v) => x + v, 0) !== 82) stop('diagnostic key total');
if (s.existingKnownFlagPages !== queue.filter(q => q.candidateReasons.includes('KNOWN_TOKENLESS_FRAGMENT_RELEVANT')).length) stop('known flag pages != human-review-queue');
if (!eq(pages.filter(p => p.knownFlag).map(key).sort(), queue.filter(q => q.candidateReasons.includes('KNOWN_TOKENLESS_FRAGMENT_RELEVANT')).map(key).sort())) stop('known flag page set != queue');
const parts = count(pages.map(p => p.partition));
if (!eq(parts, { DEVELOPMENT_EXPLORED: 34, FIRST_HELDOUT_POSTHOC: 23, NEW_HELDOUT_POSTHOC: 25 })) stop(`partition ${JSON.stringify(parts)}`);

const doc = {
  schema: 'budget-request-toc-header-tokenless-census/v0',
  note: 'analysis-only 観測。candidate は raw line の機械的ラベルで continuation / title / column heading / 右 column 帰属を意味しない。右 text 本文は保存しない（sha256 のみ）。parser / H1 / GT / 評価 contract は変更していない',
  input: { rawTextRoot: LOGICAL_ROOT, manifest: 'tests/fixtures/budget-request-raw-text/2024/raw-text-manifest.json', verifiedArtifactSha256: Object.fromEntries([...verified].sort(([x], [y]) => cmp(x, y))), populationFixture: 'tests/fixtures/budget-request-toc-full-corpus-status/2024/full-corpus-status.json' },
  anchors: anchorResults,
  summary, byPartition,
  candidatePages: pages.filter(p => p.candidates.length > 0).map(p => key(p)),
  pages,
};
const out = `${JSON.stringify(doc, null, 1)}\n`;
if (FREEZE_DIR) { fs.mkdirSync(FREEZE_DIR, { recursive: true }); fs.writeFileSync(path.join(FREEZE_DIR, 'census.json'), out); }
console.log(JSON.stringify({ outSha256: sha256Hex(out), summary, byPartition }));
