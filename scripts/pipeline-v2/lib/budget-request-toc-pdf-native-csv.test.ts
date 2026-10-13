import { describe, expect, it } from 'vitest';
import type { PageMeta, SourceToken } from './budget-request-source-token';
import { convertTocPage, csvEscape, joinLabel, renderCsv, renderMainCsv, type PageResult } from './budget-request-toc-pdf-native-csv';

const META: PageMeta = { number: 2, numPages: 5, view: [0, 0, 842, 595], rotate: 0, width: 842, height: 595 };
const FS = 6.9;
const SHA = 'a'.repeat(64);

/** 合成 SourceToken。baseline は左上原点のベースライン y。幅は指定しなければ文字数×FS */
function tok(index: number, rawText: string, xMin: number, baseline: number, xMax?: number): SourceToken {
  const width = xMax === undefined ? Math.max(rawText.length, 1) * FS : xMax - xMin;
  return {
    index,
    rawText,
    page: META.number,
    bbox: { xMin, xMax: xMin + width, yMin: baseline - FS * 0.9, yMax: baseline + FS * 0.2 },
    transform: [FS, 0, 0, FS, xMin, META.height - baseline],
    width,
    fontSize: FS,
    fontName: 'g_d0_f1',
    hasEOL: false,
    dir: 'ltr',
  };
}

/** 実PDFに倣った見出し帯: 要求/番号/区/分/ページ ×左右（境界は 414.5 付近） */
function header(start: number): SourceToken[] {
  return [
    tok(start, '要求', 33, 86, 47), tok(start + 1, '要求', 416, 86, 430),
    tok(start + 2, '区', 148, 89, 155), tok(start + 3, '分', 280, 89, 287),
    tok(start + 4, 'ページ', 393, 89, 413), tok(start + 5, '区', 531, 89, 538),
    tok(start + 6, '分', 663, 89, 670), tok(start + 7, 'ページ', 776, 89, 796),
    tok(start + 8, '番号', 33, 93, 47), tok(start + 9, '番号', 416, 93, 430),
  ];
}
/** 左列の1行: 要求番号 / コード / タイトル / ページ（右端 411） */
function leftRow(i: number, y: number, no: string, code: string, title: string, page: string): SourceToken[] {
  const out = [tok(i, no, 38, y, 41.4), tok(i + 1, code, 55, y, 72.6), tok(i + 2, title, 79.4, y), tok(i + 3, page, 411 - page.length * 3.5, y, 411)];
  return no === '' ? out.slice(1) : out;
}
function rightRow(i: number, y: number, no: string, code: string, title: string, page: string): SourceToken[] {
  const out = [tok(i, no, 419, y, 426), tok(i + 1, code, 438, y, 456), tok(i + 2, title, 462, y), tok(i + 3, page, 794 - page.length * 3.5, y, 794)];
  return no === '' ? out.slice(1) : out;
}
const page = (tokens: SourceToken[]): PageResult => convertTocPage({ pdfSha256: SHA, physicalPage: 2, meta: META, tokens });
const texts = (r: PageResult) => r.entries.map(e => [e.requestNumber, e.label, e.pageRef]);

