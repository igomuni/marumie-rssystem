/** MOF XML 事項 parser v0 の frozen evaluation で、preregistration §16 の GO 条件を機械適用するための純関数。 */

export interface SourceSetCompleteness { complete: boolean; localCount: number; expectedCount: number; missingLocally: string[]; unexpectedLocally: string[]; duplicateExpected: string[] }

/** ローカルの XML ファイル名集合が、source set（target + non-target）と完全に一致するか。1 本でも欠落・余剰・重複があれば不完全 */
export function checkSourceSetCompleteness(local: string[], expectedTargets: string[], expectedNonTargets: string[]): SourceSetCompleteness {
  const expected = [...expectedTargets, ...expectedNonTargets];
  const expectedSet = new Set(expected);
  const localSet = new Set(local);
  const missingLocally = expected.filter(f => !localSet.has(f)).sort();
  const unexpectedLocally = local.filter(f => !expectedSet.has(f)).sort();
  const duplicateExpected = expected.filter((f, i) => expected.indexOf(f) !== i).sort();
  return {
    complete: missingLocally.length === 0 && unexpectedLocally.length === 0 && duplicateExpected.length === 0 && local.length === localSet.size && local.length === expected.length,
    localCount: local.length, expectedCount: expected.length, missingLocally, unexpectedLocally, duplicateExpected,
  };
}

export interface VitestSummary { numTotalTests: number; numPassedTests: number; numFailedTests: number }
/** fail-closed test の通過（失敗 0・1 件以上の実行・最低件数以上）。 */
export function failClosedTestsPassed(s: VitestSummary, minimumTests: number): boolean {
  return s.numFailedTests === 0 && s.numPassedTests === s.numTotalTests && s.numTotalTests >= minimumTests;
}
