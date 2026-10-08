import { describe, expect, it } from 'vitest';
import { nonEmptyLinesOf, sha256Hex } from './budget-request-raw-text';
import { assembleTocPage, type TocPageInput } from './budget-request-toc-row-assembly';
import { aggregate, evaluatePage, finalJudgment, type GtPage, type GtRow } from './budget-request-toc-row-assembly-evaluator';

// synthetic fixtures のみ（held-out の値・出力は使わない）
const E = 60;
const ln = (left: string, right = '', e = E) => (left + ' ').padEnd(e) + right;
const mkInput = (lines: string[]): TocPageInput => { const text = lines.join('\n'); return { localPdfPath: 'x/a.pdf', pdfSha256: 'a'.repeat(64), physicalPage: 3, textSha256: sha256Hex(text), classifierSource: 'DIRECT', text, nonEmptyLines: nonEmptyLinesOf(text) }; };
const rawOf = (i: TocPageInput) => ({ pdfSha256: i.pdfSha256, textSha256: i.textSha256, lines: i.nonEmptyLines });
const row = (column: 'LEFT' | 'RIGHT', order: number, kind: string, o: Partial<GtRow> = {}): GtRow => ({ rowId: `x/a.pdf#3:${column}:${order}`, column, orderInColumn: order, rowKindVisual: kind, requestNumberVisualToken: null, codeVisual: null, markerVisual: null, pageRefVisual: null, wrappedFragmentCount: 0, ...o });
const Q = (column: 'LEFT' | 'RIGHT', order: number, n: string, extra: Partial<GtRow> = {}) => row(column, order, 'REQUEST_NUMBER_ROW', { requestNumberVisualToken: n, codeVisual: '01-95', pageRefVisual: '3', ...extra });
const M = (column: 'LEFT' | 'RIGHT', order: number, code: string, extra: Partial<GtRow> = {}) => row(column, order, 'MARKER_ROW', { markerVisual: '（項）', codeVisual: code, pageRefVisual: '4', ...extra });
const gtPage = (rows: GtRow[], right: 'ROWS' | 'BLANK_NO_ROWS', fragments: GtPage['fragments'] = []): GtPage => ({ localPdfPath: 'x/a.pdf', pdfSha256: 'a'.repeat(64), physicalPage: 3, textSha256: '', classifierSource: 'DIRECT', rightColumnVisual: right, gtPageComplete: true, rows, fragments });
const HDR = ['令和6年度歳出概算要求額目次', '要求 区分 ページ'];
const BODY = [ln('1 01-95 左の事業 3', '2 01-95 右の事業 5'), ln('   （項） 010 左の項 4', '   （項） 020 右の項 6'), ln('3 01-95 左の事業 7', '4 01-95 右の事業 9')];
const baseGt = () => [Q('LEFT', 1, '1'), M('LEFT', 2, '010'), Q('LEFT', 3, '3'), Q('RIGHT', 1, '2'), M('RIGHT', 2, '020'), Q('RIGHT', 3, '4')];
const run = (lines: string[], gt: GtPage) => { const i = mkInput(lines); const gp = { ...gt, textSha256: i.textSha256 }; return evaluatePage(gp, assembleTocPage(i), rawOf(i), ['s']); };
const sev = (r: ReturnType<typeof run>, fam: string) => r.instances.filter(x => x.family === fam).length;

