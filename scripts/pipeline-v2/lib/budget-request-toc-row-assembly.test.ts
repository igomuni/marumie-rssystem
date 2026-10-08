import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { sha256Hex, nonEmptyLinesOf } from './budget-request-raw-text';
import { ABSTENTION_REASONS, BAND_MIN_EVIDENCE, BAND_TOLERANCE_CHARS, MARKER_TOKEN_SOURCE, OTHER_CODE_SOURCE, PAGEREF_SOURCE, REQUEST_TOKEN_SOURCE, assembleTocPage, ruleConfigSha256, type PageOut, type TocPageInput } from './budget-request-toc-row-assembly';

const mkPage = (lines: string[], over: Partial<TocPageInput> = {}): TocPageInput => {
  const text = lines.join('\n');
  return { localPdfPath: 'data/download/example.go.jp/x.pdf', pdfSha256: 'a'.repeat(64), physicalPage: 3, textSha256: sha256Hex(text), classifierSource: 'DIRECT', text, nonEmptyLines: nonEmptyLinesOf(text), ...over };
};
const E = 60;
/** 左 text を E 桁に揃え、続けて右 text を置く（右 text の先頭が band の開始 index になる） */
const ln = (left: string, right = '', e = E) => (left + ' ').padEnd(e) + right;
const rowsOf = (o: PageOut, col?: string) => o.rows.filter(r => !col || r.column === col);
const HDR = ['令和6年度歳出概算要求額目次', '要求 区分 ページ'];
const body = [
  ln('1 01-95 左の事業 3', '2 01-95 右の事業 5'),
  ln('   （項） 010 左の項 4', '   （項） 020 右の項 6'),
  ln('3 06-95 左の事業 7', '4 06-95 右の事業 9'),
];

