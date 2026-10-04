import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { FROZEN_SOURCE_SET_SHA256, assertExpectedPopulation, assertFrozenSourceSetArtifact, assertMenuMatchesSourceSet, type SourceSetArtifact } from './mof-jikou-source-boundary';

const artifactPath = path.join('tests', 'fixtures', 'mof-budget-xml-parser-v0', '2024', '202411001-source-set.json');
const bytes = fs.readFileSync(artifactPath);
const set = JSON.parse(bytes.toString('utf8')) as SourceSetArtifact;
const all = [...set.targets, ...set.nonTargets].map(t => t.file);

describe('production normalizer の入力境界（fail-closed）', () => {
  it('frozen source-set artifact は通り、改変・差し替えは失敗する', () => {
    expect(FROZEN_SOURCE_SET_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(() => assertFrozenSourceSetArtifact(bytes)).not.toThrow();
    expect(() => assertFrozenSourceSetArtifact(Buffer.concat([bytes, Buffer.from(' ')]))).toThrow();
    expect(() => assertFrozenSourceSetArtifact(Buffer.from(bytes.toString('utf8').replace(set.targets[0].sha256, '0'.repeat(64))))).toThrow();
    expect(() => assertFrozenSourceSetArtifact(Buffer.from('{}'))).toThrow();
  });
  it('menu の XML 集合が 328 件で完全一致なら通る', () => {
    expect(all).toHaveLength(328);
    expect(() => assertMenuMatchesSourceSet(all, set)).not.toThrow();
    expect(() => assertMenuMatchesSourceSet([...all].reverse(), set)).not.toThrow();
  });
  it('0 件・1 件欠落（non-target / target）・余剰・同数の差し替え・重複は失敗する', () => {
    expect(() => assertMenuMatchesSourceSet([], set)).toThrow();
    expect(() => assertMenuMatchesSourceSet(all.filter(f => f !== set.nonTargets[0].file), set)).toThrow();
    expect(() => assertMenuMatchesSourceSet(all.filter(f => f !== set.targets[0].file), set)).toThrow();
    expect(() => assertMenuMatchesSourceSet([...all, 'extra.xml'], set)).toThrow();
    expect(() => assertMenuMatchesSourceSet([...all.slice(1), 'swapped.xml'], set)).toThrow();
    expect(() => assertMenuMatchesSourceSet([...all.slice(1), all[1]], set)).toThrow();
  });
  it('source set 自体の件数が想定外（改変された artifact）なら失敗する', () => {
    expect(() => assertMenuMatchesSourceSet(all, { ...set, targets: set.targets.slice(1) })).toThrow();
    expect(() => assertMenuMatchesSourceSet(all, { ...set, nonTargets: [...set.nonTargets, set.targets[0]] })).toThrow();
  });
  it('生成結果の population が 94 / 234 / 1,256 でなければ失敗する（0 件を含む）', () => {
    expect(() => assertExpectedPopulation({ targetFiles: 94, notTargetFiles: 234, records: 1256 })).not.toThrow();
    for (const p of [{ targetFiles: 0, notTargetFiles: 0, records: 0 }, { targetFiles: 93, notTargetFiles: 234, records: 1255 }, { targetFiles: 94, notTargetFiles: 234, records: 1257 }, { targetFiles: 94, notTargetFiles: 233, records: 1256 }]) {
      expect(() => assertExpectedPopulation(p)).toThrow();
    }
  });
});
