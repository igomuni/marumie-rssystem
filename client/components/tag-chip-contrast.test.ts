import { describe, it, expect } from 'vitest';
import { tagChipColors, type TagKind } from './tag-chip-colors';

/** WCAG 相対輝度（sRGB）。#rgb / #rrggbb を受け付ける */
function luminance(hex: string): number {
  const h = hex.length === 4 ? '#' + [...hex.slice(1)].map((c) => c + c).join('') : hex;
  const chan = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(1) + 0.7152 * chan(3) + 0.0722 * chan(5);
}

function contrastRatio(a: string, b: string): number {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

describe('tagChipColors contrast', () => {
  const kinds: TagKind[] = ['project', 'direct', 'subcontract', 'separate-origin', 'neutral'];

  // タグは太字だが小さく（既定10px）出るため、通常テキスト基準 4.5:1 を満たすこと
  it.each(kinds)('%s meets WCAG AA 4.5:1', (kind) => {
    const { bg, fg } = tagChipColors(kind);
    expect(contrastRatio(bg, fg)).toBeGreaterThanOrEqual(4.5);
  });
});
