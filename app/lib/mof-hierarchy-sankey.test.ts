import { describe, it, expect } from 'vitest';
import type { MOFJikouItem } from '@/types/mof-jikou';
import { buildMOFHierarchyBrowseTree, buildMOFHierarchySankey, DEFAULT_TOP_N } from '@/app/lib/mof-hierarchy-sankey';

/** 検証に必要なフィールドだけ指定できるようにする */
function item(overrides: Partial<MOFJikouItem>): MOFJikouItem {
  return {
    id: 'x',
    key: 'x',
    accountType: 'general',
    budgetType: '当初予算',
    documentId: '202611001',
    ministry: '財務省',
    organization: '財務本省',
    specialAccount: '',
    subAccount: '',
    agency: '',
    sectionCode: '001',
    sectionName: '財務本省共通費',
    majorExpenseCode: '95',
    majorExpenseName: 'その他の事項経費',
    name: '事項A',
    amount: 100,
    previousAmount: null,
    difference: null,
    currentAmount: null,
    spent: null,
    carriedOver: null,
    unused: null,
    description: '',
    page: 1,
    sourceUrl: '',
    ...overrides,
  };
}

const options = {
  fiscalYear: 2026,
  eraLabel: '令和8年度',
  budgetType: '当初予算' as const,
  budgetTypes: ['当初予算' as const],
  availableYears: [2026],
};

