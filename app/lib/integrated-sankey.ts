import type { BudgetBreakdownItem, BudgetSummary } from '@/types/sankey-svg';
import type { MOFKouMokuItem } from '@/types/mof-kou-moku';
import type { MofRsKouMokuLinkageRecord } from '@/types/mof-rs-kou-moku-linkage';
import { parseAmountToYen } from '@/app/lib/format/yen';

export type IntegratedAccountType = 'general' | 'special';

export interface IntegratedSectionNode {
  id: string; name: string; accountType: IntegratedAccountType; ministry: string;
  organization: string; subAccount: string; amount: number; itemCount: number;
  /** 前年度額・増減率。項配下の目を合算する（目単位が null の場合は0として扱う） */
  previousAmount: number; difference: number;
}
/** 'mixed' = 一般会計・特別会計の両方から接続する目を持つ事業。
 * 'unknown' = 予算執行データ（budgetSummary.accountSummaries）もMOF紐づけも
 * 無く、会計区分を判定する材料が無い事業（'general'へ根拠なく決め打ちしない） */
export type IntegratedProjectAccountType = IntegratedAccountType | 'mixed' | 'unknown';
export interface IntegratedProjectNode {
  id: string; projectId: number; name: string; ministry: string; linkedAmount: number;
  /** RS事業の予算額。budgetSummary.totalBudget（予算現額合計＝当初＋補正＋繰越＋予備費使用等を
   * 含む現在の総額）を使う。`/sankey-svg` の事業ノードの予算額（project-budget、
   * scripts/generate-sankey-svg-data.ts）と同じ定義に揃えている。budgetSummary.initialBudget
   * （当初予算のみ）ではない点に注意——補正予算のみで成立した事業はinitialBudgetが0円になり、
   * それを使うと `/sankey-svg` では表示される事業が0円扱いになってしまう */
  budgetAmount: number;
  mofUnlinkedAmount: number; accountType: IntegratedProjectAccountType;
  budgetSummary?: BudgetSummary;
  /** 「2-2_予算・執行_予算種別・歳出予算項目」CSV由来のレコード。対象年度（budgetYear、
   * scripts/generate-sankey-svg-data.ts の TARGET_BUDGET_YEAR）に絞った上で、予算種別
   * （当初予算・補正予算等）は絞らず全件。対象年度以外の年度の行は元データの生成時点で
   * 除かれる（他の年度はこのページの突き合わせ対象＝MOF側の同一年度と対応しないため） */
  budgetBreakdown: BudgetBreakdownItem[];
  /** budgetBreakdown を当年度・当初予算＋補正予算（決算等は除く）に絞り、MOF紐づけ状況を
   * 付与したもの（目一覧タブ用）。当初予算のみだと補正予算経由でしか紐づかない項目が
   * 一覧から丸ごと消えるため（isRsPrimaryBudgetType参照） */
  budgetItems: Array<BudgetBreakdownItem & { connected: boolean }>;
}
export interface IntegratedItemEdge {
  id: string; source: string; target: string; itemKey: string; itemName: string;
  value: number; mofAmount: number; status: 'connected' | 'unconnected' | 'excess';
  projectId?: number; sourceUrl?: string; page?: number | null;
}
export interface IntegratedGraph {
  metadata: { budgetYear: number; rsYear: number; mofAmount: number; connectedAmount: number;
    unconnectedAmount: number; excessAmount: number; sectionCount: number; projectCount: number; itemCount: number };
  sections: IntegratedSectionNode[]; projects: IntegratedProjectNode[]; edges: IntegratedItemEdge[];
}
export interface IntegratedProjectSource {
  projectId: number; name: string; ministry: string;
  budgetSummary?: BudgetSummary; budgetBreakdown?: BudgetBreakdownItem[];
}

export const sectionKey = (l: MofRsKouMokuLinkageRecord) =>
  [l.mofAccountType, l.mofBudgetType, l.mofMinistry, l.mofOrganization, l.mofSubAccount, l.sectionCode].join('|');
export const itemSectionKey = (item: MOFKouMokuItem) =>
  [item.accountType, item.budgetType, item.ministry,
    item.accountType === 'special' ? item.specialAccount : item.organization,
    item.subAccount, item.sectionCode].join('|');