describe('列分離と行', () => {
  it('同じ高さの左右 token を1つの項目に混ぜず、列ごとに別 entry にする', () => {
    const r = page([...header(0), ...leftRow(20, 110, '1', '01-95', '左の経費', '10'), ...rightRow(30, 110, '23', '41-20', '右の経費', '94')]);
    expect(texts(r)).toEqual([['1', '01-95 左の経費', '10'], ['23', '41-20 右の経費', '94']]);
    expect(r.entries.map(e => e.side)).toEqual(['left', 'right']);
    expect(r.geometricRows).toEqual({ left: 1, right: 1 });
  });

  it('pdf.js の返却順が読み順でなくても同じ結果になり、item index が保存される', () => {
    const tokens = [...header(0), ...leftRow(20, 110, '1', '01-95', '左', '10'), ...rightRow(30, 110, '2', '06-95', '右', '11'), ...leftRow(40, 124, '2', '06-95', '次', '12')];
    const shuffled = [...tokens].reverse();
    const a = page(tokens);
    const b = page(shuffled);
    expect(b.entries).toEqual(a.entries);
    expect(b.ledger).toEqual(a.ledger);
    const e = a.entries[0];
    expect([...e.requestNumberTokenIndexes, ...e.labelTokenIndexes, ...e.pageRefTokenIndexes]).toEqual([20, 21, 22, 23]);
    expect(a.ledger.map(l => l.tokenIndex)).toEqual([...tokens.map(t => t.index)].sort((x, y) => x - y));
  });

  it('同じ要求番号・同じページ・同じタイトルが複数あっても結合せず別 entry にする', () => {
    const r = page([
      ...header(0),
      ...leftRow(20, 110, '1', '01-95', '同じ経費', '10'),
      ...leftRow(30, 124, '1', '01-95', '同じ経費', '10'),
      ...rightRow(40, 110, '1', '01-95', '同じ経費', '10'),
    ]);
    expect(r.entries).toHaveLength(3);
    expect(new Set(r.entries.map(e => e.entryId)).size).toBe(3);
    expect(r.entries.every(e => e.label === '01-95 同じ経費' && e.pageRef === '10')).toBe(true);
  });

  it('列境界をまたぐ token は unresolved にして entry に使わない', () => {
    const r = page([...header(0), ...leftRow(20, 110, '1', '01-95', '左', '10'), tok(30, 'またぐ', 400, 124, 430)]);
    expect(r.audits.map(a => a.kind)).toEqual(['COLUMN_STRADDLE']);
    expect(r.entries).toHaveLength(1);
  });

  it('同じ高さに列境界をまたぐ token がある行は、ページ参照が揃っていても左右とも entry にしない（ledger は token ごとに1回）', () => {
    const left = [tok(20, '1', 38, 110, 41.4), tok(21, '01-95', 55, 110, 72.6), tok(22, '左の前半', 79.4, 110), tok(24, '10', 400, 110, 411)];
    const right = [tok(30, '2', 419, 110, 426), tok(31, '06-95', 438, 110, 456), tok(32, '右の経費', 462, 110), tok(33, '11', 783, 110, 794)];
    const straddle = tok(23, '続きの題名', 380, 110, 440);
    const r = page([...header(0), ...left, ...right, straddle, ...leftRow(40, 124, '3', '11-95', '別の行', '12')]);
    expect(texts(r)).toEqual([['3', '11-95 別の行', '12']]);
    expect(r.audits.filter(a => a.kind === 'COLUMN_STRADDLE').flatMap(a => a.tokenIndexes).sort((x, y) => x - y)).toEqual([20, 21, 22, 23, 24, 30, 31, 32, 33]);
    expect(r.ledger.filter(l => l.tokenIndex === 23)).toHaveLength(1);
    expect(r.ledger.find(l => l.tokenIndex === 23)!.disposition).toBe('UNRESOLVED');
  });

  it('見出し（組織/項）はコードと空白1個で連結し、タイトル token 同士は原文のまま連結する', () => {
    const r = page([...header(0), tok(20, '（項）', 69, 110, 90), tok(21, '010', 97, 110, 107), tok(22, '財務本省', 114, 110, 142), tok(23, '共通費', 142, 110, 160), tok(24, '5', 407, 110, 411)]);
    expect(texts(r)).toEqual([['', '（項） 010 財務本省共通費', '5']]);
    expect(r.entries[0].shape).toBe('MARKER');
  });

  it('見出しの直後の1桁コードも見出しコードとして扱う', () => {
    expect(joinLabel([tok(0, '（勘定）', 60, 100, 90), tok(1, '1', 97, 100, 100), tok(2, 'エネルギー需給勘定', 114, 100)])).toBe('（勘定） 1 エネルギー需給勘定');
  });
});

