import { describe, it, expect } from 'vitest';
import { normalizeBudgetSummary, normalizeBudgetItems } from './rs-budget';

const HEADER_ROW_COMMON = {
  'シート種別': 'レビューシート', '事業年度': '2024', '予算事業ID': '1', '事業名': 'X',
  '府省庁の建制順': '1', '政策所管府省庁': 'A省', '府省庁': 'A省', '局・庁': '', '部': '', '課': '', '室': '', '班': '', '係': '',
};

describe('normalizeBudgetSummary: blank vs explicit zero', () => {
  it('空欄はnull、明示的な0はamountsに0のまま残る', () => {
    const row = {
      ...HEADER_ROW_COMMON,
      '予算年度': '2024', '会計区分': '', '当初予算（合計）': '100', '補正予算（合計）': '0',
      '前年度からの繰越し（合計）': '', // blank
    };
    const { summaries } = normalizeBudgetSummary('/root', '/root/x.zip', 'x.csv', [row], 2024);
    expect(summaries[0].amounts['当初予算（合計）']).toBe(100);
    expect(summaries[0].amounts['補正予算（合計）']).toBe(0);
    expect(summaries[0].amounts['前年度からの繰越し（合計）']).toBeNull();
  });

  it('空欄の列からはイベントを起こさない（0円イベントとして水増ししない）', () => {
    const row = { ...HEADER_ROW_COMMON, '予算年度': '2024', '会計区分': '', '当初予算（合計）': '' };
    const { events } = normalizeBudgetSummary('/root', '/root/x.zip', 'x.csv', [row], 2024);
    expect(events.find(e => e.sourceAmountColumn === '当初予算（合計）')).toBeUndefined();
  });

  it('明示的な0円のイベントは作る（evidenceとして残す）', () => {
    const row = { ...HEADER_ROW_COMMON, '予算年度': '2024', '会計区分': '', '補正予算（合計）': '0' };
    const { events } = normalizeBudgetSummary('/root', '/root/x.zip', 'x.csv', [row], 2024);
    const ev = events.find(e => e.sourceAmountColumn === '補正予算（合計）');
    expect(ev?.amountYen).toBe(0);
  });
});

describe('normalizeBudgetSummary: 予備費等はneutral adjustment', () => {
  it('予備費等（合計）はeventType=adjustment・semanticStatus=source_neutral', () => {
    const row = { ...HEADER_ROW_COMMON, '予算年度': '2024', '会計区分': '', '予備費等（合計）': '500' };
    const { events } = normalizeBudgetSummary('/root', '/root/x.zip', 'x.csv', [row], 2024);
    const ev = events.find(e => e.sourceAmountColumn === '予備費等（合計）');
    expect(ev?.eventType).toBe('adjustment');
    expect(ev?.semanticStatus).toBe('source_neutral');
  });

  it('決算のreserve_useとは異なる型（RsEventTypeにreserve_useという値は無い）', () => {
    const row = { ...HEADER_ROW_COMMON, '予算年度': '2024', '会計区分': '一般会計', '予備費等1': '10' };
    const { events } = normalizeBudgetSummary('/root', '/root/x.zip', 'x.csv', [row], 2024);
    const ev = events.find(e => e.sourceAmountColumn === '予備費等1');
    expect(ev?.eventType).toBe('adjustment');
  });

  it('通常の当初予算はsemanticStatus=source_labeled', () => {
    const row = { ...HEADER_ROW_COMMON, '予算年度': '2024', '会計区分': '', '当初予算（合計）': '100' };
    const { events } = normalizeBudgetSummary('/root', '/root/x.zip', 'x.csv', [row], 2024);
    const ev = events.find(e => e.sourceAmountColumn === '当初予算（合計）');
    expect(ev?.semanticStatus).toBe('source_labeled');
  });
});

describe('normalizeBudgetSummary: 翌年度要求額はfiscalYear+1', () => {
  it('request系イベントのfiscalYearは元の予算年度+1になる', () => {
    const row = { ...HEADER_ROW_COMMON, '予算年度': '2024', '会計区分': '', '翌年度要求額（合計）': '1000' };
    const { events } = normalizeBudgetSummary('/root', '/root/x.zip', 'x.csv', [row], 2024);
    const ev = events.find(e => e.sourceAmountColumn === '翌年度要求額（合計）');
    expect(ev?.fiscalYear).toBe(2025);
    expect(ev?.sourceFiscalYear).toBe(2024);
  });
});

describe('normalizeBudgetItems', () => {
  it('mofNameNaturalKeyはaccountType+ministry+組織+項+目で作る', () => {
    const row = {
      ...HEADER_ROW_COMMON, '予算年度': '2024', '会計区分': '一般会計', '所管': '外務省',
      '組織・勘定': '在外公館', '項': '経済協力費', '目': '在外公館必要経費', '予算額（歳出予算項目ごと）': '100',
    };
    const [item] = normalizeBudgetItems('/root', '/root/x.zip', 'x.csv', [row], 2024);
    expect(item.mofNameNaturalKey).toBe('general|外務省|在外公館|経済協力費|在外公館必要経費');
  });

  it('金額が空欄ならbudgetAmountYenはnull', () => {
    const row = { ...HEADER_ROW_COMMON, '予算年度': '2024', '会計区分': '一般会計', '予算額（歳出予算項目ごと）': '' };
    const [item] = normalizeBudgetItems('/root', '/root/x.zip', 'x.csv', [row], 2024);
    expect(item.budgetAmountYen).toBeNull();
  });
});
