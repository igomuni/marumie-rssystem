/**
 * FieldResolver v0 held-out の freeze verification（評価側）。freeze commit 時点の blob SHA と現在の作業ツリーの blob SHA を比較する。
 * 1ファイルでも不一致なら held-out の評価を実行しない（STOP）。
 */
import { execFileSync } from 'child_process';

export const INFERENCE_FREEZE_FILES = [
  'scripts/pipeline-v2/lib/budget-request-field-resolver.ts',
  'scripts/pipeline-v2/lib/budget-request-field-resolver-runs.ts',
  'scripts/pipeline-v2/lib/budget-request-field-resolver-paths.ts',
  'scripts/pipeline-v2/extract-budget-request-field-resolver.ts',
  'scripts/pipeline-v2/lib/budget-request-field-resolver-evaluator.ts',
  'scripts/pipeline-v2/evaluate-budget-request-field-resolver.ts',
  'tests/fixtures/budget-request-field-resolver/v0/golden.json',
  'docs/tasks/20261003_0648_FieldResolver_v0_Contract.md',
  'docs/tasks/20261003_0648_FieldResolver_v0_Golden_Samples.md',
];

export type GitRunner = (args: string[]) => string;
export const defaultGit: GitRunner = args => execFileSync('git', args, { encoding: 'utf8' }).trim();

export interface FreezeEntry {
  path: string;
  blobShaAtFreeze: string | null;
  blobShaCurrent: string | null;
  match: boolean;
}
export interface FreezeVerification {
  freezeCommit: string;
  entries: FreezeEntry[];
  allMatch: boolean;
}

const sha = (f: () => string): string | null => {
  try {
    return f();
  } catch {
    return null;
  }
};

export function verifyFreeze(freezeCommit: string, files: string[], git: GitRunner = defaultGit): FreezeVerification {
  const entries = files.map(path => {
    const blobShaAtFreeze = sha(() => git(['rev-parse', `${freezeCommit}:${path}`]));
    const blobShaCurrent = sha(() => git(['hash-object', path]));
    return { path, blobShaAtFreeze, blobShaCurrent, match: blobShaAtFreeze !== null && blobShaAtFreeze === blobShaCurrent };
  });
  return { freezeCommit, entries, allMatch: entries.every(e => e.match) };
}
