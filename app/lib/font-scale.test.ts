import { describe, it, expect } from 'vitest';
import { createScaleFont, FONT_SCALE_REFERENCE_PX } from '@/app/lib/font-scale';

describe('createScaleFont', () => {
  it('is the identity function (rounded) at the reference baseline', () => {
    const scaleFont = createScaleFont(FONT_SCALE_REFERENCE_PX);
    expect(scaleFont(12)).toBe(12);
    expect(scaleFont(20)).toBe(20);
    expect(scaleFont(1)).toBe(1);
  });

  it('scales proportionally when baseFontPx differs from the reference', () => {
    const scaleFont = createScaleFont(24, FONT_SCALE_REFERENCE_PX); // 2x scale
    expect(scaleFont(12)).toBe(24);
    expect(scaleFont(10)).toBe(20);
  });

  it('rounds to the nearest integer', () => {
    const scaleFont = createScaleFont(13, FONT_SCALE_REFERENCE_PX); // scale factor 13/12
    // 10 * 13/12 = 10.833... -> rounds to 11
    expect(scaleFont(10)).toBe(11);
  });

  it('never returns less than 1 even for very small px or scale', () => {
    const scaleFont = createScaleFont(1, FONT_SCALE_REFERENCE_PX); // scale factor 1/12
    expect(scaleFont(1)).toBe(1);
    expect(scaleFont(0)).toBe(1);
  });

  it('supports a custom referencePx', () => {
    const scaleFont = createScaleFont(10, 10);
    expect(scaleFont(16)).toBe(16);
  });
});
