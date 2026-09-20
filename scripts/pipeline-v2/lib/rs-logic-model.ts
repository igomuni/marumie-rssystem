/**
 * RS 3-1（効果発現経路_目標・実績）・3-2（効果発現経路_目標のつながり）の正規化。
 * Python参照実装 normalize_logic_model/normalize_logic_relationsと同じ。
 *
 * 3-1は「アクティビティ・アウトプット・アウトカムの番号＋種別」が同一のnode（logicNodeId）に
 * 複数の年度別実績列（20xx形式の列）を持つ行が複数回現れるため、Map集約でnode（1件）と
 * observation（年度×1件）に分離する（5-1のblock集約と同じ考え方）。3-2は1行1辺の
 * 単純な変換のためstreaming generatorのまま。
 */
import { rsBase, rsSourceRef, rsRecordId, extraFields, sourceInventory, SourceInventoryTracker, COMMON_COLUMNS } from './rs-common';
import { normalizeText, stableId } from './stable-id';
import { parseNumber } from './parse';
import type { RsLogicNode, RsLogicObservation, RsLogicRelation, SourceInventory } from '../types';

function logicValueType(raw: string): RsLogicObservation['valueType'] {
  const s = normalizeText(raw);
  if (s.includes('目標年度')) return 'target_year';
  if (s.includes('目標値')) return 'target';
  if (s.includes('実績値')) return 'actual';
  if (s.includes('達成率')) return 'achievement_rate';
  return 'other';
}

const LOGIC_MODEL_MAPPED_BASE = new Set([
  ...COMMON_COLUMNS,
  '事業に関連するKPIが定められている閣議決定等の名称', '事業に関連するKPIが定められている閣議決定等の該当箇所', '事業に関連するKPIが定められている閣議決定等のURL',
  'アクティビティ・アウトプット・アウトカムの番号', '種別（アクティビティ・アウトプット・アウトカム）', 'アウトカムの期間', '成果目標の種類', 'アクティビティ／活動目標／成果目標', '活動指標／成果指標', '単位', '改善の上向き／下向き', '成果実績及び目標値の根拠として用いた統計・データ名（出典）', '定性的なアウトカム目標を設定している理由', '定性的なアウトカムに関する成果実績', '目標年度／目標値／実績値／達成率',
]);

/** 年度別実績列（"2024"のような4桁の西暦のみの列名）を検出する */
function isYearColumn(header: string): boolean {
  return /^20\d{2}$/.test(header);
}

export function normalizeLogicModel(
  rawRoot: string, zipPath: string, entry: string, rows: Record<string, string>[], year: number
): { nodes: RsLogicNode[]; observations: RsLogicObservation[]; sourceInventory: SourceInventory } {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const yearColumns = headers.filter(isYearColumn);
  const mapped = new Set([...LOGIC_MODEL_MAPPED_BASE, ...yearColumns]);

  const nodeBuild = new Map<string, RsLogicNode>();
  const observations: RsLogicObservation[] = [];

  rows.forEach((row, i) => {
    const rowNumber = i + 2;
    const base = rsBase(row, year);
    const num = (row['アクティビティ・アウトプット・アウトカムの番号'] ?? '').trim();
    const kind = (row['種別（アクティビティ・アウトプット・アウトカム）'] ?? '').trim();
    // 番号は事業内でsource-definedなため、3-2からの参照にも使える安定したnode識別子になる
    const nodeId = stableId([year, base.projectId, num, kind], 'rslogic_');
    const source = rsSourceRef(rawRoot, zipPath, entry, rowNumber, '効果発現経路_目標・実績', year);
    const evidenceId = rsRecordId(rawRoot, zipPath, entry, rowNumber, 'rslogicrow_');
    const key = `${base.projectId}\x1f${nodeId}`;

    if (!nodeBuild.has(key)) {
      nodeBuild.set(key, {
        ...base,
        recordType: 'rs_logic_node',
        logicNodeId: nodeId,
        nodeNumber: num,
        nodeTypeRaw: kind,
        outcomePeriod: (row['アウトカムの期間'] ?? '').trim(),
        goalType: (row['成果目標の種類'] ?? '').trim(),
        goal: (row['アクティビティ／活動目標／成果目標'] ?? '').trim(),
        indicator: (row['活動指標／成果指標'] ?? '').trim(),
        unit: (row['単位'] ?? '').trim(),
        direction: (row['改善の上向き／下向き'] ?? '').trim(),
        statisticsSource: (row['成果実績及び目標値の根拠として用いた統計・データ名（出典）'] ?? '').trim(),
        qualitativeReason: (row['定性的なアウトカム目標を設定している理由'] ?? '').trim(),
        qualitativeResult: (row['定性的なアウトカムに関する成果実績'] ?? '').trim(),
        kpiDecisionName: (row['事業に関連するKPIが定められている閣議決定等の名称'] ?? '').trim(),
        kpiDecisionSection: (row['事業に関連するKPIが定められている閣議決定等の該当箇所'] ?? '').trim(),
        kpiDecisionUrl: (row['事業に関連するKPIが定められている閣議決定等のURL'] ?? '').trim(),
        evidenceRowIds: [],
        sources: [],
        extraFields: {},
      });
    }
    const node = nodeBuild.get(key)!;
    node.evidenceRowIds.push(evidenceId);
    node.sources.push(source);
    // 将来列が追加されても情報が消えないよう保持する。複数行で値が競合する場合は配列化する
    for (const [k, v] of Object.entries(extraFields(row, mapped))) {
      const old = node.extraFields[k];
      if (old === undefined) {
        node.extraFields[k] = v;
      } else if (old !== v) {
        const vals = Array.isArray(old) ? old : [old];
        if (!vals.includes(v)) vals.push(v);
        node.extraFields[k] = vals;
      }
    }

    const valueTypeRaw = (row['目標年度／目標値／実績値／達成率'] ?? '').trim();
    const valueType = logicValueType(valueTypeRaw);
    for (const yc of [...yearColumns].sort()) {
      const raw = (row[yc] ?? '').trim();
      if (!raw) continue;
      observations.push({
        schemaVersion: 2,
        recordType: 'rs_logic_observation',
        observationId: stableId([evidenceId, yc], 'rsobs_'),
        sourceYear: year,
        reviewYear: year,
        projectId: base.projectId,
        projectIdRaw: base.projectIdRaw,
        logicNodeId: nodeId,
        fiscalYear: Number(yc),
        valueType,
        valueTypeRaw,
        valueRaw: raw,
        valueNumber: parseNumber(raw),
        unit: node.unit ?? '',
        sourceRowId: evidenceId,
        source,
      });
    }
  });

  return {
    nodes: [...nodeBuild.values()],
    observations,
    sourceInventory: sourceInventory(rawRoot, zipPath, entry, headers, rows, mapped, '3-1', '効果発現経路_目標・実績', year),
  };
}

