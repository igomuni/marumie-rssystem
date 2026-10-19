/**
 * /budget-request-trend 用データの読み込み。
 * 正準データは public/data/v2/ui/budget-request-trend/kou.json.gz
 * （scripts/pipeline-v2/build-budget-request-trend-csv.ts が出力。仕様: docs/budget-request-trend-csv.md）。
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { gunzipSync } from 'zlib';
import type { BudgetRequestTrendData } from '@/types/budget-request-trend';

const FILE = path.join(process.cwd(), 'public', 'data', 'v2', 'ui', 'budget-request-trend', 'kou.json.gz');

let cached: BudgetRequestTrendData | null = null;

/** データが無ければ null（生成が必要） */
export function loadBudgetRequestTrend(): BudgetRequestTrendData | null {
  if (cached) return cached;
  if (!existsSync(FILE)) return null;
  cached = JSON.parse(gunzipSync(readFileSync(FILE)).toString('utf8')) as BudgetRequestTrendData;
  return cached;
}
