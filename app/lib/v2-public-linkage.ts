/**
 * Pipeline V2 の public/data/v2 を UI から読むための軽量アダプタ。
 *
 * PoCでは /mof-kou-v2-poc から使用する。
 * 将来は /mof-kou / /mof-kou-moku / /budget-flow で共通利用する想定。
 *
 * production linkage の判定ロジックはここには置かない。
 * この層は publish 済みの V2 データを表示用に読むだけ。
 */

export type V2MatchMethod = 'exact-name-key' | 'supplemental-exact' | 'mixed';

export interface V2RootManifest {
  schemaVersion: number;
  publishSchemaVersion: number;
  generatedAt: string;
  mof: { fiscalYear: number; sectionCount: number; indexGzipBytes: number }[];
  rs: { reviewYear: number; projectCount: number; completeness: 'full' | 'partial'; indexGzipBytes: number }[];
  links: {
    reviewYear: number;
    fiscalYear: number;
    linkGroupCount: number;
    projectCount: number;
    sectionCount: number;
    gzipBytes: number;
  }[];
}

export interface V2MofSectionIndexRow {
  id: string;
  fiscalYear: number;
  accountType: string;
  ministry: string;
  organization: string;
  specialAccount: string;
  subAccount: string;
  agency: string;
  sectionCode: string;
  sectionName: string;
  itemCount: number;
  eventCount: number;
  stages: string[];
  shard: string;
  relationCount: number;
  rsLinkCounts?: Record<string, number>;
  rsProjectCount?: number;
}

export interface V2MofIndex {
  schemaVersion: number;
  publishSchemaVersion: number;
  fiscalYear: number;
  sectionCount: number;
  recordCount: number;
  eventCount: number;
  settlementChecks: number;
  sections: V2MofSectionIndexRow[];
}

export interface V2MofRsLink {
  linkId: string;
  reviewYear: number;
  phase: 'initial' | 'supplement';
  revision: number | null;
  matchMethod: V2MatchMethod;
  projectIds: string[];
  itemIds: string[];
  mofAmountYen: number;
  rsAmountYen: number;
  differenceYen: number;
  spansEntities: boolean;
}

export interface V2MofSectionDetail {
  section: {
    id: string;
    fiscalYear: number;
    accountType: string;
    ministry: string;
    organization: string;
    specialAccount: string;
    subAccount: string;
    agency: string;
    sectionCode: string;
    sectionName: string;
  };
  items: { id: string; name: string }[];
  rsLinks?: V2MofRsLink[];
}

export interface V2RsProjectIndexRow {
  projectId: string;
  projectName: string;
  ministry: string;
  bureau: string;
  reviewYear: number;
  shard: string;
  hasMofLink?: boolean;
  mofLinkCount?: number;
  mofSectionCount?: number;
}

export interface V2RsIndex {
  schemaVersion: number;
  publishSchemaVersion: number;
  reviewYear: number;
  projectCount: number;
  projects: V2RsProjectIndexRow[];
}

export interface LegacySectionIdentity {
  accountType: string;
  ministry: string;
  organization: string;
  specialAccount: string;
  subAccount: string;
  agency: string;
  sectionCode: string;
  sectionName: string;
}

async function fetchGzipJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  if (!response.body || typeof DecompressionStream === 'undefined') {
    throw new Error('このブラウザは gzip JSON の読み込みに対応していません。');
  }
  const data = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
  signal.throwIfAborted();
  return data as T;
}

export async function fetchV2RootManifest(signal: AbortSignal): Promise<V2RootManifest> {
  const response = await fetch('/data/v2/manifest.json', { signal });
  if (!response.ok) throw new Error(`/data/v2/manifest.json: ${response.status}`);
  const data = await response.json() as V2RootManifest;
  signal.throwIfAborted();
  return data;
}

export async function fetchV2MofIndex(year: number, signal: AbortSignal): Promise<V2MofIndex> {
  return fetchGzipJson<V2MofIndex>(`/data/v2/mof/fy${year}/index.json.gz`, signal);
}

export function v2SectionShard(sectionId: string): string {
  return sectionId.startsWith('mofsec_') ? sectionId.slice(7, 9) : sectionId.slice(0, 2);
}

export async function fetchV2MofSection(
  year: number,
  sectionId: string,
  signal: AbortSignal
): Promise<V2MofSectionDetail> {
  const shard = v2SectionShard(sectionId);
  const bundle = await fetchGzipJson<Record<string, V2MofSectionDetail>>(
    `/data/v2/mof/fy${year}/sections/${shard}.json.gz`,
    signal
  );
  const detail = bundle[sectionId];
  if (!detail) throw new Error(`V2 section が見つかりません: ${sectionId}`);
  return detail;
}

