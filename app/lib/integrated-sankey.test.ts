import { describe, expect, it } from 'vitest';
import { buildIntegratedGraph } from './integrated-sankey';
import type { MOFKouMokuItem } from '@/types/mof-kou-moku';
import type { MofRsKouMokuLinkageRecord } from '@/types/mof-rs-kou-moku-linkage';

const item = (o: Partial<MOFKouMokuItem> = {}): MOFKouMokuItem => ({ id:'i1',key:'k1',accountType:'general',budgetType:'当初予算',ministry:'省',organization:'組織',specialAccount:'',subAccount:'',agency:'',sectionCode:'01',sectionName:'項A',majorExpenseCode:'',majorExpenseName:'',objectiveCode:'',objectiveName:'',fiscalLawCode:'',fiscalLawName:'',economicNatureCode:'',economicNatureName:'',subItemCode:'01',subItemName:'目a',purposeCode:'',purposeName:'',amount:100,previousAmount:0,difference:0,currentAmount:null,spent:null,carriedOver:null,unused:null,documentId:'d',page:1,sourceUrl:'https://example.test',...o });
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
});