const norm = (value: string) => value.normalize('NFKC').replace(/[\s　]+/g, '');
// RS側の予算種別表記。「当初予算」に加え「第N次補正予算」も対象にする
// （MOF側の「補正予算（第N号）」に対応。generate-mof-rs-kou-moku-linkage.ts の
// resolveMofBudgetType と同じ判定）。当初予算のみだと、紐づけが補正予算経由
// しかないRS側の歳出予算項目が budgetItems（目一覧タブ）に一切現れず、
// 実際は接続しているのに確認しようが無くなる不具合になる
const isRsPrimaryBudgetType = (t: string) => t === '当初予算' || /^第\d+次補正予算$/.test(t);
// 所管・組織／会計・勘定まで一致させる（項・目名だけの一致だと、同じ項目名が別の
// 所管・会計に存在する場合に誤って接続扱いになる可能性がある）。
// scripts/generate-mof-rs-kou-moku-linkage.ts の突合キー（一般会計: 所管|組織・勘定、
// 特別会計: 所管|会計|勘定）と同じ識別子を使う
function budgetItemMatchesLink(item: BudgetBreakdownItem, link: MofRsKouMokuLinkageRecord): boolean {
  const accountMatches = (link.mofAccountType === 'general' && item.accountCategory === '一般会計') ||
    (link.mofAccountType === 'special' && item.accountCategory === '特別会計');
  if (!accountMatches || !isRsPrimaryBudgetType(item.budgetType)) return false;
  const identityMatches = link.mofAccountType === 'general'
    ? norm(item.jurisdiction) === norm(link.mofMinistry) && norm(item.organizationAccount) === norm(link.mofOrganization)
    : norm(item.jurisdiction) === norm(link.mofMinistry) && norm(item.account) === norm(link.mofOrganization) &&
      norm(item.subAccount) === norm(link.mofSubAccount);
  return identityMatches && norm(item.item) === norm(link.sectionName) && norm(item.subItem) === norm(link.subItemName);
}

// MOF項一覧（items）は当初予算のみに限定する。補正予算のamountは「改予算額」＝
// その号成立後の累計額であり当初予算額を包含するため、当初予算と単純合算すると
// 二重計上になる（実測: 単純に対象を広げるとmofAmountが548.6兆円→1002.3兆円まで
// 膨らんだ。実際の国の予算総額は約151兆円）。
//
// 一方 RS事業側の紐づけ（links、projectLinksの元）は補正予算経由も含める。
// 紐づけが補正予算経由のみのRS事業（772件・最大3.47兆円規模、2026-09-13実測）が
// 当初予算限定だと画面から丸ごと消える不具合があったため。この場合、その事業の
// 詳細パネルには「接続しているMOF項がありません」と出る（当初予算のMOF項との
// 目単位の対応が無いため、itemEdgesには含まれない。正しい挙動）
const isPrimaryBudgetType = (t: string) => t === '当初予算' || t.startsWith('補正予算');

