/**
 * 概算要求PDF Extraction工程の基盤（入力の解決と検査だけ。PDF本文の解析はしない）。
 *
 * manifest → document target → localPath → data/download/...pdf という関係は、Downloaderと同じ
 * manifest（getBudgetRequestManifest）と同じpath解決（localPathFor）をそのまま使う。
 * 原本PDFは読み取りのみで、変更・移動・再保存しない。解析途中の再生成可能な生成物は
 * data/work/budget-request-extraction/ に置く（data/download=原本 / data/work=解析途中 /
 * data/derived=意味確定データ / public/data=アプリ配信用）。
 */
import * as path from 'path';
import {
  checkCache,
  DEFAULT_BASE_DIR,
  expandTargets,
  localPathFor,
  type BudgetRequestFs,
} from './budget-request-download';
import type { BudgetRequestManifest } from './budget-request-manifest';

export const EXTRACTION_WORK_DIR = path.join('data', 'work', 'budget-request-extraction');

export interface ExtractionTarget {
  fiscalYear: number;
  publisherAuthority: string;
  publisherDomain: string;
  canonicalUrl: string;
  /** data/download/{publisherDomain}/{canonical URL path}（Downloaderと同じ規則） */
  localPath: string;
  accountType: 'general' | 'special';
  account: string;
  logicalAuthority?: string;
  role?: string;
}

/** FOUND=存在しPDFとして最低限妥当（size>0 かつ先頭 %PDF-） / MISSING=存在しない / INVALID=存在するがPDFでない */
export type SourceState = 'FOUND' | 'MISSING' | 'INVALID';

export interface InspectedTarget extends ExtractionTarget {
  state: SourceState;
  bytes?: number;
}

/**
 * 概算要求書（document）のtargetだけを列挙する。検算用のreferenceFiles（validation）は
 * 明細の抽出対象ではないため含めない。
 */
export function listExtractionTargets(manifest: BudgetRequestManifest, baseDir: string = DEFAULT_BASE_DIR): ExtractionTarget[] {
  return expandTargets(manifest)
    .filter(t => t.kind === 'document')
    .map(t => ({
      fiscalYear: t.fiscalYear,
      publisherAuthority: t.publisherAuthority,
      publisherDomain: t.publisherDomain,
      canonicalUrl: t.canonicalUrl,
      localPath: localPathFor(t.canonicalUrl, t.publisherDomain, baseDir),
      accountType: t.accountType!,
      account: t.account!,
      logicalAuthority: t.logicalAuthority,
      role: t.role,
    }));
}

/** 原本の存在とPDFとしての最低限の妥当性を確認する（先頭bytesのみ読む。Downloaderのcache判定と同じ基準） */
export function inspectTarget(target: ExtractionTarget, bfs: BudgetRequestFs): InspectedTarget {
  const c = checkCache(target.localPath, bfs);
  if (c.state === 'valid') return { ...target, state: 'FOUND', bytes: c.bytes };
  return { ...target, state: c.state === 'none' ? 'MISSING' : 'INVALID' };
}

export function summarizeInspection(items: InspectedTarget[]): { total: number; found: number; missing: number; invalid: number } {
  const count = (s: SourceState) => items.filter(i => i.state === s).length;
  return { total: items.length, found: count('FOUND'), missing: count('MISSING'), invalid: count('INVALID') };
}

// ---- Golden Sample locator -------------------------------------------------------------

export interface GoldenSampleLocator {
  id: string;
  tier: 'normal' | 'moderate' | 'extreme' | 'structured-remark';
  /** manifestのcanonical URL。PDF原本はここから data/download/... を引く（PDFはfixtureへコピーしない） */
  canonicalUrl: string;
  /** PDFの物理ページ番号（1始まり） */
  pdfPage: number;
  /** 正解データは人間がPDF原本を確認して作成する。作成前は pending-human-review */
  groundTruthStatus: 'pending-human-review' | 'human-verified';
  /** サンプルを選定した理由・観点（任意）。正解データではない */
  selectionNote?: string;
}

export interface GoldenSampleFile {
  fiscalYear: number;
  samples: GoldenSampleLocator[];
}

export interface ResolvedGoldenSample {
  sample: GoldenSampleLocator;
  target: ExtractionTarget;
}

export const humanObservationsPath = (fiscalYear: number): string =>
  path.join('tests', 'fixtures', 'budget-request-extraction', String(fiscalYear), 'human-observations.json');

export const goldenSamplePath = (fiscalYear: number): string =>
  path.join('tests', 'fixtures', 'budget-request-extraction', String(fiscalYear), 'golden-samples.json');

/** locatorをmanifestのdocument targetへ解決する。不整合（未知のURL・不正なページ・id重複）は問題として返す */
export function resolveGoldenSamples(
  file: GoldenSampleFile,
  targets: ExtractionTarget[],
): { resolved: ResolvedGoldenSample[]; problems: string[] } {
  const problems: string[] = [];
  const resolved: ResolvedGoldenSample[] = [];
  const ids = new Set<string>();
  for (const sample of file.samples) {
    if (ids.has(sample.id)) problems.push(`Golden Sample idが重複: ${sample.id}`);
    ids.add(sample.id);
    if (!Number.isInteger(sample.pdfPage) || sample.pdfPage < 1) {
      problems.push(`${sample.id}: pdfPageは1以上の整数: ${sample.pdfPage}`);
    }
    const target = targets.find(t => t.canonicalUrl === sample.canonicalUrl);
    if (!target) {
      problems.push(`${sample.id}: manifestに無いcanonicalUrl: ${sample.canonicalUrl}`);
      continue;
    }
    resolved.push({ sample, target });
  }
  return { resolved, problems };
}

// ---- work領域 ----------------------------------------------------------------------------

export const inventoryPath = (fiscalYear: number, workDir: string = EXTRACTION_WORK_DIR): string =>
  path.join(workDir, String(fiscalYear), 'inventory.json');

/** 検査結果（再生成可能）をwork領域へ書く。data/download（原本）へは書かない */
export function writeInventory(
  fiscalYear: number,
  items: InspectedTarget[],
  bfs: BudgetRequestFs,
  workDir: string = EXTRACTION_WORK_DIR,
): string {
  const file = inventoryPath(fiscalYear, workDir);
  bfs.mkdirp(path.dirname(file));
  bfs.writeAtomic(file, Buffer.from(`${JSON.stringify({ fiscalYear, summary: summarizeInspection(items), targets: items }, null, 2)}\n`, 'utf8'));
  return file;
}
