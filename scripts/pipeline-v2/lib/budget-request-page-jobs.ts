/**
 * 「指定ページだけ」を処理するPoC CLI（SourceToken / TableGeometry）の共通部分:
 * Golden Sample id・--golden・(--document, --page) を、manifestのdocument targetとページ番号のjobへ解決する。
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  goldenSamplePath,
  humanObservationsPath,
  resolveGoldenSamples,
  type ExtractionTarget,
  type GoldenSampleFile,
} from './budget-request-extraction';
import type { HumanObservation } from './budget-request-source-token';

export interface PageJob {
  id: string;
  target: ExtractionTarget;
  page: number;
  sample?: { id: string; tier: string };
}

export interface PageJobArgs {
  sampleIds?: string[];
  golden: boolean;
  documentUrl?: string;
  page?: number;
}

/** 解決できなければ error（usageに出す文字列）を返す */
export function resolvePageJobs(year: number, targets: ExtractionTarget[], args: PageJobArgs): { jobs: PageJob[]; error?: string } {
  const jobs: PageJob[] = [];
  if (!args.sampleIds && !args.golden && !args.documentUrl) return { jobs, error: '--sample= / --golden / --document= のいずれかが必要です' };

  if (args.sampleIds || args.golden) {
    const gsPath = goldenSamplePath(year);
    if (!fs.existsSync(gsPath)) return { jobs, error: `Golden Sample fixtureがありません: ${gsPath}` };
    const { resolved, problems } = resolveGoldenSamples(JSON.parse(fs.readFileSync(gsPath, 'utf8')) as GoldenSampleFile, targets);
    if (problems.length > 0) return { jobs, error: `Golden Sample fixtureに問題があります:\n  ${problems.join('\n  ')}` };
    const picked = args.sampleIds ? args.sampleIds.map(id => resolved.find(r => r.sample.id === id) ?? null) : resolved;
    const missing = args.sampleIds?.filter((_, i) => picked[i] === null);
    if (missing?.length) return { jobs, error: `未知のGolden Sample id: ${missing.join(', ')}（有効: ${resolved.map(r => r.sample.id).join(', ')}）` };
    for (const r of picked) if (r) jobs.push({ id: r.sample.id, target: r.target, page: r.sample.pdfPage, sample: { id: r.sample.id, tier: r.sample.tier } });
  }
  if (args.documentUrl) {
    const target = targets.find(t => t.canonicalUrl === args.documentUrl);
    const page = args.page ?? NaN;
    if (!target) return { jobs, error: `manifestに無いcanonical URLです: ${args.documentUrl}` };
    if (!Number.isInteger(page) || page < 1) return { jobs, error: '--page= には1以上の整数が必要です' };
    jobs.push({ id: `${path.basename(target.localPath, '.pdf')}-p${page}`, target, page });
  }
  return { jobs };
}

/** 評価専用の人間確認値（Golden Sample id → 観測）。無ければ空 */
export function loadHumanObservations(year: number): Record<string, HumanObservation[]> {
  const p = humanObservationsPath(year);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as { observations: Record<string, HumanObservation[]> }).observations : {};
}