describe('toc row assembly parser（preregistered rule のコード化。held-out には使わない）', () => {
  it('config が preregistration.json の rules と一致する（T=2, minEvidence=2, patterns, abstention）', () => {
    const pre = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024', 'preregistration.json'), 'utf8'));
    expect(BAND_TOLERANCE_CHARS).toBe(pre.rules.bandToleranceChars);
    expect(BAND_MIN_EVIDENCE).toBe(pre.rules.bandMinEvidence);
    expect(PAGEREF_SOURCE).toBe(pre.rules.patterns.PAGEREF);
    expect(REQUEST_TOKEN_SOURCE).toBe(pre.rules.patterns.REQUEST_TOKEN);
    expect(MARKER_TOKEN_SOURCE).toBe(pre.rules.patterns.MARKER_TOKEN);
    expect(OTHER_CODE_SOURCE).toBe(pre.rules.patterns.OTHER_CODE);
    expect([...ABSTENTION_REASONS]).toEqual(pre.abstentionConditions);
    expect(ruleConfigSha256()).toMatch(/^[0-9a-f]{64}$/);
  });
  it('右 band: 開始 index が T=2 以内なら 1 cluster（edge = 最小）、E+3 なら MULTIPLE_INCOMPATIBLE_BOUNDARY_CLUSTERS', () => {
    const ok = assembleTocPage(mkPage([...HDR, ln('1 01-95 a 3', '2 01-95 b 5', 60), ln('3 01-95 a 3', '4 01-95 b 5', 62)]));
    expect([ok.pageState, ok.rightBandEdge]).toEqual(['ASSEMBLED_SPLIT', 60]);
    const bad = assembleTocPage(mkPage([...HDR, ln('1 01-95 a 3', '2 01-95 b 5', 60), ln('3 01-95 a 3', '4 01-95 b 5', 63)]));
    expect([bad.pageState, bad.pageAbstentionReason, bad.rows.length]).toEqual(['PAGE_ABSTAINED', 'MULTIPLE_INCOMPATIBLE_BOUNDARY_CLUSTERS', 0]);
  });
  it('evidence が 1 件 → RIGHT_EVIDENCE_INSUFFICIENT、0 件 → NO_RIGHT_COLUMN_EVIDENCE（RIGHT を生成しない）', () => {
    const one = assembleTocPage(mkPage([...HDR, ln('1 01-95 a 3', '2 01-95 b 5'), '3 06-95 左だけ 7']));
    expect([one.pageState, one.pageAbstentionReason]).toEqual(['PAGE_ABSTAINED', 'RIGHT_EVIDENCE_INSUFFICIENT']);
    const none = assembleTocPage(mkPage([...HDR, '1 01-95 左だけ 3', '   （項） 010 項 4']));
    expect(none.pageState).toBe('ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE');
    expect(none.rightBandEdge).toBeNull();
    expect(none.rows.every(r => r.column === 'UNSPLIT')).toBe(true);
    expect(none.rows.some(r => r.column === 'RIGHT')).toBe(false);
  });
  it('marker のみの右 column は band に使わず MARKER_ONLY_RIGHT_BOUNDARY で page abstain', () => {
    const o = assembleTocPage(mkPage([...HDR, ln('1 01-95 a 3', '   （項） 020 右の項 6'), ln('2 01-95 a 4', '   （項） 030 右の項 7')]));
    expect([o.pageState, o.pageAbstentionReason]).toEqual(['PAGE_ABSTAINED', 'MARKER_ONLY_RIGHT_BOUNDARY']);
  });
  it('request / marker の分類・raw 保持（page ref の prefix も raw）・source order・provenance の再現', () => {
    const lines = [...HDR, ...body, ln('5 06-95 左の事業 国(国)1', '6 01-95 右の事業 エ 9')];
    const page = mkPage(lines);
    const o = assembleTocPage(page);
    expect(o.pageState).toBe('ASSEMBLED_SPLIT');
    const left = rowsOf(o, 'LEFT'); const right = rowsOf(o, 'RIGHT');
    expect(left.map(r => r.rowKind)).toEqual(['REQUEST_NUMBER_ROW', 'MARKER_ROW', 'REQUEST_NUMBER_ROW', 'REQUEST_NUMBER_ROW']);
    expect(right.map(r => r.rowKind)).toEqual(['REQUEST_NUMBER_ROW', 'MARKER_ROW', 'REQUEST_NUMBER_ROW', 'REQUEST_NUMBER_ROW']);
    expect(left[1]).toMatchObject({ rowStartTokenRaw: '（項）', codeRaw: '010', pageRefRaw: '4', titleRaw: '左の項' });
    expect(left[3].pageRefRaw).toBe('国(国)1');
    expect(right[3].pageRefRaw).toBe('エ 9');
    expect(left.map(r => r.sourceOrder)).toEqual([0, 1, 2, 3]);
    expect(left.map(r => r.provenance.lineIndex)).toEqual([...left.map(r => r.provenance.lineIndex)].sort((a, b) => a - b));
    for (const r of o.rows) {
      const src = nonEmptyLinesOf(page.text).find(l => l.lineIndex === r.provenance.lineIndex)!.text;
      expect(Array.from(src).slice(r.provenance.charStart, r.provenance.charEnd).join('')).toBe(r.provenance.sourceRawSlice);
      expect([r.provenance.pdfSha256, r.provenance.textSha256, r.provenance.physicalPage]).toEqual([page.pdfSha256, page.textSha256, 3]);
    }
  });
  it('header zone は最初の row-start 行の直前まで。TITLE_OR_HEADING は分割せず raw 保持', () => {
    const o = assembleTocPage(mkPage([...HDR.slice(0, 1), '令和6年度歳出概算要求額明細表   3     （項） 120 右', ...body]));
    const heads = o.rows.filter(r => r.rowKind === 'TITLE_OR_HEADING');
    expect(heads).toHaveLength(2);
    expect(heads.every(r => r.column === 'UNSPLIT' && r.state === 'RESOLVED')).toBe(true);
  });
  it('境界をまたぐ行は BOUNDARY_CROSSING、band 外の request token を持つ行は BOUNDARY_CONFLICT_LINE（推測配置しない）', () => {
    const cross = 'x'.repeat(E - 1) + '12';
    const o = assembleTocPage(mkPage([...HDR, ...body, cross]));
    const c = o.rows.find(r => r.abstentionReason === 'BOUNDARY_CROSSING')!;
    expect([c.column, c.state, c.rowKind]).toEqual(['UNSPLIT', 'ABSTAINED', 'UNKNOWN_ABSTAINED']);
    const conflict = ln('   左の続き', '6 01-95 b 5', E + 3);
    const o2 = assembleTocPage(mkPage([...HDR, ...body, conflict]));
    expect(o2.rows.some(r => r.abstentionReason === 'BOUNDARY_CONFLICT_LINE')).toBe(true);
  });
  it('OTHER_CODE は 0 始まり 3 桁 + 名称 + page ref の限定形のみ。他の 3 桁 code 形は OTHER_CODE_UNSUPPORTED_FORM、その他数字始まりは UNKNOWN_ROW_START', () => {
    const lines = [...HDR, '   001 既定定員に伴う経費 3', '   101 別の形 3', '   002 page ref なし', '12 未定義の数字始まり 3'];
    const o = assembleTocPage(mkPage(lines));
    const r = o.rows.filter(x => x.column === 'UNSPLIT' && x.provenance.lineIndex >= 2);
    expect(r[0]).toMatchObject({ rowKind: 'OTHER_CODE', codeRaw: '001', titleRaw: '既定定員に伴う経費', pageRefRaw: '3', state: 'RESOLVED' });
    expect(r[1].abstentionReason).toBe('OTHER_CODE_UNSUPPORTED_FORM');
    expect(r[2].abstentionReason).toBe('OTHER_CODE_UNSUPPORTED_FORM');
    expect(r[3].abstentionReason).toBe('UNKNOWN_ROW_START');
  });
  it('wrapped fragment: 同一 column の直前 RESOLVED row に順に attach。page ref を持つ fragment・owner 不在・barrier 越しは attach しない', () => {
    const lines = [...HDR, ln('1 01-95 左の事業 3', '2 01-95 右の事業 5'), ln('   左の続き', ''), ln('   左のさらに続き', ''), ln('', '   右の続き'), ln('8 01-95 左 6', '9 01-95 右 7'), ln('3 01-95 左 7', ''), ln('   参照付き続き 8', ''), ln('   barrier の後の続き', '')];
    const o = assembleTocPage(mkPage(lines));
    const left = rowsOf(o, 'LEFT'); const right = rowsOf(o, 'RIGHT');
    expect(left[0].fragments.map(f => f.textRaw)).toEqual(['左の続き', '左のさらに続き']);
    expect(right[0].fragments.map(f => f.textRaw)).toEqual(['右の続き']);
    expect(left[1].fragments).toEqual([]);
    expect(left.find(r => r.abstentionReason === 'FRAGMENT_WITH_PAGE_REF')).toBeDefined();
    expect(left.find(r => r.abstentionReason === 'FRAGMENT_NO_SAFE_OWNER')).toBeDefined();
  });
  it('同一 raw line の左右双方が fragment なら SIMULTANEOUS_LR_FRAGMENT で両方 abstain し、後続 fragment も owner なし', () => {
    const lines = [...HDR, ln('1 01-95 左の事業 3', '2 01-95 右の事業 5'), ln('8 01-95 左 6', '9 01-95 右 7'), ln('   左の続き', '   右の続き'), ln('   次の左続き', '   次の右続き')];
    const o = assembleTocPage(mkPage(lines));
    expect(o.rows.filter(r => r.abstentionReason === 'SIMULTANEOUS_LR_FRAGMENT')).toHaveLength(4);
    expect(o.rows.flatMap(r => r.fragments)).toEqual([]);
  });
  it('lineIndex が単調でない → SOURCE_ORDER_CONFLICT、text hash 不一致 → FROZEN_INPUT_MISMATCH（page abstain）', () => {
    const p = mkPage([...HDR, ...body]);
    const swapped = { ...p, nonEmptyLines: [p.nonEmptyLines[1], p.nonEmptyLines[0], ...p.nonEmptyLines.slice(2)] };
    expect(assembleTocPage(swapped).pageAbstentionReason).toBe('FROZEN_INPUT_MISMATCH');
    const rawOrder = { ...p, nonEmptyLines: p.nonEmptyLines.map((l, i) => (i === 1 ? { ...l, lineIndex: 0 } : l)) };
    expect(['SOURCE_ORDER_CONFLICT', 'FROZEN_INPUT_MISMATCH']).toContain(assembleTocPage(rawOrder).pageAbstentionReason);
    expect(assembleTocPage({ ...p, textSha256: 'b'.repeat(64) }).pageAbstentionReason).toBe('FROZEN_INPUT_MISMATCH');
  });
  it('決定的（同一入力で同一出力）で、row kind は #391 の taxonomy のみ、hierarchy field を持たない', () => {
    const p = mkPage([...HDR, ...body, '   001 既定定員に伴う経費 3', '12 未定義 3']);
    const a = JSON.stringify(assembleTocPage(p));
    expect(JSON.stringify(assembleTocPage(p))).toBe(a);
    const kinds = new Set(assembleTocPage(p).rows.map(r => r.rowKind));
    for (const k of kinds) expect(['REQUEST_NUMBER_ROW', 'MARKER_ROW', 'TITLE_OR_HEADING', 'OTHER_CODE', 'WRAPPED_FRAGMENT', 'UNKNOWN_ABSTAINED']).toContain(k);
    expect(a).not.toMatch(/parent|carried|PLAIN_ROW/);
  });
  it('parser module は GT fixture を読まない（firewall）', () => {
    const src = fs.readFileSync(path.join('scripts', 'pipeline-v2', 'lib', 'budget-request-toc-row-assembly.ts'), 'utf8');
    expect(src).not.toMatch(/ground-truth|visual-gt-source|annotation-ledger|heldout-candidates|PLAIN_ROW/);
  });
});

