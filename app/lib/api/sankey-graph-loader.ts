/**
 * sankey-svg-{YEAR}-graph.json の読み込み・メモリキャッシュ。
 * /api/sankey/query が使用する（/sankey-svg ページはクライアントで直接 fetch する）。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { GraphData } from '@/types/sankey-svg';

const cache = new Map<string, GraphData>();

export function loadSankeyGraph(year: string): GraphData {
  if (cache.has(year)) return cache.get(year)!;

  const jsonPath = path.join(process.cwd(), 'public', 'data', `sankey-svg-${year}-graph.json`);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `sankey-svg-${year}-graph.json が見つかりません。` +
      `bash scripts/decompress-data.sh または npm run generate-sankey-svg を実行してください。`
    );
  }

  const graph: GraphData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  cache.set(year, graph);
  return graph;
}
