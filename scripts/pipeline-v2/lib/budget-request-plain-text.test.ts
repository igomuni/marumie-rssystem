import { assertUniqueSlugs, deterministicPdfSlug, sha256, splitAndValidatePdfText } from './budget-request-plain-text';
import { describe, expect, it } from 'vitest';

describe('plain text PDF byte boundaries', () => {
  it('handles one page and preserves its bytes', () => {
    const bytes = Buffer.from('plain\ntext\f');
    expect(splitAndValidatePdfText(bytes, 1, [sha256(Buffer.from('plain\ntext'))])[0]).toEqual(Buffer.from('plain\ntext'));
  });

  it('handles multiple pages, empty pages, terminal FF, Unicode and layout whitespace', () => {
    const p1 = Buffer.from('  日本語   repeated  spaces\n\nindented\tline');
    const p2 = Buffer.alloc(0);
    const p3 = Buffer.from('最後のページ');
    const raw = Buffer.concat([p1, Buffer.from([12]), p2, Buffer.from([12]), p3, Buffer.from([12])]);
    expect(splitAndValidatePdfText(raw, 3, [sha256(p1), sha256(p2), sha256(p3)])).toEqual([p1, p2, p3]);
  });

  it('rejects missing terminal FF, missing boundaries and page-count mismatch', () => {
    expect(() => splitAndValidatePdfText(Buffer.from('page'), 1)).toThrow(/does not end/);
    expect(() => splitAndValidatePdfText(Buffer.from('page\fnext'), 2)).toThrow(/form feed/);
    expect(() => splitAndValidatePdfText(Buffer.from('a\fb\f'), 1)).toThrow(/form feeds/);
  });

  it('rejects frozen page hash mismatch and invalid UTF-8', () => {
    expect(() => splitAndValidatePdfText(Buffer.from('x\f'), 1, ['0'.repeat(64)])).toThrow(/SHA-256 mismatch/);
    expect(() => splitAndValidatePdfText(Buffer.from([0xff, 12]), 1)).toThrow();
  });

  it('creates deterministic slugs and detects collisions', () => {
    expect(deterministicPdfSlug('data/download/example.gov/a/b.PDF')).toBe('example.gov__a__b');
    expect(deterministicPdfSlug('data\\download\\example.gov\\a.pdf')).toBe('example.gov__a');
    expect(() => assertUniqueSlugs(['data/download/a__b/c.pdf', 'data/download/a/b__c.pdf'])).toThrow(/collision/);
    expect(assertUniqueSlugs(['data/download/a.pdf', 'data/download/b.pdf']).size).toBe(2);
  });
});