describe('development-only regression fixture（explored 34 page。held-out は未実行）', () => {
  const f = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-parser', '2024', 'development-regression.json');
  const fx = JSON.parse(fs.readFileSync(f, 'utf8'));
  it('34 page・held-out 実行 0・rule/config hash が現実装と一致し、held-out candidate を含まない', () => {
    expect([fx.developmentPages, fx.heldoutPagesExecuted]).toEqual([34, 0]);
    expect(fx.ruleConfigSha256).toBe(ruleConfigSha256());
    const held = new Set((JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024', 'heldout-candidates.json'), 'utf8')).pages as { localPdfPath: string; physicalPage: number }[]).map(p => `${p.localPdfPath}#${p.physicalPage}`));
    expect(fx.pages.filter((p: { localPdfPath: string; physicalPage: number }) => held.has(`${p.localPdfPath}#${p.physicalPage}`))).toEqual([]);
    expect(new Set(fx.pages.map((p: { localPdfPath: string; physicalPage: number }) => `${p.localPdfPath}#${p.physicalPage}`)).size).toBe(34);
  });
  const rawDir = path.join('data', 'work', 'budget-request-raw-text', '2024');
  it.skipIf(!fs.existsSync(rawDir))('Raw Text が手元にあれば development 出力 hash が fixture と再現する（決定性）', () => {
    const raw = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'), 'utf8')) as { documents: { localPdfPath: string; artifactPath: string }[] };
    const docs = new Map(raw.documents.map(d => [d.localPdfPath, d]));
    for (const p of fx.pages.slice(0, 5) as { localPdfPath: string; physicalPage: number; pdfSha256?: string; classifierSource: 'DIRECT' | 'INHERITED'; outputSha256: string }[]) {
      const pg = fs.readFileSync(path.join(rawDir, docs.get(p.localPdfPath)!.artifactPath), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))[p.physicalPage - 1];
      const inv = (JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-toc-physical-row', '2024', 'candidate-inventory.json'), 'utf8')).pages as { localPdfPath: string; physicalPage: number; pdfSha256: string }[]).find(x => x.localPdfPath === p.localPdfPath && x.physicalPage === p.physicalPage)!;
      const out = assembleTocPage({ localPdfPath: p.localPdfPath, pdfSha256: inv.pdfSha256, physicalPage: p.physicalPage, textSha256: pg.textSha256, classifierSource: p.classifierSource, text: pg.text, nonEmptyLines: pg.nonEmptyLines });
      expect(sha256Hex(JSON.stringify(out))).toBe(p.outputSha256);
    }
  });
});
