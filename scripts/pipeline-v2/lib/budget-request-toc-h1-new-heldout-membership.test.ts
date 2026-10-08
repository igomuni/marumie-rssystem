import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_FIELDS, deriveNewHeldout, pageKey, projectInventory, type InventoryRow } from './budget-request-toc-h1-new-heldout-membership';

const dir = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-header-zone-right-row-h1', '2024');
const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const mem = read(path.join(dir, 'new-heldout-membership.json'));
const man = read(path.join(dir, 'new-heldout-membership-freeze-manifest.json'));
const inv = read('tests/fixtures/budget-request-toc-physical-row/2024/candidate-inventory.json').pages as InventoryRow[];
const ledger = (read('tests/fixtures/budget-request-toc-physical-row/2024/development-explored-pages.json').pages as { localPdfPath: string; physicalPage: number }[]).map(pageKey);
const first = read('tests/fixtures/budget-request-toc-row-assembly/2024/heldout-candidates.json').pages as { localPdfPath: string; physicalPage: number }[];

describe('H1 新 held-out membership freeze（集合差のみ。新 25 page は未観測・未実行）', () => {
  it('population: 82 = development 34 + first held-out 23 + new 25、overlap 0、union 82、missing 0', () => {
    expect(mem.status).toBe('NEW_HELDOUT_MEMBERSHIP_FROZEN');
    expect(man.population).toEqual({ total: 82, development: 34, firstHeldout: 23, newHeldout: 25 });
    expect(man.overlaps).toEqual({ developmentFirstHeldout: 0, developmentNewHeldout: 0, firstHeldoutNewHeldout: 0 });
    expect([man.unionCount, man.missing, man.duplicateRole]).toEqual([82, 0, 0]);
    expect(mem.members).toHaveLength(25);
    expect(new Set(mem.members.map(pageKey)).size).toBe(25);
    expect(mem.counts.direct + mem.counts.inherited).toBe(25);
  });
  it('再導出が決定的で、frozen file・digest・first held-out digest と一致する', () => {
    const d = deriveNewHeldout(projectInventory(inv), ledger, first.map(pageKey));
    expect(d.members).toEqual(mem.members);
    expect(d.digestSha256).toBe(mem.digestSha256);
    expect(deriveNewHeldout(projectInventory(inv), ledger, first.map(pageKey)).digestSha256).toBe(d.digestSha256);
    expect(man.membershipDigestSha256).toBe(mem.digestSha256);
    expect(man.membershipFileSha256).toBe(sha(path.join(dir, 'new-heldout-membership.json')));
    expect(man.firstHeldoutMembershipDigestSha256).toBe('8fa5a8a8444be31a637fae618235b0a77c6b37745441edc06534fe63c5a44156');
    const sorted = [...mem.members].sort((a: { localPdfPath: string; physicalPage: number }, b: { localPdfPath: string; physicalPage: number }) => (a.localPdfPath < b.localPdfPath ? -1 : a.localPdfPath > b.localPdfPath ? 1 : a.physicalPage - b.physicalPage));
    expect(mem.members).toEqual(sorted);
  });
  it('新 25 は first held-out・development のいずれとも重ならない', () => {
    const nw = new Set(mem.members.map(pageKey));
    expect(first.filter(p => nw.has(pageKey(p)))).toEqual([]);
    const dev = new Set([...inv.filter(p => p.explored.pr3aExplored || p.explored.issue389Explored).map(pageKey), ...ledger]);
    expect(dev.size).toBe(34);
    expect([...dev].filter(k => nw.has(k))).toEqual([]);
  });
  it('derivation は whitelist field のみを使い、raw text / parser / PDF / render / H1 に依存しない', () => {
    expect(ALLOWED_FIELDS).toEqual(['localPdfPath', 'physicalPage', 'classifierSource', 'explored.pr3aExplored', 'explored.issue389Explored']);
    expect(Object.keys(projectInventory(inv)[0]).sort()).toEqual(['classifierSource', 'issue389Explored', 'localPdfPath', 'physicalPage', 'pr3aExplored']);
    for (const f of ['scripts/pipeline-v2/lib/budget-request-toc-h1-new-heldout-membership.ts', 'scripts/pipeline-v2/derive-budget-request-toc-h1-new-heldout-membership.ts']) {
      const src = fs.readFileSync(f, 'utf8');
      const imports = [...src.matchAll(/^import .* from '(.+)';$/gmu)].map(m => m[1]);
      for (const i of imports) expect(['fs', 'path', 'crypto', './lib/budget-request-toc-h1-new-heldout-membership']).toContain(i);
      expect(src).not.toMatch(/nonEmptyLines|rawText\b|assembleTocPage|pdftotext|pdftoppm|h_a1|h_a2|h_a3|bodyLineCount|rightBandEdge/);
    }
  });
  it('新 25 への H1 実行・trigger census・目視・GT・contamination がない', () => {
    expect(man).toMatchObject({ h1ExecutionsOnNewHeldout: 0, triggerCensusOnNewHeldout: 0, contamination: false }); // 本 manifest は membership freeze 時点の記録（後続 unit の GT 作成は別 manifest）
    expect(fs.readdirSync(dir).filter(f => /parser-output|heldout-output|evaluation-result|h1-output/i.test(f))).toEqual([]);
    expect(man.judgment).toBe('READY_FOR_NEW_HELDOUT_VISUAL_GT_FREEZE');
    expect(man.claimBoundary).toMatch(/GO ではない/);
    expect(fs.readdirSync('tests/fixtures/budget-request-toc-row-assembly-evaluation/2024')).toHaveLength(4);
  });
});
