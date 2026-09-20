/**
 * RS 4-1（点検・評価）の正規化。Python参照実装のnormalize_evaluationsと同じ。
 * CSV row iterator→normalize generator→writeJsonlのstreaming経路。
 */
import { rsBase, rsSourceRef, rsRecordId, extraFields, SourceInventoryTracker, COMMON_COLUMNS } from './rs-common';
import { parseNumber } from './parse';
import type { RsEvaluation, SourceInventory } from '../types';

/** 原本列名 → typed fieldキー */
const FIELDS: Record<string, keyof RsEvaluation> = {
  '事業所管部局による点検・改善ー点検結果': 'departmentCheckResult',
  '事業所管部局による点検・改善ー改善の方向性': 'departmentImprovementDirection',
  '事業所管部局による点検・改善－目標年度における効果測定に関する評価': 'targetYearEffectEvaluation',
  '外部有識者による点検ー最終実施年度': 'externalReviewLatestYear',
  '外部有識者による点検ー点検対象': 'externalReviewTarget',
  '外部有識者による点検ー対象の理由': 'externalReviewReason',
  '外部有識者による点検ー所見': 'externalReviewFindings',
  '公開プロセス結果概要': 'publicProcessSummary',
  '行政事業レビュー推進チームの所見': 'reviewTeamFinding',
  '行政事業レビュー推進チームの所見の詳細': 'reviewTeamFindingDetail',
  '所見を踏まえた改善点／概算要求における反映状況': 'requestReflectionStatus',
  '所見を踏まえた改善点／概算要求における反映状況の詳細': 'requestReflectionDetail',
  '反映額（一般会計）': 'reflectionGeneralRaw',
  '反映額（特別会計）－会計': 'reflectionSpecialAccount',
  '反映額（特別会計）－勘定': 'reflectionSpecialSubAccount',
  '反映額（特別会計）－反映額': 'reflectionSpecialRaw',
  '過去に受けた指摘事項－区分': 'pastFindingCategory',
  '過去に受けた指摘事項－取りまとめ年度': 'pastFindingYear',
  '過去に受けた指摘事項－取りまとめ内容': 'pastFinding',
  '過去に受けた指摘事項－対応状況': 'pastFindingResponse',
  'その他の指摘事項－調査等の名称': 'otherFindingSource',
  'その他の指摘事項－指摘年度': 'otherFindingYear',
  'その他の指摘事項－指摘内容': 'otherFinding',
  'その他の指摘事項－対応状況': 'otherFindingResponse',
};

const MAPPED = new Set([...COMMON_COLUMNS, ...Object.keys(FIELDS)]);

export function normalizeEvaluations(
  rawRoot: string, zipPath: string, entry: string, rows: Iterable<Record<string, string>>, year: number, headers: string[]
): { rows: Generator<RsEvaluation>; sourceInventory: () => SourceInventory } {
  const tracker = new SourceInventoryTracker(headers);

  function* generate(): Generator<RsEvaluation> {
    let rowNumber = 1;
    for (const row of rows) {
      rowNumber++;
      tracker.record(row);
      const textFields: Record<string, string> = {};
      for (const [src, dst] of Object.entries(FIELDS)) {
        textFields[dst] = (row[src] ?? '').trim();
      }
      yield {
        ...rsBase(row, year),
        ...textFields,
        recordType: 'rs_evaluation' as const,
        recordId: rsRecordId(rawRoot, zipPath, entry, rowNumber, 'rseval_'),
        reflectionGeneralYen: parseNumber(row['反映額（一般会計）']),
        reflectionSpecialYen: parseNumber(row['反映額（特別会計）－反映額']),
        extraFields: extraFields(row, MAPPED),
        source: rsSourceRef(rawRoot, zipPath, entry, rowNumber, '点検・評価', year),
      } as RsEvaluation;
    }
  }

  return {
    rows: generate(),
    sourceInventory: () => tracker.finish(rawRoot, zipPath, entry, MAPPED, '4-1', '点検・評価', year),
  };
}
