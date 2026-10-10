import { describe, expect, it } from 'vitest';
import { eligiblePages, selectSample, stratumOf, type CensusPageLike } from './budget-request-toc-b-column-continuity-sample';

const pg = (path: string, n: number, src: string, last: string, rq: number, p2 = true): CensusPageLike => ({
  localPdfPath: path, physicalPage: n, partition: 'SYNTH', classifierSource: src, pageState: 'ASSEMBLED_SPLIT', flags: { P2: p2 },
  q2: { rightRequestsBeforeFirstItem: rq, leftTail: [{ kind: 'ORG', code: '1' }, { kind: last, code: '2' }] },
});

describe('column continuity sample selection（synthetic）', () => {
  const pages = [
    pg('b.pdf', 2, 'DIRECT', 'ITEM', 1), pg('a.pdf', 10, 'DIRECT', 'ITEM', 5), pg('a.pdf', 9, 'DIRECT', 'ITEM', 1),
    pg('a.pdf', 3, 'INHERITED', 'REQUEST', 2), pg('c.pdf', 1, 'INHERITED', 'REQUEST', 4), pg('c.pdf', 2, 'DIRECT', 'ITEM', 4),
    pg('d.pdf', 1, 'DIRECT', 'ITEM', 4), pg('z.pdf', 1, 'DIRECT', 'ITEM', 9, false),
  ];
  it('eligible は P2 かつ除外外。辞書順', () => {
    const e = eligiblePages(pages, [{ localPdfPath: 'b.pdf', physicalPage: 2 }]);
    expect(e.map(p => `${p.localPdfPath}#${p.physicalPage}`)).toEqual(['a.pdf#3', 'a.pdf#9', 'a.pdf#10', 'c.pdf#1', 'c.pdf#2', 'd.pdf#1']);
  });
  it('層ごと辞書順先頭＋右先頭REQUEST数降順(同点は辞書順)の2件。空の層は補わない', () => {
    const s = selectSample(eligiblePages(pages, []));
    const by = Object.fromEntries(s.map(x => [`${x.page.localPdfPath}#${x.page.physicalPage}`, x.stratum]));
    // DIRECT/ITEM 先頭 = a.pdf#9（physicalPage は数値順）、INHERITED/REQUEST 先頭 = a.pdf#3、DIRECT/REQUEST・INHERITED/ITEM は空
    expect(by['a.pdf#9']).toBe('DIRECT/ITEM');
    expect(by['a.pdf#3']).toBe('INHERITED/REQUEST');
    // 残りから rq 降順: a.pdf#10(5)、次は rq=4 同点(c.pdf#1・c.pdf#2・d.pdf#1)の辞書順先頭 c.pdf#1
    expect(by['a.pdf#10']).toBe('TOP_RIGHT_REQUESTS');
    expect(by['c.pdf#1']).toBe('TOP_RIGHT_REQUESTS');
    expect(s).toHaveLength(4);
    expect(new Set(s.map(x => `${x.page.localPdfPath}#${x.page.physicalPage}`)).size).toBe(s.length);
  });
  it('決定性: 入力順に依存しない・上限6', () => {
    const many = ['DIRECT', 'INHERITED'].flatMap(src => ['ITEM', 'REQUEST'].flatMap(k => [1, 2, 3].map(i => pg(`${src}${k}.pdf`, i, src, k, i))));
    const a = selectSample(eligiblePages(many, []));
    const b = selectSample(eligiblePages([...many].reverse(), []));
    expect(a).toEqual(b);
    expect(a).toHaveLength(6);
    expect(stratumOf(a[0].page)).toMatch(/^(DIRECT|INHERITED)\//);
  });
});