describe('buildMOFHierarchySankey', () => {
  it('選んだ予算種別の事項だけを対象にする', () => {
    const result = buildMOFHierarchySankey(
      [item({ amount: 100 }), item({ budgetType: '暫定予算', amount: 999, name: '事項B' })],
      options
    );
    expect(result.metadata.total).toBe(100);
    expect(result.metadata.itemCount).toBe(1);
  });

  it('値の無い列は素通りし、列を畳まない', () => {
    const result = buildMOFHierarchySankey([item({})], options);
    const columns = result.sankey.nodes.map(n => n.details.column);
    expect(columns).toContain('ministry');
    expect(columns).toContain('organization');
    expect(columns).toContain('section');
    expect(columns).toContain('item');
    // 一般会計は勘定を持たない。列は畳まず、場所だけ確保する通過ノードを置く
    const subAccounts = result.sankey.nodes.filter(n => n.details.column === 'subAccount');
    expect(subAccounts).toHaveLength(1);
    expect(subAccounts[0].details.passThrough).toBe(true);
    expect(subAccounts[0].value).toBe(100);
  });

  it('通過ノードは実体を持たない（名前が空・集約に数えない）', () => {
    const result = buildMOFHierarchySankey([item({})], options);
    const pass = result.sankey.nodes.filter(n => n.details.passThrough);
    expect(pass).toHaveLength(1);
    expect(pass[0].name).toBe('');
    expect(pass[0].details.aggregated).toBeUndefined();
  });

  it('通過ノードはリンクの端点にならない（帯は実ノードから実ノードへ直結する）', () => {
    // 通過ノードは箱もラベルも出ない透明な存在なので、そこに帯が収束・分岐すると
    // 見た目には理由の分からない「くびれ」になる。帯は実在するノード同士を
    // 直接つなぎ、通過ノードは場所の確保だけに使う
    const result = buildMOFHierarchySankey([item({})], options);
    const passIds = new Set(
      result.sankey.nodes.filter(n => n.details.passThrough).map(n => n.id)
    );
    expect(passIds.size).toBeGreaterThan(0);
    for (const link of result.sankey.links) {
      expect(passIds.has(link.source)).toBe(false);
      expect(passIds.has(link.target)).toBe(false);
    }
  });

  it('通過ノードの子が集約されても、集約への帯は通過ノードを経由しない', () => {
    // 集約（その他）への流れを作る別経路（othersLinks）にも同じ穴があった。
    // 一般会計（勘定なし＝通過）の下で項が TopN から溢れると、
    // 「集約への帯」の起点が通過ノードのままになっていた
    const items = Array.from({ length: 6 }, (_, i) =>
      item({ sectionCode: `s${i}`, sectionName: `項${i}`, name: `事項${i}`, amount: 100 - i })
    );
    const result = buildMOFHierarchySankey(items, { ...options, topN: { section: 2 } });
    const passIds = new Set(
      result.sankey.nodes.filter(n => n.details.passThrough).map(n => n.id)
    );
    expect(passIds.size).toBeGreaterThan(0);
    for (const link of result.sankey.links) {
      expect(passIds.has(link.source)).toBe(false);
      expect(passIds.has(link.target)).toBe(false);
    }
  });

  it('勘定を持つ特別会計では勘定列が立つ', () => {
    const result = buildMOFHierarchySankey(
      [
        item({
          accountType: 'special',
          ministry: '共管',
          organization: '',
          specialAccount: '年金特別会計',
          subAccount: '厚生年金勘定',
        }),
      ],
      options
    );
    const subAccounts = result.sankey.nodes.filter(n => n.details.column === 'subAccount');
    expect(subAccounts).toHaveLength(1);
    expect(subAccounts[0].name).toBe('厚生年金勘定');
  });

  it('所管が空の政府関係機関は会計区分名を所管に置く', () => {
    const result = buildMOFHierarchySankey(
      [item({ accountType: 'agency', ministry: '', organization: '', agency: '沖縄振興開発金融公庫' })],
      options
    );
    const ministries = result.sankey.nodes.filter(n => n.details.column === 'ministry');
    expect(ministries.map(n => n.name)).toEqual(['政府関係機関']);
  });

  it('同名の事項が別の項にあれば別ノードになる', () => {
    const result = buildMOFHierarchySankey(
      [
        item({ sectionCode: '001', sectionName: '項A', name: '同じ名前の事項' }),
        item({ sectionCode: '002', sectionName: '項B', name: '同じ名前の事項' }),
      ],
      options
    );
    const items = result.sankey.nodes.filter(n => n.details.column === 'item');
    expect(items).toHaveLength(2);
  });

  it('各ノードで流入と流出が一致する（根と葉を除く）', () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      item({ sectionCode: `00${i}`, sectionName: `項${i}`, name: `事項${i}`, amount: 10 * (i + 1) })
    );
    const result = buildMOFHierarchySankey(items, options);
    const inflow = new Map<string, number>();
    const outflow = new Map<string, number>();
    for (const link of result.sankey.links) {
      inflow.set(link.target, (inflow.get(link.target) ?? 0) + link.value);
      outflow.set(link.source, (outflow.get(link.source) ?? 0) + link.value);
    }
    for (const node of result.sankey.nodes) {
      const inValue = inflow.get(node.id);
      const outValue = outflow.get(node.id);
      if (inValue !== undefined && outValue !== undefined) {
        expect(outValue).toBe(inValue);
      }
      if (inValue !== undefined) expect(inValue).toBe(node.value);
    }
  });

  it('TopN を超えた子は「その他」に集約され、合計は保たれる', () => {
    const count = (DEFAULT_TOP_N.section ?? 12) + 5;
    const items = Array.from({ length: count }, (_, i) =>
      item({
        sectionCode: String(i).padStart(3, '0'),
        sectionName: `項${i}`,
        name: `事項${i}`,
        amount: count - i,
      })
    );
    const result = buildMOFHierarchySankey(items, options);
    const sections = result.sankey.nodes.filter(n => n.details.column === 'section');
    expect(sections).toHaveLength((DEFAULT_TOP_N.section ?? 12) + 1);
    const others = sections.filter(n => n.details.aggregated);
    expect(others).toHaveLength(1);
    expect(others[0].details.aggregatedCount).toBe(5);
    // 集約しても総額は変わらない
    expect(sections.reduce((s, n) => s + (n.value ?? 0), 0)).toBe(result.metadata.total);
  });

  it('集約された枝の子孫はノードに残らない', () => {
    const count = (DEFAULT_TOP_N.section ?? 12) + 3;
    const items = Array.from({ length: count }, (_, i) =>
      item({
        sectionCode: String(i).padStart(3, '0'),
        sectionName: `項${i}`,
        name: `事項${i}`,
        amount: count - i,
      })
    );
    const result = buildMOFHierarchySankey(items, options);
    const itemNodes = result.sankey.nodes.filter(
      n => n.details.column === 'item' && !n.details.aggregated
    );
    // 残った項の下だけに事項が立つ（溢れた分は列の「その他」に入る）
    expect(itemNodes).toHaveLength(DEFAULT_TOP_N.section ?? 12);
    // リンクの参照先がすべて実在する
    const ids = new Set(result.sankey.nodes.map(n => n.id));
    for (const link of result.sankey.links) {
      expect(ids.has(link.source)).toBe(true);
      expect(ids.has(link.target)).toBe(true);
    }
  });

  it('収録されていない会計区分は accounts に出さない', () => {
    const result = buildMOFHierarchySankey([item({})], options);
    expect(result.accounts.map(a => a.accountType)).toEqual(['general']);
  });
});

