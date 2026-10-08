import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { describe, expect, it } from 'vitest';

const dir = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-header-zone-right-row-h1', '2024');
const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const gt = read(path.join(dir, 'new-heldout-ground-truth.json'));
const ledger = read(path.join(dir, 'new-heldout-annotation-ledger.json'));
const render = read(path.join(dir, 'new-heldout-render-manifest.json'));
const man = read(path.join(dir, 'new-heldout-visual-gt-freeze-manifest.json'));
const mem = read(path.join(dir, 'new-heldout-membership.json'));
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;

describe('H1 新 held-out visual GT freeze の integrity（visual-only。H1 / parser は未実行）', () => {
  it('GT の page identity が frozen membership 25 と完全一致（missing 0・extra 0・重複なし）で、membership digest・implementation freeze も一致する', () => {
    expect(gt.pages.map(key)).toEqual(mem.members.map(key));
    expect(new Set(gt.pages.map(key)).size).toBe(25);
    expect(gt.membershipDigestSha256).toBe('06c2e68d7ac178e7e0561d16976c47936ab9d52b59d91710cab145fa8822ab28');
    expect(mem.digestSha256).toBe(gt.membershipDigestSha256);
    expect(sha(path.join(dir, 'new-heldout-membership.json'))).toBe('7c238b9b6c756ebc9baec46f47f33db1706fee8ca40d87b1eb6d87bcf6538d06');
    expect(man.hashes.h1SourceSha256).toBe('ea6af6debefc6c092c3725fc5e37f8ea7a53658fb24d876c2f725e33c6178343');
    expect(sha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.ts')).toBe(man.hashes.h1SourceSha256);
    expect(sha(path.join(dir, 'preregistration.json'))).toBe('0c3a377ba9d32ec55701f8d0982ff9a48e8cd9f16ba8c81927fcedffcdec1b27');
    expect(sha(path.join(dir, 'implementation-freeze-manifest.json'))).toBe(man.hashes.implementationFreezeManifestSha256);
    for (const [i, p] of gt.pages.entries()) expect(p.classifierSource).toBe(mem.members[i].classifierSource);
  });
  it('freeze manifest の hash が GT / ledger / render manifest / source と一致し、status と judgment が正しい', () => {
    expect(man.status).toBe('NEW_HELDOUT_VISUAL_GT_FROZEN');
    expect(sha(path.join(dir, 'new-heldout-ground-truth.json'))).toBe(man.hashes.groundTruthSha256);
    expect(sha(path.join(dir, 'new-heldout-annotation-ledger.json'))).toBe(man.hashes.annotationLedgerSha256);
    expect(sha(path.join(dir, 'new-heldout-render-manifest.json'))).toBe(man.hashes.renderManifestSha256);
    expect(sha(path.join(dir, 'new-heldout-visual-gt-source.txt'))).toBe(man.hashes.visualGtSourceSha256);
    expect(sha(path.join(dir, 'new-heldout-membership-freeze-manifest.json'))).toBe(man.hashes.membershipFreezeManifestSha256);
    expect(man.annotationCompletion).toEqual({ complete: 25, total: 25 });
    expect(man.judgment).toBe('READY_FOR_H1_ONE_SHOT_FROZEN_EVALUATION');
  });
  it('annotation: 25/25 完了、row identity・(column, orderInColumn) 一意、fragment owner 参照が有効、集計が ledger・manifest と一致', () => {
    const all: { rowId: string; column: string; orderInColumn: number; rowKindVisual: string; requestNumberVisualToken: string | null; pageRefVisual: string | null; wrappedFragmentCount: number; requestNumberCircledVisual: boolean | null }[] = [];
    for (const p of gt.pages) {
      expect(p.gtPageComplete).toBe(true);
      const seen = new Set<string>(); const ids = new Map<string, (typeof all)[number]>();
      for (const r of p.rows) {
        expect(r.rowId).toBe(`${p.localPdfPath}#${p.physicalPage}:${r.column}:${r.orderInColumn}`);
        const k = `${r.column}:${r.orderInColumn}`; expect(seen.has(k)).toBe(false); seen.add(k); ids.set(r.rowId, r); all.push(r);
        expect(r.orderInColumn).toBeGreaterThanOrEqual(1);
      }
      for (const f of p.fragments) { expect(ids.has(f.ownerRowId)).toBe(true); expect(['UNIQUE', 'AMBIGUOUS', 'NO_SAFE_OWNER']).toContain(f.ownerStatus); }
      for (const r of p.rows) expect(p.fragments.filter((f: { ownerRowId: string }) => f.ownerRowId === r.rowId).length).toBe(r.wrappedFragmentCount);
      expect(p.rightColumnVisual === 'BLANK_NO_ROWS').toBe(!p.rows.some((r: { column: string }) => r.column === 'RIGHT'));
      const reqs = p.rows.filter((r: { requestNumberVisualToken: string | null }) => r.requestNumberVisualToken).map((r: { requestNumberVisualToken: string }) => Number(r.requestNumberVisualToken));
      reqs.forEach((n: number, i: number) => i > 0 && expect(n).toBe(reqs[i - 1] + 1));
    }
    expect(new Set(all.map(r => r.rowId)).size).toBe(all.length);
    expect(gt.counts.rows).toBe(all.length);
    expect(ledger.pages).toHaveLength(25);
    expect(ledger.pages.every((p: { inspected: boolean; annotationCompleted: boolean }) => p.inspected && p.annotationCompleted)).toBe(true);
    expect(ledger.pages.reduce((a: number, p: { rowCount: number }) => a + p.rowCount, 0)).toBe(all.length);
    expect(ledger.pages.reduce((a: number, p: { requestCount: number }) => a + p.requestCount, 0)).toBe(gt.counts.byRowKind.REQUEST_NUMBER_ROW);
    expect(ledger.pages.reduce((a: number, p: { markerCount: number }) => a + p.markerCount, 0)).toBe(gt.counts.byRowKind.MARKER_ROW);
    expect(ledger.pages.reduce((a: number, p: { plainCount: number }) => a + p.plainCount, 0)).toBe(gt.counts.byRowKind.PLAIN_ROW);
    expect(ledger.pages.reduce((a: number, p: { wrappedFragmentCount: number }) => a + p.wrappedFragmentCount, 0)).toBe(gt.counts.wrappedFragments);
    expect(ledger.pages.reduce((a: number, p: { circledCount: number }) => a + p.circledCount, 0)).toBe(gt.counts.circledRequestNumbers);
    expect(man.gtSummary).toEqual(gt.counts);
    expect(all.filter(r => r.rowKindVisual === 'PLAIN_ROW').every(r => r.requestNumberVisualToken === null)).toBe(true);
  });
  it('render manifest が 25 page 全件を 110dpi で持ち、PDF hash が Raw Text manifest と一致し、supplemental は ledger に記録されている', () => {
    expect(render.renders).toHaveLength(25);
    expect(render.baseDpi).toBe(110);
    const raw = read('tests/fixtures/budget-request-raw-text/2024/raw-text-manifest.json') as { documents: { localPdfPath: string; pdfSha256: string }[] };
    const docs = new Map(raw.documents.map(d => [d.localPdfPath, d.pdfSha256]));
    for (const [i, r] of render.renders.entries()) { expect(r.localPdfPath).toBe(mem.members[i].localPdfPath); expect(r.physicalPage).toBe(mem.members[i].physicalPage); expect(r.pdfSha256).toBe(docs.get(r.localPdfPath)); expect(r.pngSha256).toMatch(/^[0-9a-f]{64}$/); }
    expect(ledger.supplementalRenders).toHaveLength(1);
    expect(ledger.pages.filter((p: { supplementalRenderUsed: boolean }) => p.supplementalRenderUsed)).toHaveLength(1);
  });
  it('firewall: H1 / #393 の実行・trigger census・parser 出力閲覧・H1 固有 label・contamination がなく、新 held-out の出力 artifact も存在しない', () => {
    expect(man.firewall).toMatchObject({ h1ExecutionsOnNewHeldout: 0, parser393ExecutionsOnNewHeldout: 0, triggerCensus: 0, parserOutputViewed: false, h1SpecificLabels: false, rawTextUsedForGtValues: false, pdftotextDisplayed: false });
    expect(man.contamination).toBe(false);
    expect(man.formalEvaluationCount.heldoutParserExecutionsTotal).toBe(1);
    const text = JSON.stringify(gt);
    expect(text).not.toMatch(/HEADER_ZONE|H1_TRIGGER|EXPECTED_SPLIT|triggerCandidate|header-zone-right-row/);
    expect(fs.readdirSync(dir).filter(f => /parser-output|heldout-output|evaluation-result|h1-output/i.test(f))).toEqual([]);
    expect(fs.readdirSync('tests/fixtures/budget-request-toc-row-assembly-evaluation/2024')).toHaveLength(4);
    const src = fs.readFileSync('scripts/pipeline-v2/build-budget-request-toc-h1-new-heldout-visual-gt.ts', 'utf8');
    const imports = [...src.matchAll(/^import .* from '(.+)';$/gmu)].map(m => m[1]);
    for (const i of imports) expect(['fs', 'path', 'crypto']).toContain(i);
  });
  it('PLAIN_ROW は visual-only で parser mapping を持たず、unresolved / unreadable は 0（推測補完なし）', () => {
    expect(JSON.stringify(gt)).not.toMatch(/PLAIN_ROW\s*(→|->)/);
    expect(gt.counts).toMatchObject({ unresolvedPages: 0, unresolvedRows: 0, unresolvedFragments: 0, unreadableFields: 0 });
    for (const p of gt.pages) for (const r of p.rows) expect(r.unreadable).toBe(false);
  });
});
