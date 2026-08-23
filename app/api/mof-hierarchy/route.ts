/**
 * MOF 事項別内訳の階層サンキー API。
 *
 * データ源は事項別内訳（`mof-jikou-{YEAR}.json`）で、専用の生成物は持たない。
 * 組み立ては `app/lib/mof-hierarchy-sankey.ts` に委譲する。
 */

import { NextResponse } from 'next/server';
import { API_CACHE_CONTROL, serverErrorResponse } from '@/app/lib/api/api-notes';
import { availableYears, loadYear } from '@/app/lib/api/mof-jikou-loader';
import { buildMOFHierarchySankey, DEFAULT_TOP_N } from '@/app/lib/mof-hierarchy-sankey';
import type {
  MOFHierarchyColumn,
  MOFHierarchyOffset,
  MOFHierarchyTopN,
} from '@/types/mof-hierarchy';
import type { MOFBudgetType } from '@/types/mof-jikou';

/** TopN の上限。これを超えるとラベルが潰れて読めなくなる */
const TOP_N_MAX = 40;

/**
 * TopN のクエリパラメータ名。列ごとに1つ持つ。
 * URL を短く保ちたいので列名そのままではなく短縮形を使う。
 */
const TOP_N_PARAMS: Array<[Exclude<MOFHierarchyColumn, 'total'>, string]> = [
  ['ministry', 'topMinistry'],
  ['organization', 'topOrganization'],
  ['subAccount', 'topSubAccount'],
  ['section', 'topSection'],
  ['item', 'topItem'],
];

/** 表示開始位置のクエリパラメータ名。列ごとに1つ持つ */
const OFFSET_PARAMS: Array<[Exclude<MOFHierarchyColumn, 'total'>, string]> = [
  ['ministry', 'offsetMinistry'],
  ['organization', 'offsetOrganization'],
  ['subAccount', 'offsetSubAccount'],
  ['section', 'offsetSection'],
  ['item', 'offsetItem'],
];

/** 開始位置は0以上の整数。範囲外の丸めは組み立て側が持つ */
function parseOffset(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function parseTopN(raw: string | null, fallback: number | undefined): number | undefined {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), TOP_N_MAX);
}

/**
 * GET /api/mof-hierarchy
 *
 * クエリ:
 *   year       — 会計年度（西暦）。省略時は収録済みの最新年度
 *   budgetType — 予算種別。省略時・その年度に無い場合は当初予算
 *   topSection — 項の TopN
 *   topItem    — 事項の TopN
 */
export async function GET(request: Request) {
  try {
    const years = availableYears();
    if (years.length === 0) {
      return NextResponse.json(
        { error: 'データが生成されていません。npm run generate-mof-jikou を実行してください。' },
        { status: 503 }
      );
    }

    const params = new URL(request.url).searchParams;
    const rawYear = params.get('year');
    const year = rawYear ? Number(rawYear) : years[0];
    if (!years.includes(year)) {
      return NextResponse.json(
        { error: `対象外の年度です: ${rawYear}`, availableYears: years },
        { status: 400 }
      );
    }

    const data = loadYear(year);
    const budgetTypes = data.metadata.budgetTypes;
    // 種別が1つも無いと、以降の絞り込みが全件を落として「空の図」を正常応答してしまう。
    // 本当に事項が無い年度と区別が付かないので、ここで異常として返す
    if (budgetTypes.length === 0) {
      return NextResponse.json(
        { error: `${year}年度に収録されている予算種別がありません。` },
        { status: 503 }
      );
    }
    const requested = params.get('budgetType') as MOFBudgetType | null;
    // 年度を変えたときに前の種別が無いことがあるので、無ければ当初予算に落とす
    const budgetType =
      requested && budgetTypes.includes(requested)
        ? requested
        : (budgetTypes.find(t => t === '当初予算') ?? budgetTypes[0]);

    // TopN は列ごとに指定できる。指定の無い列は既定値
    const topN: MOFHierarchyTopN = Object.fromEntries(
      TOP_N_PARAMS.map(([column, param]) => [
        column,
        parseTopN(params.get(param), DEFAULT_TOP_N[column]),
      ])
    );

    const offset: MOFHierarchyOffset = Object.fromEntries(
      OFFSET_PARAMS.map(([column, param]) => [column, parseOffset(params.get(param))])
    );

    const result = buildMOFHierarchySankey(data.items, {
      fiscalYear: year,
      eraLabel: data.metadata.eraLabel,
      budgetType,
      budgetTypes,
      availableYears: years,
      topN,
      offset,
    });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': API_CACHE_CONTROL },
    });
  } catch (error) {
    return serverErrorResponse('MOF Hierarchy API', error);
  }
}
