import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const DIR = path.join('tests', 'fixtures', 'budget-request-field-resolver', 'incomplete-name-guard-v0');
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'h1-human-validation-package-manifest.json'), 'utf8')) as { worklist: { path: string; sha256: string }; protocol: { path: string; sha256: string }; sources: Record<string, unknown>[] };
const worklist = JSON.parse(fs.readFileSync(manifest.worklist.path, 'utf8')) as { sources: { canonicalUrl: string; sha256: string; pageCount: number; unitCount: number }[] };

// reviewer に渡す 3 ファイル（worklist・protocol・manifest）に、AI の結果・machine output が含まれないこと
const FORBIDDEN = /complete_total|incomplete_total|unclear_total|visual-gt|p4-evaluation|provenance|baseline|reasonCode|stratum|predicate|knownFailure|agreement|\b0 ?\/ ?(38|65) ?\/ ?0\b|65 ?\/ ?65|全件.{0,6}incomplete/i;
const FORBIDDEN_CASE_SENSITIVE = /\bGO\b/; // 判定語（大文字）。ドメイン名の .go.jp は対象外

describe('H1 human-validation reviewer package', () => {
  it('manifest が worklist・protocol の現在の hash と一致する', () => {
    expect(sha(manifest.worklist.path)).toBe(manifest.worklist.sha256);
    expect(sha(manifest.protocol.path)).toBe(manifest.protocol.sha256);
  });
  it('原本 7 本を一意に参照でき、worklist の inventory と一致する', () => {
    expect(manifest.sources).toHaveLength(7);
    expect(new Set(manifest.sources.map(s => s.reviewerFilename)).size).toBe(7);
    for (const s of manifest.sources) expect(Object.keys(s).sort()).toEqual(['canonicalUrl', 'pageCount', 'reviewerFilename', 'sha256', 'unitCount']);
    expect(manifest.sources.map(s => [s.canonicalUrl, s.sha256, s.pageCount, s.unitCount])).toEqual(worklist.sources.map(s => [s.canonicalUrl, s.sha256, s.pageCount, s.unitCount]));
    expect(manifest.sources.reduce((n, s) => n + (s.unitCount as number), 0)).toBe(65);
  });
  it('manifest は許可された key のみ（schema allowlist）', () => {
    expect(Object.keys(manifest).sort()).toEqual(['packageVersion', 'protocol', 'schema', 'sources', 'worklist']);
  });
  it('reviewer 向けの 3 ファイルに AI 結果・machine output が含まれない', () => {
    for (const f of [manifest.worklist.path, manifest.protocol.path, path.join(DIR, 'h1-human-validation-package-manifest.json')]) {
      const text = fs.readFileSync(f, 'utf8');
      expect(text).not.toMatch(FORBIDDEN);
      expect(text).not.toMatch(FORBIDDEN_CASE_SENSITIVE);
    }
  });
});
