import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import type { PageOut, RowOut } from './budget-request-toc-row-assembly';
import { censusPage, censusStream, orderingAccounting, tally, type PageMeta } from './budget-request-toc-b-scope-continuity';

// synthetic のみ（data/work・PDF・raw-text は不要）
const P = 'x/a.pdf';
const META: PageMeta = { localPdfPath: P, physicalPage: 3, partition: 'SYNTH', classifierSource: 'DIRECT' };
const NOPRIOR = { present: false, pageState: null };
const prov = (lineIndex: number) => ({ localPdfPath: P, pdfSha256: 'a'.repeat(64), physicalPage: 3, textSha256: 'b'.repeat(64), lineIndex, charStart: 0, charEnd: 1, sourceRawSlice: 'x' });
type Col = 'LEFT' | 'RIGHT' | 'UNSPLIT';
let orders: Record<Col, number> = { LEFT: 0, RIGHT: 0, UNSPLIT: 0 };
const base = (column: Col, li: number, o: Partial<RowOut>): RowOut => ({ column, sourceOrder: orders[column]++, rowKind: 'TITLE_OR_HEADING', rowStartTokenRaw: null, codeRaw: null, titleRaw: 't', pageRefRaw: null, fragments: [], provenance: prov(li), state: 'RESOLVED', abstentionReason: null, ...o });
const mk = (column: Col, li: number, tok: string, code: string) => base(column, li, { rowKind: 'MARKER_ROW', rowStartTokenRaw: tok, codeRaw: code });
const item = (c: Col, li: number, code: string) => mk(c, li, '（項）', code);
const org = (c: Col, li: number, code: string) => mk(c, li, '（組織）', code);
const req = (c: Col, li: number, n: number) => base(c, li, { rowKind: 'REQUEST_NUMBER_ROW', rowStartTokenRaw: `${n}    01-95`, codeRaw: '01-95' });
const title = (c: Col, li: number) => base(c, li, {});
const unk = (c: Col, li: number) => base(c, li, { rowKind: 'UNKNOWN_ABSTAINED', state: 'ABSTAINED', abstentionReason: 'FRAGMENT_WITH_PAGE_REF' as RowOut['abstentionReason'] });
const page = (state: PageOut['pageState'], rows: RowOut[]): PageOut => { const r = rows; orders = { LEFT: 0, RIGHT: 0, UNSPLIT: 0 }; return { localPdfPath: P, pdfSha256: 'a'.repeat(64), physicalPage: 3, textSha256: 'b'.repeat(64), classifierSource: 'DIRECT', pageState: state, pageAbstentionReason: null, rightBandEdge: state === 'ASSEMBLED_SPLIT' ? 40 : null, rows: r }; };
// 行を渡す前に sourceOrder を column ごとに 0.. で採番し直す（H1 と同じ規則）
const renumber = (rows: RowOut[]): RowOut[] => { const o: Record<string, number> = {}; const sorted = [...rows].sort((a, b) => a.provenance.lineIndex - b.provenance.lineIndex); sorted.forEach(r => { r.sourceOrder = o[r.column] = (o[r.column] ?? -1) + 1; }); return rows; };
const run = (state: PageOut['pageState'], rows: RowOut[]) => censusPage(META, page(state, renumber(rows)), NOPRIOR);

describe('stream census（synthetic）', () => {
  it('ITEM→REQUEST 列→終端と gap を数える（reset とは決めない）', () => {
    orders = { LEFT: 0, RIGHT: 0, UNSPLIT: 0 };
    const s = censusStream('PAGE', renumber([title('UNSPLIT', 0), item('UNSPLIT', 1, '010'), req('UNSPLIT', 2, 1), req('UNSPLIT', 3, 2), org('UNSPLIT', 4, '020'), req('UNSPLIT', 5, 3), item('UNSPLIT', 6, '030')]));
    expect(s.requestsBeforeFirstItem).toBe(0);
    expect(s.requestsWithPriorItem).toBe(3);
    expect(s.itemSequences.map(i => [i.code, i.contiguousRequests, i.requestsBeforeNextItemOrEnd, i.terminator])).toEqual([['010', 2, 3, 'ORG'], ['030', 0, 0, 'STREAM_END']]);
    expect(s.gapSignatures).toEqual({ '-': 2, ORG: 1 });
    expect(s.gapRecords).toEqual([{ request: '3', item: '010', gap: ['ORG:020'] }]);
  });
  it('lineIndex が非単調なら strictlyIncreasing=false（配列順を信用しない）', () => {
    const rows = [item('LEFT', 5, '010'), req('LEFT', 3, 1)];
    rows.forEach((r, i) => { r.sourceOrder = i; });
    expect(censusStream('LEFT', rows).strictlyIncreasing).toBe(false);
  });
});