describe('TopN は列単位で効く', () => {
  /**
   * 所管 → 項 → 事項 の枝を作る（1事項＝1枝）。
   * 項の表示名は「コード 名称」で組まれるので、照合は部分一致で行う
   */
  const branch = (ministry: string, section: string, name: string, amount: number) =>
    item({
      ministry,
      organization: `${ministry}本省`,
      sectionCode: section,
      sectionName: `項${section}`,
      name,
      amount,
    });

  it('親ごとではなく列全体で上位N件を残す', () => {
    // 所管Aに小さい項が5本、所管Bに大きい項が1本。
    // 親ごとの TopN だと A から5本すべて残るが、列単位なら大きい順に切られる
    const items = [
      ...Array.from({ length: 5 }, (_, i) => branch('A', `a${i}`, `事項a${i}`, 10)),
      branch('B', 'b0', '事項b0', 1000),
    ];
    const result = buildMOFHierarchySankey(items, {
      ...options,
      topN: { section: 2 },
    });
    const sections = result.sankey.nodes.filter(
      n => n.details.column === 'section' && !n.details.aggregated
    );
    expect(sections).toHaveLength(2);
    // 残るのは金額の大きい順。所管をまたいで比べる
    expect(sections.some(n => n.name.includes('b0'))).toBe(true);
    expect(sections.every(n => n.value === 1000 || n.value === 10)).toBe(true);
  });

  it('集約ノードの名前は「件数＋単位」で、「その他」とは書かない', () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      branch('A', `s${i}`, `事項${i}`, 100 - i)
    );
    const result = buildMOFHierarchySankey(items, { ...options, topN: { section: 2 } });
    const agg = result.sankey.nodes.find(
      n => n.details.column === 'section' && n.details.aggregated
    );
    expect(agg).toBeDefined();
    expect(agg!.name).toBe('4項');
    expect(agg!.name).not.toContain('その他');
  });

  it('集約ノードは中身の上位を持つ', () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      branch('A', `s${i}`, `事項${i}`, 100 - i)
    );
    const result = buildMOFHierarchySankey(items, { ...options, topN: { section: 2 } });
    const agg = result.sankey.nodes.find(
      n => n.details.column === 'section' && n.details.aggregated
    )!;
    expect(agg.details.aggregatedTop?.[0].amount).toBe(98);
    expect(agg.details.aggregatedTop?.[0].name).toContain('s2');
    // 大きい順に並ぶ
    const amounts = agg.details.aggregatedTop!.map(m => m.amount);
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
  });

  it('すべての列に TopN を指定できる', () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      branch(`省庁${i}`, `s${i}`, `事項${i}`, 100 - i)
    );
    const result = buildMOFHierarchySankey(items, { ...options, topN: { ministry: 2 } });
    const ministries = result.sankey.nodes.filter(
      n => n.details.column === 'ministry' && !n.details.aggregated
    );
    expect(ministries).toHaveLength(2);
    const agg = result.sankey.nodes.find(
      n => n.details.column === 'ministry' && n.details.aggregated
    );
    expect(agg!.name).toBe('4所管');
  });

  it('集約された所管の下の項は個別に出さず、下の列の集約に流す', () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      branch(`省庁${i}`, `s${i}`, `事項${i}`, 100 - i)
    );
    const result = buildMOFHierarchySankey(items, { ...options, topN: { ministry: 2 } });
    const sections = result.sankey.nodes.filter(
      n => n.details.column === 'section' && !n.details.aggregated
    );
    // 残った2所管の項だけが個別に立つ
    expect(sections).toHaveLength(2);
    expect(sections.some(n => n.name.includes('s0'))).toBe(true);
    expect(sections.some(n => n.name.includes('s1'))).toBe(true);
    // 合計は保たれる
    const columnTotal = result.sankey.nodes
      .filter(n => n.details.column === 'section')
      .reduce((sum, n) => sum + (n.value ?? 0), 0);
    expect(columnTotal).toBe(result.metadata.total);
  });
});

