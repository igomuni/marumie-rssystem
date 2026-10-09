/**
 * #403 の human-review queue から選んだ 7 page の human observation と raw / parser / evaluation の対応付け（read-only・no-implementation）。
 * frozen H1 の出力（#403 の保存出力）・Raw Text・既存 GT・既存 evaluator を読むだけで、parser / H1 / GT / 評価 contract は変更しない。H1 の再実行は #403 の出力を再現できるかの確認のみ。
 * 使い方: npx tsx scripts/pipeline-v2/analyze-budget-request-toc-human-review-isolation.ts [--freeze-fixture]
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import { assembleTocPageH1 } from './lib/budget-request-toc-row-assembly-h1';
import { BAND_TOLERANCE_CHARS, BAND_MIN_EVIDENCE, REQUEST_TOKEN_SOURCE, MARKER_TOKEN_SOURCE, type PageOut, type RowOut, type TocPageInput } from './lib/budget-request-toc-row-assembly';
import { evaluatePage, type GtPage, type PageResult } from './lib/budget-request-toc-row-assembly-evaluator';

const FREEZE = process.argv.includes('--freeze-fixture');
const R = (...p: string[]) => path.join(...p);
const OUT = R('tests', 'fixtures', 'budget-request-toc-human-review-failure-isolation', '2024');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;
const cps = (s: string) => Array.from(s);
const isWs = (c: string | undefined) => c === undefined || /\s/u.test(c);
const cpIdx = (s: string, u: number) => Array.from(s.slice(0, u)).length;
const FROZEN_OUT403 = '7d31dbb5e03b5c1984b2aa1af2c7f2ae09d74d3d213f673ee9f5f65b3e4f2316';

const PAGES = [
  { id: 'H1', path: 'data/download/jinji.go.jp/content/900024096.pdf', page: 3 },
  { id: 'H2', path: 'data/download/maff.go.jp/j/budget/attach/pdf/230901-2.pdf', page: 3 },
  { id: 'H3', path: 'data/download/meti.go.jp/main/yosangaisan/fy2024/pdf/ippan_o.pdf', page: 4 },
  { id: 'H4', path: 'data/download/mhlw.go.jp/wp/yosan/yosan/24syokan/dl/05-2b-01.pdf', page: 4 },
  { id: 'H5', path: 'data/download/mlit.go.jp/page/content/001630995.pdf', page: 6 },
  { id: 'H6', path: 'data/download/mod.go.jp/j/budget/gaisan/r6/gaisanyoukyu.pdf', page: 4 },
  { id: 'H7', path: 'data/download/mof.go.jp/about_mof/mof_budget/budget/fy2024/2024ippan_2.pdf', page: 2 },
];

function main() {
  const outFile = R('tests', 'fixtures', 'budget-request-toc-full-corpus-status', '2024', 'full-corpus-h1-output.json');
  if (sha256Hex(fs.readFileSync(outFile)) !== FROZEN_OUT403) throw new Error('STOP: #403 output hash mismatch');
  const saved = new Map(read<{ pages: PageOut[] }>(outFile).pages.map(p => [key(p), p]));
  const inv = new Map(read<{ pages: (TocPageInput & { classifierSource: 'DIRECT' | 'INHERITED' })[] }>(R('tests', 'fixtures', 'budget-request-toc-physical-row', '2024', 'candidate-inventory.json')).pages.map(p => [key(p), p]));
  const rawM = read<{ documents: { localPdfPath: string; artifactPath: string }[] }>(R('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'));
  const docs = new Map(rawM.documents.map(d => [d.localPdfPath, d]));
  const gt = new Map([...read<{ pages: GtPage[] }>(R('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024', 'ground-truth.json')).pages, ...read<{ pages: GtPage[] }>(R('tests', 'fixtures', 'budget-request-toc-row-assembly-header-zone-right-row-h1', '2024', 'new-heldout-ground-truth.json')).pages].map(g => [key(g), g]));
  const REQ = new RegExp(REQUEST_TOKEN_SOURCE, 'gu'); const MRK = new RegExp(MARKER_TOKEN_SOURCE, 'gu');
  const result = PAGES.map(h => {
    const k = `${h.path}#${h.page}`; const meta = inv.get(k)!; const sv = saved.get(k)!;
    const pg = fs.readFileSync(R('data', 'work', 'budget-request-raw-text', '2024', docs.get(h.path)!.artifactPath), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))[h.page - 1] as { text: string; textSha256: string; nonEmptyLines: { lineIndex: number; text: string }[] };
    const input: TocPageInput = { localPdfPath: h.path, pdfSha256: meta.pdfSha256, physicalPage: h.page, textSha256: meta.textSha256, classifierSource: meta.classifierSource, text: pg.text, nonEmptyLines: pg.nonEmptyLines };
    const rerun = assembleTocPageH1(input);
    const reproduces = JSON.stringify(rerun) === JSON.stringify(sv);
    // ---- right-band evidence trace（#393 の extraction 条件の分解。判定に使うのは先頭 token でない request token ＋ 直前に数字+空白）----
    const trace = pg.nonEmptyLines.flatMap(l => {
      const chars = cps(l.text); const first = chars.findIndex(c => !isWs(c));
      return [...l.text.matchAll(REQ)].map(m => {
        const start = cpIdx(l.text, m.index as number);
        const before = l.text.slice(0, m.index as number);
        const precededByDigitsWs = /\d{1,4}\s+$/u.test(before);
        const isFirstToken = start <= first;
        return { lineIndex: l.lineIndex, charIndex: start, token: m[0], isFirstTokenOnLine: isFirstToken, precededByDigitsAndWhitespace: precededByDigitsWs, countedAsEvidence: !isFirstToken && precededByDigitsWs };
      });
    });
    const markerCandidates = pg.nonEmptyLines.flatMap(l => { const chars = cps(l.text); const first = chars.findIndex(c => !isWs(c)); return [...l.text.matchAll(MRK)].filter(m => /\d{1,4}\s+$/u.test(l.text.slice(0, m.index as number)) && cpIdx(l.text, m.index as number) > first).map(m => ({ lineIndex: l.lineIndex, charIndex: cpIdx(l.text, m.index as number), token: m[0] })); });
    const counted = trace.filter(t => t.countedAsEvidence);
    const uncountedNonFirst = trace.filter(t => !t.isFirstTokenOnLine && !t.precededByDigitsAndWhitespace);
    const hist: Record<number, { all: number; counted: number }> = {}; for (const t of trace) { hist[t.charIndex] = hist[t.charIndex] ?? { all: 0, counted: 0 }; hist[t.charIndex].all++; if (t.countedAsEvidence) hist[t.charIndex].counted++; }
    // ---- fragment 対応（owner・attach・abstain）----
    const units = sv.rows;
    const attached = units.filter(u => u.fragments.length > 0).map(u => ({ owner: { column: u.column, sourceOrder: u.sourceOrder, rowKind: u.rowKind, rowStartTokenRaw: u.rowStartTokenRaw, lineIndex: u.provenance.lineIndex }, fragments: u.fragments.map(f => ({ lineIndex: f.provenance.lineIndex, charStart: f.provenance.charStart, charEnd: f.provenance.charEnd, text: f.textRaw })) }));
    const abstained = units.filter(u => u.state === 'ABSTAINED').map(u => ({ column: u.column, lineIndex: u.provenance.lineIndex, reason: u.abstentionReason, slice: u.provenance.sourceRawSlice }));
    const titles = units.filter(u => u.rowKind === 'TITLE_OR_HEADING').map(u => ({ column: u.column, lineIndex: u.provenance.lineIndex, slice: u.provenance.sourceRawSlice.slice(0, 60) }));
    const g = gt.get(k);
    let ev: PageResult | null = null; let gtFragments: unknown = null;
    if (g) {
      ev = evaluatePage(g, sv, { pdfSha256: input.pdfSha256, textSha256: input.textSha256, lines: input.nonEmptyLines }, []);
      const rowById = new Map(g.rows.map(r => [r.rowId, r]));
      gtFragments = g.fragments.map(f => { const o = rowById.get(f.ownerRowId)!; return { fragmentId: f.fragmentId, ownerRowId: f.ownerRowId, ownerKey: o.rowKindVisual === 'REQUEST_NUMBER_ROW' ? `REQUEST ${o.requestNumberVisualToken}` : `MARKER ${o.markerVisual} ${o.codeVisual}`, ownerColumn: o.column, orderInOwner: f.orderInOwner }; });
    }
    return {
      id: h.id, localPdfPath: h.path, physicalPage: h.page, classifierSource: meta.classifierSource, reproducesSaved403Output: reproduces, pageState: sv.pageState, rightBandEdge: sv.rightBandEdge, pageAbstentionReason: sv.pageAbstentionReason,
      unitCounts: { total: units.length, LEFT: units.filter(u => u.column === 'LEFT').length, RIGHT: units.filter(u => u.column === 'RIGHT').length, UNSPLIT: units.filter(u => u.column === 'UNSPLIT').length },
      evidence: { bandMinEvidence: BAND_MIN_EVIDENCE, bandToleranceChars: BAND_TOLERANCE_CHARS, requestTokenCandidatesAll: trace.length, requestTokenStartHistogram: hist, countedEvidence: counted.length, countedEvidenceDetail: counted, notCounted: trace.filter(t => !t.countedAsEvidence).length, uncountedNonFirstTokens: uncountedNonFirst, notCountedByReason: { firstTokenOnLine: trace.filter(t => t.isFirstTokenOnLine).length, notPrecededByDigitsAndWhitespace_nonFirst: trace.filter(t => !t.isFirstTokenOnLine && !t.precededByDigitsAndWhitespace).length }, markerCandidatesNotInBand: markerCandidates, candidateE: counted.length ? Math.min(...counted.map(t => t.charIndex)) : null, clusterSpread: counted.length ? Math.max(...counted.map(t => t.charIndex)) - Math.min(...counted.map(t => t.charIndex)) : null },
      fragmentAttachments: attached, abstainedUnits: abstained, titleUnits: titles,
      gt: g ? { available: true, fragments: gtFragments, evaluation: { groupsNotOneToOne: ev!.groups.filter(x => !(x.n === 1 && x.m === 1)), pageOutcome: ev!.pageOutcome, rowStates: ev!.rowStates, fragments: ev!.fragments, instances: ev!.instances.filter(i => i.family !== 'ABSTAINED_ROW').map(i => ({ family: i.family, gtRowId: i.gtRowId ?? null, gtKey: i.gtKey ?? null, parserUnit: i.parserUnit ?? null, state: i.state ?? null })) } } : { available: false },
      rawLineCount: pg.nonEmptyLines.length,
    };
  });
  const doc = { schema: 'budget-request-toc-human-review-failure-isolation-observations/v0', note: 'read-only 観測（原因の確定は mechanism status で区別）。parser / H1 / GT / 評価 contract は変更していない', frozen: { full_corpus_h1_output_403_sha256: FROZEN_OUT403 }, pages: result };
  if (FREEZE) fs.writeFileSync(R(OUT, 'observations.json'), `${JSON.stringify(doc, null, 1)}\n`);
  for (const r of result) console.log(JSON.stringify({ id: r.id, repro: r.reproducesSaved403Output, state: r.pageState, E: r.rightBandEdge, abst: r.pageAbstentionReason, units: r.unitCounts, ev: { all: r.evidence.requestTokenCandidatesAll, counted: r.evidence.countedEvidence, byReason: r.evidence.notCountedByReason, markerCand: r.evidence.markerCandidatesNotInBand.length, candE: r.evidence.candidateE, spread: r.evidence.clusterSpread }, attached: r.fragmentAttachments.map(a => [a.owner.rowStartTokenRaw, a.owner.lineIndex, a.fragments.map(f => f.lineIndex)]), abstained: r.abstainedUnits.map(a => [a.lineIndex, a.reason]), gt: r.gt.available ? { frags: (r.gt as any).fragments, evalFrags: (r.gt as any).evaluation.fragments, inst: (r.gt as any).evaluation.instances } : null }));
}
main();