export function buildIntegratedGraph(allItems: MOFKouMokuItem[], allLinks: MofRsKouMokuLinkageRecord[],
  projectSources: IntegratedProjectSource[], budgetYear = 2024, rsYear = 2025): IntegratedGraph {
  const items = allItems.filter((item): item is MOFKouMokuItem & { accountType: IntegratedAccountType } =>
    item.budgetType === '当初予算' && (item.accountType === 'general' || item.accountType === 'special'));
  const links = allLinks.filter(link => isPrimaryBudgetType(link.mofBudgetType) && !link.carriedOverFrom && link.rsAmount > 0);
  const linksByItem = new Map<string, MofRsKouMokuLinkageRecord[]>();
  for (const link of links) linksByItem.set(link.kouMokuKey, [...(linksByItem.get(link.kouMokuKey) ?? []), link]);
  const lastItemByKey = new Map<string, MOFKouMokuItem>();
  for (const item of items) lastItemByKey.set(item.key, item);

  const sections = new Map<string, IntegratedSectionNode>();
  const edges = new Map<string, IntegratedItemEdge>();
  let connectedAmount = 0, unconnectedAmount = 0, excessAmount = 0;
  for (const item of items) {
    const source = itemSectionKey(item);
    const section = sections.get(source) ?? { id: source, name: item.sectionName, accountType: item.accountType,
      ministry: item.ministry, organization: item.accountType === 'special' ? item.specialAccount : item.organization,
      subAccount: item.subAccount, amount: 0, itemCount: 0, previousAmount: 0, difference: 0 };
    section.amount += item.amount; section.itemCount += 1;
    section.previousAmount += item.previousAmount ?? 0; section.difference += item.difference ?? 0;
    sections.set(source, section);
    const itemLinks = lastItemByKey.get(item.key) === item ? linksByItem.get(item.key) ?? [] : [];
    const linked = itemLinks.reduce((sum, link) => sum + link.rsAmount, 0);
    for (const link of itemLinks) {
      const id = `${item.id}|project:${link.projectId}`;
      const old = edges.get(id);
      if (old) old.value += link.rsAmount;
      else edges.set(id, { id, source, target: `project:${link.projectId}`, itemKey: item.key,
        itemName: item.subItemName, value: link.rsAmount, mofAmount: item.amount, status: 'connected',
        projectId: link.projectId, sourceUrl: item.sourceUrl, page: item.page });
      connectedAmount += link.rsAmount;
    }
    const residual = item.amount - linked;
    if (residual > 0) {
      edges.set(`${item.id}|unconnected`, { id: `${item.id}|unconnected`, source, target: 'rs-unconnected',
        itemKey: item.key, itemName: item.subItemName, value: residual, mofAmount: item.amount,
        status: 'unconnected', sourceUrl: item.sourceUrl, page: item.page });
      unconnectedAmount += residual;
    } else if (residual < 0) {
      edges.set(`${item.id}|excess`, { id: `${item.id}|excess`, source, target: 'rs-excess', itemKey: item.key,
        itemName: item.subItemName, value: -residual, mofAmount: item.amount, status: 'excess',
        sourceUrl: item.sourceUrl, page: item.page });
      excessAmount += -residual;
    }
  }

  const projectLinks = new Map<number, MofRsKouMokuLinkageRecord[]>();
  for (const link of links) projectLinks.set(link.projectId, [...(projectLinks.get(link.projectId) ?? []), link]);
  const sourceMap = new Map(projectSources.map(source => [source.projectId, source]));
  // projectLinksだけ（紐づけレコードを持つ事業）を回すと、紐づけが1件も無いRS事業が
  // projects配列・検索・フィルタ・列合計から丸ごと消える。projectSources（route.ts経由で
  // 渡される全project-budgetノード）との和集合で回す
  const allProjectIds = new Set<number>([...sourceMap.keys(), ...projectLinks.keys()]);
  const projects: IntegratedProjectNode[] = [];
  for (const projectId of allProjectIds) {
    const rows = projectLinks.get(projectId) ?? [];
    const source = sourceMap.get(projectId);
    const linkedAmount = rows.reduce((sum, link) => sum + link.rsAmount, 0);
    const budgetAmount = source?.budgetSummary?.totalBudget ?? linkedAmount;
    // 会計区分は budgetSummary.accountSummaries（RS事業自身の予算・執行データ、
    // MOF紐づけの成否に関係なく常に正しい）を優先して使う。MOF側とのリンク（rows）
    // だけで判定すると、会計区分の一方がMOFと未紐づけの場合にその会計区分が
    // 抜け落ち、実際は一般・特別両方の目を持つ事業が片方だけの表示になる不具合に
    // なる（例: PID3522は一般会計8325.6億円＋特別会計1576.2億円を持つが、一般会計側は
    // MOFと未紐づけのため rows だけ見ると「特別」単独に誤判定される）
    const toAccountType = (category: string): IntegratedAccountType | null =>
      category === '一般会計' ? 'general' : category === '特別会計' ? 'special' : null;
    const accountTypesFromSummary = new Set(
      (source?.budgetSummary?.accountSummaries ?? [])
        .filter(a => a.totalBudget > 0)
        .map(a => toAccountType(a.accountCategory))
        .filter((t): t is IntegratedAccountType => t !== null),
    );
    // 政府関係機関(agency)はRSに対応する会計区分が無く対象外のはずだが、型上は
    // 除外しきれないため念のためフィルタする（実データでは一般・特別のみのはず）
    const accountTypesFromLinks = new Set(
      rows.map(r => r.mofAccountType).filter((t): t is IntegratedAccountType => t === 'general' || t === 'special'),
    );
    const accountTypes = accountTypesFromSummary.size > 0 ? accountTypesFromSummary : accountTypesFromLinks;
    // 予算執行データ（budgetSummary）もMOF紐づけも無い事業（実測554件）は判定材料が
    // 無いため、根拠なく'general'に決め打ちせず'unknown'にする
    const accountType: IntegratedProjectAccountType =
      accountTypes.size > 1 ? 'mixed' : accountTypes.size === 1 ? [...accountTypes][0] : 'unknown';
    projects.push({ id: `project:${projectId}`, projectId,
      name: rows[0]?.projectName ?? source?.name ?? `事業${projectId}`,
      ministry: rows[0]?.projectMinistry ?? source?.ministry ?? '',
      linkedAmount, budgetAmount, mofUnlinkedAmount: Math.max(0, budgetAmount - linkedAmount), accountType,
      budgetSummary: source?.budgetSummary,
      budgetBreakdown: source?.budgetBreakdown ?? [],
      budgetItems: (source?.budgetBreakdown ?? []).filter(item => item.fiscalYear === budgetYear && isRsPrimaryBudgetType(item.budgetType))
        .map(item => ({ connected: rows.some(link => budgetItemMatchesLink(item, link)), ...item })) });
  }
  return { metadata: { budgetYear, rsYear, mofAmount: items.reduce((sum, item) => sum + item.amount, 0),
    connectedAmount, unconnectedAmount, excessAmount, sectionCount: sections.size, projectCount: projects.length,
    itemCount: items.length }, sections: [...sections.values()].sort((a, b) => b.amount - a.amount),
    projects: projects.sort((a, b) => b.linkedAmount - a.linkedAmount), edges: [...edges.values()] };
}