describe('見出し・ノンブルの棄却', () => {
  it('見出し帯より上の表題・ノンブル・所管名は entry にせず、タイトルとページを近接だけで対応付けない', () => {
    const r = page([
      tok(0, '1', 790, 27, 794),
      tok(1, '令和６年度歳出概算要求額目次', 221, 47),
      tok(2, '財務省所管', 69, 67),
      tok(3, '77', 400, 67, 411),
      ...header(10),
      ...leftRow(30, 110, '1', '01-95', '本文', '10'),
    ]);
    expect(texts(r)).toEqual([['1', '01-95 本文', '10']]);
    const zone = r.ledger.filter(l => l.disposition === 'HEADER_ZONE');
    expect(zone.map(l => l.tokenIndex)).toEqual(expect.arrayContaining([0, 1, 2, 3]));
    expect(zone.find(l => l.tokenIndex === 3)!.reason).toBe('ABOVE_COLUMN_HEADER');
  });

  it('ページ参照だけの行は直前/直後のタイトルと結び付けず unresolved にする（高さが少しずれていても）', () => {
    const r = page([...header(0), tok(20, '施設整備に必要な経費', 79.4, 221), tok(21, '13', 400, 217.5, 411)]);
    expect(r.entries).toHaveLength(0);
    expect(r.audits.map(a => a.kind).sort()).toEqual(['PAGE_REF_WITHOUT_TITLE', 'UNOWNED_FRAGMENT']);
  });

  it('ページ参照のない構造行（コード付き）は NO_PAGE_REF で出さない', () => {
    const r = page([...header(0), tok(20, '4', 38, 110, 41.4), tok(21, '01-95', 55, 110, 72.6), tok(22, '施設整備に必要な経費', 79.4, 110)]);
    expect(r.entries).toHaveLength(0);
    expect(r.audits.map(a => a.kind)).toEqual(['NO_PAGE_REF']);
  });
});

describe('接頭辞つきページ参照', () => {
  it('別 token の接頭辞（エ/電/原）は原文のまま数字に連結する', () => {
    const r = page([
      ...header(0),
      tok(20, '01-95', 55, 110, 72.6), tok(21, 'タイトル甲', 79.4, 110), tok(22, 'エ', 393, 110, 400), tok(23, '12', 403, 110, 411),
      tok(30, '06-95', 55, 124, 72.6), tok(31, 'タイトル乙', 79.4, 124), tok(32, '原', 393, 124, 400), tok(33, '3', 407, 124, 411),
    ]);
    expect(r.entries.map(e => e.pageRef)).toEqual(['エ12', '原3']);
    expect(r.entries[0].pageRefTokenIndexes).toEqual([22, 23]);
  });

  it('1 token の 国(国)13 / 国 1 はスペースの有無も含めて原文どおり', () => {
    const r = page([
      ...header(0),
      tok(20, '01-95', 55, 110, 72.6), tok(21, 'タイトル甲', 79.4, 110), tok(22, '国(国)13', 392, 110, 411),
      tok(30, '06-95', 55, 124, 72.6), tok(31, 'タイトル乙', 79.4, 124), tok(32, '国 1', 397, 124, 411),
    ]);
    expect(r.entries.map(e => e.pageRef)).toEqual(['国(国)13', '国 1']);
  });

  it('ページ列帯に解釈できない token が混ざる行は PAGE_REF_AMBIGUOUS（文字を推測しない）', () => {
    const r = page([...header(0), tok(20, '01-95', 55, 110, 72.6), tok(21, 'タイトル', 79.4, 110), tok(22, '？', 393, 110, 400), tok(23, '12', 403, 110, 411)]);
    expect(r.entries).toHaveLength(0);
    expect(r.audits.map(a => a.kind)).toEqual(['PAGE_REF_AMBIGUOUS']);
  });

  it('右端が揃っていない数字（タイトル中の数字など）はページ参照にしない', () => {
    const r = page([...header(0), tok(20, '01-95', 55, 110, 72.6), tok(21, 'タイトル', 79.4, 110), tok(22, '12', 380, 110, 391)]);
    expect(r.entries).toHaveLength(0);
  });
});

