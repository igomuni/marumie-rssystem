import { describe, expect, it } from 'vitest';
import { classifyPosition, frameOf } from './budget-request-p1-outlier';

describe('frameOf / classifyPosition', () => {
  const frame = frameOf([{ x: 31, yMin: 27.8, yMax: 555.5 }, { x: 797, yMin: 27.8, yMax: 555.5 }, { x: 50, yMin: 27.8, yMax: 555.5 }]);
  it('frame は long な垂直 rule の範囲。rule が無ければ null', () => {
    expect(frame).toEqual({ top: 27.8, bottom: 555.5, left: 31, right: 797 });
    expect(frameOf([])).toBeNull();
  });
  it('frame より上側 → header position、frame の内側 → body / table position、跨ぐ・frame なし → ambiguous', () => {
    expect(classifyPosition({ xMin: 38, xMax: 83, yMin: 20.8, yMax: 27.8 }, frame).classification).toBe('SOURCE_HEADER_POSITION_SUPPORTED');
    expect(classifyPosition({ xMin: 38, xMax: 83, yMin: 47.6, yMax: 55 }, frame).classification).toBe('SOURCE_BODY_OR_TABLE_POSITION_SUPPORTED');
    expect(classifyPosition({ xMin: 38, xMax: 83, yMin: 24, yMax: 33 }, frame).classification).toBe('SOURCE_POSITION_AMBIGUOUS');
    expect(classifyPosition({ xMin: 10, xMax: 83, yMin: 47.6, yMax: 55 }, frame).classification).toBe('SOURCE_POSITION_AMBIGUOUS');
    expect(classifyPosition({ xMin: 38, xMax: 83, yMin: 47.6, yMax: 55 }, null).classification).toBe('SOURCE_POSITION_AMBIGUOUS');
  });
});
