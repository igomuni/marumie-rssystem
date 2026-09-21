/**
 * Budget Flow「RS事業」タブのデータソース。public/data/v2/rs/review-{year}を読む。
 * V1に相当するRS事業一覧・検索・詳細のUIはこれまで存在しなかった新規機能のため、
 * データソース切替（V1/V2）は無い（常にPipeline V2）。
 */
import type { RsProjectSummary, RsProjectDetail } from './rs-model';

async function fetchGzipJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`データを取得できません（${response.status}）。表示用データを再生成してください。`);
  if (!response.body || typeof DecompressionStream === 'undefined') throw new Error('このブラウザは圧縮データの読み込みに対応していません。最新版のブラウザで開いてください。');
  const data = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
  signal.throwIfAborted();
  return data as T;
}

interface V2RsIndexRow {
  projectId: string; projectName: string; ministry: string; bureau: string; startYear?: number;
  officialProjectUrl?: string; reviewYear: number; shard: string; profiles: string[];
  budgetSummary?: { initial?: number; supplements?: number; total?: number };
  hasFundingGraph: boolean;
  graph?: { blockCount: number; semanticEdgeCount: number; hasCycle: boolean; weakComponentCount: number; maxOutDegree: number; orphanBlockIds: string[]; externalRootBlockIds: string[]; duplicateRelationPairCount: number; indirectExpenseCount: number };
  hasCycle?: boolean; hasOrphanBlocks?: boolean; hasDuplicateRelations?: boolean;
  hasMofLink: boolean; mofLinkCount: number; mofSectionCount?: number;
  contextCounts?: { policies?: number; subsidyRules?: number; projectRelations?: number; logicModel?: number; evaluations?: number };
}
interface V2RsIndex { reviewYear: number; projectCount: number; projects: V2RsIndexRow[] }
export interface V2RsManifest {
  reviewYear: number; completeness: 'full' | 'partial';
  sourceAvailability: { downloadCsv: boolean; reviewSheets: boolean; spending: boolean; fundingGraph: boolean };
  projectCount: number;
}

export function toRsProjectSummary(row: V2RsIndexRow): RsProjectSummary {
  return {
    projectId: row.projectId, projectName: row.projectName, ministry: row.ministry, bureau: row.bureau,
    startYear: row.startYear ?? null, officialProjectUrl: row.officialProjectUrl ?? '', reviewYear: row.reviewYear, shard: row.shard,
    profiles: row.profiles,
    budgetInitialYen: row.budgetSummary?.initial ?? null, budgetSupplementsYen: row.budgetSummary?.supplements ?? null, budgetTotalYen: row.budgetSummary?.total ?? null,
    hasFundingGraph: row.hasFundingGraph, blockCount: row.graph?.blockCount ?? 0, semanticEdgeCount: row.graph?.semanticEdgeCount ?? 0,
    hasCycle: Boolean(row.hasCycle), hasOrphanBlocks: Boolean(row.hasOrphanBlocks), hasDuplicateRelations: Boolean(row.hasDuplicateRelations),
    hasMofLink: row.hasMofLink, mofLinkCount: row.mofLinkCount, mofSectionCount: row.mofSectionCount ?? 0,
    contextCounts: {
      policies: row.contextCounts?.policies ?? 0, subsidyRules: row.contextCounts?.subsidyRules ?? 0,
      projectRelations: row.contextCounts?.projectRelations ?? 0, logicModel: row.contextCounts?.logicModel ?? 0, evaluations: row.contextCounts?.evaluations ?? 0,
    },
  };
}

export async function fetchRsIndex(year: number, signal: AbortSignal): Promise<{ projects: RsProjectSummary[]; manifest: V2RsManifest }> {
  const [data, manifest] = await Promise.all([
    fetchGzipJson<V2RsIndex>(`/data/v2/rs/review-${year}/index.json.gz`, signal),
    fetch(`/data/v2/rs/review-${year}/manifest.json`, { signal }).then(r => { if (!r.ok) throw new Error(`manifestを取得できません（${r.status}）`); return r.json(); }) as Promise<V2RsManifest>,
  ]);
  return { projects: data.projects.map(toRsProjectSummary), manifest };
}

export async function fetchRsProjectCore(year: number, shard: string, signal: AbortSignal): Promise<Record<string, RsProjectDetail>> {
  const data = await fetchGzipJson<Record<string, Record<string, unknown>>>(`/data/v2/rs/review-${year}/core/${shard}.json.gz`, signal);
  return Object.fromEntries(Object.entries(data).map(([pid, bundle]) => [pid, {
    projectId: pid,
    project: (bundle.project as RsProjectDetail['project']) ?? {},
    reviewSheet: bundle.reviewSheet as Record<string, unknown> | undefined,
    fundingGraph: bundle.fundingGraph as RsProjectDetail['fundingGraph'],
    mofLinks: bundle.mofLinks as RsProjectDetail['mofLinks'],
    budgetSummaries: bundle.budgetSummaries as RsProjectDetail['budgetSummaries'],
  }]));
}

