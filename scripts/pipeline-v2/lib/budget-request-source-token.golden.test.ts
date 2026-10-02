/**
 * Golden Sample 4件の実PDF検証。**ローカルの data/download/ の原本PDFに依存する**ため、原本が無い環境
 * （CI等）では自動的にskipされる。人間確認値（human-observations.json）は評価専用で、抽出結果の補正には使わない。
 */
import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { getBudgetRequestManifest } from './budget-request-manifest';
import {
  goldenSamplePath,
  humanObservationsPath,
  listExtractionTargets,
  resolveGoldenSamples,
  type GoldenSampleFile,
} from './budget-request-extraction';
import { extractPageTokens } from './budget-request-pdf-page';
import { compareObservation, type HumanObservation } from './budget-request-source-token';

const targets = listExtractionTargets(getBudgetRequestManifest(2024));
const { resolved } = resolveGoldenSamples(JSON.parse(fs.readFileSync(goldenSamplePath(2024), 'utf8')) as GoldenSampleFile, targets);
const observations = (JSON.parse(fs.readFileSync(humanObservationsPath(2024), 'utf8')) as { observations: Record<string, HumanObservation[]> }).observations;
const available = resolved.length > 0 && resolved.every(r => fs.existsSync(r.target.localPath));

describe.skipIf(!available)('Golden Sample SourceToken（実PDF・ローカルdata/download依存）', () => {
  for (const { sample, target } of resolved) {
    it(`${sample.id} (${sample.tier}): tokenが取得でき、人間確認値と0.01pt以内で一致する`, async () => {
      const r = await extractPageTokens(target.localPath, sample.pdfPage);
      expect(r.tokens.length).toBeGreaterThan(0);
      for (const o of observations[sample.id] ?? []) {
        const c = compareObservation(r.tokens, o);
        expect(c.token, `"${o.text}" に該当するtokenが無い`).toBeDefined();
        expect(Math.abs(c.dx!)).toBeLessThanOrEqual(0.01);
        expect(Math.abs(c.dy!)).toBeLessThanOrEqual(0.01);
      }
    }, 60_000);
  }

  it('MEXT p876: 備考列の積算を1つの巨大文字列へ潰さず、単価・人数・回数等が別tokenで位置を保つ', async () => {
    const s = resolved.find(r => r.sample.tier === 'structured-remark')!;
    const { tokens } = await extractPageTokens(s.target.localPath, s.sample.pdfPage);
    const row = tokens.find(t => t.rawText === '１．会議出席旅費（４級）')!;
    const same = tokens.filter(t => Math.abs(t.bbox.yMin - row.bbox.yMin) < 0.5 && t.rawText.trim() !== '');
    expect(same.map(t => t.rawText)).toEqual(expect.arrayContaining(['@', '37,940', '円', '×', '人', '回', '(', ')']));
    expect(Math.max(...tokens.map(t => t.rawText.length))).toBeLessThan(60); // 表全体が1 tokenになっていない
  }, 60_000);

  it('MHLW p1555: 上部の大表と下部Coreがy座標で区別でき、関連付けはしない', async () => {
    const s = resolved.find(r => r.sample.tier === 'extreme')!;
    const { tokens } = await extractPageTokens(s.target.localPath, s.sample.pdfPage);
    const nonWs = tokens.filter(t => t.rawText.trim() !== '');
    expect(nonWs.filter(t => t.bbox.yMin < 400).length).toBeGreaterThan(100);
    const lower = nonWs.filter(t => t.bbox.yMin >= 420);
    expect(lower.map(t => t.rawText)).toContain('01-95');
    expect(Object.keys(nonWs[0]).sort()).not.toContain('parent'); // 関連付けのフィールドを持たない
  }, 60_000);

  it('MHLW 1,723頁PDFから指定1ページだけを読む（全ページ走査しない）。1ページ分は数秒以内', async () => {
    const s = resolved.find(r => r.sample.tier === 'extreme')!;
    const t0 = Date.now();
    const r = await extractPageTokens(s.target.localPath, s.sample.pdfPage);
    expect(r.page.numPages).toBe(1723);
    expect(Date.now() - t0).toBeLessThan(15_000);
  }, 60_000);
});