describe('TopN のオフセット', () => {
  const branch = (ministry: string, section: string, amount: number) =>
    item({
      ministry,
      organization: `${ministry}本省`,
      sectionCode: section,
      sectionName: `項${section}`,
      name: `事項${section}`,
      amount,
    });

  /** 金額 100, 99, 98, ... の項を n 本作る */
  const ranked = (n: number) =>
    Array.from({ length: n }, (_, i) => branch('A', `s${i}`, 100 - i));

  it('オフセットの分だけ順位をずらして切り出す', () => {
    const result = buildMOFHierarchySankey(ranked(10), {
      ...options,
      topN: { section: 3 },
      offset: { section: 3 },
    });
    const sections = result.sankey.nodes.filter(
      n => n.details.column === 'section' && !n.details.aggregated
    );
    // 4〜6位（金額 97, 96, 95）
    expect(sections.map(n => n.value).sort((a, b) => (b ?? 0) - (a ?? 0))).toEqual([97, 96, 95]);
  });

  it('窓の末尾だけが集約に入る。手前（上位側）は集約にも含めない（/sankey-svg と同じ）', () => {
    const result = buildMOFHierarchySankey(ranked(10), {
      ...options,
      topN: { section: 3 },
      offset: { section: 3 },
    });
    const agg = result.sankey.nodes.find(
      n => n.details.column === 'section' && n.details.aggregated
    )!;
    // 10件中、窓（4〜6位）の3件を残し、末尾（7〜10位）の4件だけが集約に入る。
    // 手前（1〜3位）はどこにも現れない
    expect(agg.details.aggregatedCount).toBe(4);
    const aggNames = agg.details.aggregatedTop?.map(t => t.name) ?? [];
    expect(aggNames.some(n => n.includes('s0'))).toBe(false);
    expect(aggNames.some(n => n.includes('s1'))).toBe(false);
    expect(aggNames.some(n => n.includes('s2'))).toBe(false);
    // 手前で隠した分（100+99+98=297）だけ合計が縮むので、
    // 列の合計と metadata.total は一致し続ける（保存則は保たれる）
    const columnTotal = result.sankey.nodes
      .filter(n => n.details.column === 'section')
      .reduce((sum, n) => sum + (n.value ?? 0), 0);
    expect(columnTotal).toBe(result.metadata.total);
  });

  it('窓の手前のノードは sankey.nodes に一切現れない', () => {
    const result = buildMOFHierarchySankey(ranked(10), {
      ...options,
      topN: { section: 3 },
      offset: { section: 3 },
    });
    const sectionNames = result.sankey.nodes
      .filter(n => n.details.column === 'section')
      .map(n => n.name);
    expect(sectionNames.some(n => n.includes('s0'))).toBe(false);
    expect(sectionNames.some(n => n.includes('s1'))).toBe(false);
    expect(sectionNames.some(n => n.includes('s2'))).toBe(false);
  });

  it('窓の手前で隠した分は、組織・所管・予算合計からそれぞれ引かれる（/sankey-svg と同じ挙動）', () => {
    const before = buildMOFHierarchySankey(ranked(10), { ...options, topN: { section: 3 } });
    const after = buildMOFHierarchySankey(ranked(10), {
      ...options,
      topN: { section: 3 },
      offset: { section: 3 },
    });
    // 手前で隠れた1〜3位（100+99+98=297）
    const hidden = 297;

    const orgBefore = before.sankey.nodes.find(n => n.details.column === 'organization')!.value;
    const orgAfter = after.sankey.nodes.find(n => n.details.column === 'organization')!.value;
    expect((orgBefore ?? 0) - (orgAfter ?? 0)).toBe(hidden);

    const ministryBefore = before.sankey.nodes.find(n => n.details.column === 'ministry')!.value;
    const ministryAfter = after.sankey.nodes.find(n => n.details.column === 'ministry')!.value;
    expect((ministryBefore ?? 0) - (ministryAfter ?? 0)).toBe(hidden);

    expect(before.metadata.total - after.metadata.total).toBe(hidden);
  });

  it('複数の列に同時にオフセットをかけても、縮小が二重に効かず筋が通る', () => {
    // 所管を4つ用意し、所管側にもオフセットをかけて1つを手前へ追いやる。
    // 残った所管の中でも、項側の窓の手前をさらに1件隠す。
    // 所管が手前で消えた分の項は、そもそも項の候補にすら入らないので
    // 二重に引かれることは無いはず
    const items = [
      branch('A', 'sa', 1000), // 所管の中で1位。オフセットで手前に追いやられ、丸ごと消える
      ...ranked(6), // 所管X: 項s0..s5、金額100..95（branch のデフォルト所管 'A' を上書き）
    ].map((i, idx) => (idx === 0 ? i : { ...i, ministry: 'X', organization: 'X本省' }));

    const before = buildMOFHierarchySankey(items, { ...options, topN: { section: 2 } });
    const after = buildMOFHierarchySankey(items, {
      ...options,
      topN: { ministry: 1, section: 2 },
      offset: { ministry: 1, section: 1 }, // 所管Aを手前へ、所管X内の項も1件手前へ
    });

    // 所管Aの1000 + 項s0の100（所管Xの項の1位）が手前で隠れる
    expect(before.metadata.total - after.metadata.total).toBe(1000 + 100);

    // 残った項の窓は、所管Aの消滅や項s0の手前送りと無関係に、
    // 所管Xの中で2〜3位（99, 98）のまま
    const sections = after.sankey.nodes.filter(
      n => n.details.column === 'section' && !n.details.aggregated
    );
    expect(sections.map(n => n.value).sort((a, b) => (b ?? 0) - (a ?? 0))).toEqual([99, 98]);
  });

  it('行き過ぎたオフセットは末尾に丸め、丸めた値を返す', () => {
    const result = buildMOFHierarchySankey(ranked(10), {
      ...options,
      topN: { section: 3 },
      offset: { section: 999 },
    });
    const sections = result.sankey.nodes.filter(
      n => n.details.column === 'section' && !n.details.aggregated
    );
    // 末尾3件（金額 93, 92, 91）
    expect(sections.map(n => n.value).sort((a, b) => (b ?? 0) - (a ?? 0))).toEqual([93, 92, 91]);
    expect(result.metadata.offset.section).toBe(7);
  });

  it('列ごとの候補件数を返す（オフセットの上限を画面が出すため）', () => {
    const result = buildMOFHierarchySankey(ranked(10), {
      ...options,
      topN: { section: 3 },
    });
    expect(result.metadata.columnCounts.section).toBe(10);
    expect(result.metadata.columnCounts.ministry).toBe(1);
  });
});