// ────────────────────────────────────────────────────────────
// ビュー（フィルタ・表示ウィンドウ）: app/integrated-sankey/page.tsx から移設。
// UIレイヤーの状態管理・レイアウト計算とは独立した純粋なデータ変換のため、
// レイヤー規約（app/lib/ = Pure、React/HTTP禁止）に合わせてこちらに置く
// ────────────────────────────────────────────────────────────

/** 部分一致・正規表現の切り替えを1箇所に集約する。不正な正規表現は例外を投げず
 * 「該当なし」として扱う（/sankey-svg の searchRegexError と同じ考え方） */
export function buildMatcher(query: string, useRegex: boolean): { match: (haystack: string) => boolean; error: boolean } {
  const q = query.trim();
  if (!q) return { match: () => true, error: false };
  if (useRegex) {
    try { const re = new RegExp(q, 'i'); return { match: s => re.test(s), error: false }; }
    catch { return { match: () => false, error: true }; }
  }
  const qLower = q.toLowerCase();
  return { match: s => s.toLowerCase().includes(qLower), error: false };
}

export interface RangeWindow { topN: number; offset: number }
export function windowSlice<T>(ranked: T[], w: RangeWindow) {
  const maxOffset = Math.max(0, ranked.length - w.topN);
  const offset = Math.max(0, Math.min(w.offset, maxOffset));
  // 集約対象は窓より後ろ（値が小さい側）の tail のみ。窓より前（オフセットで
  // 飛ばした値が大きい側）は単純に非表示にする（集約しない）。/sankey-svg の
  // tailRecipients = sortedRecips.slice(offset + topN) と同じ設計。ここを
  // 「窓に含まれない全件」にすると、オフセットを進めるたびに元々見えていた
  // 大きい値の項目まで集約ノードに巻き込まれ、値が跳ね上がって見える不具合になる
  return {
    shown: ranked.slice(offset, offset + w.topN),
    tail: ranked.slice(offset + w.topN),
    offset, maxOffset, total: ranked.length,
  };
}

export interface Filters {
  // null = 未選択（絞り込みなし＝すべて含む）。一度でも操作すると配列になり、
  // 空配列は「すべて解除（0件）」を明示的に表す。/sankey-svg の acGeneral/acSpecial/...
  // のような「個々の値が独立してon/offできる」挙動を、空配列=フィルタなしに
  // 圧縮してしまわないための表現
  accounts: string[] | null; ministries: string[] | null;
  sectionNameQuery: string; sectionNameRegex: boolean;
  projectNameQuery: string; projectNameRegex: boolean;
  mofMinText: string; mofMaxText: string; rsMinText: string; rsMaxText: string;
}
export const EMPTY_FILTERS: Filters = {
  accounts: null, ministries: null, sectionNameQuery: '', sectionNameRegex: false,
  projectNameQuery: '', projectNameRegex: false,
  mofMinText: '', mofMaxText: '', rsMinText: '', rsMaxText: '',
};

export const OTHER_SECTIONS = 'other-sections';
export const OTHER_PROJECTS = 'other-projects';

export type NodeKind = 'section' | 'project' | 'other-sections' | 'other-projects';
export type DisplayNode = {
  id: string; name: string; value: number; side: 'left' | 'right'; kind: NodeKind;
  section?: IntegratedSectionNode; project?: IntegratedProjectNode;
  /** RS事業（project/other-projects）のみ: 支出額。/sankey-svg の予算(緑)・支出(橙)の
   * 統合ノードと同じ構図でRS事業ノードを描くために使う */
  spendValue?: number;
};

