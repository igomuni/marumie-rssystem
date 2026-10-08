/**
 * H1 の新 held-out membership を集合差のみで導出する（pure function）。
 *   NEW_HELDOUT = TOC_82 - DEVELOPMENT_34 - FIRST_HELDOUT_23
 * 使ってよい field は identity と classifierSource と explored 判定の identity のみ（下記 whitelist）。
 * raw text・parser・PDF・render・H1・E・row-start token・GT の内容には一切依存しない（import も参照もしない）。
 */
import * as crypto from 'crypto';

export interface PageIdentity { localPdfPath: string; physicalPage: number; classifierSource: 'DIRECT' | 'INHERITED' }
export interface InventoryRow { localPdfPath: string; physicalPage: number; classifierSource: 'DIRECT' | 'INHERITED'; explored: { pr3aExplored: boolean; issue389Explored: boolean } }
export const ALLOWED_FIELDS = ['localPdfPath', 'physicalPage', 'classifierSource', 'explored.pr3aExplored', 'explored.issue389Explored'] as const;

export const pageKey = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** whitelist 以外の field を保持しない形に写す */
export const projectInventory = (rows: InventoryRow[]) => rows.map(r => ({ localPdfPath: r.localPdfPath, physicalPage: r.physicalPage, classifierSource: r.classifierSource, pr3aExplored: r.explored.pr3aExplored, issue389Explored: r.explored.issue389Explored }));

export function deriveNewHeldout(inventory: ReturnType<typeof projectInventory>, ledger390Keys: string[], firstHeldoutKeys: string[]) {
  const dev = new Set(inventory.filter(p => p.pr3aExplored || p.issue389Explored).map(pageKey)); for (const k of ledger390Keys) dev.add(k);
  const first = new Set(firstHeldoutKeys);
  const all = new Set(inventory.map(pageKey));
  const members: PageIdentity[] = inventory.filter(p => !dev.has(pageKey(p)) && !first.has(pageKey(p))).map(p => ({ localPdfPath: p.localPdfPath, physicalPage: p.physicalPage, classifierSource: p.classifierSource }))
    .sort((a, b) => cmp(a.localPdfPath, b.localPdfPath) || a.physicalPage - b.physicalPage);
  const nw = new Set(members.map(pageKey));
  const union = new Set([...dev, ...first, ...nw]);
  const inter = (a: Set<string>, b: Set<string>) => [...a].filter(x => b.has(x)).length;
  return {
    members,
    counts: { total: all.size, development: dev.size, firstHeldout: first.size, newHeldout: nw.size, union: union.size, overlapDevFirst: inter(dev, first), overlapDevNew: inter(dev, nw), overlapFirstNew: inter(first, nw), missing: [...all].filter(k => !union.has(k)).length, outsideInventory: [...union].filter(k => !all.has(k)).length },
    digestSha256: crypto.createHash('sha256').update(members.map(m => `${m.localPdfPath}\t${m.physicalPage}\t${m.classifierSource}`).join('\n')).digest('hex'),
  };
}
