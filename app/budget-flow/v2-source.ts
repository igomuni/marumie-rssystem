/**
 * Budget Flow（/budget-flow）のV2データソースアダプタ。
 * public/data/v2/mof/fy{year}/{index.json.gz, sections/{shard}.json.gz}を、
 * 既存のview model（./model.ts の Index / EntityDetail 等）へ変換する。
 * page.tsx・entity-table.tsx・model.tsはこのアダプタの戻り値をそのまま消費でき、
 * V2 schemaに直接結合しない（V1 readerと差し替え可能にするための層）。
 *
 * V1（旧public/budget-flow-v2）との既知の差分（Phase 1では受容する）:
 *   - sourceYear: MOFのsource-preserving正規化にはRSのreviewYearに相当する
 *     「提出年度」の別軸が無いため、fiscalYearをそのまま流用する。
 *   - identityMethod / rawKeys: V2の項（section）はaccountType+所管+組織+
 *     特別会計+勘定+外局+項コード+項名の完全一致でのみ形成され、V1のような
 *     曖昧一致・複数キーの統合は行っていないため、常に単一のraw keyになる。
 *   - sources[].sha256 / sizeBytes: V2 publishはZIPファイル単位のハッシュを
 *     計算していないため空文字列・0のまま（表示は空欄になるだけで壊れない）。
 *   - comparisons（現行V1との差分タブ）: V2データソース選択時は比較対象の
 *     V1レコードを取得しないため常に空配列。V1データソースを選べば従来どおり表示される。
 */
import type { EntityDetail, EntitySummary, EventGroup, Index, RawRecord } from './model';

async function fetchGzipJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`データを取得できません（${response.status}）。表示用データを再生成してください。`);
  if (!response.body || typeof DecompressionStream === 'undefined') throw new Error('このブラウザは圧縮データの読み込みに対応していません。最新版のブラウザで開いてください。');
  const data = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
  signal.throwIfAborted();
  return data as T;
}

export interface V2SectionIndexRow {
  id: string; fiscalYear: number; accountType: string; ministry: string; organization: string;
  specialAccount: string; subAccount: string; agency: string; sectionCode: string; sectionName: string;
  itemCount: number; eventCount: number; stages: string[]; shard: string; relationCount: number;
  rsLinkCounts?: Record<string, number>; rsProjectCount?: number;
}
interface V2MofIndex {
  fiscalYear: number; sectionCount: number; recordCount: number; eventCount: number; settlementChecks: number;
  sections: V2SectionIndexRow[];
}

export function toEntitySummary(row: V2SectionIndexRow): EntitySummary {
  return {
    id: row.id, fiscalYear: row.fiscalYear, sourceYear: row.fiscalYear,
    accountType: row.accountType, ministry: row.ministry, organization: row.organization,
    specialAccount: row.specialAccount, subAccount: row.subAccount, agency: row.agency,
    sectionCode: row.sectionCode, sectionName: row.sectionName, stages: row.stages,
    eventCount: row.eventCount, relationCount: row.relationCount,
  };
}

export async function fetchV2Index(year: number, signal: AbortSignal): Promise<Index> {
  const data = await fetchGzipJson<V2MofIndex>(`/data/v2/mof/fy${year}/index.json.gz`, signal);
  return {
    fiscalYear: data.fiscalYear, archiveSha256: '', v1File: '', v1Sha256: '',
    eventCount: data.eventCount, recordCount: data.recordCount, settlementChecks: data.settlementChecks,
    entities: data.sections.map(toEntitySummary),
  };
}

interface V2SourceRef { domain?: string; dataset?: string; year?: number; path?: string; zipEntry?: string; rowNumber?: number }
interface V2Record { id: string; itemId: string; phase: string; budgetStatus?: string; revision?: number | null; sourceAmountColumn?: string | null; sourceRef?: number }
interface V2EventGroup { eventType: string; budgetStatus?: string; revision?: number | null; amountYen: number; evidence: { eventId: string; amountYen: number; itemName: string; itemIds: string[]; recordIds: string[]; submittedAmountYen?: number; enactedAmountYen?: number }[] }
interface V2Relation { relationId: string; relationType: string; evidenceMethod: string; sourceSectionIds: string[]; targetSectionIds: string[]; sourceRecordIds: string[]; targetRecordIds: string[] }
interface V2RsLink { linkId: string; reviewYear: number; phase: string; revision: number | null; matchMethod: string; projectIds: string[]; mofAmountYen: number; rsAmountYen: number; differenceYen: number; spansEntities: boolean }
export interface V2SectionDetail {
  section: { id: string; fiscalYear: number; accountType: string; ministry: string; organization: string; specialAccount: string; subAccount: string; agency: string; sectionCode: string; sectionName: string };
  items: { id: string; name: string }[];
  events: V2EventGroup[];
  records: V2Record[];
  sources: V2SourceRef[];
  relations?: V2Relation[];
  rsLinks?: V2RsLink[];
}