describe('事項（葉）の候補は上流の列のTopNと無関係にグローバル', () => {
  // /sankey-svg は 所管→事業 は事業側を上流のTopNに従属させるが、
  // 事業→支出先（葉）だけは allEdges から上流と無関係にグローバルランキングする
  // （app/lib/sankey-svg-filter.ts:136-143）。事項（葉）も同じ扱いにする。
  const leaf = (section: string, itemName: string, itemAmount: number) =>
    item({
      ministry: 'A',
      organization: 'A本省',
      sectionCode: section,
      sectionName: `項${section}`,
      name: itemName,
      amount: itemAmount,
    });

  it('項がTopNで集約されても、その配下の事項は候補件数に数える', () => {
    // 項を6本作り、項のTopNを2に絞る（4本が集約に回る）。
    // それでも事項の候補件数は6件のまま（項の集約状態と無関係）
    const items = Array.from({ length: 6 }, (_, i) => leaf(`s${i}`, `事項s${i}`, 100 - i));
    const result = buildMOFHierarchySankey(items, { ...options, topN: { section: 2 } });
    expect(result.metadata.columnCounts.item).toBe(6);
  });

  // 項sAは3事項の合計10,000で1位（kept）。項sBは単独事項9,999で2位（TopN=1なので集約に回る）。
  // 事項単体で見ると、sB配下の1件（9,999）が全事項中で最大なので、
  // 項が集約された配下からでも事項のTopN窓には入るはず
  const items = [
    leaf('sA', '事項sA-1', 3334),
    leaf('sA', '事項sA-2', 3333),
    leaf('sA', '事項sA-3', 3333),
    leaf('sB', '事項sB-1', 9999),
  ];

  it('項が集約された配下からでも、事項単体でTopNの窓に入れば個別に出る', () => {
    const result = buildMOFHierarchySankey(items, {
      ...options,
      topN: { section: 1, item: 1 },
    });
    const itemNodes = result.sankey.nodes.filter(
      n => n.details.column === 'item' && !n.details.aggregated
    );
    expect(itemNodes).toHaveLength(1);
    expect(itemNodes[0].value).toBe(9999);
    expect(itemNodes[0].name).toBe('事項sB-1');
  });

  it('項が集約された配下から個別に出た事項は、項の集約ノードから帯が伸びる', () => {
    const result = buildMOFHierarchySankey(items, {
      ...options,
      topN: { section: 1, item: 1 },
    });
    const soloItem = result.sankey.nodes.find(
      n => n.details.column === 'item' && n.value === 9999
    )!;
    const sectionAgg = result.sankey.nodes.find(
      n => n.details.column === 'section' && n.details.aggregated
    )!;
    const link = result.sankey.links.find(l => l.target === soloItem.id)!;
    expect(link.source).toBe(sectionAgg.id);
  });

  it('保存則は保たれる（事項列の合計 = 予算合計）', () => {
    const result = buildMOFHierarchySankey(items, {
      ...options,
      topN: { section: 1, item: 1 },
    });
    const columnTotal = result.sankey.nodes
      .filter(n => n.details.column === 'item')
      .reduce((sum, n) => sum + (n.value ?? 0), 0);
    expect(columnTotal).toBe(result.metadata.total);
  });
});

