import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './budget-request-raw-text';

const dir = path.join('tests', 'fixtures', 'budget-request-cover-structure', '2024');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const cand = read<{ candidateDigestSha256: string; candidates: { filePath: string; fileSha256: string; physicalPage: number; textSha256: string }[] }>(path.join(dir, 'frozen-candidates.json'));
type Entry = { kindVisual: string; ordinalVisual: string | null; labelOrMarkerVisual: string | null; codeVisual: string | null; labelVisualParts: string[]; nameVisualParts: string[]; printedPageRefVisual: string | null; status: string };
const gt = read<{
  preregistrationCommit: string; candidateFixtureSha256: string; candidateDigestSha256: string;
  summary: { rows: number; sourceHashMismatch: number; partialOrUnresolvedRows: number };
  rows: { sourceKey: { filePath: string; fileSha256: string; physicalPage: number; textSha256: string }; visualStatus: string; header: { codeVisual: string | null; textVisualParts: string[]; titleVisualParts: string[]; status: string }; entries: Entry[] }[];
}>(path.join(dir, 'visual-gt.json'));
const key = (k: { filePath: string; physicalPage: number }) => `${k.filePath}#${k.physicalPage}`;

describe('cover structure v0 visual GT freeze', () => {
  it('candidate と 1:1（欠落・余剰・重複なし）で、hash が一致する', () => {
    expect(gt.rows.map(r => key(r.sourceKey)).sort()).toEqual(cand.candidates.map(key).sort());
    expect(gt.candidateDigestSha256).toBe(cand.candidateDigestSha256);
    expect(gt.candidateFixtureSha256).toBe(sha256Hex(fs.readFileSync(path.join(dir, 'frozen-candidates.json'))));
    const byKey = new Map(cand.candidates.map(c => [key(c), c]));
    for (const r of gt.rows) expect(r.sourceKey).toEqual({ filePath: byKey.get(key(r.sourceKey))!.filePath, fileSha256: byKey.get(key(r.sourceKey))!.fileSha256, physicalPage: r.sourceKey.physicalPage, textSha256: byKey.get(key(r.sourceKey))!.textSha256 });
    expect(gt.summary.sourceHashMismatch).toBe(0);
    expect(gt.preregistrationCommit).toMatch(/^[0-9a-f]{40}$/);
  });
  it('schema（preregistration §3）に沿い、visible な値のみを持つ（Raw Text 由来のフィールドなし）', () => {
    for (const r of gt.rows) {
      expect(['RESOLVED', 'PARTIAL', 'UNRESOLVED']).toContain(r.visualStatus);
      expect(r.header.textVisualParts.length).toBeGreaterThan(0);
      expect(r.entries.length).toBeGreaterThan(0);
      for (const e of r.entries) {
        expect(['SECTION_REFERENCE', 'SCOPE_REFERENCE']).toContain(e.kindVisual);
        if (e.kindVisual === 'SECTION_REFERENCE') expect([e.ordinalVisual !== null, e.labelVisualParts.length > 0, e.codeVisual]).toEqual([true, true, null]);
        else expect([e.labelOrMarkerVisual !== null, e.codeVisual !== null, e.nameVisualParts.length > 0]).toEqual([true, true, true]);
      }
    }
  });
  it('summary が rows と整合し、parser を含まない', () => {
    expect(gt.summary.rows).toBe(gt.rows.length);
    expect(gt.summary.partialOrUnresolvedRows).toBe(gt.rows.filter(r => r.visualStatus !== 'RESOLVED').length);
    expect(Object.keys(gt.rows[0])).not.toContain('parserOutput');
  });
});