export async function fetchV2RsIndex(reviewYear: number, signal: AbortSignal): Promise<V2RsIndex> {
  return fetchGzipJson<V2RsIndex>(`/data/v2/rs/review-${reviewYear}/index.json.gz`, signal);
}

export const MATCH_METHOD_META: Record<V2MatchMethod, { label: string; description: string }> = {
  'exact-name-key': {
    label: '構造化項目一致',
    description: 'RSの構造化された会計・所管・項・目等からMOF項目を完全一致で特定したリンクです。',
  },
  'supplemental-exact': {
    label: '補足情報から復元',
    description: 'RSの補足情報を構造化し、MOFの完全キーを復元して特定したリンクです。金額で対象を選んでいません。',
  },
  mixed: {
    label: '複合',
    description: '同じMOF項目のリンクgroupに、構造化項目一致と補足情報から復元したRS行の両方を含みます。',
  },
};

export function matchMethodLabel(method: V2MatchMethod): string {
  return MATCH_METHOD_META[method].label;
}

export function phaseLabel(phase: V2MofRsLink['phase'], revision: number | null): string {
  if (phase === 'initial') return '当初予算';
  return revision ? `第${revision}次補正予算` : '補正予算';
}

export function normalizeSpecialAccount(value: string): string {
  return value.replace(/特別会計$/, '');
}

/**
 * 既存 MOF UI の行と V2 section index を意味キーで接続するための PoC helper。
 * ID体系が違っても、項の構造化フィールドが同じならV2 sectionを見つけられる。
 */
export function findV2SectionForLegacyRow(
  rows: V2MofSectionIndexRow[],
  legacy: LegacySectionIdentity
): V2MofSectionIndexRow | null {
  const matches = rows.filter(row =>
    row.accountType === legacy.accountType &&
    row.ministry === legacy.ministry &&
    row.organization === legacy.organization &&
    normalizeSpecialAccount(row.specialAccount) === normalizeSpecialAccount(legacy.specialAccount) &&
    row.subAccount === legacy.subAccount &&
    row.agency === legacy.agency &&
    row.sectionCode === legacy.sectionCode &&
    row.sectionName === legacy.sectionName
  );
  return matches.length === 1 ? matches[0] : null;
}

// ============================================================
// 既存 /mof-kou のUIを維持したままV2 linkageをoverlayするためのhelper
// （63_sonnet-mof-kou-existing-ui-v2-poc.md）
// ============================================================

export interface V2Stage { phase: 'initial' | 'supplement'; revision: number | null }

/**
 * legacy MOFBudgetType（当初予算/暫定予算/補正予算（第N号）/決算）を、V2のphase/revisionへ
 * 変換する。V2 production linkは現状initial/supplementのみを対象にしているため、
 * 暫定予算・決算はnullを返す（別stageへの誤接続を避けるため自動変換しない）。
 */
export function legacyBudgetTypeToV2Stage(budgetType: string): V2Stage | null {
  if (budgetType === '当初予算') return { phase: 'initial', revision: null };
  const m = /^補正予算（第(\d+)号）$/.exec(budgetType);
  if (m) return { phase: 'supplement', revision: Number(m[1]) };
  return null;
}

export function v2StageKey(stage: V2Stage): string {
  return `${stage.phase}\x1f${stage.revision ?? ''}`;
}

/**
 * lib/mof-keys.ts の sectionNaturalKey/itemNaturalKey と同じ規則で、legacy MOFKouMokuItem
 * （V1のkou-mokuパイプライン由来）からV2の itemNaturalKey を独立に再現する。
 * NFKC正規化＋空白除去はJSのnormalize('NFKC')+空白除去で代替する（lib/stable-id.tsの
 * normalizeTextと同じ規則）。
 */
function normalizeTextLike(value: string | null | undefined): string {
  if (!value) return '';
  return value.normalize('NFKC').replace(/\s+/g, '');
}

function legacyScopeParts(legacy: LegacySectionIdentity): string[] {
  if (legacy.accountType === 'general') return [legacy.accountType, legacy.ministry, legacy.organization];
  if (legacy.accountType === 'special') return [legacy.accountType, legacy.ministry, legacy.specialAccount, legacy.subAccount];
  return [legacy.accountType, legacy.agency, legacy.subAccount];
}

export function legacySectionNaturalKey(legacy: LegacySectionIdentity): string {
  return [...legacyScopeParts(legacy), legacy.sectionCode, legacy.sectionName].map(normalizeTextLike).join('|');
}

