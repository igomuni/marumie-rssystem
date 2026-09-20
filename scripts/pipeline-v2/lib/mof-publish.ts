/**
 * MOF公開データ（public/data/v2/mof/fy{year}）のcompact変換ロジック。
 * 参照実装: Python版 pipeline_v2/publish.py の publish_mof_year。
 *
 * 既存のderive-mof.ts（sections.jsonl・stage-gaps.jsonl）が既に項単位の
 * 集約・unresolvedPreSettlementDeltaYen算出を行っているため、参照実装が
 * publish時に再計算しているこのロジックはderive層の成果物をそのまま
 * indexへ転用する（同じ計算を二重に持たない）。detail shard（records/items/
 * events/relations/rsLinks）はここで新たに組み立てる。
 */
import { stableId } from './stable-id';
import { pick, meaningful } from './publish-common';
import { sectionKeyOf } from './mof-sections';
import type {
  MofBudgetItemRecord, MofDerivedBudgetEvent, MofDerivedSection, MofStageGap, MofIdentityRelation,
  MofRsProjectLinkGroup, SourceRef,
} from '../types';

/** derive-mof.ts（aggregateMofSections）のsections.jsonl・stage-gaps.jsonlと同じID生成。
 *  IDを揃えることで、publish層で別のID体系を持たずにsections.jsonl/stage-gaps.jsonlを
 *  そのまま結合できる（sectionId自体が'mofsec_'で始まるため、256 shardの分割キーには
 *  使わずmofSectionShard()を別途使う） */
const MOFSEC_PREFIX = 'mofsec_';

export function sectionIdOf(row: { accountType: string; ministry: string; organization: string; specialAccount: string; subAccount: string; agency: string; sectionCode: string; sectionName: string }): string {
  return stableId([sectionKeyOf(row)], MOFSEC_PREFIX);
}

/** sectionIdは'mofsec_'固定プレフィックス付きのため、そのまま256 shard分割に使うと
 *  全件が同じ2文字（プレフィックスの先頭）に落ちてしまう。プレフィックスを除いた
 *  ハッシュ本体の先頭2桁を使う（16進・256通りに均等分布する） */
export function mofSectionShard(sectionId: string): string {
  return sectionId.slice(MOFSEC_PREFIX.length, MOFSEC_PREFIX.length + 2);
}

function compactSource(source: SourceRef | undefined): Record<string, unknown> | null {
  if (!source) return null;
  return pick(source as unknown as Record<string, unknown>, ['domain', 'dataset', 'year', 'path', 'zipEntry', 'rowNumber']);
}

export interface MofSectionDetail {
  section: Record<string, unknown>;
  items: { id: string; name: string }[];
  events: { eventType: string; budgetStatus?: string; revision?: number | null; amountYen: number; evidence: Record<string, unknown>[] }[];
  records: Record<string, unknown>[];
  sources: Record<string, unknown>[];
  relations?: Record<string, unknown>[];
  rsLinks?: Record<string, unknown>[];
  stageGaps?: Record<string, unknown>[];
}

const SECTION_META_KEYS = ['id', 'fiscalYear', 'accountType', 'ministry', 'organization', 'specialAccount', 'subAccount', 'agency', 'sectionCode', 'sectionName'] as const satisfies readonly (keyof MofDerivedSection)[];

