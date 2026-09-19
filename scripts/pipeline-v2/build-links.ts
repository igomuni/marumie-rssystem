/**
 * RS事業 ↔ MOF BudgetEntity（項・目）を完全一致キーで結合し、project-links.jsonを作る。
 *
 * 方式はV1（scripts/generate-mof-rs-kou-moku-linkage.ts）と同じ: RSの2-2 CSV
 * （予算種別・歳出予算項目）はMOFの科目別内訳と同じ語彙（所管・組織/特別会計・勘定・項・目）を
 * 持つため、名前照合や語幹一致は使わず完全一致キーで直接突き合わせる（V1実測: 一般会計・当初予算で
 * 事業の92.7%・金額の97.9%が一致）。誤検出は原理上ない（両者が同じMOF語彙を使っているため）。
 *
 * V1との違い: V1はbudgetType（当初/補正第N号）ごとに別キー空間で照合するが、V2のMOF
 * BudgetEntityは同一項・目であればbudgetTypeをまたいで1つのentityに集約済みのため
 * （build-identities.ts）、budgetTypeを区別せず「事業がそのentityに一度でも予算計上したか」
 * のみを見る。決算目への引き継ぎ（V1の3.5節）もこのPoCでは行わない
 * （決算entityと予算entityは元々同じ集約キーで既に統合されているため引き継ぎ自体が不要）。
 *
 * 入力: data/derived/{year}/budget-entities.json, data/normalized/rs/{year}/budget-items.json
 * 出力: data/derived/{year}/project-links.json
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-links.ts [year...]
 *   （年度省略時は 2024 2025）
 */
import * as fs from 'fs';
import * as path from 'path';
import type { RsBudgetItem } from './types';

interface BudgetEntity {
  entityId: string;
  account: string;
  organization: string;
  subAccount?: string;
  sectionName: string;
  itemName: string;
}

interface ProjectLink {
  projectId: string;
  entityId: string;
  amount: number;
}

/** 突合用の文字列正規化: NFKC + 空白除去（V1のnorm()と同じ） */
function norm(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '');
}

function entityMatchKey(account: string, organization: string, subAccount: string, sectionName: string, itemName: string): string {
  return [norm(account), norm(organization), norm(subAccount), norm(sectionName), norm(itemName)].join('|');
}

function processYear(year: number): void {
  const entitiesPath = path.join('data', 'derived', String(year), 'budget-entities.json');
  const itemsPath = path.join('data', 'normalized', 'rs', String(year), 'budget-items.json');
  console.log(`\n=== project-links: year=${year} ===`);
  if (!fs.existsSync(entitiesPath) || !fs.existsSync(itemsPath)) {
    console.log(`  スキップ（未生成: ${!fs.existsSync(entitiesPath) ? entitiesPath : itemsPath}）`);
    return;
  }

  const entities: BudgetEntity[] = JSON.parse(fs.readFileSync(entitiesPath, 'utf-8'));
  const entityByKey = new Map<string, string>();
  for (const e of entities) {
    const key = entityMatchKey(e.account, e.organization, e.subAccount ?? '', e.sectionName, e.itemName);
    entityByKey.set(key, e.entityId); // 同一キーが複数entityIdを持つことは無い（build-identitiesで既に一意化済み）
  }

  const items: RsBudgetItem[] = JSON.parse(fs.readFileSync(itemsPath, 'utf-8'));
  const targetItems = items.filter(i => i.fiscalYear === year && (i.accountCategory === '一般会計' || i.accountCategory === '特別会計'));

  const linkMap = new Map<string, ProjectLink>(); // `${projectId}|${entityId}`
  let linkedRows = 0;
  let totalAmount = 0;
  let linkedAmount = 0;
  const totalProjects = new Set<string>();
  const linkedProjects = new Set<string>();

  for (const item of targetItems) {
    totalAmount += item.amount;
    totalProjects.add(item.projectId);
    const key = entityMatchKey(item.ministry, item.organization, item.subAccount, item.sectionName, item.itemName);
    const entityId = entityByKey.get(key);
    if (!entityId) continue;

    linkedRows++;
    linkedAmount += item.amount;
    linkedProjects.add(item.projectId);
    const pairKey = `${item.projectId}|${entityId}`;
    const existing = linkMap.get(pairKey);
    if (existing) existing.amount += item.amount;
    else linkMap.set(pairKey, { projectId: item.projectId, entityId, amount: item.amount });
  }

  const links = [...linkMap.values()].sort((a, b) => b.amount - a.amount);
  const outDir = path.join('data', 'derived', String(year));
  fs.writeFileSync(path.join(outDir, 'project-links.json'), JSON.stringify(links, null, 2));

  console.log(`  対象行（一般会計＋特別会計）: ${targetItems.length}件`);
  console.log(`  完全一致: ${linkedRows}行 → project-links.json: ${links.length}件（事業×entity）`);
  console.log(`  事業カバレッジ: ${linkedProjects.size} / ${totalProjects.size} (${(linkedProjects.size / totalProjects.size * 100).toFixed(1)}%)`);
  console.log(`  金額カバレッジ: ${(linkedAmount / 1e12).toFixed(2)} / ${(totalAmount / 1e12).toFixed(2)} 兆円 (${(linkedAmount / totalAmount * 100).toFixed(1)}%)`);

  // identity-resolution.jsonにprojectLinksの解決結果を追記し、unresolvedから外す
  const irPath = path.join(outDir, 'identity-resolution.json');
  if (fs.existsSync(irPath)) {
    const ir = JSON.parse(fs.readFileSync(irPath, 'utf-8'));
    ir.projectLinks = {
      matchMethod: 'exact_match',
      matchKey: 'ministry+organization+subAccount+sectionName+itemName (NFKC正規化)',
      targetRows: targetItems.length,
      linkedRows,
      linkCount: links.length,
      projectTotal: totalProjects.size,
      projectLinked: linkedProjects.size,
      amountTotal: totalAmount,
      amountLinked: linkedAmount,
      note: 'V1(generate-mof-rs-kou-moku-linkage.ts)と同方式。budgetTypeは区別せずentity単位で判定',
    };
    ir.unresolved = (ir.unresolved ?? []).filter((u: { area: string }) => !u.area.startsWith('project-links'));
    fs.writeFileSync(irPath, JSON.stringify(ir, null, 2));
  }
}

function main(): void {
  const years = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
  const targetYears = years.length > 0 ? years : [2024, 2025];
  for (const year of targetYears) processYear(year);
}

main();
