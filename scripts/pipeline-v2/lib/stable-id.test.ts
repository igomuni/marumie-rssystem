import { describe, it, expect } from 'vitest';
import { normalizeText, stableId, publicStableId, shardOf } from './stable-id';

describe('normalizeText', () => {
  it('NFKCで全角英数を半角にする', () => {
    expect(normalizeText('ＡＢＣ１２３')).toBe('ABC123');
  });
  it('空白（全角含む）を除去する', () => {
    expect(normalizeText('内閣 官房　総務課')).toBe('内閣官房総務課');
  });
  it('null/undefinedは空文字', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });
});

describe('stableId', () => {
  it('同じパーツ列は常に同じIDになる', () => {
    const a = stableId(['general', '外務省', '在外公館', '027', '経済協力費']);
    const b = stableId(['general', '外務省', '在外公館', '027', '経済協力費']);
    expect(a).toBe(b);
  });
  it('全角/半角・空白の違いを吸収する', () => {
    const a = stableId(['一般', 'デジタル庁']);
    const b = stableId(['一般', 'デジタル 庁']);
    expect(a).toBe(b);
  });
  it('パーツの順序が違えば別IDになる', () => {
    const a = stableId(['a', 'b']);
    const b = stableId(['b', 'a']);
    expect(a).not.toBe(b);
  });
  it('パーツの値が違えば別IDになる（区切り文字混同を起こさない）', () => {
    const a = stableId(['ab', 'c']);
    const b = stableId(['a', 'bc']);
    expect(a).not.toBe(b);
  });
  it('prefixを付けられる', () => {
    expect(stableId(['x'], 'mofrow_')).toMatch(/^mofrow_[0-9a-f]{20}$/);
  });
  it('prefix無しは20桁の16進文字列', () => {
    expect(stableId(['x'])).toMatch(/^[0-9a-f]{20}$/);
  });
});

describe('publicStableId', () => {
  it('Python参照実装の実際の出力値と一致する（golden value）', () => {
    // public/data/v2/mof/fy2024の実生成物（pipeline-v2-unified-public-20260920.tar.gz）で
    // 確認したFY2024 外務省/在外公館/027/経済協力費のsection ID
    const id = publicStableId(['mof-section', 2024, 'general', '外務省', '在外公館', '', '', '', '027', '経済協力費']);
    expect(id).toBe('0067ec27906deaa07022');
  });
  it('NFKC正規化はしない（値をそのまま比較するため）', () => {
    const a = publicStableId(['general', 'デジタル庁']);
    const b = publicStableId(['general', 'デジタル 庁']);
    expect(a).not.toBe(b);
  });
  it('同じパーツ列は常に同じIDになる', () => {
    expect(publicStableId(['a', 1, 'b'])).toBe(publicStableId(['a', 1, 'b']));
  });
});

describe('shardOf', () => {
  it('IDの先頭2桁を返す', () => {
    expect(shardOf('0067ec27906deaa07022')).toBe('00');
    expect(shardOf('ffabc')).toBe('ff');
  });
});
