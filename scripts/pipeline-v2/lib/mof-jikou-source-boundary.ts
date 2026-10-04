/**
 * MOF 事項 normalizer（normalize-mof-jikou.ts）の入力境界を fail-closed にするための純関数。
 * parser v0 の frozen scope（FY2024 一般会計 当初予算 202411001）では、source-set artifact の同一性・menu が列挙する XML 集合の完全性・
 * 期待 population（target 94 / non-target 234 / 事項 1,256）が揃わない限り、出力を生成しない。
 */
import { createHash } from 'crypto';
import { checkSourceSetCompleteness } from './mof-budget-xml-items-evaluation-rules';

/** frozen source-set artifact の SHA-256（#370 の preregistration freeze 時の値） */
export const FROZEN_SOURCE_SET_SHA256 = '62df90fb32caf5997ecb2772eb0c84da66789b635eb1bc024743cf6a8da2afe3';
export const EXPECTED_TARGET_FILES = 94;
export const EXPECTED_NON_TARGET_FILES = 234;
export const EXPECTED_JIKOU_RECORDS = 1256;

export interface SourceSetArtifact { targets: { file: string; sha256: string }[]; nonTargets: { file: string; sha256: string }[] }

/** source-set artifact の bytes が frozen 値と一致すること（任意の artifact を渡して境界を弱められないようにする） */
export function assertFrozenSourceSetArtifact(bytes: Uint8Array | Buffer): void {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== FROZEN_SOURCE_SET_SHA256) throw new Error(`source-set artifact が frozen 値と一致しない（${actual}）。frozen source set 以外では生成しない`);
}

/** menu が列挙する XML の集合が、source set（target 94 + non-target 234 = 328）と過不足なく一致すること。0 件・欠落・余剰・重複・差し替えはすべて失敗 */
export function assertMenuMatchesSourceSet(menuFiles: string[], set: SourceSetArtifact): void {
  if (set.targets.length !== EXPECTED_TARGET_FILES || set.nonTargets.length !== EXPECTED_NON_TARGET_FILES) {
    throw new Error(`source set の件数が想定外（target ${set.targets.length} / non-target ${set.nonTargets.length}）`);
  }
  const c = checkSourceSetCompleteness(menuFiles, set.targets.map(t => t.file), set.nonTargets.map(t => t.file));
  if (menuFiles.length === 0 || !c.complete) {
    throw new Error(`menu の XML 集合が frozen source set と一致しない（menu ${c.localCount} / expected ${c.expectedCount}、欠落 ${c.missingLocally.length}、余剰 ${c.unexpectedLocally.length}、重複 ${c.duplicateExpected.length}）`);
  }
}

/** 生成結果の population が期待どおりであること（target 94 / non-target 234 / 事項 1,256） */
export function assertExpectedPopulation(p: { targetFiles: number; notTargetFiles: number; records: number }): void {
  if (p.targetFiles !== EXPECTED_TARGET_FILES || p.notTargetFiles !== EXPECTED_NON_TARGET_FILES || p.records !== EXPECTED_JIKOU_RECORDS) {
    throw new Error(`生成結果の population が期待と異なる（target ${p.targetFiles} / not_target ${p.notTargetFiles} / 事項 ${p.records}。期待 ${EXPECTED_TARGET_FILES} / ${EXPECTED_NON_TARGET_FILES} / ${EXPECTED_JIKOU_RECORDS}）`);
  }
}
