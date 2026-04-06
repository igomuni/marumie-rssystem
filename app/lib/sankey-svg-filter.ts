import type { RawNode, RawEdge, LayoutNode, LayoutLink } from '@/types/sankey-svg';
import { MARGIN, NODE_W, NODE_PAD, getColumn, sortPriority } from '@/app/lib/sankey-svg-constants';

// ── Client-side TopN filtering ──

type AggMember = { id: string; name: string; value: number; ministry?: string };

export function filterTopN(
  allNodes: RawNode[],
  allEdges: RawEdge[],
  topMinistry: number,
  topProject: number,
  topRecipient: number,
  recipientOffset: number,
  pinnedProjectId: string | null = null,
  hiddenProjectIds: Set<string> = new Set(),
): { nodes: RawNode[]; edges: RawEdge[]; totalRecipientCount: number; aggNodeMembers: Map<string, AggMember[]>; topProjectIds: Set<string>; projectsWithWindowFlow: Set<string> } {
  // Build O(1) lookup map
  const nodeById = new Map(allNodes.map(n => [n.id, n]));

  // 1. TopN ministries by total value (stable ranking)
  const ministries = allNodes.filter(n => n.type === 'ministry').sort((a, b) => b.value - a.value);
  const topMinistryNodes = ministries.slice(0, topMinistry);
  const topMinistryIds = new Set(topMinistryNodes.map(n => n.id));
  const topMinistryNames = new Set(topMinistryNodes.map(n => n.name));
  const otherMinistries = ministries.slice(topMinistry);

  // 2. Recipient window — ranked by total amount across ALL edges (stable ranking)
  const allRecipientAmounts = new Map<string, number>();
  for (const e of allEdges) {
    if (e.target.startsWith('r-')) {
      allRecipientAmounts.set(e.target, (allRecipientAmounts.get(e.target) || 0) + e.value);
    }
  }
  const allSortedRecipients = Array.from(allRecipientAmounts.entries()).sort((a, b) => b[1] - a[1]);
  const totalRecipientCount = allSortedRecipients.length;
  const windowRecipients = allSortedRecipients.slice(recipientOffset, recipientOffset + topRecipient);
  const windowRecipientIds = new Set(windowRecipients.map(([id]) => id));
  const tailRecipients = allSortedRecipients.slice(recipientOffset + topRecipient);
  const tailRecipientIds = new Set(tailRecipients.map(([id]) => id));

  // 3. Per-project and per-recipient window spending (all projects, used for re-ranking)
  const projectWindowValue = new Map<string, number>();
  const recipientWindowValue = new Map<string, number>();
  for (const e of allEdges) {
    if (windowRecipientIds.has(e.target)) {
      projectWindowValue.set(e.source, (projectWindowValue.get(e.source) || 0) + e.value);
      recipientWindowValue.set(e.target, (recipientWindowValue.get(e.target) || 0) + e.value);
    }
  }

  // Recipients before the window (rank 0..offset-1) are neither in window nor tail — their flow is hidden.
  // Compute per-project spending to these hidden recipients so we can subtract from node heights.
  const aboveWindowRecipientIds = new Set(allSortedRecipients.slice(0, recipientOffset).map(([id]) => id));
  const projectAboveWindowSpending = new Map<string, number>();
  if (recipientOffset > 0) {
    for (const e of allEdges) {
      if (aboveWindowRecipientIds.has(e.target)) {
        projectAboveWindowSpending.set(e.source, (projectAboveWindowSpending.get(e.source) || 0) + e.value);
      }
    }
  }

  // 4. TopN projects re-ranked by WINDOW spending (dynamic as offset changes)
  //    Scope: projects belonging to top ministries only
  const topMinistryAllProjects = allNodes.filter(
    n => n.type === 'project-spending' && topMinistryNames.has(n.ministry || '')
  );
  topMinistryAllProjects.sort(
    (a, b) => (projectWindowValue.get(b.id) || 0) - (projectWindowValue.get(a.id) || 0)
  );
  const topProjectNodes = topMinistryAllProjects
    .slice(0, topProject)
    .filter(n => (projectWindowValue.get(n.id) || 0) > 0);
  // Pin: force-include the pinned project (TopN+1) if not already present
  if (pinnedProjectId) {
    const pinned = allNodes.find(n => n.id === pinnedProjectId && n.type === 'project-spending');
    if (pinned && !topProjectNodes.some(n => n.id === pinnedProjectId)) {
      topProjectNodes.push(pinned);
    }
  }
  const topProjectIds = new Set(topProjectNodes.map(n => n.id));

  const otherMinistryProjects = allNodes.filter(
    n => n.type === 'project-spending' && !topMinistryNames.has(n.ministry || '') && !topProjectIds.has(n.id) && !hiddenProjectIds.has(n.id)
  );
  const otherProjects = [
    ...topMinistryAllProjects.filter(n => !topProjectIds.has(n.id) && !hiddenProjectIds.has(n.id)),
    ...otherMinistryProjects,
  ];
  const otherProjectSpendingIds = new Set(otherProjects.map(n => n.id));

  // 5. Aggregated values
  let otherProjectWindowTotal = 0;
  let otherProjectTailTotal = 0;
  const otherProjectsWithFlow = new Set<string>();
  for (const e of allEdges) {
    if (!otherProjectSpendingIds.has(e.source)) continue;
    if (windowRecipientIds.has(e.target)) {
      otherProjectWindowTotal += e.value;
      otherProjectsWithFlow.add(e.source);
    } else if (tailRecipientIds.has(e.target)) {
      otherProjectTailTotal += e.value;
      otherProjectsWithFlow.add(e.source);
    }
  }
  // Sum of budget amounts for aggregated projects (budget-column height basis).
  const otherProjectBudgetTotal = otherProjects.reduce((s, p) => {
    const bn = p.projectId != null ? nodeById.get(`project-budget-${p.projectId}`) : undefined;
    return s + (bn?.value ?? 0);
  }, 0);

  const totalWindowSpending = windowRecipients.reduce((s, [, v]) => s + v, 0);

  // 6. Ministry window values (for edge widths)
  const ministryWindowValue = new Map<string, number>();
  for (const e of allEdges) {
    if (windowRecipientIds.has(e.target)) {
      const spNode = nodeById.get(e.source);
      if (spNode?.type === 'project-spending' && spNode.ministry) {
        ministryWindowValue.set(spNode.ministry, (ministryWindowValue.get(spNode.ministry) || 0) + e.value);
      }
    }
  }
  const otherMinistryWindowValue = otherMinistries.reduce((s, n) => s + (ministryWindowValue.get(n.name) || 0), 0);

  // 7. Ministry budget totals (sum of project-budget values per ministry — for node heights)
  // Exclude hidden projects (projects that left TopN due to offset change)
  const ministryBudgetValue = new Map<string, number>();
  for (const n of allNodes) {
    if (n.type === 'project-budget' && n.ministry) {
      const spendingId = n.projectId != null ? `project-spending-${n.projectId}` : null;
      if (spendingId && hiddenProjectIds.has(spendingId)) continue;
      ministryBudgetValue.set(n.ministry, (ministryBudgetValue.get(n.ministry) || 0) + n.value);
    }
  }
  const totalBudget = Array.from(ministryBudgetValue.values()).reduce((s, v) => s + v, 0);
  const otherMinistryBudgetValue = otherMinistries.reduce((s, n) => s + (ministryBudgetValue.get(n.name) || 0), 0);

  // ── Build nodes ──
  const nodes: RawNode[] = [];
  const totalNode = allNodes.find(n => n.type === 'total');
  if (totalNode) nodes.push({ ...totalNode, value: totalBudget, skipLinkOverride: true });

  for (const n of topMinistryNodes) {
    const bv = ministryBudgetValue.get(n.name) || 0;
    if (bv > 0) nodes.push({ ...n, value: bv, skipLinkOverride: true });
  }
  if (otherMinistryBudgetValue > 0) {
    nodes.push({ id: '__agg-ministry', name: `${otherMinistries.length.toLocaleString()}省庁`, type: 'ministry', value: otherMinistryBudgetValue, skipLinkOverride: true, aggregated: true });
  }

  for (const n of topProjectNodes) {
    const wv = projectWindowValue.get(n.id) || 0;
    const budgetNode = nodeById.get(`project-budget-${n.projectId}`);
    // Budget height = original budget amount (budget-column basis).
    // skipLinkOverride prevents layout engine from overriding with edge-sum (which is window spending).
    if (budgetNode) nodes.push({ ...budgetNode, skipLinkOverride: true });
    // spending node height = total spending minus spending to above-window (hidden) recipients.
    const hidden = projectAboveWindowSpending.get(n.id) || 0;
    nodes.push({ ...n, value: n.value - hidden, skipLinkOverride: true });
  }
  // Create __agg-project-budget only when there is window spending (needs ministry→budget edges).
  // Create __agg-project-spending whenever there is ANY flow through it (window OR tail),
  // so that the tail edge __agg-project-spending→__agg-recipient always has a valid source node.
  if (otherProjectWindowTotal > 0 || otherProjectTailTotal > 0) {
    if (otherProjectBudgetTotal > 0) {
      nodes.push({ id: '__agg-project-budget', name: `${otherProjects.length.toLocaleString()}事業`, type: 'project-budget', value: otherProjectBudgetTotal, skipLinkOverride: true, aggregated: true });
    }
    const otherProjectSpendingTotal = otherProjects.reduce((s, p) => s + p.value - (projectAboveWindowSpending.get(p.id) || 0), 0);
    nodes.push({ id: '__agg-project-spending', name: `${otherProjects.length.toLocaleString()}事業`, type: 'project-spending', value: otherProjectSpendingTotal, skipLinkOverride: true, aggregated: true });
  }

  for (const [rid] of windowRecipients) {
    const rNode = nodeById.get(rid);
    if (rNode) nodes.push({ ...rNode, value: recipientWindowValue.get(rid) || 0, skipLinkOverride: true });
  }
  // tailValue = total inflow to rank (offset+topRecipient)+ recipients from ALL projects.
  // otherProjectTailTotal is a subset of tailValue (aggregated projects' tail flow),
  // so it must NOT be added separately — that would double-count.
  // Also subtract tail spending from hidden projects (they are excluded from project-spending column).
  const hiddenTailSpending = hiddenProjectIds.size > 0
    ? allEdges.filter(e => hiddenProjectIds.has(e.source) && tailRecipientIds.has(e.target))
              .reduce((s, e) => s + e.value, 0)
    : 0;
  const tailValue = tailRecipients.reduce((s, [, v]) => s + v, 0) - hiddenTailSpending;
  const aggRecipientValue = tailValue;
  if (aggRecipientValue > 0) {
    // Cap layout height so the aggregate bar doesn't overwhelm the window recipients.
    // Cap = min window-recipient value × topRecipient  (≈ total height of all window bars if all were minimum-sized).
    const minWindowRecipientValue = windowRecipients.length > 0
      ? Math.min(...windowRecipients.map(([, v]) => v))
      : aggRecipientValue;
    const layoutCap = minWindowRecipientValue * topRecipient;
    nodes.push({
      id: '__agg-recipient',
      name: `${tailRecipients.length.toLocaleString()}支出先`,
      type: 'recipient',
      value: aggRecipientValue,
      layoutCap: layoutCap,
      aggregated: true,
    });
  }

  // ── Build edges ──
  const edges: RawEdge[] = [];

  // total → ministry (budget-based)
  for (const mn of topMinistryNodes) {
    const bv = ministryBudgetValue.get(mn.name) || 0;
    if (bv > 0) edges.push({ source: 'total', target: mn.id, value: bv });
  }
  if (otherMinistryBudgetValue > 0) {
    edges.push({ source: 'total', target: '__agg-ministry', value: otherMinistryBudgetValue });
  }

  // ministry → project-budget (budget-based)
  for (const n of topProjectNodes) {
    const budgetNode = nodeById.get(`project-budget-${n.projectId}`);
    const bv = budgetNode?.value ?? 0;
    const ministrySource = topMinistryNames.has(n.ministry || '') ? `ministry-${n.ministry}` : '__agg-ministry';
    if (bv > 0) edges.push({ source: ministrySource, target: `project-budget-${n.projectId}`, value: bv });
  }
  if (otherProjectBudgetTotal > 0) {
    for (const mn of topMinistryNodes) {
      const v = otherProjects
        .filter(p => p.ministry === mn.name && p.projectId != null)
        .reduce((s, p) => s + (nodeById.get(`project-budget-${p.projectId}`)?.value ?? 0), 0);
      if (v > 0) edges.push({ source: mn.id, target: '__agg-project-budget', value: v });
    }
    const otherMinRemain = otherProjects
      .filter(p => !topMinistryNames.has(p.ministry || '') && p.projectId != null)
      .reduce((s, p) => s + (nodeById.get(`project-budget-${p.projectId}`)?.value ?? 0), 0);
    if (otherMinRemain > 0) edges.push({ source: '__agg-ministry', target: '__agg-project-budget', value: otherMinRemain });
  }

  // project-budget → project-spending (budget-based)
  for (const n of topProjectNodes) {
    const budgetNode = nodeById.get(`project-budget-${n.projectId}`);
    const bv = budgetNode?.value ?? 0;
    if (bv > 0) edges.push({ source: `project-budget-${n.projectId}`, target: n.id, value: bv });
  }
  if (otherProjectBudgetTotal > 0) {
    edges.push({ source: '__agg-project-budget', target: '__agg-project-spending', value: otherProjectBudgetTotal });
  }

  // project-spending → window recipients
  const topProjectSpendingIds = new Set(topProjectNodes.map(n => n.id));
  for (const e of allEdges) {
    if (topProjectSpendingIds.has(e.source) && windowRecipientIds.has(e.target)) edges.push(e);
  }
  // project-spending → __agg-recipient (tail)
  for (const sp of topProjectNodes) {
    const v = allEdges.filter(e => e.source === sp.id && tailRecipientIds.has(e.target)).reduce((s, e) => s + e.value, 0);
    if (v > 0) edges.push({ source: sp.id, target: '__agg-recipient', value: v });
  }

  // __agg-project-spending → window recipients
  for (const rid of windowRecipientIds) {
    const v = allEdges.filter(e => otherProjectSpendingIds.has(e.source) && e.target === rid).reduce((s, e) => s + e.value, 0);
    if (v > 0) edges.push({ source: '__agg-project-spending', target: rid, value: v });
  }
  // __agg-project-spending → __agg-recipient (tail)
  if (otherProjectTailTotal > 0) {
    edges.push({ source: '__agg-project-spending', target: '__agg-recipient', value: otherProjectTailTotal });
  }

  // Build aggregation membership map for side panel display
  const aggNodeMembers = new Map<string, { id: string; name: string; value: number; ministry?: string }[]>();
  // __agg-ministry → actual ministry nodes
  if (otherMinistries.length > 0) {
    aggNodeMembers.set('__agg-ministry', otherMinistries.map(n => ({
      id: n.id, name: n.name, value: ministryBudgetValue.get(n.name) || 0,
    })).sort((a, b) => b.value - a.value));
  }
  // __agg-project-budget / __agg-project-spending → actual project-budget nodes
  if (otherProjects.length > 0) {
    const projectBudgetMembers = otherProjects.map(sp => {
      const bn = sp.projectId != null ? nodeById.get(`project-budget-${sp.projectId}`) : undefined;
      return { id: bn?.id ?? `project-budget-${sp.projectId}`, name: sp.name, value: bn?.value ?? 0, ministry: sp.ministry };
    }).sort((a, b) => b.value - a.value);
    aggNodeMembers.set('__agg-project-budget', projectBudgetMembers);
    aggNodeMembers.set('__agg-project-spending', otherProjects.map(sp => ({
      id: sp.id, name: sp.name, value: sp.value, ministry: sp.ministry,
    })).sort((a, b) => b.value - a.value));
  }
  // __agg-recipient → tail recipient nodes
  if (tailRecipients.length > 0) {
    aggNodeMembers.set('__agg-recipient', tailRecipients.map(([id, value]) => {
      const n = nodeById.get(id);
      return { id, name: n?.name ?? id, value };
    }));
  }

  const projectsWithWindowFlow = new Set(
    allNodes.filter(n => n.type === 'project-spending' && (projectWindowValue.get(n.id) || 0) > 0).map(n => n.id)
  );
  return { nodes, edges, totalRecipientCount, aggNodeMembers, topProjectIds, projectsWithWindowFlow };
}

