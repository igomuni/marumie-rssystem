export interface RawNode {
  id: string;
  name: string;
  type: 'total' | 'ministry' | 'project-budget' | 'project-spending' | 'recipient';
  value: number;
  /** Actual value preserved when layout height is capped (used for tooltip display) */
  rawValue?: number;
  /** If set, layout engine caps node height to this value after computing link-sum */
  layoutCap?: number;
  /** If true, layout engine skips the link-sum override so node.value stays as initialized */
  skipLinkOverride?: boolean;
  aggregated?: boolean;
  projectId?: number;
  ministry?: string;
}

export interface RawEdge {
  source: string;
  target: string;
  value: number;
}

export interface GraphData {
  metadata: {
    totalBudget: number;
    totalSpending: number;
    directSpending: number;
    indirectSpending: number;
    ministryCount: number;
    projectCount: number;
    recipientCount: number;
  };
  nodes: RawNode[];
  edges: RawEdge[];
}

export interface LayoutNode extends RawNode {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  sourceLinks: LayoutLink[];
  targetLinks: LayoutLink[];
}

export interface LayoutLink {
  source: LayoutNode;
  target: LayoutNode;
  value: number;
  sourceWidth: number;
  targetWidth: number;
  y0: number;
  y1: number;
}
