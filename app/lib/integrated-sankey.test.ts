import { describe, expect, it } from 'vitest';
import { buildIntegratedGraph, buildView, EMPTY_FILTERS } from './integrated-sankey';
import type { MOFKouMokuItem } from '@/types/mof-kou-moku';
import type { MofRsKouMokuLinkageRecord } from '@/types/mof-rs-kou-moku-linkage';
import type { BudgetBreakdownItem } from '@/types/sankey-svg';

const item = (o: Partial<MOFKouMokuItem> = {}): MOFKouMokuItem => ({ id:'i1',key:'k1',accountType:'general',budgetType:'当初予算',ministry:'省',organization:'組織',specialAccount:'',subAccount:'',agency:'',sectionCode:'01',sectionName:'項A',majorExpenseCode:'',majorExpenseName:'',objectiveCode:'',objectiveName:'',fiscalLawCode:'',fiscalLawName:'',economicNatureCode:'',economicNatureName:'',subItemCode:'01',subItemName:'目a',purposeCode:'',purposeName:'',amount:100,previousAmount:0,difference:0,currentAmount:null,spent:null,carriedOver:null,unused:null,documentId:'d',page:1,sourceUrl:'https://example.test',...o });
const budgetItem = (o: Partial<BudgetBreakdownItem> = {}): BudgetBreakdownItem => ({ fiscalYear:2024,accountCategory:'一般会計',account:'',subAccount:'',budgetType:'当初予算',jurisdiction:'省',organizationAccount:'組織',item:'項A',subItem:'目a',note:'',amount:60,nextYearRequestAmount:0,...o });
const link = (o: Partial<MofRsKouMokuLinkageRecord> = {}): MofRsKouMokuLinkageRecord => ({ projectId:1,projectName:'事業X',projectMinistry:'省',kouMokuKey:'k1',mofAccountType:'general',mofBudgetType:'当初予算',mofMinistry:'省',mofOrganization:'組織',mofSubAccount:'',sectionCode:'01',sectionName:'項A',subItemCode:'01',subItemName:'目a',kouMokuAmount:100,rsAmount:60,...o });