describe('toc row assembly evaluator（synthetic。#395 amendment の機械化。held-out は使わない）', () => {
  it('完全一致: 全 row CORRECT、severe 0、page CORRECT', () => {
    const r = run([...HDR, ...BODY], gtPage(baseGt(), 'ROWS'));
    expect(r.rowStates).toEqual({ CORRECT: 6, INCORRECT: 0, ABSTAINED: 0, UNRESOLVED: 0 });
    expect(r.pageOutcome.state).toBe('CORRECT');
    expect(['FALSE_POSITIVE_ROW_ASSEMBLY', 'WRONG_COLUMN_ASSIGNMENT', 'WRONG_FRAGMENT_ATTACHMENT', 'PROVENANCE_MISMATCH'].map(f => sev(r, f))).toEqual([0, 0, 0, 0]);
  });
  it('column 不一致: identity は一致し、対応後に WRONG_COLUMN_ASSIGNMENT（欠落 + 余剰にならない）', () => {
    const gt = baseGt(); gt[3] = Q('LEFT', 4, '2');
    const r = run([...HDR, ...BODY], gtPage(gt, 'ROWS'));
    expect(sev(r, 'WRONG_COLUMN_ASSIGNMENT')).toBe(1);
    expect(sev(r, 'FALSE_POSITIVE_ROW_ASSEMBLY')).toBe(0);
    expect(r.rowStates.INCORRECT).toBe(1); expect(r.matchedRows).toBe(6);
  });
  it('parser-only extra は FALSE_POSITIVE、GT 側にだけある row は OMITTED_SILENTLY（severe ではない）', () => {
    const extra = run([...HDR, ...BODY], gtPage(baseGt().slice(0, 5), 'ROWS'));
    expect(sev(extra, 'FALSE_POSITIVE_ROW_ASSEMBLY')).toBe(1);
    const miss = run([...HDR, ...BODY], gtPage([...baseGt(), Q('LEFT', 4, '99')], 'ROWS'));
    expect(miss.omittedSilently).toBe(1); expect(sev(miss, 'FALSE_POSITIVE_ROW_ASSEMBLY')).toBe(0);
  });
  it('duplicate key は group の件数・column 多重集合で deterministic（occurrence・順序に依存しない）', () => {
    const lines = [...HDR, ln('1 01-95 a 3', '2 01-95 b 5'), ln('   （項） 010 左 4', '   （項） 010 右 4'), ln('3 01-95 a 7', '4 01-95 b 9')];
    const gt = [Q('LEFT', 1, '1'), M('LEFT', 2, '010'), Q('LEFT', 3, '3'), Q('RIGHT', 1, '2'), M('RIGHT', 2, '010'), Q('RIGHT', 3, '4')];
    const ok = run(lines, gtPage(gt, 'ROWS'));
    expect(ok.groups.find(g => g.key.startsWith('M|'))).toMatchObject({ n: 2, m: 2, matched: 2, wrongColumn: 0 });
    const gt2 = gt.map(r => (r.markerVisual && r.column === 'RIGHT' ? { ...r, column: 'LEFT' as const } : r));
    expect(sev(run(lines, gtPage(gt2, 'ROWS')), 'WRONG_COLUMN_ASSIGNMENT')).toBe(1);
    const gt3 = gt.slice(0, 5); // GT の重複が 1 件少ない → parser の余剰
    expect(sev(run(lines, gtPage(gt3, 'ROWS')), 'FALSE_POSITIVE_ROW_ASSEMBLY')).toBeGreaterThanOrEqual(1);
  });
  it('header zone の TITLE_OR_HEADING が右 column の row を統合 → FALSE_POSITIVE（例外なし）', () => {
    const lines = ['令和6年度歳出概算要求額目次', ln('令和6年度歳出概算要求額総表 1', '   （項） 120 右の項 9'), ...BODY];
    const gt = [...baseGt(), M('RIGHT', 0, '120')];
    const r = run(lines, gtPage(gt, 'ROWS'));
    expect(r.instances.filter(x => x.family === 'FALSE_POSITIVE_ROW_ASSEMBLY' && x.reason === 'MERGE').length).toBe(1);
  });
  it('UNSPLIT で GT の右 column が ROWS → 右 row は UNRESOLVED（NO_EVIDENCE_BUT_VISUAL_RIGHT_PRESENT）、severe に数えない', () => {
    const lines = [...HDR, '1 01-95 左の事業 3', '   （項） 010 左の項 4'];
    const gt = [Q('LEFT', 1, '1'), M('LEFT', 2, '010'), Q('RIGHT', 1, '2')];
    const r = run(lines, gtPage(gt, 'ROWS'));
    expect(r.pageOutcome).toEqual({ state: 'UNRESOLVED', reason: 'NO_EVIDENCE_BUT_VISUAL_RIGHT_PRESENT' });
    expect(r.rowStates).toMatchObject({ CORRECT: 2, UNRESOLVED: 1 });
    expect(r.instances.filter(x => x.family === 'NO_EVIDENCE_BUT_VISUAL_RIGHT_PRESENT')).toHaveLength(1);
    expect(r.rowNotComparable.columnUnclaimed).toBe(2);
    expect(sev(r, 'FALSE_POSITIVE_ROW_ASSEMBLY') + sev(r, 'WRONG_COLUMN_ASSIGNMENT')).toBe(0);
    const blank = run(lines, gtPage(gt.slice(0, 2), 'BLANK_NO_ROWS'));
    expect(blank.pageOutcome.state).toBe('NOT_COMPARABLE');
  });
  it('PLAIN_ROW は NOT_COMPARABLE（四状態に数えない・mapping なし）', () => {
    const plain = row('LEFT', 0, 'PLAIN_ROW', { pageRefVisual: '1' });
    const r = run([...HDR, ...BODY], gtPage([plain, ...baseGt()], 'ROWS'));
    expect(r.rowNotComparable.plainRow).toBe(1);
    expect(r.gtComparableRows).toBe(6);
    expect(Object.values(r.rowStates).reduce((a, b) => a + b, 0)).toBe(6);
  });
  it('fragment: 対応済み owner の fragment は CORRECT、GT 件数を超える attach は WRONG_FRAGMENT_ATTACHMENT', () => {
    const lines = [...HDR, ln('1 01-95 左の事業 3', '2 01-95 右の事業 5'), ln('   左の続き', ''), ln('3 01-95 a 7', '4 01-95 b 9')];
    const g1 = [Q('LEFT', 1, '1', { wrappedFragmentCount: 1 }), Q('LEFT', 2, '3'), Q('RIGHT', 1, '2'), Q('RIGHT', 2, '4')];
    const ok = run(lines, gtPage(g1, 'ROWS', [{ fragmentId: 'f1', ownerRowId: g1[0].rowId, column: 'LEFT', orderInOwner: 1 }]));
    expect(ok.fragments).toMatchObject({ gt: 1, correct: 1, wrongAttachment: 0 });
    const g2 = g1.map(r => ({ ...r, wrappedFragmentCount: 0 }));
    expect(run(lines, gtPage(g2, 'ROWS')).fragments.wrongAttachment).toBe(1);
  });
  it('provenance は Raw Text と機械照合され、不一致は PROVENANCE_MISMATCH', () => {
    const i = mkInput([...HDR, ...BODY]);
    const out = assembleTocPage(i);
    const bad = { ...out, rows: out.rows.map((u, k) => (k === 3 ? { ...u, provenance: { ...u.provenance, sourceRawSlice: u.provenance.sourceRawSlice + 'x' } } : u)) };
    const r = evaluatePage({ ...gtPage(baseGt(), 'ROWS'), textSha256: i.textSha256 }, bad, rawOf(i), []);
    expect(sev(r, 'PROVENANCE_MISMATCH')).toBe(1);
    expect(run([...HDR, ...BODY], gtPage(baseGt(), 'ROWS')).provenance.mismatches).toBe(0);
  });
  it('page abstain は GT row を ABSTAINED、OTHER_CODE unit は UNRESOLVED で pass をブロックする', () => {
    const one = run([...HDR, ln('1 01-95 a 3', '2 01-95 b 5')], gtPage([Q('LEFT', 1, '1'), Q('RIGHT', 1, '2')], 'ROWS'));
    expect(one.pageOutcome).toEqual({ state: 'ABSTAINED', reason: 'RIGHT_EVIDENCE_INSUFFICIENT' });
    expect(one.rowStates.ABSTAINED).toBe(2);
    const oc = run([...HDR, '   001 既定定員に伴う経費 3'], gtPage([], 'BLANK_NO_ROWS'));
    const agg = aggregate([oc]);
    expect(agg.blockingUnresolved.count).toBe(1);
    expect(finalJudgment(true, agg.severe.total, agg.blockingUnresolved.count)).toBe('REVIEW_REQUIRED');
  });
  it('final judgment の優先順位: STOP_PROTOCOL > STOP_SAFETY > REVIEW_REQUIRED > SAFETY_PASS', () => {
    expect(finalJudgment(false, 3, 2)).toBe('STOP_PROTOCOL');
    expect(finalJudgment(true, 1, 2)).toBe('STOP_SAFETY');
    expect(finalJudgment(true, 0, 1)).toBe('REVIEW_REQUIRED');
    expect(finalJudgment(true, 0, 0)).toBe('SAFETY_PASS_COVERAGE_REPORTED');
  });
  it('aggregate は coverage の分子・分母を amendment の定義どおりに返す', () => {
    const r = run([...HDR, ...BODY], gtPage(baseGt(), 'ROWS'));
    const a = aggregate([r]);
    expect(a.coverage.pageResolutionCoverage).toMatchObject({ numerator: 1, denominator: 1 });
    expect(a.coverage.physicalRowCoverage).toMatchObject({ numerator: 6, denominator: 6 });
    expect(a.coverage.comparableRowClassificationCoverage).toMatchObject({ numerator: 6, denominator: 6 });
    expect(a.rows.notComparable.classification).toBe(6);
  });
});
