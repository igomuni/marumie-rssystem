/**
 * project-quality-scores-{YEAR}.json の読み込み・集計・メモリキャッシュ。
 * /api/quality-scores（全件・pids絞り込み）、/api/quality-scores/[pid]、/api/search/projects が共用する。
 * 型・読み込みロジックの正典はこのファイル（route.ts 側に重複定義を置かないこと）。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

export interface QualityScoreItem {
  pid: string;
  name: string;
  ministry: string;
  bureau: string;
  division: string;
  section: string;
  office: string;
  team: string;
  unit: string;
  rowCount: number;
  recipientCount?: number;
  validCount: number;
  govAgencyCount: number;
  suppValidCount: number;
  invalidCount: number;
  validRatio: number | null;
  cnFilled: number;
  cnEmpty: number;
  cnFillRatio: number | null;
  budgetAmount: number;
  execAmount: number;
  spendTotal: number;
  spendNetTotal: number;
  gapRatio: number | null;
  blockCount: number;
  orphanBlockCount: number;
  hasRedelegation: boolean;
  redelegationDepth: number;
  opaqueRatio: number | null;
  axis1: number | null;
  axis2: number | null;
  axis3: number | null;
  axis4: number | null;
  axis5: number | null;
  // 新軸（score-project-quality-ai.py が付与）
  axisIdentify?: number | null;    // A 支出先の特定可能性 (AI判定 28%)
  axisPurpose?: number | null;     // B 使途の説明性 (AI判定 22%)
  axisBudget?: number | null;      // C 収支の整合性 (機械計算 15%)
  axisStructure?: number | null;   // D 構造の整合性 (機械計算・参考表示のみ/総合に不算入)
  axisEffective?: number | null;   // E 有効性/成果設計の明確さ (AI判定 35%・0-10の11段階・意図ベース)
  identifyLevelAvg?: number | null; // 0-3 平均（金額加重）
  purposeLevelAvg?: number | null;  // 0-3 平均（金額加重）
  effectiveLevel?: number | null;  // 0-10 有効性レベル
  effectiveReason?: string;        // 有効性判定の根拠（AI時）
  aiSource?: string;               // "openrouter:<model>" | "heuristic"
  totalScore: number | null;
}

export interface QualityScoresResponse {
  items: QualityScoreItem[];
  summary: {
    total: number;
    avgScore: number;
    medianScore: number;
    stddevScore: number;
    modeScore: number;
    ministries: string[];
  };
}

/**
 * pid単体API・pids絞り込みで返す軽量プロジェクション（サイドパネル表示用の最小セット）。
 * 全44フィールドは返さない（ペイロード削減）。
 */
export interface QualityScoreProjection {
  pid: string;
  name: string;
  ministry: string;
  totalScore: number | null;
  axisIdentify: number | null;
  axisPurpose: number | null;
  axisBudget: number | null;
  axisStructure: number | null;
  axisEffective: number | null;
  identifyLevelAvg: number | null;
  purposeLevelAvg: number | null;
  effectiveLevel: number | null;
  effectiveReason: string | null;
  aiSource: string | null;
}

export function toQualityScoreProjection(i: QualityScoreItem): QualityScoreProjection {
  return {
    pid: i.pid,
    name: i.name,
    ministry: i.ministry,
    totalScore: i.totalScore,
    axisIdentify: i.axisIdentify ?? null,
    axisPurpose: i.axisPurpose ?? null,
    axisBudget: i.axisBudget ?? null,
    axisStructure: i.axisStructure ?? null,
    axisEffective: i.axisEffective ?? null,
    identifyLevelAvg: i.identifyLevelAvg ?? null,
    purposeLevelAvg: i.purposeLevelAvg ?? null,
    effectiveLevel: i.effectiveLevel ?? null,
    effectiveReason: i.effectiveReason ?? null,
    aiSource: i.aiSource ?? null,
  };
}

const cache = new Map<string, QualityScoresResponse>();
const pidIndexCache = new Map<string, Map<string, QualityScoreItem>>();

export function loadQualityScores(year: string): QualityScoresResponse {
  if (cache.has(year)) return cache.get(year)!;

  // 展開済み .json を優先。無ければ .gz をその場で展開（prebuild未実行のローカル等でも動く）。
  const base = path.join(process.cwd(), 'public', 'data', `project-quality-scores-${year}.json`);
  let raw: string;
  if (fs.existsSync(base)) {
    raw = fs.readFileSync(base, 'utf-8');
  } else if (fs.existsSync(`${base}.gz`)) {
    raw = zlib.gunzipSync(fs.readFileSync(`${base}.gz`)).toString('utf-8');
  } else {
    throw new Error(
      `project-quality-scores-${year}.json(.gz) が見つかりません。` +
      `python3 scripts/score-project-quality-ai.py --year ${year} を実行してください。`
    );
  }

  const items: QualityScoreItem[] = JSON.parse(raw);

  const ministries = [...new Set(items.map(i => i.ministry))].sort();
  const scored = items.filter(i => i.totalScore !== null);
  const scores = scored.map(i => i.totalScore as number).sort((a, b) => a - b);
  const avgScore = scores.length > 0
    ? scores.reduce((sum, s) => sum + s, 0) / scores.length
    : 0;

  // 中央値
  let medianScore = 0;
  if (scores.length > 0) {
    const mid = Math.floor(scores.length / 2);
    medianScore = scores.length % 2 === 0
      ? (scores[mid - 1] + scores[mid]) / 2
      : scores[mid];
  }

  // 標準偏差
  let stddevScore = 0;
  if (scores.length > 0) {
    const variance = scores.reduce((sum, s) => sum + (s - avgScore) ** 2, 0) / scores.length;
    stddevScore = Math.sqrt(variance);
  }

  // 最頻値（1点刻みでビン化）
  let modeScore = 0;
  if (scores.length > 0) {
    const bins = new Map<number, number>();
    for (const s of scores) {
      const bin = Math.round(s);
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
    }
    let maxCount = 0;
    for (const [bin, count] of bins) {
      if (count > maxCount) {
        maxCount = count;
        modeScore = bin;
      }
    }
  }

  const result: QualityScoresResponse = {
    items,
    summary: { total: items.length, avgScore, medianScore, stddevScore, modeScore, ministries },
  };
  cache.set(year, result);
  return result;
}

/** pid → item の O(1) 取得（全件キャッシュと索引を共有。見つからなければ undefined） */
export function getQualityScore(year: string, pid: string): QualityScoreItem | undefined {
  let index = pidIndexCache.get(year);
  if (!index) {
    index = new Map(loadQualityScores(year).items.map(i => [i.pid, i]));
    pidIndexCache.set(year, index);
  }
  return index.get(pid);
}
