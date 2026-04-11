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
  includeZeroSpending: boolean = true,
  showAggRecipient: boolean = true,
): { nodes: RawNode[]; edges: RawEdge[]; totalRecipientCount: number; aggNodeMembers: Map<string, AggMember[]>; topProjectIds: Set<string> } {
  // Build O(1) lookup map
  const nodeById = new Map(allNodes.map(n => [n.id, n]));

  // Zero-spending exclusion sets (populated only when includeZeroSpending is false)
  const zeroSpendingProjectIds = new Set<string>();
  const zeroSpendingBudgetIds = new Set<string>();
  if (!includeZeroSpending) {
    for (const n of allNodes) {
      if (n.type === 'project-spending' && n.value === 0) {
        zeroSpendingProjectIds.add(n.id);
        if (n.projectId != null) zeroSpendingBudgetIds.add(`project-budget-${n.projectId}`);
      }
    }
  }

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

  // 3. Per-project and per-recipient window/tail spending (all projects, used for re-ranking)
  const projectWindowValue = new Map<string, number>();
  const recipientWindowValue = new Map<string, number>();
  const projectTailValue = new Map<string, number>();
  for (const e of allEdges) {
    if (windowRecipientIds.has(e.target)) {
      projectWindowValue.set(e.source, (projectWindowValue.get(e.source) || 0) + e.value);
      recipientWindowValue.set(e.target, (recipientWindowValue.get(e.target) || 0) + e.value);
    } else if (tailRecipientIds.has(e.target)) {
      projectTailValue.set(e.source, (projectTailValue.get(e.source) || 0) + e.value);
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
    n => n.type === 'project-spending' && topMinistryNames.has(n.ministry || '') && !zeroSpendingProjectIds.has(n.id)
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
    if (pinned && (includeZeroSpending || !zeroSpendingProjectIds.has(pinned.id)) && !topProjectNodes.some(n => n.id === pinnedProjectId)) {
      topProjectNodes.push(pinned);
    }
  }
  const topProjectIds = new Set(topProjectNodes.map(n => n.id));

  // Projects that originally have spending (node.value > 0) but have no flow to any visible recipient
  // (neither window nor tail — all spending goes to above-window recipients only) are effectively hidden.
  // Projects with tail-only flow remain in aggregation and ministry totals.
  // Pinned projects are exempted: they are kept visible even when effectively hidden so that
  // ministryBudgetValue and project budget columns stay in sync.
  // This is computed purely from current state (path-independent).
  const effectivelyHiddenIds = new Set(
    allNodes
      .filter(n => n.type === 'project-spending' && n.value > 0
        && !topProjectIds.has(n.id)  // pinned projects are in topProjectIds — do not hide them
        && (projectWindowValue.get(n.id) || 0) === 0
        && (!showAggRecipient || (projectTailValue.get(n.id) || 0) === 0))
      .map(n => n.id)
  );
  const effectivelyHiddenBudgetIds = new Set(
    allNodes
      .filter(n => n.type === 'project-spending' && effectivelyHiddenIds.has(n.id) && n.projectId != null)
      .map(n => `project-budget-${n.projectId}`)
  );

  const otherMinistryProjects = allNodes.filter(
    n => n.type === 'project-spending' && !topMinistryNames.has(n.ministry || '') && !topProjectIds.has(n.id) && !effectivelyHiddenIds.has(n.id) && !zeroSpendingProjectIds.has(n.id)
  );
  const otherProjects = [
    ...topMinistryAllProjects.filter(n => !topProjectIds.has(n.id) && !effectivelyHiddenIds.has(n.id)),
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
  // Exclude effectively hidden projects (had spending but lost window flow at current offset)
  const ministryBudgetValue = new Map<string, number>();
  for (const n of allNodes) {
    if (n.type === 'project-budget' && n.ministry) {
      if (effectivelyHiddenBudgetIds.has(n.id)) continue;
      if (zeroSpendingBudgetIds.has(n.id)) continue;
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
    // spending node height = window spending only (agg hidden) or total minus above-window (normal).
    const spendingValue = !showAggRecipient
      ? (projectWindowValue.get(n.id) || 0)
      : n.value - (projectAboveWindowSpending.get(n.id) || 0);
    nodes.push({ ...n, value: spendingValue, skipLinkOverride: true });
  }
  // Create __agg-project-budget when aggregated projects have budget (otherProjectBudgetTotal > 0).
  // This can happen even when flow is zero (budget-only projects with no spending edges).
  if (otherProjectBudgetTotal > 0) {
    nodes.push({ id: '__agg-project-budget', name: `${otherProjects.length.toLocaleString()}事業`, type: 'project-budget', value: otherProjectBudgetTotal, skipLinkOverride: true, aggregated: true });
  }
  // Create __agg-project-spending whenever there is flow through it.
  // In range mode: window flow only (no __agg-recipient, so tail-only nodes have no outgoing edge).
  // In normal mode: window OR tail flow (tail goes to __agg-recipient).
  const aggProjectSpendingNeeded = !showAggRecipient ? otherProjectWindowTotal > 0 : (otherProjectWindowTotal > 0 || otherProjectTailTotal > 0);
  if (aggProjectSpendingNeeded) {
    const otherProjectSpendingTotal = !showAggRecipient
      ? otherProjectWindowTotal
      : otherProjects.reduce((s, p) => s + p.value - (projectAboveWindowSpending.get(p.id) || 0), 0);
    nodes.push({ id: '__agg-project-spending', name: `${otherProjects.length.toLocaleString()}事業`, type: 'project-spending', value: otherProjectSpendingTotal, skipLinkOverride: true, aggregated: true });
  }

  for (const [rid] of windowRecipients) {
    const rNode = nodeById.get(rid);
    if (rNode) nodes.push({ ...rNode, value: recipientWindowValue.get(rid) || 0, skipLinkOverride: true });
  }
  // tailValue = total inflow to rank (offset+topRecipient)+ recipients from ALL projects.
  // otherProjectTailTotal is a subset of tailValue (aggregated projects' tail flow),
  // so it must NOT be added separately — that would double-count.
  // Subtract effectively hidden projects' tail spending (excluded from project-spending column).
  const hiddenTailSpending = effectivelyHiddenIds.size > 0
    ? allEdges.filter(e => effectivelyHiddenIds.has(e.source) && tailRecipientIds.has(e.target))
              .reduce((s, e) => s + e.value, 0)
    : 0;
  const tailValue = tailRecipients.reduce((s, [, v]) => s + v, 0) - hiddenTailSpending;
  const aggRecipientValue = tailValue;
  if (showAggRecipient && aggRecipientValue > 0) {
    nodes.push({
      id: '__agg-recipient',
      name: `${tailRecipients.length.toLocaleString()}支出先`,
      type: 'recipient',
      value: aggRecipientValue,
      skipLinkOverride: true,
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
  if (otherProjectBudgetTotal > 0 && aggProjectSpendingNeeded) {
    edges.push({ source: '__agg-project-budget', target: '__agg-project-spending', value: otherProjectBudgetTotal });
  }

  // project-spending → window recipients
  const topProjectSpendingIds = new Set(topProjectNodes.map(n => n.id));
  for (const e of allEdges) {
    if (topProjectSpendingIds.has(e.source) && windowRecipientIds.has(e.target)) edges.push(e);
  }
  // project-spending → __agg-recipient (tail) — skipped when agg-recipient is hidden
  if (showAggRecipient) {
    for (const sp of topProjectNodes) {
      const v = allEdges.filter(e => e.source === sp.id && tailRecipientIds.has(e.target)).reduce((s, e) => s + e.value, 0);
      if (v > 0) edges.push({ source: sp.id, target: '__agg-recipient', value: v });
    }
  }

  // __agg-project-spending → window recipients
  for (const rid of windowRecipientIds) {
    const v = allEdges.filter(e => otherProjectSpendingIds.has(e.source) && e.target === rid).reduce((s, e) => s + e.value, 0);
    if (v > 0) edges.push({ source: '__agg-project-spending', target: rid, value: v });
  }
  // __agg-project-spending → __agg-recipient (tail) — skipped when agg-recipient is hidden
  if (showAggRecipient && otherProjectTailTotal > 0) {
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

  return { nodes, edges, totalRecipientCount, aggNodeMembers, topProjectIds };
}

// ── Custom Layout Engine ──

export function computeLayout(filteredNodes: RawNode[], filteredEdges: RawEdge[], containerWidth: number, containerHeight: number, minNodeGap: number = NODE_PAD) {
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

  const effectivePad = Math.max(NODE_PAD, minNodeGap);

  // Compute the total rendered column height at a given ky using the exact same
  // gap rule used in placement below.
  const colHeight = (colNodes: RawNode[], candidateKy: number): number => {
    let total = 0;
    for (const node of colNodes) {
      const h = Math.max(1, node.value * candidateKy);
      const gap = (effectivePad > NODE_PAD && h < effectivePad) ? effectivePad : NODE_PAD;
      total += h + gap;
    }
    return total;
  };

  // Binary-search for the largest ky such that every column fits within innerH.
  let ky = Infinity;
  for (const [, colNodes] of columns) {
    const totalValue = colNodes.reduce((s, n) => s + n.value, 0);
    if (totalValue <= 0) continue;
    let lo = 0;
    let hi = innerH / totalValue;  // upper bound: ignores floor(1) and gap overhead
    // Expand hi until the column fits at hi (lo stays valid lower bound of ky)
    while (colHeight(colNodes, hi) > innerH && hi > 1e-9) hi /= 2;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (colHeight(colNodes, mid) <= innerH) lo = mid; else hi = mid;
    }
    ky = Math.min(ky, lo);
  }
  // ky=0 is valid: column gap overhead alone exceeds innerH — all nodes get minimum height (1px).
  // Only fall back to ky=1 when no column was processed (all columns empty).
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
      // Apply extra gap only for small nodes (those whose label would be hidden in OFF mode)
      const gap = (effectivePad > NODE_PAD && h < effectivePad) ? effectivePad : NODE_PAD;
      y += h + gap;
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
