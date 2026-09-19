import { describe, it, expect } from 'vitest';
import { norm, entityMatchKey } from './match-key';

describe('norm', () => {
  it('全角英数を半角に正規化する（NFKC）', () => {
    expect(norm('ＡＢＣ１２３')).toBe('ABC123');
  });

  it('空白（全角含む）を除去する', () => {
    expect(norm('内閣 官房　総務課')).toBe('内閣官房総務課');
  });

  it('通常の日本語文字列はそのまま', () => {
    expect(norm('デジタル庁')).toBe('デジタル庁');
  });
});

describe('entityMatchKey', () => {
  it('全角/半角・空白の違いを吸収して同じキーになる', () => {
    const a = entityMatchKey('デジタル庁', 'デジタル庁', '', '情報通信技術調達等適正効率化推進費', '情報システム経費');
    const b = entityMatchKey('デジタル庁', 'デジタル庁', '', '情報通信技術調達等適正効率化推進費', '情報システム経費　');
    expect(a).toBe(b);
  });

  it('subAccountが異なれば別キーになる（特別会計の勘定違いを取り違えない）', () => {
    const a = entityMatchKey('厚生労働省', '厚生保険特別会計', '健康勘定', '保険給付費', '保険給付費');
    const b = entityMatchKey('厚生労働省', '厚生保険特別会計', '業務勘定', '保険給付費', '保険給付費');
    expect(a).not.toBe(b);
  });
});
