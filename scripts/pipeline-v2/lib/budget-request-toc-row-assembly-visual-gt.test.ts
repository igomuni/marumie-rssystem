import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './budget-request-raw-text';

const dir = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024');
const phys = path.join('tests', 'fixtures', 'budget-request-toc-physical-row', '2024');
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const sha = (f: string) => sha256Hex(fs.readFileSync(path.join(dir, f)));
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;
type Row = { rowId: string; column: string; orderInColumn: number; rowKindVisual: string; wrappedFragmentCount: number; pageRefVisual: string | null; requestNumberVisualToken: string | null; requestNumberCircledVisual: boolean | null };
type Page = { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; classifierSource: string; gtPageComplete: boolean; unresolvedReason: string | null; rightColumnVisual: string; rows: Row[]; fragments: { fragmentId: string; ownerRowId: string; column: string }[] };
const gt = readJson<{ membershipDigestSha256: string; counts: any; pages: Page[] }>(path.join(dir, 'ground-truth.json'));
const held = readJson<{ membershipDigestSha256: string; pages: Page[] }>(path.join(dir, 'heldout-candidates.json'));
const manifest = readJson<any>(path.join(dir, 'gt-freeze-manifest.json'));
const ledger = readJson<{ pages: { gtComplete: boolean; unresolvedReason: string | null; rows: number; fragments: number }[] }>(path.join(dir, 'annotation-ledger.json'));
const inv = readJson<{ pages: (Page & { explored: { pr3aExplored: boolean; issue389Explored: boolean } })[] }>(path.join(phys, 'candidate-inventory.json'));
const explored390 = readJson<{ pages: Page[] }>(path.join(phys, 'development-explored-pages.json'));
const raw = readJson<{ documents: { localPdfPath: string; pdfSha256: string; pageTextSha256: string[] }[] }>(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'));

describe('toc row assembly visual GT freeze（GT integrity のみ。parser の正しさは主張しない）', () => {
  it('candidate 23 page がすべて存在し、候補外・重複がなく、explored（34 page）と重ならない', () => {
    expect(gt.pages.map(key)).toEqual(held.pages.map(key));
    expect(new Set(gt.pages.map(key)).size).toBe(23);
    const explored = new Set([...inv.pages.filter(p => p.explored.pr3aExplored || p.explored.issue389Explored).map(key), ...explored390.pages.map(key)]);
    expect(explored.size).toBe(34);
    expect(gt.pages.filter(p => explored.has(key(p)))).toEqual([]);
    expect(gt.pages.filter(p => p.classifierSource === 'DIRECT')).toHaveLength(14);
    expect(gt.pages.filter(p => p.classifierSource === 'INHERITED')).toHaveLength(9);
  });
  it('source PDF / text hash が Raw Text manifest と一致し、membership・preregistration の hash が freeze manifest と一致する', () => {
    const docs = new Map(raw.documents.map(d => [d.localPdfPath, d]));
    for (const p of gt.pages) expect([docs.get(p.localPdfPath)!.pdfSha256, docs.get(p.localPdfPath)!.pageTextSha256[p.physicalPage - 1]]).toEqual([p.pdfSha256, p.textSha256]);
    expect(gt.membershipDigestSha256).toBe('8fa5a8a8444be31a637fae618235b0a77c6b37745441edc06534fe63c5a44156');
    expect(held.membershipDigestSha256).toBe(manifest.membershipDigestSha256);
    expect(sha('preregistration.json')).toBe(manifest.sha256.preregistration);
    expect(sha('preregistration.json')).toBe('0cfec657698f699bc3686a7944439db918e7515e439c74457d9c6458e6b42ac8');
    expect(sha('heldout-candidates.json')).toBe(manifest.sha256.heldoutCandidates);
  });
  it('GT / ledger / render manifest / source の SHA-256 が freeze manifest と一致する', () => {
    expect(sha('ground-truth.json')).toBe(manifest.sha256.groundTruth);
    expect(sha('annotation-ledger.json')).toBe(manifest.sha256.annotationLedger);
    expect(sha('render-manifest.json')).toBe(manifest.sha256.renderManifest);
    expect(sha('visual-gt-source.txt')).toBe(manifest.sha256.visualGtSource);
    expect(manifest.taxonomyBoundary).toMatch(/PLAIN_ROW[\s\S]*mapping は本 GT freeze では定義しない[\s\S]*事後的に mapping を作ってはならない/);
    expect(manifest.judgment).toBe('READY_FOR_TOC_ROW_ASSEMBLY_IMPLEMENTATION');
  });
  it('row ID と (page, column, orderInColumn) が一意で、fragment owner が存在し、wrappedFragmentCount と整合する', () => {
    const ids: string[] = [];
    for (const p of gt.pages) {
      const seen = new Set<string>();
      for (const r of p.rows) {
        expect(r.rowId).toBe(`${p.localPdfPath}#${p.physicalPage}:${r.column}:${r.orderInColumn}`);
        const k = `${r.column}:${r.orderInColumn}`;
        expect(seen.has(k)).toBe(false); seen.add(k); ids.push(r.rowId);
      }
      const owners = new Map(p.rows.map(r => [r.rowId, r]));
      for (const f of p.fragments) { expect(owners.has(f.ownerRowId)).toBe(true); expect(owners.get(f.ownerRowId)!.column).toBe(f.column); }
      for (const r of p.rows) expect(p.fragments.filter(f => f.ownerRowId === r.rowId).length).toBe(r.wrappedFragmentCount);
      expect(p.rightColumnVisual === 'BLANK_NO_ROWS').toBe(!p.rows.some(r => r.column === 'RIGHT'));
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('unresolved を resolved 扱いしない（未完 page は理由を持つ）、count が manifest・ledger と整合する', () => {
    for (const p of gt.pages) expect(p.gtPageComplete || p.unresolvedReason !== null).toBe(true);
    const rows = gt.pages.reduce((a, p) => a + p.rows.length, 0);
    const frags = gt.pages.reduce((a, p) => a + p.fragments.length, 0);
    expect([gt.counts.rows, gt.counts.wrappedFragments, gt.counts.pages]).toEqual([rows, frags, 23]);
    expect(manifest.counts).toEqual(gt.counts);
    expect(ledger.pages).toHaveLength(23);
    expect(ledger.pages.reduce((a, p) => a + p.rows, 0)).toBe(rows);
    expect(ledger.pages.reduce((a, p) => a + p.fragments, 0)).toBe(frags);
    expect(ledger.pages.filter(p => !p.gtComplete || p.unresolvedReason).length).toBe(gt.counts.unresolvedPages);
  });
  it('visual 内部整合: 要求番号が page 内で連番、page ref が page 内で非減少（Raw Text 照合ではない）', () => {
    for (const p of gt.pages) {
      const reqs = p.rows.filter(r => r.requestNumberVisualToken).map(r => Number(r.requestNumberVisualToken));
      reqs.forEach((n, i) => i > 0 && expect(n).toBe(reqs[i - 1] + 1));
      const refs = ['LEFT', 'RIGHT'].flatMap(c => p.rows.filter(r => r.column === c).map(r => Number(r.pageRefVisual)));
      refs.forEach((n, i) => i > 0 && expect(n).toBeGreaterThanOrEqual(refs[i - 1]));
    }
  });
});
