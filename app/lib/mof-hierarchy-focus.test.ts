import { describe, it, expect } from 'vitest';
import { descendantsByColumn, focusHierarchy, relatedNodeIds } from '@/app/lib/mof-hierarchy-focus';
import type { MOFHierarchyColumn, MOFHierarchyNode } from '@/types/mof-hierarchy';
import type { SankeyLink } from '@/types/sankey';

function node(
  id: string,
  column: MOFHierarchyColumn,
  value: number,
  aggregated = false
): MOFHierarchyNode {
  return {
    id,
    name: id,
    value,
    type: column,
    details: { column, ...(aggregated ? { aggregated: true, aggregatedCount: 3 } : {}) },
  };
}

/**
 * 予算合計 → 所管A / 所管B
 * 所管A → 項A1 / 項の「その他」
 * 所管B → 項の「その他」
 * 項の「その他」 → 事項の「その他」
 */
const NODES: MOFHierarchyNode[] = [
  node('root', 'total', 100),
  node('A', 'ministry', 60),
  node('B', 'ministry', 40),
  node('A1', 'section', 25),
  node('others-section', 'section', 75, true),
  node('others-item', 'item', 75, true),
];

const LINKS: SankeyLink[] = [
  { source: 'root', target: 'A', value: 60 },
  { source: 'root', target: 'B', value: 40 },
  { source: 'A', target: 'A1', value: 25 },
  { source: 'A', target: 'others-section', value: 35 },
  { source: 'B', target: 'others-section', value: 40 },
  { source: 'others-section', target: 'others-item', value: 75 },
];

describe('relatedNodeIds', () => {
  it('自分・祖先・子孫を集める', () => {
    const set = relatedNodeIds(LINKS, 'A');
    expect([...set].sort()).toEqual(
      ['A', 'A1', 'others-item', 'others-section', 'root'].sort()
    );
  });

  it('葉を選ぶと祖先だけが付いてくる', () => {
    expect([...relatedNodeIds(LINKS, 'A1')].sort()).toEqual(['A', 'A1', 'root'].sort());
  });
});

describe('focusHierarchy', () => {
  it('関連しないノードとリンクを落とす', () => {
    const result = focusHierarchy(NODES, LINKS, 'A');
    expect(result.nodes.map(n => n.id)).not.toContain('B');
    expect(result.links.some(l => l.source === 'B')).toBe(false);
  });

  it('祖先の金額を選んだ枝のぶんに置き換える', () => {
    const result = focusHierarchy(NODES, LINKS, 'A');
    // 根は全体の100ではなく、選んだ枝の60になる
    expect(result.nodes.find(n => n.id === 'root')?.value).toBe(60);
    expect(result.links.find(l => l.target === 'A')?.value).toBe(60);
  });

  it('共有している「その他」をこの枝から来た分だけに直す', () => {
    const result = focusHierarchy(NODES, LINKS, 'A');
    // 全体では75だが、所管Aから来たのは35
    expect(result.nodes.find(n => n.id === 'others-section')?.value).toBe(35);
  });

  it('集約の下流リンクも同じ割合で縮める', () => {
    const result = focusHierarchy(NODES, LINKS, 'A');
    // 75 → 35 に縮んだので、次の列の集約への流れも 35 になる
    const downstream = result.links.find(
      l => l.source === 'others-section' && l.target === 'others-item'
    );
    expect(downstream?.value).toBe(35);
    expect(result.nodes.find(n => n.id === 'others-item')?.value).toBe(35);
  });

  it('どの列の合計も根を超えない', () => {
    const result = focusHierarchy(NODES, LINKS, 'A');
    const root = result.nodes.find(n => n.id === 'root')?.value ?? 0;
    const byColumn = new Map<string, number>();
    for (const n of result.nodes) {
      byColumn.set(n.details.column, (byColumn.get(n.details.column) ?? 0) + (n.value ?? 0));
    }
    for (const total of byColumn.values()) {
      expect(total).toBeLessThanOrEqual(root + 1e-9);
    }
  });

  it('複数の親を持つ集約を選ぶと、どの親の枝も残る', () => {
    const result = focusHierarchy(NODES, LINKS, 'others-section');
    expect(result.nodes.map(n => n.id).sort()).toEqual(
      ['A', 'B', 'others-item', 'others-section', 'root'].sort()
    );
    // 各親の実際の寄与がそのまま残る（35 と 40）
    expect(result.links.find(l => l.source === 'A')?.value).toBe(35);
    expect(result.links.find(l => l.source === 'B')?.value).toBe(40);
    // 根はその合計
    expect(result.nodes.find(n => n.id === 'root')?.value).toBe(75);
  });

  it('リンクの順序が変わっても結果は同じ', () => {
    const reversed = [...LINKS].reverse();
    const a = focusHierarchy(NODES, LINKS, 'others-section');
    const b = focusHierarchy(NODES, reversed, 'others-section');
    const value = (r: typeof a, id: string) => r.nodes.find(n => n.id === id)?.value;
    for (const id of ['root', 'A', 'B', 'others-section', 'others-item']) {
      expect(value(b, id)).toBe(value(a, id));
    }
  });

  it('元の配列を書き換えない', () => {
    const before = LINKS.map(l => l.value);
    focusHierarchy(NODES, LINKS, 'A');
    expect(LINKS.map(l => l.value)).toEqual(before);
    expect(NODES.find(n => n.id === 'root')?.value).toBe(100);
  });
});

describe('descendantsByColumn', () => {
  it('列ごとに子孫を金額の大きい順で返す', () => {
    const result = descendantsByColumn(NODES, LINKS, 'A');
    expect(result.get('section')?.map(n => n.id)).toEqual(['others-section', 'A1']);
    expect(result.get('item')?.map(n => n.id)).toEqual(['others-item']);
  });

  it('値の無い列（子孫がいない列）は含まない', () => {
    const result = descendantsByColumn(NODES, LINKS, 'A');
    expect(result.has('ministry')).toBe(false);
    expect(result.has('subAccount')).toBe(false);
  });

  it('自分自身は子孫に含めない', () => {
    const result = descendantsByColumn(NODES, LINKS, 'A');
    const allIds = [...result.values()].flat().map(n => n.id);
    expect(allIds).not.toContain('A');
  });

  it('葉ノード（事項）を選ぶと空になる', () => {
    const result = descendantsByColumn(NODES, LINKS, 'others-item');
    expect(result.size).toBe(0);
  });
});
