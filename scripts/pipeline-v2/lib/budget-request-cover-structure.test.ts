import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { comparisonCharacterSequence, parseCoverPage } from './budget-request-cover-structure';

const SRC = { filePath: 'a.pdf', fileSha256: 'f', physicalPage: 1, textSha256: 't' };
const L = (s: string) => s.split('\n').filter(l => l.trim()).map(text => ({ text }));
const parse = (s: string) => parseCoverPage(SRC, L(s));

// 以下は Raw Text で観測済みの development data（PR-3A 探索済み page 由来の raw line。visual GT ではない）
const OBSERVED_GENERAL = `19 内 閣 府 所 管
   令   和    ６       年      度      歳      出      概      算       要         求   書
        1. 令和６年度歳出概算要求額総表 ・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・   1
        2. 令和６年度歳出概算要求額明細表 ・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・     3
           （組織）022 科学技術・イノベーション ・・・・・・・・・・・・・・・・・・・・・・・・・・           3
                   推進事務局`;
const OBSERVED_WORDSPLIT = `25 厚生労働省所管
  令   和   ６       年      度      歳      出      概      算      要          求   書
      1. 令和６年度歳出概算要求額総表 ・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・   1
      2. 令和６年度歳出概算要求額明細表 ・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・ 13
         （組織）010 厚 生 労 働 本 省 ・・・・・・・・・・・・・・・・・・・・・・・・・・ 13
         （組織）050 国立障害者リハビリテーシ ・・・・・・・・・・・・・・・・・・・・・・・・・・ 1462
                 ョンセンター
         （組織）070 地   方    厚   生    局 ・・・・・・・・・・・・・・・・・・・・・・・・・・ 1547`;
const OBSERVED_SPECIAL_STAFFING = `9101 東 日 本 大 震 災 復 興 特 別 会 計 （法務省）
   令   和     ６      年       度       歳      出       概       算      要          求   書
        1. 令和６年度歳出概算要求額総表 ・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・       1
        2. 令和６年度歳出概算要求額明細表 ・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・         3
           （会計）01 東 日 本 大 震 災 復 興 ・・・・・・・・・・・・・・・・・・・・・・・・・・         3
        3. 令和６年度概算要求定員表 ・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・   7`;
const OBSERVED_NONNUMERIC_REF = `02 国   会   所    管 （国立国会図書館）
   令       和    ６      年       度      歳       出      概       算      要       求       書
           1. 令和６年度歳出概算要求額総表 ・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・ 国         1
           2. 令和６年度歳出概算要求額明細表 ・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・ 国(国) 1
              （組織）030 国 立 国 会 図 書 館 ・・・・・・・・・・・・・・・・・・・・・・・・・・ 国(国) 1
           3. 令和６年度概算要求定員表 ・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・ 国(国) 13`;