export function buildMofSectionDetails(
  fiscalYear: number, items: MofBudgetItemRecord[], events: MofDerivedBudgetEvent[],
  relations: MofIdentityRelation[], stageGaps: MofStageGap[], linksByReviewYear: { reviewYear: number; links: MofRsProjectLinkGroup[] }[]
): Map<string, MofSectionDetail> {
  const recordToSection = new Map<string, string>();
  const recordToItemId = new Map<string, string>();
  const itemMeta = new Map<string, { id: string; name: string }>();
  const details = new Map<string, MofSectionDetail>();

  for (const row of items) {
    const sid = sectionIdOf(row);
    recordToSection.set(row.recordId, sid);
    recordToItemId.set(row.recordId, row.itemNaturalKey);
    if (!itemMeta.has(row.itemNaturalKey)) itemMeta.set(row.itemNaturalKey, { id: row.itemNaturalKey, name: row.subItemName });

    if (!details.has(sid)) {
      details.set(sid, {
        section: pick({ ...row, id: sid, fiscalYear } as unknown as Record<string, unknown>, SECTION_META_KEYS as readonly string[]),
        items: [], events: [], records: [], sources: [],
      });
    }
    const detail = details.get(sid)!;
    if (!detail.items.some(i => i.id === row.itemNaturalKey)) detail.items.push(itemMeta.get(row.itemNaturalKey)!);

    const source = compactSource(row.source);
    let sourceRef: number | undefined;
    if (source) {
      const idx = detail.sources.findIndex(s => JSON.stringify(s) === JSON.stringify(source));
      sourceRef = idx >= 0 ? idx : detail.sources.push(source) - 1;
    }
    detail.records.push(pick({
      id: row.recordId, itemId: row.itemNaturalKey, phase: row.phase, budgetStatus: row.budgetStatus,
      revision: row.revision, sourceAmountColumn: row.sourceAmountColumn, sourceRef,
    }, ['id', 'itemId', 'phase', 'budgetStatus', 'revision', 'sourceAmountColumn', 'sourceRef']));
  }

  const eventGroups = new Map<string, Map<string, { eventType: string; budgetStatus?: string; revision?: number | null; amountYen: number; evidence: Record<string, unknown>[] }>>();
  for (const ev of events) {
    const sourceIds = (ev.sourceRecordIds ?? []).filter(id => recordToSection.has(id));
    const sids = sourceIds.length > 0 ? [...new Set(sourceIds.map(id => recordToSection.get(id)!))] : [sectionIdOf(ev as unknown as { accountType: string; ministry: string; organization: string; specialAccount: string; subAccount: string; agency: string; sectionCode: string; sectionName: string })];
    for (const sid of sids) {
      if (!details.has(sid)) details.set(sid, { section: pick({ ...ev, id: sid, fiscalYear } as unknown as Record<string, unknown>, SECTION_META_KEYS as readonly string[]), items: [], events: [], records: [], sources: [] });
      const groupKey = `${ev.eventType}\x1f${ev.budgetStatus ?? ''}\x1f${ev.revision ?? ''}`;
      const sectionGroups = eventGroups.get(sid) ?? new Map();
      const group = sectionGroups.get(groupKey) ?? { eventType: ev.eventType, ...(ev.budgetStatus ? { budgetStatus: ev.budgetStatus } : {}), ...(ev.revision !== null && ev.revision !== undefined ? { revision: ev.revision } : {}), amountYen: 0, evidence: [] };
      group.amountYen += ev.amountYen ?? 0;
      const itemIds = [...new Set(sourceIds.map(id => recordToItemId.get(id)).filter((x): x is string => Boolean(x)))].sort();
      const evidence = pick({
        eventId: ev.eventId, amountYen: ev.amountYen ?? 0, itemName: ev.subItemName ?? '', itemIds, recordIds: sourceIds,
        submittedAmountYen: ev.submittedAmountYen, enactedAmountYen: ev.enactedAmountYen,
      }, ['eventId', 'amountYen', 'itemName', 'itemIds', 'recordIds', 'submittedAmountYen', 'enactedAmountYen']);
      group.evidence.push(evidence);
      sectionGroups.set(groupKey, group);
      eventGroups.set(sid, sectionGroups);
    }
  }
  for (const [sid, groups] of eventGroups) {
    details.get(sid)!.events = [...groups.values()];
  }

  for (const rel of relations) {
    const srcRecords = rel.sourceRecordIds.filter(id => recordToSection.has(id));
    const tgtRecords = rel.targetRecordIds.filter(id => recordToSection.has(id));
    const sids = [...new Set([...srcRecords, ...tgtRecords].map(id => recordToSection.get(id)!))];
    const compact = {
      relationId: rel.relationId, relationType: rel.relationType, evidenceMethod: rel.evidenceMethod,
      sourceStage: rel.sourceStage, targetStage: rel.targetStage,
      sourceSectionIds: [...new Set(srcRecords.map(id => recordToSection.get(id)!))].sort(),
      targetSectionIds: [...new Set(tgtRecords.map(id => recordToSection.get(id)!))].sort(),
      sourceItemIds: [...new Set(srcRecords.map(id => recordToItemId.get(id)).filter((x): x is string => Boolean(x)))].sort(),
      targetItemIds: [...new Set(tgtRecords.map(id => recordToItemId.get(id)).filter((x): x is string => Boolean(x)))].sort(),
      // 生recordIdも残す（budget-flow UIのIdentity/RSタブが原典レコード単位でtraceできるように）
      sourceRecordIds: [...rel.sourceRecordIds].sort(),
      targetRecordIds: [...rel.targetRecordIds].sort(),
    };
    for (const sid of sids) {
      if (!details.has(sid)) continue;
      const detail = details.get(sid)!;
      detail.relations = detail.relations ?? [];
      detail.relations.push(compact);
    }
  }

  for (const { reviewYear, links } of linksByReviewYear) {
    for (const link of links) {
      const mofRecords = link.mofRecordIds.filter(id => recordToSection.has(id));
      const sids = [...new Set(mofRecords.map(id => recordToSection.get(id)!))];
      const compact = {
        linkId: link.linkId, reviewYear, phase: link.phase, revision: link.revision, matchMethod: link.matchMethod,
        projectIds: link.projectIds, itemIds: [...new Set(mofRecords.map(id => recordToItemId.get(id)).filter((x): x is string => Boolean(x)))].sort(),
        mofAmountYen: link.mofAmountYen, rsAmountYen: link.rsAmountYen, differenceYen: link.differenceYen,
        // このlinkのmofRecordIdsが複数sectionにまたがる場合、budget-flow UIで「この項だけの
        // リンクではない」ことが分かるようにする（MOF↔RS linkは1:1を仮定しない原則と同じ理由）
        spansEntities: sids.length > 1,
      };
      for (const sid of sids) {
        if (!details.has(sid)) continue;
        const detail = details.get(sid)!;
        detail.rsLinks = detail.rsLinks ?? [];
        detail.rsLinks.push(compact);
      }
    }
  }

  for (const gap of stageGaps) {
    const detail = details.get(gap.sectionId);
    if (!detail) continue;
    detail.stageGaps = detail.stageGaps ?? [];
    detail.stageGaps.push(pick(gap as unknown as Record<string, unknown>, ['from', 'to', 'deltaYen', 'classification', 'note']));
  }

  for (const detail of details.values()) {
    if (!meaningful(detail.relations)) delete detail.relations;
    if (!meaningful(detail.rsLinks)) delete detail.rsLinks;
    if (!meaningful(detail.stageGaps)) delete detail.stageGaps;
  }

  return details;
}

export function buildMofIndexRow(section: MofDerivedSection, rsLinkCounts: Record<string, number>, rsProjectCount: number, relationCount: number): Record<string, unknown> {
  const row: Record<string, unknown> = { ...section, shard: mofSectionShard(section.id), relationCount };
  if (Object.keys(rsLinkCounts).length > 0) {
    row.rsLinkCounts = rsLinkCounts;
    row.rsProjectCount = rsProjectCount;
  }
  return row;
}