const RELATIONS_MAPPED = new Set([
  ...COMMON_COLUMNS,
  '派生元ーアクティビティ・アウトプット・アウトカムの番号', '派生元ー種別（アクティビティ・アウトプット・アウトカム）', '派生元ーアウトカムの期間', '派生元ーアクティビティの内容/ 活動目標／成果目標', '派生元ー活動指標／成果指標',
  '派生先ーアクティビティ・アウトプット・アウトカムの番号', '派生先ー種別（アクティビティ・アウトプット・アウトカム）', '派生先ーアウトカムの期間', '派生先ー 活動目標／成果目標', '派生先ー活動指標／成果指標', '後続アウトカムへのつながり', 'アウトカムを複数段階で設定できない理由',
]);

export function normalizeLogicRelations(
  rawRoot: string, zipPath: string, entry: string, rows: Iterable<Record<string, string>>, year: number, headers: string[]
): { rows: Generator<RsLogicRelation>; sourceInventory: () => SourceInventory } {
  const tracker = new SourceInventoryTracker(headers);

  function* generate(): Generator<RsLogicRelation> {
    let rowNumber = 1;
    for (const row of rows) {
      rowNumber++;
      tracker.record(row);
      const base = rsBase(row, year);
      const sn = (row['派生元ーアクティビティ・アウトプット・アウトカムの番号'] ?? '').trim();
      const sk = (row['派生元ー種別（アクティビティ・アウトプット・アウトカム）'] ?? '').trim();
      const tn = (row['派生先ーアクティビティ・アウトプット・アウトカムの番号'] ?? '').trim();
      const tk = (row['派生先ー種別（アクティビティ・アウトプット・アウトカム）'] ?? '').trim();
      yield {
        ...base,
        recordType: 'rs_logic_relation' as const,
        relationId: rsRecordId(rawRoot, zipPath, entry, rowNumber, 'rslogicrel_'),
        sourceNodeNumber: sn,
        sourceNodeTypeRaw: sk,
        sourceLogicNodeId: sn ? stableId([year, base.projectId, sn, sk], 'rslogic_') : '',
        sourceOutcomePeriod: (row['派生元ーアウトカムの期間'] ?? '').trim(),
        sourceGoal: (row['派生元ーアクティビティの内容/ 活動目標／成果目標'] ?? '').trim(),
        sourceIndicator: (row['派生元ー活動指標／成果指標'] ?? '').trim(),
        targetNodeNumber: tn,
        targetNodeTypeRaw: tk,
        targetLogicNodeId: tn ? stableId([year, base.projectId, tn, tk], 'rslogic_') : '',
        targetOutcomePeriod: (row['派生先ーアウトカムの期間'] ?? '').trim(),
        targetGoal: (row['派生先ー 活動目標／成果目標'] ?? '').trim(),
        targetIndicator: (row['派生先ー活動指標／成果指標'] ?? '').trim(),
        connectionToLaterOutcome: (row['後続アウトカムへのつながり'] ?? '').trim(),
        reasonNoMultipleOutcomeStages: (row['アウトカムを複数段階で設定できない理由'] ?? '').trim(),
        hasRelation: Boolean(sn && tn),
        extraFields: extraFields(row, RELATIONS_MAPPED),
        source: rsSourceRef(rawRoot, zipPath, entry, rowNumber, '効果発現経路_目標のつながり', year),
      };
    }
  }

  return {
    rows: generate(),
    sourceInventory: () => tracker.finish(rawRoot, zipPath, entry, RELATIONS_MAPPED, '3-2', '効果発現経路_目標のつながり', year),
  };
}
