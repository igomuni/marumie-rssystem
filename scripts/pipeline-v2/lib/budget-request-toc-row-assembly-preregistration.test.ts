import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './budget-request-raw-text';

const dir = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024');
const phys = path.join('tests', 'fixtures', 'budget-request-toc-physical-row', '2024');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
type Pg = { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; classifierSource: string; evaluationRole?: string };
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;
const pre = read<any>(path.join(dir, 'preregistration.json'));
const held = read<{ membershipDigestSha256: string; sampleSize: number; byClassifierSource: Record<string, number>; population: { pool: number }; frozenInput: Record<string, string>; zeroPoolStrata: Record<string, number>; strata: Record<string, { take: number; pool: number }>; pages: Pg[] }>(path.join(dir, 'heldout-candidates.json'));
const inv = read<{ frozenInput: Record<string, string>; summary: { pages: number; direct: number; inherited: number; physicalPdfs: number }; pages: (Pg & { explored: { pr3aExplored: boolean; issue389Explored: boolean } })[] }>(path.join(phys, 'candidate-inventory.json'));
const ledger = read<{ pages: Pg[] }>(path.join(phys, 'development-explored-pages.json'));
const raw = read<{ frozenInput: { corpusDigestSha256: string }; documents: { localPdfPath: string; pdfSha256: string; pageTextSha256: string[] }[] }>(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'));

describe('toc row assembly preregistration（integrity のみ。parser の正しさは検証しない）', () => {
  it('frozen digest と TOC population が #390 inventory / Raw Text manifest と一致する', () => {
    expect(pre.integrity.frozenInput.rawTextCorpusDigestSha256).toBe(raw.frozenInput.corpusDigestSha256);
    expect(pre.integrity.frozenInput.rawTextCorpusDigestSha256).toBe(inv.frozenInput.rawTextCorpusDigestSha256);
    expect(pre.integrity.frozenInput.pageClassificationCorpusDigestSha256).toBe(inv.frozenInput.pageClassificationCorpusDigestSha256);
    expect([inv.summary.pages, inv.summary.direct, inv.summary.inherited, inv.summary.physicalPdfs]).toEqual([82, 55, 27, 55]);
    expect(pre.integrity.population).toEqual({ tocPages: 82, direct: 55, inherited: 27, physicalPdfs: 55 });
  });
  it('dependency artifact が存在し、base/head SHA が 40 桁 hex で記録されている', () => {
    for (const f of ['candidate-inventory.json', 'development-explored-pages.json', 'boundary-band-evidence.json', 'failure-taxonomy.json', 'result.json']) expect(fs.existsSync(path.join(phys, f))).toBe(true);
    expect(fs.existsSync(path.join('tests', 'fixtures', 'budget-request-toc-column-structure', '2024', 'machine-inventory.json'))).toBe(true);
    expect(pre.integrity.baseMainSha).toMatch(/^[0-9a-f]{40}$/);
    expect(pre.integrity.dependencies.pr390HeadSha).toMatch(/^[0-9a-f]{40}$/);
    expect(read<{ judgment: string }>(path.join(phys, 'result.json')).judgment).toBe('READY_FOR_TOC_ROW_ASSEMBLY_PREREG');
  });
  it('preregistration の必須節が揃い、tolerance が数値で固定され、GO は GT freeze のみを意味する', () => {
    for (const k of ['integrity', 'inputContract', 'outputContract', 'rules', 'abstentionConditions', 'failureTaxonomy', 'gtProtocol', 'metrics', 'goStop', 'unresolved', 'judgment']) expect(pre[k]).toBeDefined();
    for (const k of ['createdAt', 'baseMainSha', 'dependencies', 'frozenInput', 'population', 'developmentEvidenceUsed', 'posthocEvidenceUsed', 'claimBoundary']) expect(pre.integrity[k]).toBeDefined();
    expect(pre.rules.bandToleranceChars).toBe(2);
    expect(typeof pre.rules.bandMinEvidence).toBe('number');
    expect(pre.judgment).toBe('READY_FOR_TOC_ROW_ASSEMBLY_GT_FREEZE');
    expect(pre.outputContract.excluded).toEqual(expect.arrayContaining(['parent ministry', 'carried hierarchy']));
    expect(pre.goStop.unresolvedAcceptanceThreshold.length).toBeGreaterThan(0);
  });
  it('abstention 条件は重複なく、page/line の scope 分けと taxonomy 対応が全条件を網羅する', () => {
    const a: string[] = pre.abstentionConditions;
    expect(new Set(a).size).toBe(a.length);
    expect([...pre.abstentionScope.pageLevel, ...pre.abstentionScope.lineOrSegmentLevel].sort()).toEqual([...a].sort());
    expect(Object.keys(pre.failureTaxonomy.abstentionToFamily).sort()).toEqual([...a].sort());
    const fams = new Set<string>([...pre.failureTaxonomy.reusedFrom390, ...pre.failureTaxonomy.addedForEvaluation]);
    for (const f of Object.values(pre.failureTaxonomy.abstentionToFamily)) expect(fams.has(f as string)).toBe(true);
    const t390 = read<{ counts: Record<string, number> }>(path.join(phys, 'failure-taxonomy.json')).counts;
    for (const f of pre.failureTaxonomy.reusedFrom390) expect(f in t390).toBe(true);
  });
  it('held-out candidate は explored（PR-3A / #389 / #390 render）と重ならず、重複なく inventory の TOC page で、membership digest が固定されている', () => {
    const explored = new Set([...inv.pages.filter(p => p.explored.pr3aExplored || p.explored.issue389Explored).map(key), ...ledger.pages.map(key)]);
    const keys = new Set(inv.pages.map(key));
    expect(explored.size).toBe(82 - held.population.pool);
    expect(new Set(held.pages.map(key)).size).toBe(held.pages.length);
    expect(held.pages.filter(p => explored.has(key(p)))).toEqual([]);
    expect(held.pages.every(p => keys.has(key(p)) && p.evaluationRole === 'HELDOUT_CANDIDATE')).toBe(true);
    const docs = new Map(raw.documents.map(d => [d.localPdfPath, d]));
    for (const p of held.pages) expect([docs.get(p.localPdfPath)!.pdfSha256, docs.get(p.localPdfPath)!.pageTextSha256[p.physicalPage - 1]]).toEqual([p.pdfSha256, p.textSha256]);
    const digest = sha256Hex(held.pages.map(p => `${p.localPdfPath} ${p.pdfSha256} ${p.physicalPage} ${p.textSha256}`).join('\n'));
    expect(digest).toBe(held.membershipDigestSha256);
    expect(pre.gtProtocol.selection.membershipDigestSha256).toBe(digest);
    expect([held.sampleSize, held.pages.length, pre.gtProtocol.selection.sampleSize]).toEqual([23, 23, 23]);
    expect(held.byClassifierSource.DIRECT + held.byClassifierSource.INHERITED).toBe(23);
  });
  it('pool 0 の stratum は sample されず（捏造なし）、各 stratum の take は pool 以下で preregistration と一致する', () => {
    expect(Object.values(held.zeroPoolStrata).every(n => n === 0)).toBe(true);
    for (const [s, v] of Object.entries(held.strata)) {
      expect(v.take).toBeLessThanOrEqual(v.pool);
      expect(pre.gtProtocol.strata['pool>0'][s]).toEqual({ pool: v.pool, take: v.take });
    }
    expect(pre.gtProtocol.strata.pool0_notSampled.length).toBeGreaterThan(0);
  });
});
