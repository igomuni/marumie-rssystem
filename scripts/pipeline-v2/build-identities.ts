/**
 * MOF normalizedイベント（当初・補正・決算）を、項・目単位のcanonical BudgetEntityへ
 * 集約するPipeline V2 derived層の最小実装。
 *
 * スコープ: このPoCで行うのは「MOF内部での項・目コードの同一性解決」のみ。
 * RS事業とMOF項・目のリンク（project-links.json）、移替関係の解決（transfer-links.json）は
 * 意図的に実装しない（identity-resolution.jsonのunresolvedに理由を記録する）。
 * 理由: RS↔MOF紐づけは既存V1調査で事業紐づけ率21.3%と精度が著しく低いことが判明しており
 * （docs/tasks/20260913_1555_統合サンキー再構築の確定仕様.md）、当て推量での統合を避ける
 * という仕様書7節の原則上、専用の設計検討なしに実装すべきではないため。
 *
 * 入力: data/normalized/mof/{year}/budget-events.json
 * 出力: data/derived/{year}/{budget-entities,budget-events,identity-resolution}.json
 *
 * 同一性判定は account+organization+sectionCode+sectionName+itemName の完全一致のみ
 * （matchMethod: 'exact_match'）。名称揺れ・項コード変更をまたいだ統合は行わない
 * （fiscalYearをまたいだ統合も対象外。各年度内で完結する）。
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-identities.ts [year...]
 *   （年度省略時は 2024 2025）
 */
import * as fs from 'fs';
import * as path from 'path';
import type { MofBudgetEvent } from './types';

interface BudgetEntity {
  entityId: string;
  fiscalYear: number;
  account: string;
  organization: string;
  subAccount?: string;
  sectionCode: string;
  sectionName: string;
  itemName: string;
  /** このentityに属する原典イベント件数（初出・補正・決算の合計） */
  eventCount: number;
}

interface DerivedBudgetEvent extends MofBudgetEvent {
  entityId: string;
}

/** 特別会計は「勘定」を含めないと所管・特別会計名だけでは一意にならない（例: 同じ特別会計内の複数勘定） */
function entityKey(e: MofBudgetEvent): string {
  return [e.account, e.organization, e.subAccount ?? '', e.sectionCode, e.sectionName, e.itemName].join('|');
}

function buildEntities(events: MofBudgetEvent[], fiscalYear: number): { entities: BudgetEntity[]; keyToId: Map<string, string> } {
  const keyToId = new Map<string, string>();
  const counts = new Map<string, number>();
  let seq = 0;
  for (const e of events) {
    const key = entityKey(e);
    if (!keyToId.has(key)) keyToId.set(key, `mof-${fiscalYear}-${String(++seq).padStart(5, '0')}`);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const entities: BudgetEntity[] = [...keyToId.entries()].map(([key, entityId]) => {
    const [account, organization, subAccount, sectionCode, sectionName, itemName] = key.split('|');
    return {
      entityId, fiscalYear, account, organization,
      subAccount: subAccount || undefined,
      sectionCode, sectionName, itemName,
      eventCount: counts.get(key) ?? 0,
    };
  });
  return { entities, keyToId };
}

function processYear(year: number): void {
  const inPath = path.join('data', 'normalized', 'mof', String(year), 'budget-events.json');
  if (!fs.existsSync(inPath)) {
    console.log(`\n=== derived: year=${year} ===\n  スキップ（normalized未生成: ${inPath}）`);
    return;
  }
  console.log(`\n=== derived: year=${year} ===`);
  const events: MofBudgetEvent[] = JSON.parse(fs.readFileSync(inPath, 'utf-8'));
  const { entities, keyToId } = buildEntities(events, year);
  const derivedEvents: DerivedBudgetEvent[] = events.map(e => ({ ...e, entityId: keyToId.get(entityKey(e))! }));

  const outDir = path.join('data', 'derived', String(year));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'budget-entities.json'), JSON.stringify(entities, null, 2));
  fs.writeFileSync(path.join(outDir, 'budget-events.json'), JSON.stringify(derivedEvents, null, 2));

  const identityResolution = {
    fiscalYear: year,
    mof: {
      rawEventCount: events.length,
      canonicalEntityCount: entities.length,
      matchMethod: 'exact_match' as const,
      matchKey: 'account+organization+subAccount+sectionCode+sectionName+itemName',
      note: '年度内のみで完結。fiscalYearをまたいだ項コード変更・名称変更の同一性判定はこのPoCでは行わない',
    },
    unresolved: [
      {
        area: 'project-links (RS事業 ↔ MOF項・目)',
        status: 'not_attempted',
        reason: '既存V1調査（docs/tasks/20260913_1555_統合サンキー再構築の確定仕様.md）でRS2024×MOF2023の事業紐づけ率が21.3%と低精度と判明済み。当て推量での統合を避けるため、専用の設計検討を経てから実装する',
      },
      {
        area: 'transfer-links (MOF移替関係)',
        status: 'not_attempted',
        reason: '移替元・移替先の対応表（予算現額移替調書等）を未取り込みのため、このPoCでは対象外',
      },
    ],
  };
  fs.writeFileSync(path.join(outDir, 'identity-resolution.json'), JSON.stringify(identityResolution, null, 2));

  console.log(`  budget-entities.json: ${entities.length}件（raw ${events.length}件から集約）`);
  console.log(`  budget-events.json: ${derivedEvents.length}件（entityId付与）`);
  console.log(`  identity-resolution.json: 出力済み`);
}

function main(): void {
  const years = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
  const targetYears = years.length > 0 ? years : [2024, 2025];
  for (const year of targetYears) processYear(year);
}

main();