describe('cover structure v0 parser（observed development data / synthetic を区別）', () => {
  it('[observed] header code/text・title・SECTION/SCOPE を source order で取り出し、provenance を保持する', () => {
    const o = parse(OBSERVED_GENERAL);
    expect(o.source).toEqual(SRC);
    expect(o.header).toMatchObject({ codeRaw: '19', textRawParts: ['内 閣 府 所 管'], status: 'RESOLVED' });
    expect(o.header.titleRawParts[0].replace(/\s/g, '')).toBe('令和６年度歳出概算要求書');
    expect(o.entries.map(e => e.kind)).toEqual(['SECTION_REFERENCE', 'SECTION_REFERENCE', 'SCOPE_REFERENCE']);
    expect(o.entries[0]).toMatchObject({ ordinalRaw: '1.', labelRawParts: ['令和６年度歳出概算要求額総表'], printedPageRefRaw: '1' });
  });
  it('[observed] multiline scope name は preregistered continuation rule で追加 part とし、連結・補完しない', () => {
    const e = parse(OBSERVED_GENERAL).entries[2];
    expect(e).toMatchObject({ kind: 'SCOPE_REFERENCE', markerRaw: '（組織）', codeRaw: '022', nameRawParts: ['科学技術・イノベーション', '推進事務局'], printedPageRefRaw: '3' });
  });
  it('[observed] 語途中の分断も parts のまま保持し、次の marker 行は continuation にしない', () => {
    const o = parse(OBSERVED_WORDSPLIT);
    const scopes = o.entries.filter(e => e.kind === 'SCOPE_REFERENCE') as Extract<(typeof o.entries)[number], { kind: 'SCOPE_REFERENCE' }>[];
    expect(scopes.map(s => s.nameRawParts)).toEqual([['厚 生 労 働 本 省'], ['国立障害者リハビリテーシ', 'ョンセンター'], ['地   方    厚   生    局']]);
    expect(scopes.map(s => s.printedPageRefRaw)).toEqual(['13', '1462', '1547']);
  });
  it('[observed] 定員表 section は任意で、特会は（会計）marker・4 桁 code', () => {
    const o = parse(OBSERVED_SPECIAL_STAFFING);
    expect(o.header.codeRaw).toBe('9101');
    expect(o.entries.map(e => (e.kind === 'SECTION_REFERENCE' ? e.ordinalRaw : e.markerRaw))).toEqual(['1.', '2.', '（会計）', '3.']);
    expect(parse(OBSERVED_GENERAL).entries.some(e => e.kind === 'SECTION_REFERENCE' && e.ordinalRaw === '3.')).toBe(false);
  });
  it('[observed] 数字のみでない printed page 参照は文字列のまま保持する', () => {
    const refs = parse(OBSERVED_NONNUMERIC_REF).entries.map(e => e.printedPageRefRaw);
    expect(refs).toEqual(['国         1', '国(国) 1', '国(国) 1', '国(国) 13']);
  });
  it('whitespace / letter spacing は raw のまま、比較列でのみ除去する', () => {
    const o = parse(OBSERVED_WORDSPLIT);
    expect(o.header.titleRawParts[0]).toContain('令   和');
    expect(comparisonCharacterSequence(['地   方    厚   生    局'])).toBe('地方厚生局');
    expect(comparisonCharacterSequence(['９９０５（エ）'])).toBe('9905(エ)');
  });
  it('[synthetic] 構造を満たさない入力は abstain（null / PARTIAL / UNRESOLVED）で、文字を補わない', () => {
    expect(parse('').status).toBe('UNRESOLVED');
    // preregistration §3: header・title が読めても entry が 0 件なら UNRESOLVED（PARTIAL ではない）
    const headerOnly = parse('19 内閣府所管\n令和６年度歳出概算要求書');
    expect([headerOnly.header.status, headerOnly.entries.length, headerOnly.status]).toEqual(['RESOLVED', 0, 'UNRESOLVED']);
    expect(parse('内閣府所管').status).toBe('UNRESOLVED');
    const noHeaderCode = parse('内閣府所管\n令和６年度歳出概算要求書\n1. 令和６年度歳出概算要求額総表 ・・・・ 1');
    expect(noHeaderCode.header.codeRaw).toBeNull();
    expect(noHeaderCode.status).toBe('PARTIAL');
    const stray = parse('19 内閣府所管\n令和６年度歳出概算要求書\n何かの注記\n1. 令和６年度歳出概算要求額総表 ・・・・ 1');
    expect(stray.status).toBe('PARTIAL');
    expect(stray.unclassifiedLines).toEqual(['何かの注記']);
    const noTitle = parse('19 内閣府所管\n1. 令和６年度歳出概算要求額総表 ・・・・ 1');
    expect(noTitle.header.titleRawParts).toEqual([]);
    expect(noTitle.entries).toHaveLength(1);
    expect(noTitle.status).toBe('PARTIAL');
  });
  it('[synthetic] leader dots も page 参照も無い行は SCOPE の後でのみ continuation、SECTION の後では未分類', () => {
    const afterSection = parse('19 内閣府所管\n令和６年度歳出概算要求書\n1. 令和６年度歳出概算要求額総表 ・・・・ 1\n続き');
    expect(afterSection.unclassifiedLines).toEqual(['続き']);
  });
  it('同一入力は同一出力（決定的）', () => {
    expect(JSON.stringify(parse(OBSERVED_WORDSPLIT))).toBe(JSON.stringify(parse(OBSERVED_WORDSPLIT)));
  });
  it('production parser / builder は GT・development fixture・manifest・辞書を参照しない（境界のコード検査）', () => {
    for (const f of ['scripts/pipeline-v2/lib/budget-request-cover-structure.ts', 'scripts/pipeline-v2/build-budget-request-cover-structure.ts']) {
      const src = fs.readFileSync(f, 'utf8');
      const code = src.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*')).join('\n');
      expect(code).not.toMatch(/visual-gt|development-explored|structure-inventory|frozen-candidates|budget-request-manifest|localPathFor/);
    }
  });
});
