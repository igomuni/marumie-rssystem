import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import { meaningful, pick, rsShard, gzipDeterministic } from './publish-common';

describe('meaningful: 0とfalseは残す、null/undefined/空は落とす', () => {
  it.each([
    [0, true], [false, true], ['', false], [null, false], [undefined, false], [[], false], [{}, false], ['x', true], [[1], true],
  ])('meaningful(%p) === %p', (value, expected) => {
    expect(meaningful(value)).toBe(expected);
  });
});

describe('pick: keepZero既定はtrue', () => {
  it('0とfalseは既定で残る', () => {
    const out = pick({ a: 0, b: false, c: '', d: 'x' }, ['a', 'b', 'c', 'd']);
    expect(out).toEqual({ a: 0, b: false, d: 'x' });
  });

  it('keepZero=falseなら0だけ除外する（falseは残す）', () => {
    const out = pick({ a: 0, b: false }, ['a', 'b'], { keepZero: false });
    expect(out).toEqual({ b: false });
  });
});

describe('rsShard: 決定的な2桁hexを返す', () => {
  it('同じprojectIdなら常に同じshardになる', () => {
    expect(rsShard('1')).toBe(rsShard('1'));
    expect(rsShard('1')).toMatch(/^[0-9a-f]{2}$/);
  });
});

describe('gzipDeterministic: 実行時刻に依存せずbyte-for-byteで再現可能', () => {
  it('同一入力を2回圧縮すると、バイト列・SHA-256ハッシュが完全に一致する', () => {
    const data = Buffer.from(JSON.stringify({ a: 1, b: [1, 2, 3], c: 'テスト' }), 'utf-8');
    const first = gzipDeterministic(data);
    const second = gzipDeterministic(data);
    expect(first.equals(second)).toBe(true);
    const hash = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');
    expect(hash(first)).toBe(hash(second));
  });

  it('MTIMEフィールド（バイト4-7）が常にゼロである', () => {
    const compressed = gzipDeterministic(Buffer.from('x'));
    expect(compressed.readUInt32LE(4)).toBe(0);
  });
});