// ── Custom Layout Engine ──

export function computeLayout(filteredNodes: RawNode[], filteredEdges: RawEdge[], containerWidth: number, containerHeight: number) {
  const innerW = containerWidth - MARGIN.left - MARGIN.right;
  const innerH = containerHeight - MARGIN.top - MARGIN.bottom;
  const usedCols = new Set<number>();
  for (const n of filteredNodes) usedCols.add(getColumn(n));
  const maxCol = Math.max(...usedCols, 1);
  const colSpacing = (innerW - NODE_W) / maxCol;

  const nodeMap = new Map<string, LayoutNode>();
  for (const n of filteredNodes) {
    nodeMap.set(n.id, { ...n, x0: 0, x1: 0, y0: 0, y1: 0, sourceLinks: [], targetLinks: [] });
  }

  const links: LayoutLink[] = [];
  for (const l of filteredEdges) {
    const src = nodeMap.get(l.source);
    const tgt = nodeMap.get(l.target);
    if (!src || !tgt) continue;
    const link: LayoutLink = { source: src, target: tgt, value: l.value, sourceWidth: 0, targetWidth: 0, y0: 0, y1: 0 };
    links.push(link);
    src.sourceLinks.push(link);
    tgt.targetLinks.push(link);
  }

  const nodes = Array.from(nodeMap.values());
  for (const node of nodes) {
    const srcSum = node.sourceLinks.reduce((s, l) => s + l.value, 0);
    const tgtSum = node.targetLinks.reduce((s, l) => s + l.value, 0);
    const linkValue = Math.max(srcSum, tgtSum);
    if (linkValue > 0 && !node.skipLinkOverride) node.value = linkValue;
    // Apply layout cap: preserve actual value in rawValue, shrink value for height computation
    if (node.layoutCap !== undefined && node.value > node.layoutCap) {
      node.rawValue = node.value;
      node.value = node.layoutCap;
    }
  }

  const columns: Map<number, LayoutNode[]> = new Map();
  for (const node of nodes) {
    const col = getColumn(node);
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(node);
  }

  for (const [, colNodes] of columns) {
    colNodes.sort((a, b) => {
      const ap = sortPriority(a);
      const bp = sortPriority(b);
      if (ap !== bp) return ap - bp;
      return b.value - a.value;
    });
  }

  let ky = Infinity;
  for (const [, colNodes] of columns) {
    const totalValue = colNodes.reduce((s, n) => s + n.value, 0);
    const totalPadding = Math.max(0, (colNodes.length - 1) * NODE_PAD);
    const available = innerH - totalPadding;
    if (totalValue > 0) ky = Math.min(ky, available / totalValue);
  }
  if (!isFinite(ky)) ky = 1;

  for (const [col, colNodes] of columns) {
    for (const node of colNodes) {
      node.x0 = col * colSpacing;
      node.x1 = node.x0 + NODE_W;
    }
    let y = 0;
    for (const node of colNodes) {
      const h = Math.max(1, node.value * ky);
      node.y0 = y;
      node.y1 = y + h;
      y += h + NODE_PAD;
    }
  }

  // Sort links by target/source y-position so ribbons don't cross unnecessarily
  for (const node of nodes) {
    node.sourceLinks.sort((a, b) => a.target.y0 - b.target.y0);
    node.targetLinks.sort((a, b) => a.source.y0 - b.source.y0);
  }

  for (const node of nodes) {
    const nodeHeight = node.y1 - node.y0;
    const totalSrcValue = node.sourceLinks.reduce((s, l) => s + l.value, 0);
    const totalTgtValue = node.targetLinks.reduce((s, l) => s + l.value, 0);
    let sy = node.y0;
    for (const link of node.sourceLinks) {
      const proportion = totalSrcValue > 0 ? link.value / totalSrcValue : 0;
      link.sourceWidth = nodeHeight * proportion;
      link.y0 = sy;
      sy += link.sourceWidth;
    }
    let ty = node.y0;
    for (const link of node.targetLinks) {
      const proportion = totalTgtValue > 0 ? link.value / totalTgtValue : 0;
      link.targetWidth = nodeHeight * proportion;
      link.y1 = ty;
      ty += link.targetWidth;
    }
  }

  // Content bounding box (in inner coords, before MARGIN)
  let contentMaxX = 0, contentMaxY = 0;
  for (const node of nodes) {
    contentMaxX = Math.max(contentMaxX, node.x1);
    contentMaxY = Math.max(contentMaxY, node.y1);
  }

  const LABEL_SPACE = 200; // approximate space for rightmost column labels
  return { nodes, links, ky, maxCol, innerW, innerH, contentW: contentMaxX + NODE_W + LABEL_SPACE, contentH: contentMaxY };
}