describe('page census（synthetic）', () => {
  it('SPLIT: P1（同一 column に先行 ITEM）と P2/P3/P4（右先頭 request・左に ITEM あり）は重複する', () => {
    const c = run('ASSEMBLED_SPLIT', [title('UNSPLIT', 0), item('LEFT', 2, '010'), req('LEFT', 3, 1), item('LEFT', 8, '020'), req('RIGHT', 2, 2), req('RIGHT', 3, 3), item('RIGHT', 4, '030'), req('RIGHT', 5, 4)]);
    expect(c.flags).toMatchObject({ P1: true, P2: true, P3: true, P3_LEFT: false, P3_RIGHT: true, P4: true, P5: false, P6: false });
    expect(c.columnStartRequestWithoutPriorItem).toEqual({ LEFT: 0, RIGHT: 2 });
    expect(c.sameColumnRequestWithPriorItem).toBe(2);
    expect(c.q2).toMatchObject({ rightStartsWithRequest: true, rightRequestsBeforeFirstItem: 2, leftHasItem: true, headingInterruptionInRightPrefix: false });
    expect(c.ordering.crossColumn).toBe('ORDER_NOT_ESTABLISHED');
    expect(c.families).toEqual(['SAME_COLUMN_CONTEXT_AVAILABLE', 'COLUMN_BOUNDARY_CONTEXT_MISSING', 'PAGE_BOUNDARY_CONTEXT_MISSING', 'ORDER_AMBIGUOUS']);
  });
  it('SPLIT: 右先頭が ITEM なら P2 なし。左先頭が request なら P3_LEFT（どちらがページ先頭かは主張しない）', () => {
    const c = run('ASSEMBLED_SPLIT', [req('LEFT', 2, 1), item('LEFT', 3, '010'), item('RIGHT', 2, '020'), req('RIGHT', 3, 2)]);
    expect(c.flags).toMatchObject({ P2: false, P3: true, P3_LEFT: true, P3_RIGHT: false, P4: true });
    expect(c.q2).toBeNull();
  });
  it('SPLIT: 右先頭 request の前に heading があれば headingInterruptionInRightPrefix', () => {
    const c = run('ASSEMBLED_SPLIT', [item('LEFT', 2, '010'), title('RIGHT', 2), req('RIGHT', 3, 2)]);
    expect(c.q2?.headingInterruptionInRightPrefix).toBe(true);
    expect(c.q2?.rightStartsWithRequest).toBe(true);
  });
  it('SPLIT: 両 column に ITEM が無ければ P4 なしで P5、右に request があれば P2', () => {
    const c = run('ASSEMBLED_SPLIT', [req('LEFT', 2, 1), req('RIGHT', 2, 2)]);
    expect(c.flags).toMatchObject({ P1: false, P2: true, P4: false, P5: true });
    expect(c.q2?.rightHasItem).toBe(false);
  });
  it('SPLIT: HEADER stream（UNSPLIT 行）は item 分析に入らず、body 内に挟まる行を数える', () => {
    const c = run('ASSEMBLED_SPLIT', [title('UNSPLIT', 0), item('LEFT', 2, '010'), title('UNSPLIT', 3), req('LEFT', 4, 1), req('RIGHT', 2, 2)]);
    expect(c.streams.map(s => s.stream)).toEqual(['LEFT', 'RIGHT', 'HEADER']);
    expect(c.ordering.headerRowsInterleavedWithBody).toBe(1);
    expect(c.streams[0].requestsWithPriorItem).toBe(1);
  });
  it('UNSPLIT: 先頭が request なら P3、column 依存の問いは COLUMN_CONTEXT_NOT_AVAILABLE（P1/P2/P4 は立てない）', () => {
    const c = run('ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE', [title('UNSPLIT', 0), req('UNSPLIT', 1, 5), item('UNSPLIT', 2, '010'), req('UNSPLIT', 3, 6), unk('UNSPLIT', 4)]);
    expect(c.flags).toMatchObject({ P1: false, P2: false, P3: true, P3_PAGE: true, P4: false, P5: false, P6: true, P6_UNSPLIT_COLUMN: true });
    expect(c.reasons).toContain('COLUMN_CONTEXT_NOT_AVAILABLE');
    expect(c.pageStartRequestBeforeFirstItem).toEqual({ PAGE: 1, LEFT: null, RIGHT: null });
    expect(c.pageLocalRequestWithPriorItem).toBe(1);
    expect(c.streams[0].itemSequences[0]).toMatchObject({ code: '010', contiguousRequests: 1, terminator: 'UNKNOWN_ABSTAINED' });
    expect(c.ordering.status).toBe('PAGE_LOCAL_LINEINDEX_ORDER');
  });
  it('UNSPLIT: ITEM が無ければ P5。ITEM の後の gap に OTHER_CODE があれば interruption として記録', () => {
    const c = run('ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE', [req('UNSPLIT', 1, 1)]);
    expect(c.flags).toMatchObject({ P3: true, P5: true });
    const d = run('ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE', [item('UNSPLIT', 1, '010'), base('UNSPLIT', 2, { rowKind: 'OTHER_CODE', rowStartTokenRaw: '001', codeRaw: '001' }), req('UNSPLIT', 3, 1)]);
    expect(d.interruptionKinds).toEqual(['OTHER_CODE']);
    expect(d.streams[0].gapSignatures).toEqual({ OTHER_CODE: 1 });
  });
  it('PAGE_ABSTAINED: units 0 → NO_A_LAYER_SEMANTIC_EVIDENCE（P6 のみ。P5 にしない・補完しない）', () => {
    const c = run('PAGE_ABSTAINED', []);
    expect(c.flags).toMatchObject({ P5: false, P6: true, P6_PAGE_ABSTAINED: true, P1: false, P2: false, P3: false });
    expect(c.ordering.status).toBe('NO_A_LAYER_SEMANTIC_EVIDENCE');
    expect(c.families).toEqual(['A_LAYER_UNAVAILABLE']);
    expect(c.streams).toEqual([]);
  });
  it('配列順と lineIndex 順の差: SPLIT は差あり（LEFT→RIGHT 連結）、UNSPLIT は差なし', () => {
    const s = run('ASSEMBLED_SPLIT', [item('LEFT', 2, '010'), item('LEFT', 8, '020'), req('RIGHT', 3, 1)]);
    const u = run('ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE', [item('UNSPLIT', 1, '010'), req('UNSPLIT', 2, 1)]);
    expect(s.ordering.arrayOrderDiffersFromLineIndex).toBe(true);
    expect(u.ordering.arrayOrderDiffersFromLineIndex).toBe(false);
    expect(s.ordering.leftRightRangesOverlap).toBe(true);
  });
  it('tally は重複を overlapMatrix で明示し、ordering accounting は stream 数を数える', () => {
    const a = run('ASSEMBLED_SPLIT', [item('LEFT', 2, '010'), req('LEFT', 3, 1), req('RIGHT', 2, 2)]);
    const b = run('PAGE_ABSTAINED', []);
    const t = tally([a, b]);
    expect(t).toMatchObject({ pages: 2, P1: 1, P2: 1, P4: 1, P6: 1, P6_PAGE_ABSTAINED: 1 });
    expect(t.overlapMatrix).toEqual({ 'P1+P2+P3+P4': 1, P6: 1 });
    expect(orderingAccounting([a, b])).toMatchObject({ pageColumnGroups: 3, strictlyIncreasing: 3, splitPages: 1, splitArrayOrderDiffers: 1 });
  });
});

