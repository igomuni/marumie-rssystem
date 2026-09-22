/** Pipeline V2の公開済みリンクを、/mof-kou-moku 用の軽量UI projectionへ展開する。 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { MOFBudgetType, MOFKouMokuData, MOFKouMokuItem } from '@/types/mof-kou-moku';
import type { V2MatchMethod } from '@/app/lib/v2-public-linkage';
import type { MofKouMokuV2LinkGroup, MofKouMokuV2LinkageProduct, MofKouMokuV2Project } from '@/types/mof-kou-moku-v2-linkage';

type Root = { publishSchemaVersion: number; links: { reviewYear: number; fiscalYear: number }[] };
type Link = { linkId: string; phase: 'initial' | 'supplement'; revision: number | null; matchMethod: V2MatchMethod; sectionIds: string[]; projectIds: string[]; mofAmountYen: number; rsAmountYen: number; differenceYen: number };
type DetailLink = Link & { reviewYear: number; itemIds: string[] };
type Detail = { rsLinks?: DetailLink[] };
const read = <T>(p: string) => JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
const readGz = <T>(p: string) => JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString('utf-8')) as T;
const norm = (v: string | null | undefined) => (v ?? '').normalize('NFKC').replace(/\s+/g, '');
function itemKey(i: MOFKouMokuItem) {
  const section = i.accountType === 'general' ? [i.accountType, i.ministry, i.organization, i.sectionCode, i.sectionName]
    : i.accountType === 'special' ? [i.accountType, i.ministry, i.specialAccount, i.subAccount, i.sectionCode, i.sectionName]
    : [i.accountType, i.agency, i.subAccount, i.sectionCode, i.sectionName];
  return [...section, i.subItemCode, i.subItemName].map(norm).join('|');
}
function budgetType(phase: Link['phase'], revision: number | null): MOFBudgetType | null {
  return phase === 'initial' ? '当初予算' : revision === null ? null : `補正予算（第${revision}号）` as MOFBudgetType;
}
function build(reviewYear: number, fiscalYear: number) {
  const rootDir = path.resolve(process.cwd(), 'public/data/v2');
  const legacy = read<MOFKouMokuData>(path.resolve(process.cwd(), `public/data/mof-kou-moku-${fiscalYear}.json`));
  const rows = new Map<string, MOFKouMokuItem[]>();
  for (const item of legacy.items) { const k = `${itemKey(item)}\x1f${item.budgetType}`; rows.set(k, [...(rows.get(k) ?? []), item]); }
  const standalone = readGz<{ links: Link[] }>(path.join(rootDir, 'links', `review-${reviewYear}-fy${fiscalYear}`, 'links.json.gz'));
  const expected = new Set(standalone.links.map(x => x.linkId));
  const byShard = new Map<string, Set<string>>();
  for (const l of standalone.links) for (const id of l.sectionIds) { const shard = id.startsWith('mofsec_') ? id.slice(7, 9) : id.slice(0, 2); const ids = byShard.get(shard) ?? new Set<string>(); ids.add(id); byShard.set(shard, ids); }
  const links = new Map<string, DetailLink>();
  for (const [shard, ids] of byShard) {
    const bundle = readGz<Record<string, Detail>>(path.join(rootDir, 'mof', `fy${fiscalYear}`, 'sections', `${shard}.json.gz`));
    for (const id of ids) for (const link of bundle[id]?.rsLinks ?? []) if (link.reviewYear === reviewYear && expected.has(link.linkId)) {
      const old = links.get(link.linkId); links.set(link.linkId, old ? { ...old, itemIds: [...new Set([...old.itemIds, ...link.itemIds])].sort() } : { ...link, itemIds: [...link.itemIds].sort() });
    }
  }
  const rs = readGz<{ projects: MofKouMokuV2Project[] }>(path.join(rootDir, 'rs', `review-${reviewYear}`, 'index.json.gz'));
  const projects = new Map(rs.projects.map(p => [String(p.projectId), { ...p, projectId: String(p.projectId) }]));
  const groups: MofKouMokuV2LinkGroup[] = []; let unmatched = 0; let ambiguous = 0; let multi = 0;
  for (const link of links.values()) {
    const type = budgetType(link.phase, link.revision); if (!type) continue; if (link.itemIds.length > 1) multi++;
    for (const id of link.itemIds) { const candidates = rows.get(`${id}\x1f${type}`) ?? []; if (candidates.length !== 1) { candidates.length ? ambiguous++ : unmatched++; continue; } const item = candidates[0];
      groups.push({ linkId: link.linkId, reviewYear, fiscalYear, phase: link.phase, revision: link.revision, matchMethod: link.matchMethod, kouMokuKey: item.key, itemNaturalKey: id, mofBudgetType: type, projectIds: [...link.projectIds], projects: link.projectIds.map(id => projects.get(String(id)) ?? { projectId: String(id), projectName: String(id), ministry: '' }), mofAmountYen: link.mofAmountYen, rsAmountYen: link.rsAmountYen, differenceYen: link.differenceYen, spansItems: link.itemIds.length > 1 });
    }
  }
  const product: MofKouMokuV2LinkageProduct = { schemaVersion: 1, sourcePublishSchemaVersion: read<Root>(path.join(rootDir, 'manifest.json')).publishSchemaVersion, generatedAt: new Date().toISOString(), reviewYear, fiscalYear, groups, diagnostics: { sourceLinkGroupCount: standalone.links.length, projectedGroupItemCount: groups.length, unmatchedItemIdCount: unmatched, ambiguousItemIdCount: ambiguous, multiItemGroupCount: multi, linkedKouMokuCount: new Set(groups.map(g => g.kouMokuKey)).size, linkedProjectCount: new Set(groups.flatMap(g => g.projectIds)).size } };
  const output = path.join(rootDir, 'ui/mof-kou-moku', `review-${reviewYear}-fy${fiscalYear}.json.gz`); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, zlib.gzipSync(JSON.stringify(product), { level: 9 }));
  console.log(`review-${reviewYear} × fy${fiscalYear}: groups=${groups.length} items=${product.diagnostics.linkedKouMokuCount} projects=${product.diagnostics.linkedProjectCount} unmatched=${unmatched} ambiguous=${ambiguous}`);
}
const review = process.argv.find(x => x.startsWith('--review=')); const fy = process.argv.find(x => x.startsWith('--fy=')); const root = read<Root>(path.resolve(process.cwd(), 'public/data/v2/manifest.json'));
for (const combo of root.links.filter(x => !review || x.reviewYear === Number(review.split('=')[1])).filter(x => !fy || x.fiscalYear === Number(fy.split('=')[1]))) build(combo.reviewYear, combo.fiscalYear);
