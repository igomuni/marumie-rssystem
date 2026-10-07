import { describe, expect, it } from 'vitest';
import { buildDocumentPages, buildPageRawText, documentStatusOf, isNonEmptyLine, nonEmptyLinesOf, splitPdftotextPages } from './budget-request-raw-text';

describe('budget-request raw text contract', () => {
  it('末尾の form feed が作る空要素だけを落とし、page 数と一致させる', () => {
    expect(splitPdftotextPages('a\f\fb\f', 3)).toEqual(['a', '', 'b']);
    expect(splitPdftotextPages('a\fb\f', 2)).toEqual(['a', 'b']);
  });
  it('page 数が合わなければ throw する（page boundary を推測しない）', () => {
    expect(() => splitPdftotextPages('a\fb', 2)).toThrow(/form feed/);
    expect(() => splitPdftotextPages('a\fb\f', 3)).toThrow(/page boundary mismatch/);
    expect(() => splitPdftotextPages('a\fb\fc\f', 2)).toThrow(/page boundary mismatch/);
  });
  it('text は無加工で保持し、行は trim・結合・正規化しない', () => {
    const t = '  ＡＢＣ　１２３\r\n\n  - x\n';
    const p = buildPageRawText(1, t);
    expect(p.text).toBe(t);
    expect(p.nonEmptyLines).toEqual([
      { lineIndex: 0, text: '  ＡＢＣ　１２３\r' },
      { lineIndex: 2, text: '  - x' },
    ]);
  });
  it('空白のみ（全角空白・\\r・\\t を含む）の行は empty と判定する', () => {
    expect(isNonEmptyLine('　 \t\r')).toBe(false);
    expect(nonEmptyLinesOf('\n \n　\n')).toEqual([]);
  });
  it('page status は non-whitespace の有無だけで決まり、空 page も record を残す', () => {
    const pages = buildDocumentPages('\f \n\fx\f', 3);
    expect(pages.map(p => [p.page, p.status])).toEqual([[1, 'EMPTY'], [2, 'EMPTY'], [3, 'EXTRACTED']]);
    expect(documentStatusOf(pages)).toBe('EXTRACTED');
    expect(documentStatusOf(buildDocumentPages('\f\f', 2))).toBe('EMPTY');
  });
  it('hash と文字数は text から決定的', () => {
    const a = buildPageRawText(1, 'あい u');
    const b = buildPageRawText(1, 'あい u');
    expect(a).toEqual(b);
    expect(a.charCount).toBe(4);
    expect(a.nonWhitespaceCharCount).toBe(3);
  });
});
