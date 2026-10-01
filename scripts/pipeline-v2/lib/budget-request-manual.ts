/**
 * manual-required target（WAF等で自動取得できないPDF）の人手取得の準備。
 *
 * manifestをsource of truthとして、保存先directoryの作成と、人間向けの取得指示書
 * `_MANUAL_DOWNLOAD.md`（directoryごと）の生成を行う。networkへは出ない・PDFは作らない・
 * 既存ファイルは削除も上書きもしない。指示書が存在してもdownloaderは期待PDFのexact pathだけを
 * 見るため、cache判定には影響しない。
 */
import * as path from 'path';
import {
  checkCache,
  DEFAULT_BASE_DIR,
  localPathFor,
  type BudgetRequestDownloadTarget,
  type BudgetRequestFs,
} from './budget-request-download';

export const MANUAL_INSTRUCTIONS_FILE = '_MANUAL_DOWNLOAD.md';

export type ManualFileState = 'MISSING' | 'VALID PDF' | 'INVALID FILE';

export interface ManualEntry {
  target: BudgetRequestDownloadTarget;
  localPath: string;
  state: ManualFileState;
  /** 用途（account / subAccounts / relatedAuthority から生成） */
  purpose: string;
}

export interface ManualPreparation {
  entries: ManualEntry[];
  /** 作成（既存でも作成保証）したdirectory */
  directories: string[];
  /** 生成した指示書のpath */
  instructionFiles: string[];
}

export function selectManualTargets(targets: BudgetRequestDownloadTarget[]): BudgetRequestDownloadTarget[] {
  return targets.filter(t => t.acquisitionPolicy === 'manual-required');
}

export function manualPurpose(t: BudgetRequestDownloadTarget): string {
  if (t.kind === 'reference') return t.title ?? t.purpose ?? '';
  return [t.account, ...(t.subAccounts ?? []), ...(t.relatedAuthority ? [t.relatedAuthority] : [])].filter(Boolean).join('・');
}

export function manualState(localPath: string, bfs: BudgetRequestFs): ManualFileState {
  const c = checkCache(localPath, bfs);
  return c.state === 'none' ? 'MISSING' : c.state === 'valid' ? 'VALID PDF' : 'INVALID FILE';
}

/** manual-required targetの現在の配置状態を調べる（書き込みなし）。local path不正なら例外 */
export function planManual(
  targets: BudgetRequestDownloadTarget[],
  bfs: BudgetRequestFs,
  baseDir: string = DEFAULT_BASE_DIR,
): ManualEntry[] {
  return selectManualTargets(targets).map(target => {
    const localPath = localPathFor(target.canonicalUrl, target.publisherDomain, baseDir);
    return { target, localPath, state: manualState(localPath, bfs), purpose: manualPurpose(target) };
  });
}

/** 1 directory分の指示書（Markdown）。entriesは同じparent directoryのもの */
export function renderManualInstructions(fiscalYear: number, entries: ManualEntry[]): string {
  const dir = path.dirname(entries[0].localPath);
  const domains = [...new Set(entries.map(e => e.target.publisherDomain))];
  const rows = entries.map(e => `| ${e.state} | ${e.purpose} | ${e.target.canonicalUrl} | \`${e.localPath}\` |`);
  const n = entries.length;
  return [
    `# FY${fiscalYear} 概算要求 — 人手取得が必要なPDF`,
    '',
    'このファイルは downloader の manifest から生成されています（`--prepare-manual`）。手で編集しても次回の生成で上書きされます。',
    '',
    '## 手順',
    '',
    '1. 下記URLを通常のWebブラウザで開く',
    '2. Human Verification等が表示された場合は人間が通常の操作で確認する',
    '3. PDFをダウンロードする',
    '4. 指定されたファイル名のまま、このフォルダへ配置する',
    '5. 全件配置後、検証コマンドを実行する',
    '',
    '## 注意',
    '',
    '- CAPTCHA/Human Verificationの自動突破は行わない',
    '- HTMLページをPDFとして保存しない',
    `- 指定された${n}ファイル以外を上書きしない`,
    '',
    `## 対象（${n}件）`,
    '',
    `フォルダ: \`${dir}\``,
    '',
    '状態: `MISSING`=ファイルなし（人手取得が必要） / `VALID PDF`=正しいPDFあり（再取得不要） / `INVALID FILE`=ファイルはあるが size=0 または `%PDF-` ではない（置き直してください）',
    '',
    '| 状態 | 用途 | 取得URL | 保存先 |',
    '|---|---|---|---|',
    ...rows,
    '',
    '途中まで取得した場合も、`--prepare-manual` を再実行すれば状態列が更新されます。',
    '',
    '## 検証',
    '',
    '```bash',
    `npm run pipeline:v2:download:budget-requests -- ${fiscalYear} --only=${domains.join(',')}`,
    '```',
    '',
    `${n}件すべて正しく配置されていれば \`cached: ${n}\` / \`manual-required: 0\` / \`failed: 0\` になります。その後、全体確認:`,
    '',
    '```bash',
    `npm run pipeline:v2:download:budget-requests -- ${fiscalYear}`,
    '```',
    '',
    '',
  ].join('\n');
}

/**
 * manual-required targetの保存先directoryを作り、directoryごとに指示書を書く。
 * PDFは作らない・既存ファイルは変更しない。mkdir/書き込み失敗は例外。
 */
export function prepareManual(
  fiscalYear: number,
  targets: BudgetRequestDownloadTarget[],
  bfs: BudgetRequestFs,
  baseDir: string = DEFAULT_BASE_DIR,
): ManualPreparation {
  const entries = planManual(targets, bfs, baseDir);
  const byDir = new Map<string, ManualEntry[]>();
  for (const e of entries) {
    const dir = path.dirname(e.localPath);
    byDir.set(dir, [...(byDir.get(dir) ?? []), e]);
  }
  const instructionFiles: string[] = [];
  for (const [dir, group] of byDir) {
    bfs.mkdirp(dir);
    const file = path.join(dir, MANUAL_INSTRUCTIONS_FILE);
    bfs.writeAtomic(file, Buffer.from(renderManualInstructions(fiscalYear, group), 'utf8'));
    instructionFiles.push(file);
  }
  return { entries, directories: [...byDir.keys()], instructionFiles };
}