describe('項のTopN選抜は事項オフセットで見えている額に連動して再ランキングされる', () => {
  // /sankey-svg は事業のTopN選抜を「所属所管のTopN」ではなく「現在窓に入っている
  // 支出先からの流入額」で毎回再計算する（sankey-svg-filter.ts:261-284）。
  // mof-hierarchy でも、項の直下の事項オフセットで一部の事項が窓の手前に
  // 隠れると、項どうしの順位（TopNに残るかどうか）もそれに応じて入れ替わるべき
  // （所管・組織・勘定は/sankey-svgのミニストリと同じくこの再ランキングの対象外）。
  const leaf = (ministry: string, section: string, itemName: string, itemAmount: number) =>
    item({
      ministry,
      organization: `${ministry}本省`,
      sectionCode: section,
      sectionName: `項${section}`,
      name: itemName,
      amount: itemAmount,
    });

  // 項P: 事項1件1000（真の合計では項Qより大きく、通常はPがTopN=1に残る）
  // 項Q: 事項2件550+449=999（真の合計はPよりわずかに小さい）
  const items = [
    leaf('A', 'P', '事項P1', 1000),
    leaf('A', 'Q', '事項Q1', 550),
    leaf('A', 'Q', '事項Q2', 449),
  ];

  it('事項オフセット無しでは、真の合計どおり項Pが残る', () => {
    const result = buildMOFHierarchySankey(items, { ...options, topN: { section: 1 } });
    const sections = result.sankey.nodes.filter(
      n => n.details.column === 'section' && !n.details.aggregated
    );
    expect(sections.map(n => n.name)).toEqual(['P 項P']);
  });

  it('事項P1（項Pの唯一の事項・全事項中1位）が窓の手前に隠れると、項の順位が入れ替わる', () => {
    // 全事項を金額順に並べると 事項P1(1000) > 事項Q1(550) > 事項Q2(449)。
    // 事項のTopN=1・オフセット=1で1位（事項P1）を手前に隠すと、
    // 項Pの見えている額は 1000-1000=0 に、項Qは 999 のまま
    // （項Qの2件は窓+集約でどちらも「見えている」扱い）。
    // 真の合計では項Pの方が大きいが、見えている額では項Qが上回り、
    // TopNに残る項が入れ替わるはず
    const result = buildMOFHierarchySankey(items, {
      ...options,
      topN: { section: 1, item: 1 },
      offset: { item: 1 },
    });
    const sections = result.sankey.nodes.filter(
      n => n.details.column === 'section' && !n.details.aggregated
    );
    expect(sections.map(n => n.name)).toEqual(['Q 項Q']);
  });

  it('入れ替わった後も保存則は保たれる（項列の合計＝予算合計）', () => {
    const result = buildMOFHierarchySankey(items, {
      ...options,
      topN: { section: 1, item: 1 },
      offset: { item: 1 },
    });
    const columnTotal = result.sankey.nodes
      .filter(n => n.details.column === 'section')
      .reduce((sum, n) => sum + (n.value ?? 0), 0);
    expect(columnTotal).toBe(result.metadata.total);
  });

  it('所管・組織・勘定は事項オフセットによる再ランキングの対象外（/sankey-svg の所管と同じ）', () => {
    // 所管を2つにして、それぞれの真の合計の大小関係が
    // 事項オフセットの前後で変わらないことを確認する
    const twoMinistries = [
      leaf('A', 'P', '事項P1', 1000),
      leaf('A', 'Q', '事項Q1', 550),
      leaf('A', 'Q', '事項Q2', 449),
      leaf('B', 'R', '事項R1', 100), // 所管Bは所管Aよりずっと小さいまま
    ];
    const before = buildMOFHierarchySankey(twoMinistries, { ...options, topN: { ministry: 1 } });
    const after = buildMOFHierarchySankey(twoMinistries, {
      ...options,
      topN: { ministry: 1, item: 1 },
      offset: { item: 1 },
    });
    const ministryName = (r: typeof before) =>
      r.sankey.nodes.find(n => n.details.column === 'ministry' && !n.details.aggregated)!.name;
    expect(ministryName(before)).toBe('A');
    expect(ministryName(after)).toBe('A');
  });
});