describe('列の根拠がないページ', () => {
  it('見出しがないページは本文を全部 NO_COLUMN_EVIDENCE にし、entry を作らない（raw 証拠は保持）', () => {
    const body = [...leftRow(20, 110, '1', '01-95', '左', '10'), ...rightRow(30, 110, '2', '06-95', '右', '11')];
    const r = page(body);
    expect(r.columnEvidence.available).toBe(false);
    expect(r.entries).toHaveLength(0);
    expect(r.audits.every(a => a.kind === 'NO_COLUMN_EVIDENCE')).toBe(true);
    expect(r.audits.flatMap(a => a.tokenIndexes).sort((x, y) => x - y)).toEqual(body.map(t => t.index));
    expect(r.audits.flatMap(a => a.rawTexts)).toContain('左');
  });

  it('要求が2個でない/ページ見出しが欠けるページも列の根拠なしにする', () => {
    const noPage = header(0).filter(t => t.rawText !== 'ページ');
    expect(page([...noPage, ...leftRow(20, 110, '1', '01-95', '左', '10')]).columnEvidence.available).toBe(false);
    const oneRequest = header(0).filter(t => !(t.rawText === '要求' && t.bbox.xMin > 400));
    expect(page([...oneRequest, ...leftRow(20, 110, '1', '01-95', '左', '10')]).columnEvidence.available).toBe(false);
  });
});

describe('折り返し・継続の保留', () => {
  const wrapped = (): SourceToken[] => [
    ...header(0),
    ...leftRow(20, 110, '8', '01-05', '長い区分の前半', '94'),
    tok(30, '必要な経費', 79.4, 117),
    ...leftRow(40, 131, '9', '05-06', '次の区分', '95'),
  ];

  it('ページ付きの行の直後に所有者不明の断片行があるとき、前の行を完全なタイトルとして出さず候補つきで audit に残す', () => {
    const r = page(wrapped());
    expect(texts(r)).toEqual([['9', '05-06 次の区分', '95']]);
    const hold = r.audits.find(a => a.kind === 'HOLD_INCOMPLETE_TITLE')!;
    const frag = r.audits.find(a => a.kind === 'UNOWNED_FRAGMENT')!;
    expect(hold.rawTexts).toEqual(['8', '01-05', '長い区分の前半', '94']);
    expect(hold.candidateOwnerRowId).toBe(frag.rowId);
    expect(frag.rawTexts).toEqual(['必要な経費']);
    expect(frag.candidateOwnerEntryId).toBeNull(); // 保留行は entry ではない
    expect(r.entries.some(e => e.label.includes('必要な経費'))).toBe(false);
  });

  it('構造行（ページ参照なし）の次の行にページ参照がある（ページ参照が最終行にある折り返し）とき、後ろの行を単独 entry にしない', () => {
    const r = page([
      ...header(0),
      tok(20, '4', 38, 110, 41.4), tok(21, '01-95', 55, 110, 72.6), tok(22, '長い区分の前半', 79.4, 110),
      tok(30, '後半の経費', 79.4, 117), tok(31, '12', 403, 117, 411),
    ]);
    expect(r.entries).toHaveLength(0);
    expect(r.audits.map(a => a.kind).sort()).toEqual(['HOLD_POSSIBLE_CONTINUATION_TAIL', 'NO_PAGE_REF']);
    const tail = r.audits.find(a => a.kind === 'HOLD_POSSIBLE_CONTINUATION_TAIL')!;
    expect(tail.rawTexts).toEqual(['後半の経費', '12']);
    expect(tail.candidateOwnerRowId).toBe(r.audits.find(a => a.kind === 'NO_PAGE_REF')!.rowId);
  });

  it('ページ付きの行の直後に、番号のない構造風の断片（NO_PAGE_REF）が続くときは前の行を保留し、断片は候補つきで audit に残す', () => {
    const r = page([...header(0), ...leftRow(20, 110, '8', '01-05', '前半', '94'), tok(30, '010', 55, 117, 65), tok(31, '続きの語', 79.4, 117)]);
    expect(r.entries).toHaveLength(0);
    const hold = r.audits.find(a => a.kind === 'HOLD_INCOMPLETE_TITLE')!;
    const frag = r.audits.find(a => a.kind === 'NO_PAGE_REF')!;
    expect(hold.candidateOwnerRowId).toBe(frag.rowId);
    expect(frag.candidateOwnerRowId).toBe(hold.rowId);
  });

  it('次の行が独自の要求番号を持つ NO_PAGE_REF なら、前のページ付き行は保留しない', () => {
    const r = page([...header(0), ...leftRow(20, 110, '8', '01-05', '前', '94'), tok(30, '9', 38, 124, 41.4), tok(31, '02-05', 55, 124, 72.6), tok(32, '次', 79.4, 124)]);
    expect(texts(r)).toEqual([['8', '01-05 前', '94']]);
    expect(r.audits.map(a => a.kind)).toEqual(['NO_PAGE_REF']);
  });

  it('断片の後ろの番号なし行（折り返し末尾の可能性）は単独 entry にせず保留する', () => {
    const r = page([...header(0), tok(20, '前の断片', 79.4, 110), tok(30, '末尾の一部', 55, 117), tok(31, '5', 407, 117, 411)]);
    expect(r.entries).toHaveLength(0);
    expect(r.audits.map(a => a.kind)).toContain('HOLD_POSSIBLE_CONTINUATION_TAIL');
  });

  it('断片行だけのページ位置では何も結合しない', () => {
    const r = page([...header(0), tok(20, '断片だけ', 79.4, 110)]);
    expect(r.audits.map(a => a.kind)).toEqual(['UNOWNED_FRAGMENT']);
    expect(r.entries).toHaveLength(0);
  });

  it('番号なしの タイトル+ページ 行（表紙目次型）は、直前が断片でなければ出す', () => {
    const r = page([...header(0), tok(20, '令和６年度歳出概算要求額総表', 55, 110), tok(21, '1', 407, 110, 411)]);
    expect(texts(r)).toEqual([['', '令和６年度歳出概算要求額総表', '1']]);
    expect(r.entries[0].shape).toBe('TITLE_PAGE');
  });
});

