import { describe, it, expect } from 'vitest';
import { parseIntValue, parseNumber, yenFromThousand, canonicalProjectId } from './parse';

describe('parseIntValue', () => {
  it('カンマ区切りの整数を変換する', () => {
    expect(parseIntValue('1,234,567')).toBe(1234567);
  });
  it('blankは既定で0', () => {
    expect(parseIntValue('')).toBe(0);
    expect(parseIntValue(null)).toBe(0);
  });
  it('noneIfBlank指定時はblankでnull', () => {
    expect(parseIntValue('', { noneIfBlank: true })).toBeNull();
  });
  it('ハイフン等のblankトークンもblank扱い', () => {
    expect(parseIntValue('-', { noneIfBlank: true })).toBeNull();
    expect(parseIntValue('―', { noneIfBlank: true })).toBeNull();
  });
});

describe('parseNumber', () => {
  it('blankはnull（0に潰さない）', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(null)).toBeNull();
  });
  it('明示的な0は0のまま', () => {
    expect(parseNumber('0')).toBe(0);
  });
  it('数値を返す', () => {
    expect(parseNumber('42')).toBe(42);
  });
});

describe('yenFromThousand', () => {
  it('千円を円に変換する（浮動小数点誤差なし）', () => {
    expect(yenFromThousand('11,200.834')).toBe(11200834);
  });
  it('負数に対応する', () => {
    expect(yenFromThousand('-500')).toBe(-500000);
  });
  it('blankは既定で0', () => {
    expect(yenFromThousand('')).toBe(0);
  });
  it('noneIfBlank指定時はblankでnull', () => {
    expect(yenFromThousand('', { noneIfBlank: true })).toBeNull();
  });
  it('小数点以下4桁目以降は切り捨てる', () => {
    expect(yenFromThousand('1.2345')).toBe(1234);
  });
});

describe('canonicalProjectId', () => {
  it('数値のみのIDは先頭の0を除去する', () => {
    expect(canonicalProjectId('000004')).toBe('4');
  });
  it('全て0のIDは"0"になる', () => {
    expect(canonicalProjectId('0000')).toBe('0');
  });
  it('数値でないIDはそのまま保持する', () => {
    expect(canonicalProjectId('abc123')).toBe('abc123');
  });
  it('空文字は空文字のまま', () => {
    expect(canonicalProjectId('')).toBe('');
  });
});
