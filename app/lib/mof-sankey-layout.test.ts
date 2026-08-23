import { describe, it, expect } from 'vitest';
import { computeMOFSankeyLayout } from '@/app/lib/mof-sankey-layout';
import type { SankeyLink, SankeyNode } from '@/types/sankey';

type Node = SankeyNode & { name?: string; details?: { passThrough?: boolean } };

const OPTIONS = {
  width: 1000,
  height: 600,
  margin: { top: 20, right: 100, bottom: 20, left: 100 },
  nodeWidth: 10,
  nodePadding: 4,
};

/** 列を type で明示する（階層図と同じ使い方） */
const columnOf = (node: { type?: string }) => Number(node.type ?? 0);

describe('computeMOFSankeyLayout', () => {
  it('列は指定した番号に置かれる', () => {
    const nodes: Node[] = [
      { id: 'a', name: 'a', value: 100, type: '0' },
      { id: 'b', name: 'b', value: 100, type: '2' },
    ];
    const links: SankeyLink[] = [{ source: 'a', target: 'b', value: 100 }];
    const layout = computeMOFSankeyLayout({ nodes, links }, { ...OPTIONS, columnOf });
    expect(layout.columnCount).toBe(3);
    expect(layout.nodes.find(n => n.id === 'b')?.column).toBe(2);
  });

  it('ラベルスロットを指定すると、小さいノードもその高さを確保する', () => {
    const nodes: Node[] = [
      { id: 'big', name: 'big', value: 1000, type: '0' },
      { id: 'tiny', name: 'tiny', value: 1, type: '0' },
    ];
    const layout = computeMOFSankeyLayout(
      { nodes, links: [] },
      { ...OPTIONS, columnOf, minNodeSlot: 20, align: 'top' }
    );
    const tiny = layout.nodes.find(n => n.id === 'tiny');
    const big = layout.nodes.find(n => n.id === 'big');
    // 箱自体は値どおり小さいが、次のノードとの間隔がスロットぶん空く
    expect(tiny && big && tiny.y - big.y).toBeGreaterThanOrEqual(20);
  });

  it('スロットで膨らんでも列は指定した高さに収まる', () => {
    // 小さいノードを多く含めると、素朴な按分ではスロット分だけ列がはみ出す
    const nodes: Node[] = [
      { id: 'big', name: 'big', value: 10000, type: '0' },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `small-${i}`,
        name: `small-${i}`,
        value: 1,
        type: '0',
      })),
    ];
    const layout = computeMOFSankeyLayout(
      { nodes, links: [] },
      { ...OPTIONS, columnOf, minNodeSlot: 13, align: 'top' }
    );
    expect(layout.contentHeight).toBeLessThanOrEqual(OPTIONS.height + 1);
  });

  it('通過ノードはスロットも余白も取らない', () => {
    const withPass: Node[] = [
      { id: 'p', name: '', value: 100, type: '0', details: { passThrough: true } },
      { id: 'q', name: '', value: 100, type: '0', details: { passThrough: true } },
    ];
    const withReal: Node[] = [
      { id: 'p', name: 'p', value: 100, type: '0' },
      { id: 'q', name: 'q', value: 100, type: '0' },
    ];
    const passLayout = computeMOFSankeyLayout(
      { nodes: withPass, links: [] },
      { ...OPTIONS, columnOf, minNodeSlot: 40, align: 'top' }
    );
    const realLayout = computeMOFSankeyLayout(
      { nodes: withReal, links: [] },
      { ...OPTIONS, columnOf, minNodeSlot: 40, align: 'top' }
    );
    // 実ノードはスロットで間隔が空くが、通過ノードは詰まる
    const passGap = passLayout.nodes[1].y - passLayout.nodes[0].y;
    const realGap = realLayout.nodes[1].y - realLayout.nodes[0].y;
    expect(passGap).toBeLessThan(realGap);
  });

  it('帯はノードの上端から順に積まれ、幅は値に比例する', () => {
    const nodes: Node[] = [
      { id: 'src', name: 'src', value: 300, type: '0' },
      { id: 'a', name: 'a', value: 200, type: '1' },
      { id: 'b', name: 'b', value: 100, type: '1' },
    ];
    const links: SankeyLink[] = [
      { source: 'src', target: 'a', value: 200 },
      { source: 'src', target: 'b', value: 100 },
    ];
    const layout = computeMOFSankeyLayout({ nodes, links }, { ...OPTIONS, columnOf });
    const [first, second] = layout.links;
    expect(second.y0).toBeCloseTo(first.y0 + first.width, 5);
    expect(first.width / second.width).toBeCloseTo(2, 1);
  });

  it('align: top は列を上端から積む', () => {
    const nodes: Node[] = [{ id: 'a', name: 'a', value: 1, type: '0' }];
    const top = computeMOFSankeyLayout(
      { nodes, links: [] },
      { ...OPTIONS, columnOf, align: 'top' }
    );
    expect(top.nodes[0].y).toBe(OPTIONS.margin.top);
  });

  it('高さが不揃いでも、ラベル中心の間隔が minNodeSlot を下回らない', () => {
    // スロットはノード上端から測るのにラベルは中心に出るので、
    // 素朴に max(h + padding, slot) とすると中心間隔が slot を割り込む。
    //
    // 崩れるのは「slot をわずかに超える高さのノード」の直後に極小ノードが来る並び。
    // ここでは mid の高さが約 19px（slot=18 を超えるので slot 側の下限が効かない）に
    // なるよう値を選んでいる。中心間隔は 19/2 + padding + 1/2 ≒ 14px にしかならない。
    const nodes: Node[] = [
      { id: 'filler', name: 'filler', value: 27000, type: '0' },
      { id: 'mid', name: 'mid', value: 1000, type: '0' },
      { id: 'tiny', name: 'tiny', value: 10, type: '0' },
    ];
    const slot = 18;
    const layout = computeMOFSankeyLayout(
      { nodes, links: [] },
      { ...OPTIONS, columnOf, align: 'top', minNodeSlot: slot }
    );
    const mid = layout.nodes.find(n => n.id === 'mid')!;
    // 前提が崩れていないこと（この高さでないとテストが素通りする）
    expect(mid.height).toBeGreaterThan(slot);
    expect(mid.height).toBeLessThan(slot * 2);

    const centers = layout.nodes.map(n => n.y + n.height / 2).sort((a, b) => a - b);
    for (let i = 1; i < centers.length; i += 1) {
      expect(centers[i] - centers[i - 1]).toBeGreaterThanOrEqual(slot - 1e-9);
    }
  });

  it('通過ノードを挟んでも、ラベル中心の間隔が minNodeSlot を下回らない', () => {
    // 隣（list[i+1]）だけを見ると、間に通過ノードが挟まった並びで
    // スロットが広がらず、見えているラベル同士が近づいてしまう
    const nodes: Node[] = [
      { id: 'filler', name: 'filler', value: 27000, type: '0' },
      { id: 'mid', name: 'mid', value: 1000, type: '0' },
      { id: 'pass', name: '', value: 10, type: '0', details: { passThrough: true } },
      { id: 'tiny', name: 'tiny', value: 10, type: '0' },
    ];
    const slot = 18;
    const layout = computeMOFSankeyLayout(
      { nodes, links: [] },
      { ...OPTIONS, columnOf, align: 'top', minNodeSlot: slot }
    );
    // 前提が崩れていないこと（この高さでないとテストが素通りする）
    const mid = layout.nodes.find(n => n.id === 'mid')!;
    expect(mid.height).toBeGreaterThan(slot);
    expect(mid.height).toBeLessThan(slot * 2);

    // ラベルを出すノードだけで中心間隔を見る
    const centers = layout.nodes
      .filter(n => !(n.details as { passThrough?: boolean } | undefined)?.passThrough)
      .map(n => n.y + n.height / 2)
      .sort((a, b) => a - b);
    for (let i = 1; i < centers.length; i += 1) {
      expect(centers[i] - centers[i - 1]).toBeGreaterThanOrEqual(slot - 1e-9);
    }
  });

  it('通過ノードはラベルを持たないので中心間隔の対象にしない', () => {
    const nodes: Node[] = [
      { id: 'big', name: 'big', value: 1000, type: '0' },
      { id: 'pass', name: '', value: 500, type: '0', details: { passThrough: true } },
      { id: 'tiny', name: 'tiny', value: 1, type: '0' },
    ];
    const layout = computeMOFSankeyLayout(
      { nodes, links: [] },
      { ...OPTIONS, columnOf, align: 'top', minNodeSlot: 18 }
    );
    // 通過ノードは箱もラベルも出ないため、余白で間延びさせない
    const pass = layout.nodes.find(n => n.id === 'pass')!;
    const big = layout.nodes.find(n => n.id === 'big')!;
    expect(pass.y).toBeCloseTo(big.y + big.height + OPTIONS.nodePadding, 5);
  });

  it('多数の細い帯が集まっても、帯の合計幅がノードの高さを超えない', () => {
    // 帯1本ごとに「最低1px」の下限を掛けると、集約ノードのように
    // 大量の細い流れが1点に集まる箱では、帯の合計がノード自身の箱より
    // はみ出して見える（「集合がノードよりも大きい」という不具合）。
    // 個々の帯を極細で見せるより、ノードの高さという不変量を優先する
    // 列全体の尺度は、この列にある一番大きいノード（huge）が決める。
    // agg は列全体からすればごく僅かな取り分しか持たないので、
    // 個々の帯（1件あたり value=1）は尺度をかけても1pxに届かない
    const huge: Node = { id: 'huge', name: 'huge', value: 1_000_000, type: '0' };
    const parents: Node[] = Array.from({ length: 80 }, (_, i) => ({
      id: `p${i}`,
      name: `p${i}`,
      value: 1,
      type: '0',
    }));
    const agg: Node = { id: 'agg', name: 'agg', value: 80, type: '1' };
    const nodes = [huge, ...parents, agg];
    const links: SankeyLink[] = parents.map(p => ({ source: p.id, target: 'agg', value: 1 }));
    const layout = computeMOFSankeyLayout(
      { nodes, links },
      { ...OPTIONS, columnOf, align: 'top' }
    );
    const aggNode = layout.nodes.find(n => n.id === 'agg')!;
    const totalLinkWidth = layout.links
      .filter(l => l.target.id === 'agg')
      .reduce((sum, l) => sum + l.width, 0);
    expect(totalLinkWidth).toBeLessThanOrEqual(aggNode.height + 1e-6);
  });
});
