/**
 * /sankey Global View 事前計算レイアウトスクリプト
 *
 * 全スライダーレベル（支出先ページ）のSankeyレイアウトを事前計算し、
 * sankey-global-layout.json に出力する。
 *
 * generateSankeyData をレベルごとに呼び出す。selectData 内の共通計算
 * （府省庁選択・支出先ランキング）はキャッシュされるため高速。
 *
 * 使い方:
 *   npm run compute-sankey-global-layout
 *
 * 入力: public/data/rs2024-structured.json (要: npm run generate-structured)
 * 出力: public/data/sankey-global-layout.json
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  sankey as d3Sankey,
  sankeyJustify,
  sankeyLinkHorizontal,
  type SankeyNode as D3SankeyNode,
  type SankeyLink as D3SankeyLink,
} from 'd3-sankey';
import { generateSankeyData } from '../app/lib/sankey-generator';
import type { SankeyNode, SankeyLink } from '@/types/preset';

// ── Layout constants (matching SankeyGlobalView.tsx) ──

const SVG_WIDTH = 1200;
const SVG_HEIGHT = 800;
const MARGIN = { top: 40, right: 100, bottom: 40, left: 100 };
const INNER_WIDTH = SVG_WIDTH - MARGIN.left - MARGIN.right;
const INNER_HEIGHT = SVG_HEIGHT - MARGIN.top - MARGIN.bottom;
const NODE_WIDTH = 44;
const NODE_PADDING = 22;

// ── d3-sankey types ──

interface D3Node {
  id: string;
  name: string;
  type: string;
  value: number;
  details?: SankeyNode['details'];
  originalId?: number;
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
}

interface D3Link {
  source: D3Node;
  target: D3Node;
  value: number;
  details?: SankeyLink['details'];
  width?: number;
  y0?: number;
  y1?: number;
}

// ── Output types ──

interface LayoutNodeOutput {
  id: string;
  name: string;
  type: string;
  value: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  originalId?: number;
  details?: SankeyNode['details'];
}

interface LayoutLinkOutput {
  source: string;
  target: string;
  value: number;
  path: string;
  width: number;
  y0: number;
  y1: number;
  details?: SankeyLink['details'];
}

interface LevelLayout {
  nodes: LayoutNodeOutput[];
  links: LayoutLinkOutput[];
}

interface GlobalLayoutData {
  metadata: {
    totalLevels: number;
    recipientsPerLevel: number;
    totalRecipients: number;
    svgWidth: number;
    svgHeight: number;
    margin: typeof MARGIN;
  };
  levels: Record<string, LevelLayout>;
}

// ── Layout computation ──

function computeLayout(nodes: SankeyNode[], links: SankeyLink[]): LevelLayout {
  const d3Nodes: D3Node[] = nodes.map((n) => ({
    id: n.id,
    name: n.name,
    type: n.type,
    value: n.value,
    details: n.details,
    originalId: n.originalId,
  }));

  const nodeMap = new Map(d3Nodes.map((n, i) => [n.id, i]));
  const d3Links: D3Link[] = links
    .filter((l) => nodeMap.has(l.source) && nodeMap.has(l.target))
    .map((l) => ({
      source: d3Nodes[nodeMap.get(l.source)!],
      target: d3Nodes[nodeMap.get(l.target)!],
      value: l.value,
      details: l.details,
    }));

  const generator = d3Sankey<D3Node, D3Link>()
    .nodeId((d) => d.id)
    .nodeWidth(NODE_WIDTH)
    .nodePadding(NODE_PADDING)
    .nodeAlign(sankeyJustify)
    .nodeSort(null)
    .extent([
      [0, 0],
      [INNER_WIDTH, INNER_HEIGHT],
    ]);

  const { nodes: layoutNodes, links: layoutLinks } = generator({
    nodes: d3Nodes,
    links: d3Links,
  });

  const pathGen = sankeyLinkHorizontal<
    D3SankeyNode<D3Node, D3Link>,
    D3SankeyLink<D3Node, D3Link>
  >();

  const outputNodes: LayoutNodeOutput[] = layoutNodes.map((n) => ({
    id: n.id,
    name: n.name,
    type: n.type,
    value: n.value,
    x0: n.x0 ?? 0,
    x1: n.x1 ?? 0,
    y0: n.y0 ?? 0,
    y1: n.y1 ?? 0,
    originalId: n.originalId,
    details: n.details,
  }));

  const outputLinks: LayoutLinkOutput[] = layoutLinks.map((l) => ({
    source: l.source.id,
    target: l.target.id,
    value: l.value,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    path: pathGen(l as any) || '',
    width: l.width ?? 1,
    y0: l.y0 ?? 0,
    y1: l.y1 ?? 0,
    details: l.details,
  }));

  return { nodes: outputNodes, links: outputLinks };
}

// ── Main ──

async function main() {
  console.log('Computing Sankey Global View layouts...\n');

  const MINISTRY_LIMIT = 3;
  const PROJECT_LIMIT = 3;
  const SPENDING_LIMIT = 10;
  const SUBCONTRACT_LIMIT = 10;

  // Step 1: Generate level 0 to discover total recipient count
  console.log('  Generating level 0 (triggers common computation cache)...');
  const startTime = Date.now();

  const level0Data = await generateSankeyData({
    ministryLimit: MINISTRY_LIMIT,
    projectLimit: PROJECT_LIMIT,
    spendingLimit: SPENDING_LIMIT,
    subcontractLimit: SUBCONTRACT_LIMIT,
    spendingDrilldownLevel: 0,
  });

  const totalRecipients = level0Data.metadata.summary.totalFilteredSpendings ?? 0;
  const totalLevels = Math.ceil(totalRecipients / SPENDING_LIMIT);

  console.log(`  Total recipients: ${totalRecipients.toLocaleString()}`);
  console.log(`  Total levels: ${totalLevels}`);
  console.log(`  Level 0 generated in ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`);

  // Step 2: Compute layout for each level
  const levels: Record<string, LevelLayout> = {};

  console.log('  Computing all levels...');
  const layoutStart = Date.now();

  // Level 0
  levels['0'] = computeLayout(level0Data.sankey.nodes, level0Data.sankey.links);

  // Levels 1..N (selectData common computation is cached, so these are fast)
  for (let level = 1; level < totalLevels; level++) {
    if (level % 100 === 0 || level === 1) {
      const elapsed = ((Date.now() - layoutStart) / 1000).toFixed(1);
      process.stdout.write(`  Level ${level}/${totalLevels} (${((level / totalLevels) * 100).toFixed(0)}%, ${elapsed}s)...\r`);
    }

    const data = await generateSankeyData({
      ministryLimit: MINISTRY_LIMIT,
      projectLimit: PROJECT_LIMIT,
      spendingLimit: SPENDING_LIMIT,
      subcontractLimit: SUBCONTRACT_LIMIT,
      spendingDrilldownLevel: level,
    });

    levels[String(level)] = computeLayout(data.sankey.nodes, data.sankey.links);
  }

  const layoutTime = ((Date.now() - layoutStart) / 1000).toFixed(1);
  console.log(`\n  All ${totalLevels} levels computed in ${layoutTime}s`);

  // Step 3: Write output
  const output: GlobalLayoutData = {
    metadata: {
      totalLevels,
      recipientsPerLevel: SPENDING_LIMIT,
      totalRecipients,
      svgWidth: SVG_WIDTH,
      svgHeight: SVG_HEIGHT,
      margin: MARGIN,
    },
    levels,
  };

  const outputPath = path.join(process.cwd(), 'public/data/sankey-global-layout.json');
  const jsonStr = JSON.stringify(output);
  fs.writeFileSync(outputPath, jsonStr);

  const sizeMB = (Buffer.byteLength(jsonStr) / 1024 / 1024).toFixed(1);
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  Output: ${outputPath}`);
  console.log(`  Size: ${sizeMB} MB`);
  console.log(`  Total time: ${totalTime}s`);
  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