describe('配下の事項が全件隠れた項は、項自身も隠す', () => {
  // 項は必ず1件以上の事項を持つ（buildFullNodeMap が事項から項を組むため、
  // 事項ゼロの項は仕組み上作られない）。事項オフセットで、ある項の配下の
  // 事項が「全件」窓の手前に隠れると、その項には表示すべき中身が無くなる。
  // 集約にも kept にも入れず、項自身も隠す（/sankey-svg が可視流入ゼロの
  // 事業をTopN候補からそもそも除くのと同じ考え方）
  const leaf = (section: string, itemName: string, itemAmount: number) =>
    item({
      ministry: 'A',
      organization: 'A本省',
      sectionCode: section,
      sectionName: `項${section}`,
      name: itemName,
      amount: itemAmount,
    });

  // 全事項を金額順に並べると 事項P1(900) > 事項P2(800) > 事項Q1(100)。
  // 事項のTopN=1・オフセット=2で、上位2件（項Pの事項2件すべて）が
  // 窓の手前に隠れる。項Qの事項Q1（3位）だけが窓に残る
  const items = [
    leaf('P', '事項P1', 900),
    leaf('P', '事項P2', 800),
    leaf('Q', '事項Q1', 100),
  ];

  it('配下の事項が全件隠れた項は、kept にも集約にも現れない', () => {
    const result = buildMOFHierarchySankey(items, {
      ...options,
      topN: { item: 1 },
      offset: { item: 2 },
    });
    const sectionNames = result.sankey.nodes
      .filter(n => n.details.column === 'section')
      .map(n => n.name);
    expect(sectionNames.some(n => n.includes('P'))).toBe(false);
    expect(sectionNames.some(n => n.includes('Q'))).toBe(true);
  });

  it('項が集約に回る設定でも、配下の事項が全件隠れた項は集約のaggregatedTopに出ない', () => {
    const items6 = [
      ...items,
      leaf('R', '事項R1', 50),
      leaf('S', '事項S1', 40),
      leaf('T', '事項T1', 30),
    ];
    const result = buildMOFHierarchySankey(items6, {
      ...options,
      topN: { section: 1, item: 1 },
      offset: { item: 2 },
    });
    const agg = result.sankey.nodes.find(
      n => n.details.column === 'section' && n.details.aggregated
    );
    const aggNames = agg?.details.aggregatedTop?.map(t => t.name) ?? [];
    expect(aggNames.some(n => n.includes('P'))).toBe(false);
  });

  it('保存則は保たれる（項列の合計＝予算合計＝窓に残った事項Q1の金額）', () => {
    const result = buildMOFHierarchySankey(items, {
      ...options,
      topN: { item: 1 },
      offset: { item: 2 },
    });
    expect(result.metadata.total).toBe(100);
    const columnTotal = result.sankey.nodes
      .filter(n => n.details.column === 'section')
      .reduce((sum, n) => sum + (n.value ?? 0), 0);
    expect(columnTotal).toBe(result.metadata.total);
  });
});

