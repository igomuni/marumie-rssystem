import type { MofKouMokuV2LinkGroup, MofKouMokuV2LinkageProduct } from '@/types/mof-kou-moku-v2-linkage';

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

export async function fetchMofKouMokuV2Linkage(
  reviewYear: number,
  fiscalYear: number,
  signal: AbortSignal
): Promise<MofKouMokuV2LinkageProduct> {
  return fetchGzipJson<MofKouMokuV2LinkageProduct>(
    `/data/v2/ui/mof-kou-moku/review-${reviewYear}-fy${fiscalYear}.json.gz`,
    signal
  );
}

export function groupV2KouMokuLinksByKey(
  groups: MofKouMokuV2LinkGroup[]
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
  byKey: Map<string, MofKouMokuV2LinkGroup[]>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, groups] of byKey) {
    out.set(key, new Set(groups.flatMap(g => g.projectIds)).size);
  }
  return out;
}
