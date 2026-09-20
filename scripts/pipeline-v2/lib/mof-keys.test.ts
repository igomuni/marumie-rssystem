import { describe, it, expect } from 'vitest';
import { scopeOf, sectionNaturalKey, legacySectionKey, scopeNameItemKey, standardAmountColumn, isExpenditureHeaders } from './mof-keys';

describe('scopeOf', () => {
  it('一般会計は所管・組織を読む', () => {
    expect(scopeOf({ '所管': '外務省', '組織': '在外公館' }, 'general')).toEqual({
      ministry: '外務省', organization: '在外公館', specialAccount: '', subAccount: '', agency: '',
    });
  });
  it('特別会計は所管・特別会計名・勘定を読む（組織は使わない）', () => {
    expect(scopeOf({ '所管': '厚生労働省', '特別会計': '厚生保険特別会計', '勘定': '健康勘定' }, 'special')).toEqual({
      ministry: '厚生労働省', organization: '', specialAccount: '厚生保険特別会計', subAccount: '健康勘定', agency: '',
    });
  });
  it('政府関係機関は政府関係機関名・業務を読む', () => {
    expect(scopeOf({ '政府関係機関': '沖縄振興開発金融公庫', '業務': '一般業務' }, 'agency')).toEqual({
      ministry: '', organization: '', specialAccount: '', subAccount: '一般業務', agency: '沖縄振興開発金融公庫',
    });
  });
});

describe('sectionNaturalKey / legacySectionKey', () => {
  it('項名が違えば同じ項コードでも別キーになる（東日本大震災復興特別会計の実例）', () => {
    const scope = scopeOf({ '所管': '内閣府', '特別会計': '東日本大震災復興', '勘定': '' }, 'special');
    const a = sectionNaturalKey('special', scope, '01', '復興債費');
    const b = sectionNaturalKey('special', scope, '01', '復興庁共通費');
    expect(a).not.toBe(b);
  });
  it('legacySectionKeyは項名を含まないため同じ項コードなら同じキーになる（意図的な衝突）', () => {
    const scope = scopeOf({ '所管': '内閣府', '特別会計': '東日本大震災復興', '勘定': '' }, 'special');
    const a = legacySectionKey('special', scope, '01');
    const b = legacySectionKey('special', scope, '01');
    expect(a).toBe(b);
  });
});

describe('scopeNameItemKey', () => {
  it('コードを含まずscope+項名+目名だけで作る', () => {
    const scope = scopeOf({ '所管': '外務省', '組織': '在外公館' }, 'general');
    const key = scopeNameItemKey('general', scope, '経済協力費', '在外公館必要経費');
    expect(key).toBe('general|外務省|在外公館|経済協力費|在外公館必要経費');
  });
});

describe('standardAmountColumn', () => {
  it('前年度・比較・改を除いた本年度の予算額列を選ぶ', () => {
    const headers = ['項名', '目名', '令和6年度要求額(千円)', '前年度予算額(千円)', '比較増△減額(千円)'];
    expect(standardAmountColumn(headers)).toBe('令和6年度要求額(千円)');
  });
  it('改{年度}予算額（補正後総額）は候補から除外する', () => {
    const headers = ['項名', '令和6年度予算額(千円)', '改令和6年度予算額(千円)'];
    expect(standardAmountColumn(headers)).toBe('令和6年度予算額(千円)');
  });
  it('候補が無ければエラーにする', () => {
    expect(() => standardAmountColumn(['項名', '目名'])).toThrow();
  });
});

describe('isExpenditureHeaders', () => {
  it('主要経費別分類を含めば歳出表と判定する', () => {
    expect(isExpenditureHeaders(['所管', '主要経費別分類コード'])).toBe(true);
  });
  it('使途別分類を含めば歳出表と判定する（政府関係機関の決算等）', () => {
    expect(isExpenditureHeaders(['政府関係機関', '使途別分類コード'])).toBe(true);
  });
  it('どちらも無ければ歳出表ではない（歳入表）', () => {
    expect(isExpenditureHeaders(['所管', '款コード'])).toBe(false);
  });
});