describe('item の会計', () => {
  it('全 token が BLANK/HEADER_ZONE/ENTRY/UNRESOLVED のちょうど1つに入り、元の rawText が保たれる', () => {
    const tokens = [...header(0), tok(15, ' ', 130, 110, 135), tok(16, '', 140, 110, 140), ...wrappedBody()];
    const r = page(tokens);
    expect(r.ledger).toHaveLength(tokens.length);
    expect(new Set(r.ledger.map(l => l.tokenIndex)).size).toBe(tokens.length);
    expect(r.ledger.find(l => l.tokenIndex === 15)).toMatchObject({ disposition: 'BLANK', rawText: ' ' });
    for (const l of r.ledger) expect(l.rawText).toBe(tokens.find(t => t.index === l.tokenIndex)!.rawText);
    const byRef = r.ledger.filter(l => l.disposition === 'ENTRY').every(l => r.entries.some(e => e.entryId === l.ref));
    expect(byRef).toBe(true);
  });
  function wrappedBody(): SourceToken[] {
    return [...leftRow(20, 110, '1', '01-95', '甲', '10'), ...rightRow(30, 110, '2', '06-95', '乙', '11'), tok(40, '余り', 79.4, 200)];
  }

  it('同一入力から同一出力（ID・順序）', () => {
    const tokens = [...header(0), ...leftRow(20, 110, '1', '01-95', '甲', '10')];
    expect(JSON.stringify(page(tokens))).toBe(JSON.stringify(page(tokens)));
  });
});

describe('CSV', () => {
  it('カンマ・二重引用符・改行を含む値を RFC 4180 風にエスケープする', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('x\ny')).toBe('"x\ny"');
    expect(csvEscape('x\r\ny')).toBe('"x\r\ny"');
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape(null)).toBe('');
  });

  it('main CSV は 要求番号,区分,ページ の3列だけで、区分に含まれる記号が列を壊さない', () => {
    const r = page([...header(0), ...leftRow(20, 110, '1', '01-95', '甲,乙"丙"', '10')]);
    expect(renderMainCsv(r.entries)).toBe('要求番号,区分,ページ\n1,"01-95 甲,乙""丙""",10\n');
    expect(renderCsv(['a'], [])).toBe('a\n');
  });
});