export function buildView(data: IntegratedGraph, filters: Filters, sectionWindow: RangeWindow, projectWindow: RangeWindow) {
  const mofMin = parseAmountToYen(filters.mofMinText);
  const mofMax = parseAmountToYen(filters.mofMaxText);
  const rsMin = parseAmountToYen(filters.rsMinText);
  const rsMax = parseAmountToYen(filters.rsMaxText);
  const sectionNameMatch = buildMatcher(filters.sectionNameQuery, filters.sectionNameRegex).match;
  const projectNameMatch = buildMatcher(filters.projectNameQuery, filters.projectNameRegex).match;
  // 共管（所管が「A及びB」のような複合表記）を分解して複数値として扱う
  const ministriesOf = (m: string) => m.split(/及び|・|、/).map(s => s.trim()).filter(Boolean);

  const keptSections = data.sections.filter(s =>
    (filters.accounts === null || filters.accounts.includes(s.accountType)) &&
    (filters.ministries === null || ministriesOf(s.ministry).some(m => filters.ministries!.includes(m))) &&
    sectionNameMatch(s.name) &&
    (mofMin === null || s.amount >= mofMin) &&
    (mofMax === null || s.amount <= mofMax));
  const rankedSections = [...keptSections].sort((a, b) => b.amount - a.amount);
  const sectionRange = windowSlice(rankedSections, sectionWindow);
  const sectionsTotal = rankedSections.reduce((a, s) => a + s.amount, 0);
  const sectionTailTotal = sectionRange.tail.reduce((a, s) => a + s.amount, 0);

  const keptProjects = data.projects.filter(p =>
    projectNameMatch(p.name) &&
    (rsMin === null || p.budgetAmount >= rsMin) &&
    (rsMax === null || p.budgetAmount <= rsMax));
  const rankedProjects = [...keptProjects].sort((a, b) => b.budgetAmount - a.budgetAmount);
  const projectRange = windowSlice(rankedProjects, projectWindow);
  const projectsTotal = rankedProjects.reduce((a, p) => a + p.budgetAmount, 0);
  const projectTailTotal = projectRange.tail.reduce((a, p) => a + p.budgetAmount, 0);
  const spendOf = (p: IntegratedProjectNode) => p.budgetSummary?.executedAmount ?? 0;
  const projectTailSpendTotal = projectRange.tail.reduce((a, p) => a + spendOf(p), 0);
  const projectsSpendTotal = rankedProjects.reduce((a, p) => a + spendOf(p), 0);

  const left: DisplayNode[] = sectionRange.shown
    .map((s): DisplayNode => ({ id: s.id, name: s.name, value: s.amount, side: 'left', kind: 'section', section: s }));
  if (sectionRange.tail.length > 0) {
    left.push({ id: OTHER_SECTIONS, name: `その他の項（${sectionRange.tail.length}件）`, value: sectionTailTotal, side: 'left', kind: 'other-sections' });
  }
  const right: DisplayNode[] = projectRange.shown
    .map((p): DisplayNode => ({ id: p.id, name: p.name, value: p.budgetAmount, spendValue: spendOf(p), side: 'right', kind: 'project', project: p }));
  if (projectRange.tail.length > 0) {
    right.push({ id: OTHER_PROJECTS, name: `その他のRS事業（${projectRange.tail.length}件）`, value: projectTailTotal, spendValue: projectTailSpendTotal, side: 'right', kind: 'other-projects' });
  }

  // 「その他」集約ノードの詳細パネル用: 窓より後ろ（tail）に出た項・事業そのもの。
  // 窓より前（オフセットで飛ばした側）は集約に含めない（windowSlice参照）
  const hiddenSections = sectionRange.tail.map(s => ({ name: s.name, value: s.amount }));
  const hiddenProjects = projectRange.tail.map(p => ({ name: p.name, value: p.budgetAmount }));

  return {
    left, right, hiddenSections, hiddenProjects,
    // フィルタ後・ランキング済みの母集合。検索ジャンプ（jumpTo）が buildView と
    // 異なる母集合を使うと、フィルタで除外されたノードを選択してしまい詳細パネルが
    // 空になる不具合になるため、ジャンプ側もこの配列をそのまま使う
    rankedSections, rankedProjects,
    sectionColumnTotal: sectionsTotal, projectColumnTotal: projectsTotal, projectSpendColumnTotal: projectsSpendTotal,
    sectionUniverse: sectionRange.total, sectionMaxOffset: sectionRange.maxOffset, sectionOffset: sectionRange.offset,
    projectUniverse: projectRange.total, projectMaxOffset: projectRange.maxOffset, projectOffset: projectRange.offset,
  };
}

export type ViewModel = ReturnType<typeof buildView>;