export function legacyItemNaturalKey(
  legacy: LegacySectionIdentity,
  item: { subItemCode: string; subItemName: string }
): string {
  return [legacySectionNaturalKey(legacy), normalizeTextLike(item.subItemCode), normalizeTextLike(item.subItemName)].join('|');
}

export interface V2StandaloneLink {
  linkId: string;
  phase: 'initial' | 'supplement';
  revision: number | null;
  matchMethod: V2MatchMethod;
  sectionIds: string[];
  projectIds: string[];
  mofAmountYen: number;
  rsAmountYen: number;
  differenceYen: number;
}

export interface V2StandaloneLinksProduct {
  schemaVersion: number;
  publishSchemaVersion: number;
  reviewYear: number;
  fiscalYear: number;
  links: V2StandaloneLink[];
}

export async function fetchV2StandaloneLinks(
  reviewYear: number,
  fiscalYear: number,
  signal: AbortSignal
): Promise<V2StandaloneLinksProduct> {
  return fetchGzipJson<V2StandaloneLinksProduct>(`/data/v2/links/review-${reviewYear}-fy${fiscalYear}/links.json.gz`, signal);
}

/**
 * root manifestのlink productsから、指定fiscalYearに存在するreviewYear候補を求める
 * （新しい順）。fiscalYearとreviewYearは同じ軸ではないため、rootのmof/rs一覧からではなく
 * links一覧から算出する。
 */
export function availableReviewYearsForFiscalYear(manifest: V2RootManifest, fiscalYear: number): number[] {
  return [...new Set(manifest.links.filter(l => l.fiscalYear === fiscalYear).map(l => l.reviewYear))].sort((a, b) => b - a);
}

/**
 * standalone links（一覧全体）から、V2 section id + stageごとのdistinct projectId集合を作る。
 * `/mof-kou`一覧のRS件数・filter・sortをV2化するために使う（section detailを都度取得しない）。
 */
export function buildV2SectionProjectCounts(links: V2StandaloneLink[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const link of links) {
    const key = v2StageKey({ phase: link.phase, revision: link.revision });
    for (const sectionId of link.sectionIds) {
      const mapKey = `${sectionId}\x1f${key}`;
      const set = map.get(mapKey) ?? new Set<string>();
      for (const pid of link.projectIds) set.add(pid);
      map.set(mapKey, set);
    }
  }
  return map;
}

/** 決算用: section内の当初・補正正式linkをstageをまたいでdistinct projectへ集約する。 */
export function buildV2SectionIdentityProjectCounts(links: V2StandaloneLink[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const link of links) {
    for (const sectionId of link.sectionIds) {
      const set = map.get(sectionId) ?? new Set<string>();
      for (const projectId of link.projectIds) set.add(projectId);
      map.set(sectionId, set);
    }
  }
  return map;
}

export interface LegacySectionMappingResult {
  /** legacySectionNaturalKey(legacy) -> 一意接続できたV2 section */
  byLegacyKey: Map<string, V2MofSectionIndexRow>;
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount: number;
}

/**
 * legacy MOFKouSectionSummary（複数行、budgetType違いも含む）をV2 sectionへ一括接続する。
 * 同じ項は複数のbudgetType行（当初/補正/決算等）で重複してlegacy側に現れるが、V2
 * section idはbudgetTypeを区別しないため、legacy row id単位で結果をキャッシュしてよい。
 */
export function mapLegacySectionsToV2(
  legacyRows: LegacySectionIdentity[],
  v2Rows: V2MofSectionIndexRow[]
): LegacySectionMappingResult {
  const byLegacyKey = new Map<string, V2MofSectionIndexRow>();
  let matchedCount = 0, unmatchedCount = 0, ambiguousCount = 0;
  for (const legacy of legacyRows) {
    const matches = v2Rows.filter(row =>
      row.accountType === legacy.accountType &&
      row.ministry === legacy.ministry &&
      row.organization === legacy.organization &&
      normalizeSpecialAccount(row.specialAccount) === normalizeSpecialAccount(legacy.specialAccount) &&
      row.subAccount === legacy.subAccount &&
      row.agency === legacy.agency &&
      row.sectionCode === legacy.sectionCode &&
      row.sectionName === legacy.sectionName
    );
    if (matches.length === 1) { byLegacyKey.set(legacySectionNaturalKey(legacy), matches[0]); matchedCount++; }
    else if (matches.length === 0) unmatchedCount++;
    else ambiguousCount++;
  }
  return { byLegacyKey, matchedCount, unmatchedCount, ambiguousCount };
}

export function lookupV2Section(mapping: LegacySectionMappingResult, legacy: LegacySectionIdentity): V2MofSectionIndexRow | null {
  return mapping.byLegacyKey.get(legacySectionNaturalKey(legacy)) ?? null;
}
