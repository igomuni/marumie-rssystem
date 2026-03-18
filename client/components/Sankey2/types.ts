/** sankey2-layout.json の型定義 */

export interface LayoutNode {
  id: string;
  label: string;
  type: 'total' | 'ministry' | 'project-budget' | 'project-spending' | 'recipient';
  amount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  ministry?: string;
  projectId?: number;
  isIndirect?: boolean;
  chainPaths?: string[];
}

export interface LayoutEdge {
  source: string;
  target: string;
  value: number;
  path: [number, number][];
  width: number;
  edgeType?: 'direct' | 'subcontract';
}

export interface LayoutMetadata {
  layout: {
    totalWidth: number;
    totalHeight: number;
    nodeCount: number;
    edgeCount: number;
    clusterWidth: number;
    clusterHeight: number;
    clusterGap: number;
  };
}

export interface Sankey2LayoutData {
  metadata: LayoutMetadata;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}