describe('項オフセットで窓の手前に隠れた項は、配下の事項も道連れで隠す', () => {
  // 事項は項より先に処理されるため、項側のTopNに制限が無ければ全事項が
  // 一旦 kept になる。そのあとで項自身が「項の」オフセットにより窓の手前へ
  // 明示的に隠れる場合、配下の事項が既に kept でも道連れで隠す
  // ——ユーザーが項オフセットで明示的に押し出した項の中身が、
  // 事項側の独立ランキングだけで居残ってしまうのは直感に反するため
  const leaf = (section: string, itemName: string, itemAmount: number) =>
    item({
      ministry: 'A',
      organization: 'A本省',
      sectionCode: section,
      sectionName: `項${section}`,
      name: itemName,
      amount: itemAmount,
    });

  // 項Q(事項Q1=1000)が項P(事項P1=500)より大きいので、
  // 項のTopN=1・オフセット=1で項Qが窓の手前に明示的に隠れ、項Pが残る
  const items = [leaf('P', '事項P1', 500), leaf('Q', '事項Q1', 1000)];

  it('項が窓の手前で明示的に隠れたら、配下の事項も隠す（kept のまま残さない）', () => {
    const result = buildMOFHierarchySankey(items, {
      ...options,
      topN: { section: 1 },
      offset: { section: 1 },
    });
    const itemNames = result.sankey.nodes
      .filter(n => n.details.column === 'item')
      .map(n => n.name);
    expect(itemNames).not.toContain('事項Q1');
    expect(itemNames).toContain('事項P1');
  });

  it('隠れた項の事項の金額は、祖先からも予算合計からも引かれている', () => {
    const result = buildMOFHierarchySankey(items, {
      ...options,
      topN: { section: 1 },
      offset: { section: 1 },
    });
    // 残っているのは項Pの事項P1（500）だけ
    expect(result.metadata.total).toBe(500);
  });
});

describe('buildMOFHierarchyBrowseTree', () => {
  const branch = (ministry: string, section: string, amount: number) =>
    item({
      ministry,
      organization: `${ministry}本省`,
      sectionCode: section,
      sectionName: `項${section}`,
      name: `事項${section}`,
      amount,
    });

  it('TopN で溢れる件数でも、集約せず全件を実ノードとして返す', () => {
    const count = (DEFAULT_TOP_N.section ?? 40) + 10;
    const items = Array.from({ length: count }, (_, i) => branch('A', `s${i}`, count - i));
    const result = buildMOFHierarchyBrowseTree(items, '当初予算');
    const sections = result.nodes.filter(n => n.details.column === 'section');
    expect(sections).toHaveLength(count);
    expect(sections.every(n => !n.details.aggregated)).toBe(true);
  });

  it('通過ノードは出力せず、帯は実ノード同士を直結する', () => {
    const result = buildMOFHierarchyBrowseTree([item({})], '当初予算');
    const passIds = new Set(
      result.nodes.filter(n => n.details.passThrough).map(n => n.id)
    );
    expect(passIds.size).toBe(0);
    for (const link of result.links) {
      const ids = new Set(result.nodes.map(n => n.id));
      expect(ids.has(link.source)).toBe(true);
      expect(ids.has(link.target)).toBe(true);
    }
  });

  it('選んだ予算種別の事項だけを対象にする', () => {
    const result = buildMOFHierarchyBrowseTree(
      [item({ amount: 100 }), item({ budgetType: '暫定予算', amount: 999, name: '事項B' })],
      '当初予算'
    );
    const items = result.nodes.filter(n => n.details.column === 'item');
    expect(items).toHaveLength(1);
  });

  it('各ノードで流入と流出が一致する（根と葉を除く・保存則）', () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      branch(`省庁${i}`, `s${i}`, 10 * (i + 1))
    );
    const result = buildMOFHierarchyBrowseTree(items, '当初予算');
    const inflow = new Map<string, number>();
    const outflow = new Map<string, number>();
    for (const link of result.links) {
      inflow.set(link.target, (inflow.get(link.target) ?? 0) + link.value);
      outflow.set(link.source, (outflow.get(link.source) ?? 0) + link.value);
    }
    for (const node of result.nodes) {
      const inValue = inflow.get(node.id);
      if (inValue !== undefined) expect(inValue).toBeCloseTo(node.value ?? 0, 5);
    }
  });

  it('sankey が TopN で集約していても、browse は同じ全ノードを持つ', () => {
    const count = (DEFAULT_TOP_N.section ?? 40) + 5;
    const items = Array.from({ length: count }, (_, i) =>
      item({ sectionCode: `s${i}`, sectionName: `項${i}`, name: `事項${i}`, amount: count - i })
    );
    const result = buildMOFHierarchySankey(items, options);
    const sankeySections = result.sankey.nodes.filter(n => n.details.column === 'section');
    const browseSections = result.browse.nodes.filter(n => n.details.column === 'section');
    // sankey 側は集約1件を含む上限件数、browse は集約せず全件
    expect(sankeySections.some(n => n.details.aggregated)).toBe(true);
    expect(browseSections).toHaveLength(count);
    expect(browseSections.every(n => !n.details.aggregated)).toBe(true);
  });
});
