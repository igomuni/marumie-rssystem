import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { evaluateGolden, renderEvaluationMarkdown, type Golden, type GoldenSample } from './budget-request-field-resolver-evaluator';
import { resolveFields, type FieldResolverResult } from './budget-request-field-resolver';

const read = (f: string) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const importsOf = (src: string): string[] => [...src.matchAll(/from\s+'([^']+)'/g)].map(m => m[1]);
const base = (imp: string): string => (imp.startsWith('.') ? `./${path.basename(imp)}` : imp);

/** 推論側（Golden・GT・凍結済み上位層を読まない）。評価側（evaluator と評価CLI）だけが Golden を読んでよい */
const INFERENCE_FILES = ['budget-request-field-resolver.ts', 'budget-request-field-resolver-runs.ts', 'budget-request-field-resolver-paths.ts', '../extract-budget-request-field-resolver.ts'];
const FORBIDDEN_IMPORT = /golden|human-observations|region|spatial|semantic|anchor|template|document-hierarchy-eval|a2-eval/i;
const ALLOWED_HIERARCHY = new Set(['./budget-request-document-hierarchy', './budget-request-document-hierarchy-v2', './budget-request-document-hierarchy-a2-experiments', './budget-request-document-hierarchy-paths']);

describe('静的境界（GT 汚染の防止）', () => {
  for (const f of INFERENCE_FILES) {
    const src = read(f);
    it(`${f}: Golden / hierarchy GT / human-observations / 凍結済み上位層を import しない`, () => {
      for (const imp of importsOf(src)) {
        expect(imp, `${f} imports ${imp}`).not.toMatch(FORBIDDEN_IMPORT);
        if (imp.includes('document-hierarchy')) expect(ALLOWED_HIERARCHY.has(base(imp)), `${f} imports ${imp}`).toBe(true);
      }
    });
    it(`${f}: fixture / Golden / GT のパスを文字列として参照しない`, () => {
      // コメントを除いた本文で検査する
      const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(body).not.toMatch(/tests\/fixtures|golden\.json|human-observations|budget-request-document-hierarchy\/2024|readFileSync\([^)]*(golden|fixtures)/i);
    });
  }
  it('推論側のモジュールは評価側（evaluator）に依存しない', () => {
    for (const f of INFERENCE_FILES) expect(importsOf(read(f)).some(i => i.includes('evaluator'))).toBe(false);
  });
  it('Golden を読むのは評価CLIだけ（推論CLIは読まない）', () => {
    expect(read('../evaluate-budget-request-field-resolver.ts')).toContain('golden.json');
    expect(read('../extract-budget-request-field-resolver.ts')).not.toContain('golden');
  });
  it('推論 module に Golden 固有の分岐（target id / ministry 名 / ページ番号の特例）が無い', () => {
    const body = read('budget-request-field-resolver.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(body).not.toMatch(/meti-|mhlw-|mext-|cfa-|経済産業|厚生労働|文部科学|こども家庭/);
    expect(body).not.toMatch(/sourcePage\s*===|pageNumber\s*===|\.page\s*===\s*\d/);
  });
});

describe('評価（Golden 側）', () => {
  const meta = { number: 1, numPages: 1, view: [0, 0, 842, 595] as [number, number, number, number], rotate: 0, width: 842, height: 595 };
  const emptyResult = resolveFields({ pages: [{ meta, tokens: [], geometry: { physicalRows: [], columnBands: [] } as never, logical: { logicalRowCandidates: [] } as never }], hierarchy: null });
  const amount = (status: string, raw: string | null, n: number | null, zero = false) => ({ status, magnitudeRaw: raw, magnitudeNumeric: n, explicitZero: zero, sign: { status: 'not_observed', raw: null } });
  const golden = {
    schemaVersion: 'test',
    columnBandsPt: { previousBudget: [204, 256], requestedBudget: [256, 307], difference: [411, 463] },
    humanReview: { exceptions: [] },
    samples: [{
      id: 's', sourcePage: 1, document: { canonicalUrl: 'u' }, pageUnitLabel: { status: 'not_observed', raw: null },
      targets: [{
        id: 't', kind: 'detail_line', visualLocator: { approxYPt: 100, yToleranceBandPt: 8 },
        rowLocal: { code: { status: 'resolved', raw: '003' }, name: { status: 'resolved', normalized: '例' }, previousBudget: amount('resolved', '10', 10), requestedBudget: amount('blank', null, null), difference: amount('resolved', '0', 0, true) },
        expectedSourceClass: { code: 'same_row' }, auxiliary: [], hierarchy: { inputState: 'not_applicable', expected: { parentItemAssociation: { status: 'not_applicable' }, parentOrganizationAssociation: { status: 'not_applicable' } } },
      }],
    }],
  } as unknown as Golden;

  it('record が見つからなければ not_found（確定扱いにしない）', () => {
    const r = evaluateGolden(golden, () => emptyResult);
    expect(r.recordNotFound).toEqual(['t']);
    expect(r.overall.exact).toBe(0);
    expect(r.overall.falseResolved).toBe(0);
  });
  const rec = (over: Record<string, unknown>) => ({
    anchor: { page: 1, logicalRowIndex: 0 }, anchorBBox: { xMin: 0, yMin: 95, xMax: 800, yMax: 105 }, recordKind: 'detail_line', recordKindBasis: '',
    rowLocal: {
      code: { status: 'resolved', value: { raw: '003' }, reasonCode: null, evidence: { associationClass: 'same_row', bboxUnion: { xMin: 0, xMax: 1 } } },
      name: { status: 'resolved', value: { raw: '例', normalized: '例' }, reasonCode: null, evidence: { associationClass: 'same_row', bboxUnion: { xMin: 0, xMax: 1 } } },
      previousBudget: { status: 'resolved', value: { magnitudeRaw: '10', magnitudeNumeric: 10, explicitZero: false }, reasonCode: null, evidence: { associationClass: 'same_row', bboxUnion: { xMin: 240, xMax: 255 } } },
      requestedBudget: { status: 'blank', value: null, reasonCode: 'no_token_in_cell_band', evidence: { associationClass: 'same_row', bboxUnion: { xMin: 259, xMax: 307 } } },
      difference: { status: 'resolved', value: { magnitudeRaw: '0', magnitudeNumeric: 0, explicitZero: true }, reasonCode: null, evidence: { associationClass: 'same_row', bboxUnion: { xMin: 440, xMax: 462 } } },
      previousBudgetSign: { status: 'not_observed', value: null, reasonCode: 'x', evidence: null },
      requestedBudgetSign: { status: 'not_applicable', value: null, reasonCode: 'x', evidence: null },
      differenceSign: { status: 'not_observed', value: null, reasonCode: 'x', evidence: null },
      ...over,
    },
    hierarchyDependent: { parentItemAssociation: { status: 'not_applicable', value: null, reasonCode: 'x', evidence: null }, parentOrganizationAssociation: { status: 'not_applicable', value: null, reasonCode: 'x', evidence: null } },
    auxiliaryEvidenceRefs: [], pageUnitLabel: { status: 'not_observed', value: null, reasonCode: 'x', evidence: null },
  });
  const run = (over: Record<string, unknown>) => evaluateGolden(golden, () => ({ records: [rec(over)] } as unknown as FieldResolverResult));

  it('全て一致なら false resolved 0・exact', () => {
    const r = run({});
    expect(r.failures).toEqual([]);
    expect(r.overall.falseResolveRate).toBe(0);
  });
  it('blank を値にしたものは false resolved。値は合っていても source が補助の場合は exact にしない', () => {
    const wrongBlank = run({ requestedBudget: { status: 'resolved', value: { magnitudeRaw: '5', magnitudeNumeric: 5, explicitZero: false }, reasonCode: null, evidence: { associationClass: 'same_row', bboxUnion: { xMin: 259, xMax: 307 } } } });
    expect(wrongBlank.failures.map(f => `${f.field}:${f.outcome}`)).toContain('requestedBudget:false_resolved');
    const aux = run({ previousBudget: { status: 'resolved', value: { magnitudeRaw: '10', magnitudeNumeric: 10, explicitZero: false }, reasonCode: null, evidence: { associationClass: 'auxiliary', bboxUnion: { xMin: 240, xMax: 255 } } } });
    expect(aux.failures.map(f => `${f.field}:${f.outcome}`)).toContain('previousBudget:wrong_source');
    const rightSide = run({ previousBudget: { status: 'resolved', value: { magnitudeRaw: '10', magnitudeNumeric: 10, explicitZero: false }, reasonCode: null, evidence: { associationClass: 'same_row', bboxUnion: { xMin: 600, xMax: 620 } } } });
    expect(rightSide.failures.map(f => `${f.field}:${f.outcome}`)).toContain('previousBudget:wrong_source');
  });
  it('符号の捏造は false resolved、Golden に符号 token が無いのに resolved にしたものも同様', () => {
    const r = run({ previousBudgetSign: { status: 'resolved', value: { raw: '△' }, reasonCode: null, evidence: { associationClass: 'same_row', bboxUnion: { xMin: 240, xMax: 250 } } } });
    expect(r.failures.map(f => `${f.field}:${f.outcome}`)).toContain('previousBudgetSign:false_resolved');
  });
  it('レポートは決定的で Markdown に出力できる', () => {
    expect(JSON.stringify(run({}))).toBe(JSON.stringify(run({})));
    expect(renderEvaluationMarkdown(run({}))).toContain('false-resolve rate');
  });
});

describe('実PDFのartifact（data/work が無ければ skip）', () => {
  const dir = path.join(__dirname, '../../../data/work/budget-request-field-resolver');
  const goldenFile = path.join(__dirname, '../../../tests/fixtures/budget-request-field-resolver/v0/golden.json');
  const have = fs.existsSync(path.join(dir, 'evaluation', 'golden-v0.json')) && fs.existsSync(goldenFile);
  it.skipIf(!have)('Golden 20 target の評価: false resolved 0・wrong source 0・不変条件違反 0', () => {
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'evaluation', 'golden-v0.json'), 'utf8')) as ReturnType<typeof evaluateGolden>;
    expect(report.golden.targetCount).toBe(20);
    expect(report.recordNotFound).toEqual([]);
    expect(report.overall.falseResolved).toBe(0);
    expect(report.overall.wrongSource).toBe(0);
    expect(report.overall.wrongNormalization).toBe(0);
  });
  it.skipIf(!have)('全 artifact: 符号を値から作っていない（算術監査: 完全に確定した行は 要求−前年度=増減（符号込み）に一致）', () => {
    let checked = 0;
    for (const d of fs.readdirSync(dir)) {
      const f = path.join(dir, d, 'field-resolution.json');
      if (!fs.existsSync(f)) continue;
      const res = JSON.parse(fs.readFileSync(f, 'utf8')) as FieldResolverResult;
      for (const r of res.records) {
        const { previousBudget: p, requestedBudget: q, difference: df } = r.rowLocal;
        if (!p.value || !q.value || !df.value) continue;
        const s = (sg: { status: string }) => (sg.status === 'resolved' ? -1 : 1);
        checked++;
        expect(q.value.magnitudeNumeric * s(r.rowLocal.requestedBudgetSign) - p.value.magnitudeNumeric * s(r.rowLocal.previousBudgetSign), `${d} p${r.anchor.page} L${r.anchor.logicalRowIndex}`).toBe(df.value.magnitudeNumeric * s(r.rowLocal.differenceSign));
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
