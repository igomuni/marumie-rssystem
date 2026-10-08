/**
 * H1 の development 用 synthetic fixture（#398 の rule から作る。#396 held-out の実値・raw line は転記しない）。
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-toc-header-zone-h1-synthetic.ts [--freeze-fixture]
 */
import * as fs from 'fs';
import * as path from 'path';

const OUT = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-header-zone-right-row-h1', '2024', 'development-synthetic.json');
const E = 60;
const ln = (left: string, right = '', e = E) => (left + ' ').padEnd(e) + right;
const H0 = '令和6年度歳出概算要求額目次', H1L = '要求 区分 ページ';
const BODY = [ln('1 01-95 左の事業 3', '2 01-95 右の事業 5'), ln('   （項） 010 左の項 4', '   （項） 020 右の項 6'), ln('3 01-95 左の事業 7', '4 01-95 右の事業 9')];
type Case = { id: string; polarity: 'positive' | 'negative'; description: string; lines: string[]; expect: { triggerLineIndexes: number[]; rightKinds?: string[]; downstreamFragments?: number; pageState?: string } };
const cases: Case[] = [
  { id: 'P1-request-right', polarity: 'positive', description: 'REQUEST_TOKEN が E 以右にある header zone 行', lines: [H0, H1L, ln('総表 1', '5 01-95 右の事業 11'), ...BODY], expect: { triggerLineIndexes: [2], rightKinds: ['REQUEST_NUMBER_ROW'], pageState: 'ASSEMBLED_SPLIT' } },
  { id: 'P2-marker-right', polarity: 'positive', description: 'MARKER_TOKEN が E 以右にある header zone 行', lines: [H0, H1L, ln('総表 1', '   （項） 030 右の項 12'), ...BODY], expect: { triggerLineIndexes: [2], rightKinds: ['MARKER_ROW'], pageState: 'ASSEMBLED_SPLIT' } },
  { id: 'P3-other-code-right', polarity: 'positive', description: 'frozen の OTHER_CODE pattern に segment 全体が一致', lines: [H0, H1L, ln('総表 1', '   001 既定定員に伴う経費 3'), ...BODY], expect: { triggerLineIndexes: [2], rightKinds: ['OTHER_CODE'], pageState: 'ASSEMBLED_SPLIT' } },
  { id: 'P4-left-text-right-request', polarity: 'positive', description: 'LEFT に文字、RIGHT に request', lines: [H0, H1L, ln('あいう 見出し 12', '5 01-95 右の事業 11'), ...BODY], expect: { triggerLineIndexes: [2], rightKinds: ['REQUEST_NUMBER_ROW'], pageState: 'ASSEMBLED_SPLIT' } },
  { id: 'P5-left-blank-right-request', polarity: 'positive', description: 'LEFT が空白の行は行頭が row-start token になり header zone ではない（T2 を満たさず body 行として frozen と同じ出力）', lines: [H0, H1L, ln('', '5 01-95 右の事業 11'), ...BODY], expect: { triggerLineIndexes: [], pageState: 'ASSEMBLED_SPLIT' } },
  { id: 'P6-right-unit-fragment-owner', polarity: 'positive', description: 'H1 の RIGHT unit が直後の token なし fragment の owner 候補になる（declared downstream effect）', lines: [H0, H1L, ln('総表 1', '5 01-95 右の事業 11'), ln('1 01-95 左の事業 3', '   右の続き'), ln('   （項） 010 左の項 4', '6 01-95 右の事業 9'), ln('3 01-95 左の事業 7', '7 01-95 右の事業 10')], expect: { triggerLineIndexes: [2], rightKinds: ['REQUEST_NUMBER_ROW'], downstreamFragments: 1, pageState: 'ASSEMBLED_SPLIT' } },
  { id: 'N7-page-title-right', polarity: 'negative', description: 'E 以右に page title 相当の text のみ（row-start token なし）', lines: [H0, ln('歳出概算要求額目次', '概算要求額目次の右側'), H1L, ...BODY], expect: { triggerLineIndexes: [], pageState: 'ASSEMBLED_SPLIT' } },
  { id: 'N8-column-heading-right', polarity: 'negative', description: 'E 以右に列見出し相当の text のみ', lines: [H0, ln('要求 区分 ページ', '要求 区分 ページ'), ...BODY], expect: { triggerLineIndexes: [], pageState: 'ASSEMBLED_SPLIT' } },
  { id: 'N9-tokenless-wrapped-like', polarity: 'negative', description: 'token を持たない wrapped fragment 風の右側 text', lines: [H0, H1L, ln('総表 1', '   続きの文字列'), ...BODY], expect: { triggerLineIndexes: [], pageState: 'ASSEMBLED_SPLIT' } },
  { id: 'N10-boundary-conflict', polarity: 'negative', description: 'band 外（E+3）の request token を持つ行は BOUNDARY_CONFLICT_LINE 相当で分割しない', lines: [H0, H1L, ln('総表 あ', '5 01-95 右の事業 11', E + 3), ...BODY], expect: { triggerLineIndexes: [], pageState: 'ASSEMBLED_SPLIT' } },
  { id: 'N11-boundary-crossing', polarity: 'negative', description: 'line[E-1] と line[E] がともに非空白（BOUNDARY_CROSSING 相当）', lines: [H0, H1L, `${'z'.repeat(E)}5 01-95 右の事業 11`, ...BODY], expect: { triggerLineIndexes: [], pageState: 'ASSEMBLED_SPLIT' } },
  { id: 'N12-unsplit-page', polarity: 'negative', description: 'right evidence がなく UNSPLIT になる page', lines: [H0, H1L, ln('総表 1', '右側の見出し文字'), '1 01-95 左の事業 3', '   （項） 010 左の項 4'], expect: { triggerLineIndexes: [], pageState: 'ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE' } },
  { id: 'N13-page-abstained', polarity: 'negative', description: 'marker のみの右 column で PAGE_ABSTAINED になる page', lines: [H0, H1L, ln('総表 1', '   （項） 030 右の項 12'), ln('1 01-95 左の事業 3', '   （項） 020 右の項 6')], expect: { triggerLineIndexes: [], pageState: 'PAGE_ABSTAINED' } },
  { id: 'N14-outside-header-zone', polarity: 'negative', description: 'header zone 外（body 行の後）にある同じ token pattern', lines: [H0, H1L, ...BODY, ln('定員表 1', '5 01-95 右の事業 13')], expect: { triggerLineIndexes: [], pageState: 'ASSEMBLED_SPLIT' } },
  { id: 'N15-left-only', polarity: 'negative', description: 'E より左だけに content がある header zone 行', lines: [H0, H1L, '総表 1', ...BODY], expect: { triggerLineIndexes: [], pageState: 'ASSEMBLED_SPLIT' } },
];
const doc = {
  schema: 'budget-request-toc-header-zone-h1-development-synthetic/v0',
  note: '#398 の rule から作った synthetic。held-out の実値・raw line は含まない。expect は実装の出力ではなく rule から手で決めた期待',
  rightBandEdge: E,
  cases,
};
if (process.argv.includes('--freeze-fixture')) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, `${JSON.stringify(doc, null, 1)}\n`); }
console.log(JSON.stringify({ cases: cases.length, positive: cases.filter(c => c.polarity === 'positive').length, negative: cases.filter(c => c.polarity === 'negative').length }));
