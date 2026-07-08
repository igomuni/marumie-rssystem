/**
 * rs{YEAR}-project-details.json の読み込み・メモリキャッシュ。
 * /api/project-details/[projectId] と app/lib/ai/sankey-chat-agent.ts（深掘りツール）が共用する。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { ProjectDetailsData, ProjectDetail } from '@/types/project-details';
import type { SupportedYear } from '@/app/lib/api/api-notes';

const cache = new Map<SupportedYear, ProjectDetailsData>();

/** 事業詳細データを取得（年度別キャッシュ付き） */
export function loadProjectDetails(year: SupportedYear): ProjectDetailsData {
  if (cache.has(year)) return cache.get(year)!;

  // 展開済み .json を優先。無ければ .gz をその場で展開（prebuild未実行のローカル等でも動く）。
  const base = path.join(process.cwd(), 'public', 'data', `rs${year}-project-details.json`);
  const fileContent = fs.existsSync(base)
    ? fs.readFileSync(base, 'utf-8')
    : zlib.gunzipSync(fs.readFileSync(`${base}.gz`)).toString('utf-8');
  const data = JSON.parse(fileContent) as ProjectDetailsData;
  cache.set(year, data);
  console.log(`[API] Project details data loaded into cache (year=${year})`);
  return data;
}

/** projectId 単体の詳細を取得。見つからなければ undefined */
export function getProjectDetail(year: SupportedYear, projectId: string): ProjectDetail | undefined {
  return loadProjectDetails(year)[projectId];
}
