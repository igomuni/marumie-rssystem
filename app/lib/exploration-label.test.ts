import { describe, it, expect } from 'vitest';
import { buildExplorationLabel } from '@/app/lib/exploration-label';

describe('buildExplorationLabel', () => {
  it('フィルタなしのクエリは年度+「フィルタなし」', () => {
    expect(buildExplorationLabel({ year: '2024' })).toBe('2024・フィルタなし');
  });

  it('年度もフィルタもない場合は「フィルタなし」のみ', () => {
    expect(buildExplorationLabel({})).toBe('フィルタなし');
  });

  it('府省庁は2件まで表示、超過は「他N」', () => {
    expect(buildExplorationLabel({ year: '2025', filter: { ministries: ['経済産業省'] } }))
      .toBe('2025・経済産業省');
    expect(buildExplorationLabel({ filter: { ministries: ['経済産業省', '環境省', '総務省', '文部科学省'] } }))
      .toBe('経済産業省/環境省 他2');
  });

  it('事業名・支出先名フィルタを引用符付きで表示', () => {
    expect(buildExplorationLabel({ filter: { projectName: { query: '半導体' } } }))
      .toBe('事業名"半導体"');
    expect(buildExplorationLabel({ filter: { recipientName: { query: '博報堂', regex: true } } }))
      .toBe('支出先"博報堂"');
  });

  it('金額範囲: 下限のみ・上限のみ・両方', () => {
    expect(buildExplorationLabel({ filter: { budget: { min: 10000000000 } } }))
      .toBe('予算100億円以上');
    expect(buildExplorationLabel({ filter: { budget: { max: 1000000000000 } } }))
      .toBe('予算1.00兆円以下');
    expect(buildExplorationLabel({ filter: { spending: { min: 10000000000, max: 1000000000000 } } }))
      .toBe('受領額100億円〜1.00兆円');
  });

  it('会計区分は全指定（=フィルタなし）では表示しない', () => {
    expect(buildExplorationLabel({ filter: { accountCategories: ['general', 'special'] } }))
      .toBe('一般会計/特別会計');
    expect(buildExplorationLabel({ filter: { accountCategories: ['general', 'special', 'both', 'none'] } }))
      .toBe('フィルタなし');
  });

  it('複合条件は「・」で連結される', () => {
    expect(buildExplorationLabel({
      year: '2024',
      filter: {
        ministries: ['経済産業省'],
        projectName: { query: '半導体' },
        budget: { min: 10000000000 },
      },
    })).toBe('2024・経済産業省・事業名"半導体"・予算100億円以上');
  });
});