describe('integrated sankey first cut', () => {
  it('splits a MOF item across projects and RS unconnected', () => {
    const g=buildIntegratedGraph([item()],[link(),link({projectId:2,projectName:'事業Y',rsAmount:25})],[]);
    expect(g.edges.filter(e=>e.status==='connected').map(e=>e.value)).toEqual([60,25]);
    expect(g.edges.find(e=>e.status==='unconnected')?.value).toBe(15);
  });
  it('keeps several sections converging on one project', () => {
    const g=buildIntegratedGraph([item(),item({id:'i2',key:'k2',sectionCode:'02',sectionName:'項B',amount:40})],[link(),link({kouMokuKey:'k2',sectionCode:'02',sectionName:'項B',rsAmount:40})],[]);
    expect(new Set(g.edges.filter(e=>e.target==='project:1').map(e=>e.source)).size).toBe(2);
  });
  it('reports over-allocation rather than clamping it', () => {
    const g=buildIntegratedGraph([item()],[link({rsAmount:120})],[]);
    expect(g.metadata.excessAmount).toBe(20); expect(g.edges.some(e=>e.target==='rs-excess')).toBe(true);
  });
  it('does not apply one colliding link twice', () => {
    const g=buildIntegratedGraph([item(),item({id:'i2',amount:80})],[link()],[]);
    expect(g.metadata.connectedAmount).toBe(60); expect(g.metadata.unconnectedAmount).toBe(120);
  });

  it('keeps one edge per MOF item even between the same section and project', () => {
    // 同じ項・同じ事業の間に目が2つある場合、表示で束ねるかは描画側の判断。
    // モデルは目別エッジを保持する
    const g=buildIntegratedGraph(
      [item(),item({id:'i2',key:'k2',subItemCode:'02',subItemName:'目b',amount:50})],
      [link(),link({kouMokuKey:'k2',subItemCode:'02',subItemName:'目b',rsAmount:30})],[]);
    const toProject=g.edges.filter(e=>e.target==='project:1');
    expect(toProject).toHaveLength(2);
    expect(new Set(toProject.map(e=>e.source)).size).toBe(1);
    expect(toProject.map(e=>e.itemName).sort()).toEqual(['目a','目b']);
  });

  it('sends a fully unconnected MOF item to RS未接続 in full', () => {
    const g=buildIntegratedGraph([item()],[],[]);
    expect(g.metadata.connectedAmount).toBe(0);
    const unconnected=g.edges.filter(e=>e.target==='rs-unconnected');
    expect(unconnected).toHaveLength(1);
    expect(unconnected[0].value).toBe(100);
  });

  it('marks RS budget items that no MOF item matched', () => {
    const g=buildIntegratedGraph([item()],[link()],
      [{projectId:1,name:'事業X',ministry:'省',budgetBreakdown:[budgetItem(),budgetItem({subItem:'目z',amount:10})]}]);
    const items=g.projects[0].budgetItems;
    expect(items.map(i=>[i.subItem,i.connected])).toEqual([['目a',true],['目z',false]]);
  });

  it('keeps general and special accounts separate for one project', () => {
    const g=buildIntegratedGraph(
      [item(),item({id:'i2',key:'k2',accountType:'special',specialAccount:'特会',sectionName:'項S',amount:200})],
      [link(),link({kouMokuKey:'k2',mofAccountType:'special',mofOrganization:'特会',sectionName:'項S',rsAmount:150})],
      []);
    const sources=g.edges.filter(e=>e.target==='project:1').map(e=>e.source);
    expect(new Set(sources).size).toBe(2);
    expect(g.sections.map(s=>s.accountType).sort()).toEqual(['general','special']);
    expect(g.projects[0].linkedAmount).toBe(210);
  });

  it('aggregates previousAmount/difference per section across its items', () => {
    const g=buildIntegratedGraph(
      [item({previousAmount:80,difference:20}),
       item({id:'i2',key:'k2',subItemCode:'02',subItemName:'目b',amount:50,previousAmount:40,difference:10})],
      [link()],[]);
    expect(g.sections[0].previousAmount).toBe(120);
    expect(g.sections[0].difference).toBe(30);
  });

  it('treats null previousAmount/difference as zero rather than NaN', () => {
    const g=buildIntegratedGraph([item({previousAmount:null,difference:null})],[],[]);
    expect(g.sections[0].previousAmount).toBe(0);
    expect(g.sections[0].difference).toBe(0);
  });

  it('marks a project as mixed when it receives from both account types', () => {
    const g=buildIntegratedGraph(
      [item(),item({id:'i2',key:'k2',accountType:'special',specialAccount:'特会',sectionName:'項S',amount:200})],
      [link(),link({kouMokuKey:'k2',mofAccountType:'special',mofOrganization:'特会',sectionName:'項S',rsAmount:150})],
      []);
    expect(g.projects[0].accountType).toBe('mixed');
  });

  it('adds a supplementary-budget item as its difference (not the cumulative amount) into the same section as the initial item', () => {
    // 補正予算の amount は累計額（当初を包含）。単純合算だと二重計上になるため、
    // 補正予算行は amount ではなく difference（当初との差額）を項に加算する
    const g=buildIntegratedGraph(
      [item(), item({ id: 'i2', key: 'k2', budgetType: '補正予算（第1号）', subItemName: '目b',
        amount: 130, previousAmount: 100, difference: 30 })],
      [], []);
    expect(g.sections).toHaveLength(1);
    expect(g.sections[0].amount).toBe(130);
    expect(g.sections[0].itemCount).toBe(2);
  });

  it('keeps 前年度額・増減率 (YoY) scoped to 当初予算 rows, ignoring supplementary-budget previousAmount/difference', () => {
    // 補正予算のprevious/differenceは「補正前の成立予算額」「当該号の増減額」という
    // 別概念（年度内の話）。前年度比（YoY）の集計に混ぜてはいけない
    const g=buildIntegratedGraph(
      [item({ previousAmount: 80, difference: 20 }),
       item({ id: 'i2', key: 'k2', budgetType: '補正予算（第1号）', subItemName: '目b',
         amount: 130, previousAmount: 100, difference: 30 })],
      [], []);
    expect(g.sections[0].previousAmount).toBe(80);
    expect(g.sections[0].difference).toBe(20);
  });

  it('does not report excess for a supplementary-budget cut with no RS linkage (negative diff, linked=0)', () => {
    // 補正予算の減額（difference負）でRSの紐づけが1件も無い場合、residualは負に
    // なるが「超過」ではない——RSは何も主張していないので、MOFが減らしただけで
    // 確認すべき差異は無い（例: 国債費の補正超過は実は補正でマイナスされている
    // だけだった、2026-09-14指摘）
    const g=buildIntegratedGraph(
      [item({ budgetType: '補正予算（第1号）', amount: 70, previousAmount: 100, difference: -30 })],
      [], []);
    expect(g.edges).toHaveLength(0);
    expect(g.metadata.excessAmount).toBe(0);
    expect(g.metadata.unconnectedAmount).toBe(0);
    expect(g.metadata.unlinkedReductionAmount).toBe(-30);
    expect(g.metadata.connectedAmount + g.metadata.unconnectedAmount - g.metadata.excessAmount + g.metadata.unlinkedReductionAmount)
      .toBe(g.metadata.mofAmount);
  });

  it('still reports excess when RS claims an amount despite a supplementary-budget cut (negative diff, linked>0)', () => {
    // MOFの補正が減額でも、RSがその目に対して金額を主張している場合は
    // 食い違いとして超過扱いのまま残す（要確認事項として有効）
    const g=buildIntegratedGraph(
      [item({ budgetType: '補正予算（第1号）', amount: 70, previousAmount: 100, difference: -30 })],
      [link({ mofBudgetType: '補正予算（第1号）', rsAmount: 50 })],
      []);
    expect(g.metadata.connectedAmount).toBe(50);
    expect(g.metadata.excessAmount).toBe(80); // linked(50) - amount(-30) = 80
  });

  it('tags each edge with the source item budgetType', () => {
    const g=buildIntegratedGraph(
      [item(), item({ id: 'i2', key: 'k2', budgetType: '補正予算（第1号）', subItemName: '目b', amount: 130, difference: 30 })],
      [], []);
    const byBudgetType = new Map(g.edges.map(e => [e.itemKey, e.budgetType]));
    expect(byBudgetType.get('k1')).toBe('当初予算');
    expect(byBudgetType.get('k2')).toBe('補正予算（第1号）');
  });

  it('reports a single account type when a project receives from only one', () => {
    const g=buildIntegratedGraph([item()],[link()],[]);
    expect(g.projects[0].accountType).toBe('general');
  });

  it('reports unknown account type for a project with no budget data or MOF linkage', () => {
    const g=buildIntegratedGraph([item()],[],[{projectId:9,name:'事業Z',ministry:'省'}]);
    expect(g.projects.find(p=>p.projectId===9)?.accountType).toBe('unknown');
  });

  it('uses spendingAmount (project-spending node value) rather than budgetSummary.executedAmount', () => {
    // budgetSummaryが無い（RS 2-1予算執行サマリ未収録）事業でも、支出先データ由来の
    // spendingAmountがあれば支出額として反映する（PID21972相当のケース）
    const g=buildIntegratedGraph([item()],[],[{projectId:9,name:'事業Z',ministry:'省',spendingAmount:100_000_000_000}]);
    expect(g.projects.find(p=>p.projectId===9)?.spendingAmount).toBe(100_000_000_000);
  });

  it('breaks ties in project ordering (same budgetAmount, including 0円) by spendingAmount descending', () => {
    const g=buildIntegratedGraph([],[],[
      {projectId:1,name:'事業A',ministry:'省',spendingAmount:10},
      {projectId:2,name:'事業B',ministry:'省',spendingAmount:30},
      {projectId:3,name:'事業C',ministry:'省',spendingAmount:20},
    ]);
    const view=buildView(g, EMPTY_FILTERS, {topN:10,offset:0}, {topN:10,offset:0});
    expect(view.rankedProjects.map(p=>p.projectId)).toEqual([2,3,1]);
  });
});
