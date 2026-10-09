/**
 * B 層 scope continuity の mechanical census（analysis-only・read-only）。parent resolver ではない。
 * commit 済み A 層 artifact（full-corpus-h1-output.json / full-corpus-status.json）と #411 の観察 fixture だけを読む。
 * raw-text / PDF / data/ は使わない。
 * 使い方: npx tsx scripts/pipeline-v2/analyze-budget-request-toc-b-scope-continuity.ts [--freeze-fixture] [--out <census.json のパス>]
 * --freeze-fixture を付けた時だけ書き込む（既定の出力先は tests/fixtures/budget-request-toc-b-layer-scope-continuity-failure-isolation/2024/census.json）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import type { PageOut } from './lib/budget-request-toc-row-assembly';
import { censusPage, orderingAccounting, questionTotals, tally, type PageCensus } from './lib/budget-request-toc-b-scope-continuity';

const FREEZE = process.argv.includes('--freeze-fixture');
const outIdx = process.argv.indexOf('--out');
const FX = (...p: string[]) => path.join('tests', 'fixtures', ...p);
const OUT = outIdx >= 0 ? process.argv[outIdx + 1] : FX('budget-request-toc-b-layer-scope-continuity-failure-isolation', '2024', 'census.json');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;
const FROZEN_OUT403 = '7d31dbb5e03b5c1984b2aa1af2c7f2ae09d74d3d213f673ee9f5f65b3e4f2316';

type Check = { sampleId: string; check: string; source: string; expected: unknown; actual: unknown; ok: boolean };

function main() {
  const outFile = FX('budget-request-toc-full-corpus-status', '2024', 'full-corpus-h1-output.json');
  const statusFile = FX('budget-request-toc-full-corpus-status', '2024', 'full-corpus-status.json');
  const outHash = sha256Hex(fs.readFileSync(outFile));
  if (outHash !== FROZEN_OUT403) throw new Error('STOP: #403 output hash mismatch');
  const parser = new Map(read<{ pages: PageOut[] }>(outFile).pages.map(p => [key(p), p]));
  const status = read<{ pages: { localPdfPath: string; physicalPage: number; partition: string; classifierSource: string; pageState: string; units: { total: number } }[] }>(statusFile);

  const pages: PageCensus[] = status.pages.map(m => {
    const pr = parser.get(key(m)); if (!pr) throw new Error(`STOP: parser output missing ${key(m)}`);
    if (pr.rows.length !== m.units.total || pr.pageState !== m.pageState) throw new Error(`STOP: status/output mismatch ${key(m)}`);
    const prev = parser.get(`${m.localPdfPath}#${m.physicalPage - 1}`);
    return censusPage({ localPdfPath: m.localPdfPath, physicalPage: m.physicalPage, partition: m.partition, classifierSource: m.classifierSource }, pr, { present: !!prev, pageState: prev ? prev.pageState : null });
  });

  const part = (p: string) => pages.filter(x => x.partition === p);
  const count = (xs: string[]) => xs.reduce((a: Record<string, number>, k) => ((a[k] = (a[k] ?? 0) + 1), a), {});
  const sortObj = (o: Record<string, number>) => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));
  const accounting = {
    pages: pages.length, partitions: sortObj(count(pages.map(p => p.partition))), pageStates: sortObj(count(pages.map(p => p.pageState))),
    classifierSourceByState: sortObj(count(pages.map(p => `${p.pageState}/${p.classifierSource}`))), statusJoinedPages: status.pages.length, outputPages: parser.size,
    distinctPdfs: new Set(pages.map(p => p.localPdfPath)).size,
    totalRows: pages.reduce((a, p) => a + p.counts.rows, 0), totalItems: pages.reduce((a, p) => a + p.counts.items, 0), totalRequests: pages.reduce((a, p) => a + p.counts.requests, 0),
    priorPageInCorpus: sortObj(count(pages.map(p => (p.priorPageInCorpus.present ? `present/${p.priorPageInCorpus.pageState}` : 'absent')))),
  };

  // ---- #411 の observation sample 8 page との整合（期待値は #411 task doc / visual-observations.json の記述に由来） ----
  const sample = read<{ samples: { sampleId: string; localPdfPath: string; physicalPage: number }[] }>(FX('budget-request-toc-b-layer-problem-observation', '2024', 'observation-sample.json'));
  const byId = new Map(sample.samples.map(s => [s.sampleId, pages.find(p => key(p) === key(s))!]));
  const checks: Check[] = [];
  const chk = (sampleId: string, check: string, source: string, expected: unknown, actual: unknown) => checks.push({ sampleId, check, source, expected, actual, ok: JSON.stringify(expected) === JSON.stringify(actual) });
  const st = (id: string, name: string) => byId.get(id)!.streams.find(s => s.stream === name)!;
  const tag = (t: { kind: string; code: string | null } | null | undefined) => (t ? `${t.kind}:${t.code}` : null);
  // BS-01: 右枠は先頭が要求21（親 marker 無し）、左末尾は項901、右枠に要求25〜27が項の直後
  chk('BS-01', 'pageState', '#411 sample', 'ASSEMBLED_SPLIT', byId.get('BS-01')!.pageState);
  chk('BS-01', 'RIGHT first semantic', '#411 O4/O5', 'REQUEST:21', tag(st('BS-01', 'RIGHT').firstSemantic));
  chk('BS-01', 'LEFT last semantic', '#411 O4', 'ITEM:901', tag(st('BS-01', 'LEFT').lastSemanticTail.at(-1)));
  chk('BS-01', 'P2 (right request before right item)', '#411 O4', true, byId.get('BS-01')!.flags.P2);
  chk('BS-01', 'RIGHT item followed by 3 contiguous requests (25-27)', '#411 §6', 3, st('BS-01', 'RIGHT').itemSequences.at(-1)?.contiguousRequests);
  chk('BS-01', 'RIGHT 定員表行(UNKNOWN_ABSTAINED) at stream tail', '#411 O5', 'UNKNOWN_ABSTAINED', st('BS-01', 'RIGHT').itemSequences.at(-1)?.terminator);
  // BS-02: UNSPLIT。先頭は組織040、末尾は項080→要求50、要求番号は38から
  chk('BS-02', 'pageState', '#411 sample', 'ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE', byId.get('BS-02')!.pageState);
  chk('BS-02', 'PAGE first semantic', '#411 O5', 'ORG:040', tag(st('BS-02', 'PAGE').firstSemantic));
  chk('BS-02', 'last ITEM 080 → 1 request, stream end', '#411 O5', { code: '080', n: 1, term: 'STREAM_END' }, (() => { const i = st('BS-02', 'PAGE').itemSequences.at(-1); return { code: i?.code, n: i?.contiguousRequests, term: i?.terminator }; })());
  chk('BS-02', 'column question not available (P6_UNSPLIT_COLUMN)', '#411 O4', true, byId.get('BS-02')!.flags.P6_UNSPLIT_COLUMN);
  chk('BS-02', 'P3 false (first request after an item)', '#411 O5', false, byId.get('BS-02')!.flags.P3);
  // BS-03: 左先頭は項020、左末尾は項180（request無し）、右先頭は request 90 で次行が組織090
  chk('BS-03', 'LEFT first semantic', '#411 O3/O5', 'ITEM:020', tag(st('BS-03', 'LEFT').firstSemantic));
  chk('BS-03', 'LEFT last semantic (no request after)', '#411 O3', 'ITEM:180', tag(st('BS-03', 'LEFT').lastSemanticTail.at(-1)));
  chk('BS-03', 'RIGHT first semantic', '#411 O3/O4', 'REQUEST:90', tag(st('BS-03', 'RIGHT').firstSemantic));
  chk('BS-03', 'RIGHT second row is 組織090', '#411 O3', 'ORG:090', st('BS-03', 'RIGHT').firstRowsKinds[1]);
  chk('BS-03', 'P2 and P4', '#411 O4', [true, true], [byId.get('BS-03')!.flags.P2, byId.get('BS-03')!.flags.P4]);
  // BS-04 / BS-08: PAGE_ABSTAINED
  for (const id of ['BS-04', 'BS-08']) { chk(id, 'PAGE_ABSTAINED / no A-layer evidence', '#411 sample/O7', ['PAGE_ABSTAINED', true, 0], [byId.get(id)!.pageState, byId.get(id)!.flags.P6_PAGE_ABSTAINED, byId.get(id)!.streams.length]); }
  // BS-05: 項155→要求1→定員表行
  chk('BS-05', 'ITEM 155 → 1 request → UNKNOWN_ABSTAINED', '#411 O3/O5', { code: '155', n: 1, term: 'UNKNOWN_ABSTAINED' }, (() => { const i = st('BS-05', 'PAGE').itemSequences.at(-1); return { code: i?.code, n: i?.contiguousRequests, term: i?.terminator }; })());
  // BS-06: 左末尾は項028→要求22、右先頭は要求23（marker無し）、右末尾は項072（子requestなし）
  chk('BS-06', 'LEFT tail ITEM:028 → REQUEST:22', '#411 O4', ['ITEM:028', 'REQUEST:22'], st('BS-06', 'LEFT').lastSemanticTail.slice(-2).map(t => tag(t)));
  chk('BS-06', 'RIGHT first semantic', '#411 O4', 'REQUEST:23', tag(st('BS-06', 'RIGHT').firstSemantic));
  chk('BS-06', 'RIGHT last semantic (no child request)', '#411 O5', 'ITEM:072', tag(st('BS-06', 'RIGHT').lastSemanticTail.at(-1)));
  // BS-07: 左先頭は親 marker 無しの request 42,43、右先頭は項440、右末尾は項020（request無し）
  chk('BS-07', 'LEFT requests before first ITEM (42, 43)', '#411 O3', 2, st('BS-07', 'LEFT').requestsBeforeFirstItem);
  chk('BS-07', 'LEFT first semantic', '#411 O5', 'REQUEST:42', tag(st('BS-07', 'LEFT').firstSemantic));
  chk('BS-07', 'RIGHT first semantic', '#411 O4', 'ITEM:440', tag(st('BS-07', 'RIGHT').firstSemantic));
  chk('BS-07', 'P3_LEFT true / P2 false', '#411 O3/O4', [true, false], [byId.get('BS-07')!.flags.P3_LEFT, byId.get('BS-07')!.flags.P2]);
  chk('BS-07', 'RIGHT last semantic (no child request)', '#411 O5', 'ITEM:020', tag(st('BS-07', 'RIGHT').lastSemanticTail.at(-1)));

  const sampleTable = sample.samples.map(s => { const p = byId.get(s.sampleId)!; return { sampleId: s.sampleId, key: key(s), pageState: p.pageState, flags: Object.entries(p.flags).filter(([, v]) => v).map(([k]) => k) }; });
  const unresolvedConflicts = checks.filter(c => !c.ok);

  const census = {
    schema: 'toc-b-layer-scope-continuity-census/v1',
    note: 'POST_HOC mechanical census。parent resolver / schema / GT / preregistration ではない。A 層 parser・evaluator・GT・#395 protocol は不変。raw-text / PDF 不使用。context 候補が「どの境界まで observable か」を数えるだけで意味を補完しない。',
    terms: { ACTIVE_ITEM_CONTEXT_CANDIDATE: '同一 stream 内の物理順（lineIndex）で REQUEST の前にある最も近い（項）marker。真の parent を意味しない', ORDER_NOT_ESTABLISHED: 'LEFT↔RIGHT の順序は A 層 provenance から確立できない', P3_PAGE: 'UNSPLIT page の PAGE stream で該当（SPLIT は P3_LEFT / P3_RIGHT。どちらがページ先頭かは主張しない）' },
    inputs: { h1OutputSha256: outHash },
    accounting,
    orderingEvidence: orderingAccounting(pages),
    tallies: { all82: tally(pages), dev34: tally(part('DEVELOPMENT_EXPLORED')), first23: tally(part('FIRST_HELDOUT_POSTHOC')), new25: tally(part('NEW_HELDOUT_POSTHOC')), split35: tally(pages.filter(p => p.pageState === 'ASSEMBLED_SPLIT')), unsplit44: tally(pages.filter(p => p.pageState === 'ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE')) },
    questions: questionTotals(pages),
    validation411: { samples: sampleTable, checks, checkCount: checks.length, mismatches: unresolvedConflicts.length },
    pages,
  };
  const text = JSON.stringify(census, null, 2) + '\n';
  console.log(JSON.stringify({ outSha256: sha256Hex(Buffer.from(text)), accounting, orderingEvidence: census.orderingEvidence, tallies: { all82: census.tallies.all82, split35: census.tallies.split35, unsplit44: census.tallies.unsplit44 }, questions: census.questions, validation411: { checkCount: checks.length, mismatches: unresolvedConflicts } }, null, 1));
  if (FREEZE) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, text); console.log(`wrote ${OUT}`); }
}
main();