function sectionRawKey(section: V2SectionDetail['section']): string {
  return [section.accountType, section.ministry, section.organization, section.specialAccount, section.subAccount, section.agency, section.sectionCode, section.sectionName]
    .filter(Boolean).join('|');
}

export function toEntityDetail(sectionId: string, detail: V2SectionDetail): EntityDetail {
  const { section, sources } = detail;
  const events: EventGroup[] = detail.events.map(e => ({
    eventType: e.eventType, budgetStatus: e.budgetStatus ?? '', revision: e.revision ?? null, amountYen: e.amountYen,
    evidence: e.evidence.map(ev => ({ eventId: ev.eventId, amountYen: ev.amountYen, itemName: ev.itemName, sourceRecordIds: ev.recordIds })),
  }));
  const records: RawRecord[] = detail.records.map(r => {
    const src = r.sourceRef !== undefined ? sources[r.sourceRef] : undefined;
    return {
      recordId: r.id, itemNaturalKey: r.itemId, sectionNaturalKey: sectionRawKey(section),
      phase: r.phase, budgetStatus: r.budgetStatus ?? '', revision: r.revision ?? null, sourceAmountColumn: r.sourceAmountColumn ?? null,
      source: { path: src?.path ?? '', zipEntry: src?.zipEntry ?? '', rowNumber: src?.rowNumber ?? 0 },
    };
  });
  const sourcesByPath = Object.fromEntries(sources.filter(s => s.path).map(s => [s.path!, { path: s.path!, sha256: '', sizeBytes: 0 }]));
  const relations = (detail.relations ?? []).map(r => ({
    relationId: r.relationId, relationType: r.relationType, evidenceMethod: r.evidenceMethod,
    entityIds: [...new Set([...r.sourceSectionIds, ...r.targetSectionIds])],
    sourceRecordIds: r.sourceRecordIds, targetRecordIds: r.targetRecordIds,
  }));
  const links = (detail.rsLinks ?? []).map(l => ({
    linkId: l.linkId, sourceYear: l.reviewYear, fiscalYear: section.fiscalYear, phase: l.phase,
    matchMethod: l.matchMethod, projectIds: l.projectIds, spansEntities: l.spansEntities,
  }));
  const stages = [...new Set(events.map(e => e.eventType))].sort();
  const eventCount = events.reduce((sum, e) => sum + e.evidence.length, 0);
  return {
    id: sectionId, fiscalYear: section.fiscalYear, sourceYear: section.fiscalYear,
    accountType: section.accountType, ministry: section.ministry, organization: section.organization,
    specialAccount: section.specialAccount, subAccount: section.subAccount, agency: section.agency,
    sectionCode: section.sectionCode, sectionName: section.sectionName,
    stages, eventCount, relationCount: relations.length,
    identityMethod: 'exact-match-within-fiscal-year（会計・所管・組織・特別会計・勘定・外局・項コード・項名の完全一致）',
    rawKeys: [sectionRawKey(section)],
    events, records, sources: sourcesByPath, relations, links, comparisons: [],
  };
}

export async function fetchV2EntityDetails(year: number, shard: string, signal: AbortSignal): Promise<Record<string, EntityDetail>> {
  const data = await fetchGzipJson<Record<string, V2SectionDetail>>(`/data/v2/mof/fy${year}/sections/${shard}.json.gz`, signal);
  return Object.fromEntries(Object.entries(data).map(([id, detail]) => [id, toEntityDetail(id, detail)]));
}

/** V2のsection idは16進20桁のためV1（16分割: id[0]）と同じ発想は使えず、
 *  publish側のmofSectionShard()と同じ「'mofsec_'を除いた先頭2桁」で256分割されている */
export function v2ShardOf(entityId: string): string {
  const prefix = 'mofsec_';
  return entityId.startsWith(prefix) ? entityId.slice(prefix.length, prefix.length + 2) : entityId.slice(0, 2);
}
