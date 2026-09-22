import type {
  MofKouMokuV2IdentitySource,
  MofKouMokuV2IdentityRelation,
  MofKouMokuV2LinkGroup,
  MofKouMokuV2LinkageProduct,
} from "@/types/mof-kou-moku-v2-linkage";

async function fetchGzipJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  if (!response.body || typeof DecompressionStream === "undefined") {
    throw new Error("このブラウザは gzip JSON の読み込みに対応していません。");
  }
  const data = await new Response(
    response.body.pipeThrough(new DecompressionStream("gzip")),
  ).json();
  signal.throwIfAborted();
  return data as T;
}

export async function fetchMofKouMokuV2Linkage(
  reviewYear: number,
  fiscalYear: number,
  signal: AbortSignal,
): Promise<MofKouMokuV2LinkageProduct> {
  return fetchGzipJson<MofKouMokuV2LinkageProduct>(
    `/data/v2/ui/mof-kou-moku/review-${reviewYear}-fy${fiscalYear}.json.gz`,
    signal,
  );
}

export function groupV2KouMokuLinksByKey(
  groups: MofKouMokuV2LinkGroup[],
): Map<string, MofKouMokuV2LinkGroup[]> {
  const out = new Map<string, MofKouMokuV2LinkGroup[]>();
  for (const group of groups) {
    const rows = out.get(group.kouMokuKey) ?? [];
    rows.push(group);
    out.set(group.kouMokuKey, rows);
  }
  return out;
}

export function countV2ProjectsByKouMoku(
  byKey: Map<string, MofKouMokuV2LinkGroup[]>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, groups] of byKey) {
    out.set(key, new Set(groups.flatMap((g) => g.projectIds)).size);
  }
  return out;
}

export function groupV2SettlementIdentityByKey(
  relations: MofKouMokuV2IdentityRelation[],
): Map<string, MofKouMokuV2IdentityRelation[]> {
  const out = new Map<string, MofKouMokuV2IdentityRelation[]>();
  for (const relation of relations) {
    const rows = out.get(relation.kouMokuKey) ?? [];
    rows.push(relation);
    out.set(relation.kouMokuKey, rows);
  }
  return out;
}

export function countV2IdentityProjectsByKouMoku(
  byKey: Map<string, MofKouMokuV2IdentityRelation[]>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, relations] of byKey) {
    out.set(
      key,
      new Set(relations.flatMap((relation) => relation.projectIds)).size,
    );
  }
  return out;
}

/** identity sourceを当初・各次補正ごとに符号を保ったまま合算する。 */
export function aggregateV2IdentitySourceAmounts(
  sources: MofKouMokuV2IdentitySource[],
): Map<string, number> {
  const amounts = new Map<string, number>();
  for (const source of sources) {
    const stage =
      source.phase === "initial"
        ? "initial"
        : `supplement-${source.revision ?? 0}`;
    amounts.set(stage, (amounts.get(stage) ?? 0) + source.rsAmountYen);
  }
  return amounts;
}

/** 2-2の金額を符号を保ったままRS事業単位に合算する。 */
export function aggregateRsProjectAmounts(
  records: ReadonlyArray<{
    projectId: string | number;
    budgetAmountYen: number | null;
  }>,
): Map<string, number> {
  const amounts = new Map<string, number>();
  for (const record of records) {
    const projectId = String(record.projectId);
    amounts.set(
      projectId,
      (amounts.get(projectId) ?? 0) + (record.budgetAmountYen ?? 0),
    );
  }
  return amounts;
}