describe('committed census fixture integrity（raw-text / PDF 不要）', () => {
  const f = path.join('tests', 'fixtures', 'budget-request-toc-b-layer-scope-continuity-failure-isolation', '2024', 'census.json');
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  it('82 page・partition 34/23/25・A 層 state 35/44/3', () => {
    expect(c.accounting.pages).toBe(82);
    expect(c.accounting.partitions).toEqual({ DEVELOPMENT_EXPLORED: 34, FIRST_HELDOUT_POSTHOC: 23, NEW_HELDOUT_POSTHOC: 25 });
    expect(c.accounting.pageStates).toEqual({ ASSEMBLED_SPLIT: 35, ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE: 44, PAGE_ABSTAINED: 3 });
    expect(c.pages).toHaveLength(82);
  });
  it('順序の根拠: 149 group で lineIndex 厳密増加・sourceOrder=index、SPLIT 35 で配列順差・LEFT/RIGHT 範囲重なり、UNSPLIT 差 0', () => {
    expect(c.orderingEvidence).toMatchObject({ pageColumnGroups: 149, strictlyIncreasing: 149, sourceOrderIsIndex: 149, splitArrayOrderDiffers: 35, splitLeftRightRangesOverlap: 35, unsplitArrayOrderDiffers: 0 });
  });
  it('#411 の sample 8 page の整合 check が全て合致（UNRESOLVED_CONFLICT 0）', () => {
    expect(c.validation411.checkCount).toBeGreaterThan(20);
    expect(c.validation411.mismatches).toBe(0);
  });
  it('絶対パス・環境依存値を含まない', () => {
    const text = fs.readFileSync(f, 'utf8');
    expect(text).not.toMatch(/\/Users\/|\/tmp\/|\/home\//);
  });
});
