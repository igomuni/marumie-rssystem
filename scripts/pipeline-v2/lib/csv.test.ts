import { describe, it, expect } from 'vitest';
import { parseCsv, parseAmount } from './csv';

describe('parseCsv', () => {
  it('BOM付きヘッダーを正しく読む', () => {
    const rows = parseCsv('﻿a,b\n1,2\n');
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('クォート内のカンマを1フィールドとして扱う', () => {
    const rows = parseCsv('name,note\n"事業A","説明,補足"\n');
    expect(rows).toEqual([{ name: '事業A', note: '説明,補足' }]);
  });

  it('クォート内の改行を1フィールドとして扱う', () => {
    const rows = parseCsv('name,note\n"事業A","1行目\n2行目"\n');
    expect(rows).toEqual([{ name: '事業A', note: '1行目\n2行目' }]);
  });

  it('エスケープされたダブルクォート（""）を1文字の"に戻す', () => {
    const rows = parseCsv('name\n"a""b"\n');
    expect(rows).toEqual([{ name: 'a"b' }]);
  });

  it('CRLF改行に対応する', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n3,4\r\n');
    expect(rows).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }]);
  });

  it('CR単独の改行にも対応する（レコードを1行に潰さない）', () => {
    const rows = parseCsv('a,b\r1,2\r3,4\r');
    expect(rows).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }]);
  });

  it('クォート内のCR/LFはそのまま保持する', () => {
    const rows = parseCsv('name,note\n"事業A","1行目\r\n2行目"\n"事業B","3行目\r4行目"\n');
    expect(rows).toEqual([
      { name: '事業A', note: '1行目\r\n2行目' },
      { name: '事業B', note: '3行目\r4行目' },
    ]);
  });

  it('空行を無視する', () => {
    const rows = parseCsv('a,b\n1,2\n\n3,4\n');
    expect(rows).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }]);
  });

  it('空のCSVは空配列を返す', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('ヘッダーが空文字の列は行オブジェクトに含めない', () => {
    const rows = parseCsv('a,,c\n1,2,3\n');
    expect(rows).toEqual([{ a: '1', c: '3' }]);
  });
});

describe('parseAmount', () => {
  it('カンマ区切りの数値を変換する', () => {
    expect(parseAmount('1,234,567')).toBe(1234567);
  });

  it('undefinedは0を返す', () => {
    expect(parseAmount(undefined)).toBe(0);
  });

  it('空文字は0を返す', () => {
    expect(parseAmount('')).toBe(0);
  });

  it('非数値は0を返す', () => {
    expect(parseAmount('該当なし')).toBe(0);
  });

  it('前後の空白を無視する', () => {
    expect(parseAmount('  42  ')).toBe(42);
  });
});
