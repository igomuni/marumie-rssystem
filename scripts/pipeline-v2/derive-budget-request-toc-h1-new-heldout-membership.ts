/**
 * H1 の新 held-out membership（集合差のみ）。raw text / parser / PDF / render / H1 に依存しない。
 * 使い方: npx tsx scripts/pipeline-v2/derive-budget-request-toc-h1-new-heldout-membership.ts [--freeze-fixture]
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { deriveNewHeldout, projectInventory, pageKey, type InventoryRow } from './lib/budget-request-toc-h1-new-heldout-membership';

const OUT = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-header-zone-right-row-h1', '2024');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const invPath = path.join('tests', 'fixtures', 'budget-request-toc-physical-row', '2024', 'candidate-inventory.json');
const ledgerPath = path.join('tests', 'fixtures', 'budget-request-toc-physical-row', '2024', 'development-explored-pages.json');
const firstPath = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024', 'heldout-candidates.json');
const inventory = projectInventory(read<{ pages: InventoryRow[] }>(invPath).pages); // whitelist 以外の field は保持しない
const ledger = read<{ pages: { localPdfPath: string; physicalPage: number }[] }>(ledgerPath).pages.map(pageKey);
const first = read<{ membershipDigestSha256: string; pages: { localPdfPath: string; physicalPage: number }[] }>(firstPath);
const d = deriveNewHeldout(inventory, ledger, first.pages.map(pageKey));
const c = d.counts;
if (c.total !== 82 || c.development !== 34 || c.firstHeldout !== 23 || c.newHeldout !== 25 || c.union !== 82 || c.missing !== 0 || c.outsideInventory !== 0 || c.overlapDevFirst + c.overlapDevNew + c.overlapFirstNew !== 0) throw new Error(`STOP_NEW_HELDOUT_POPULATION_MISMATCH ${JSON.stringify(c)}`);
if (first.membershipDigestSha256 !== '8fa5a8a8444be31a637fae618235b0a77c6b37745441edc06534fe63c5a44156') throw new Error('STOP_FROZEN_ARTIFACT_INTEGRITY: first held-out digest');

const membership = {
  schema: 'budget-request-toc-h1-new-heldout-membership/v0',
  status: 'NEW_HELDOUT_MEMBERSHIP_FROZEN',
  derivation: 'NEW_HELDOUT = TOC_82 - DEVELOPMENT_34 - FIRST_HELDOUT_23（集合差のみ。sampling・選別なし）',
  canonicalOrder: ['localPdfPath', 'physicalPage'],
  digestSha256: d.digestSha256,
  digestRule: 'sha256(各 member を `localPdfPath\\tphysicalPage\\tclassifierSource` とし、canonical order で改行連結)',
  counts: { ...c, direct: d.members.filter(m => m.classifierSource === 'DIRECT').length, inherited: d.members.filter(m => m.classifierSource === 'INHERITED').length },
  members: d.members,
};
const memberText = `${JSON.stringify(membership, null, 1)}\n`;
if (process.argv.includes('--freeze-fixture')) {
  fs.writeFileSync(path.join(OUT, 'new-heldout-membership.json'), memberText);
  const manifest = {
    schema: 'budget-request-toc-h1-new-heldout-membership-freeze-manifest/v0',
    status: 'NEW_HELDOUT_MEMBERSHIP_FROZEN',
    createdAt: process.env.FREEZE_CREATED_AT ?? new Date().toISOString(),
    baseMainSha: process.env.BASE_MAIN_SHA ?? null,
    population: { total: c.total, development: c.development, firstHeldout: c.firstHeldout, newHeldout: c.newHeldout },
    overlaps: { developmentFirstHeldout: c.overlapDevFirst, developmentNewHeldout: c.overlapDevNew, firstHeldoutNewHeldout: c.overlapFirstNew },
    unionCount: c.union, missing: c.missing, duplicateRole: 0,
    membershipFileSha256: crypto.createHash('sha256').update(memberText).digest('hex'),
    membershipDigestSha256: d.digestSha256,
    firstHeldoutMembershipDigestSha256: first.membershipDigestSha256,
    derivationMethod: '集合差のみ（identity と classifierSource と explored 判定の identity）。sampling なし・trigger 有無・publisher 比率・positive/negative 比率で選ばない',
    derivationInputs: { inventory: { path: invPath, sha256: sha(invPath), note: '82 TOC page の identity 一覧として使用。whitelist field 以外は読み取り後に保持しない（機械 feature は使用・出力・観測していない）' }, developmentLedger390: { path: ledgerPath, sha256: sha(ledgerPath) }, firstHeldout: { path: firstPath, sha256: sha(firstPath) } },
    allowedMetadata: ['localPdfPath', 'physicalPage', 'classifierSource', 'explored.pr3aExplored', 'explored.issue389Explored', 'frozen population membership'],
    prohibitedEvidence: ['H1 parser output / trigger 有無', 'E', 'row-start token', 'raw-line content', 'GT content', 'PDF visual content / render', '#396 failure similarity', 'ministry / layout による選別'],
    h1ExecutionsOnNewHeldout: 0, triggerCensusOnNewHeldout: 0, rawTextInspected: false, pdfOrRenderInspected: false, visualInspectionCount: 0, gtAuthored: false, contamination: false,
    derivationScriptDependencies: 'fs / path / crypto のみ（raw text / parser / PDF / H1 を import しない）',
    nextUnit: '新 held-out 25 の visual-only GT freeze。H1 execution はその後',
    claimBoundary: 'membership を固定しただけ。新 held-out は未実行・未観測。H1 の安全性・有効性・formal evaluation の GO ではない',
    judgment: 'READY_FOR_NEW_HELDOUT_VISUAL_GT_FREEZE',
  };
  fs.writeFileSync(path.join(OUT, 'new-heldout-membership-freeze-manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
}
console.log(JSON.stringify({ counts: membership.counts, digest: d.digestSha256 }));
