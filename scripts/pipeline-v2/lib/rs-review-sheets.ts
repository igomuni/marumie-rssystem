/**
 * RSレビューシート（sheets/{year}/{府省庁}/*.csv）の正規化。
 * Python参照実装のnormalize_review_sheetsと同じ。download-csv ZIPとは異なり、
 * 個別CSVファイルを府省庁ディレクトリ配下から再帰的に列挙して読む。
 * 様式1（前年度事業・新規開始事業）・様式2（新規要求事業）のみを対象とし、
 * 様式3・様式4は仕様対象外としてignoredFilesに記録する。
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseCsv } from './csv';
import { stableId } from './stable-id';
import { canonicalProjectId, parseIntValue, yenFromThousand } from './parse';
import type { RsReviewSheetRecord, RsReviewSheetFileInfo, RsReviewSheetManifest, SourceRef } from '../types';

function clean(v: string | undefined): string {
  return (v ?? '').trim();
}

function sheetForm(fileName: string): 'form1' | 'form2' | null {
  const n = fileName.normalize('NFKC');
  if (n.includes('(様式1)')) return 'form1';
  if (n.includes('(様式2)')) return 'form2';
  return null;
}

/** ファイル名は"{府省庁}_{year}年度_..."形式。年度トークンより前を府省庁名として取り出す */
function sheetMinistry(fileName: string, year: number): string {
  const token = `_${year}年度_`;
  const idx = fileName.indexOf(token);
  return idx >= 0 ? clean(fileName.slice(0, idx)) : '';
}

function findCsvFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) out.push(...findCsvFilesRecursive(p));
    else if (name.toLowerCase().endsWith('.csv')) out.push(p);
  }
  return out;
}

function sourceRef(rawRoot: string, filePath: string, rowNumber: number, form: string, year: number): SourceRef {
  return {
    domain: 'rssystem.go.jp',
    path: path.relative(rawRoot, filePath).split(path.sep).join('/'),
    file: path.basename(filePath),
    dataset: `sheets-${form}`,
    year,
    rowNumber,
  };
}

export function normalizeReviewSheets(rawRoot: string, year: number): { rows: RsReviewSheetRecord[]; manifest: RsReviewSheetManifest } {
  const baseDir = path.join(rawRoot, 'rssystem.go.jp', 'sheets', String(year));
  if (!fs.existsSync(baseDir)) {
    return { rows: [], manifest: { sourceYear: year, available: false, files: [], ignoredFiles: [], rowCount: 0 } };
  }

  const out: RsReviewSheetRecord[] = [];
  const files: RsReviewSheetFileInfo[] = [];
  const ignoredFiles: { path: string; reason: string }[] = [];
  const formCounts: Record<string, number> = {};
  let officialProjectUrlCount = 0;

  for (const filePath of findCsvFilesRecursive(baseDir).sort()) {
    const fileName = path.basename(filePath);
    const form = sheetForm(fileName);
    if (!form) {
      ignoredFiles.push({ path: path.relative(rawRoot, filePath).split(path.sep).join('/'), reason: 'outside current normalized sheets scope (only form1/form2 are specified)' });
      continue;
    }
    const rows = parseCsv(fs.readFileSync(filePath, 'utf-8'));
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    files.push({ path: path.relative(rawRoot, filePath).split(path.sep).join('/'), form, rowCount: rows.length, headers });
    const ministry = sheetMinistry(fileName, year);

    rows.forEach((row, i) => {
      const rowNumber = i + 2;
      const rawId = clean(row['予算事業ID']);
      const pid = canonicalProjectId(rawId);
      const src = sourceRef(rawRoot, filePath, rowNumber, form, year);
      const officialProjectUrl = clean(row['事業URL']);
      if (officialProjectUrl) officialProjectUrlCount++;

      const consumed = new Set([
        '政策', '施策', '予算事業ID', '事業名', '事業所管課室', '会計区分', '事業URL', '行政事業レビュー推進チームの所見',
      ]);

      let rec: RsReviewSheetRecord;
      if (form === 'form1') {
        const prior = year - 1;
        const next = year + 1;
        consumed.add('事業開始年度');
        consumed.add('事業終了（予定）年度');
        consumed.add(`${prior}年度予算額計`);
        consumed.add(`${prior}年度執行額`);
        consumed.add(`${year}年度当初予算額`);
        consumed.add(`${next}年度要求額`);
        consumed.add('差引き（要求-当初）');
        consumed.add('外部有識者の所見');
        consumed.add('反映額');
        consumed.add('改善点・反映状況');
        consumed.add(`${year}年度外部有識者点検対象`);
        consumed.add(`${year}年度外部有識者点検対象とした理由`);
        consumed.add('直近の外部有識者点検実施年度');
        rec = {
          schemaVersion: 2,
          recordType: 'rs_review_sheet',
          recordId: stableId([path.relative(rawRoot, filePath).split(path.sep).join('/'), rowNumber], 'rssheet_'),
          sheetForm: 'form1',
          sourceYear: year,
          reviewYear: year,
          projectId: pid,
          projectIdRaw: rawId,
          projectName: clean(row['事業名']),
          ministryFromFile: ministry,
          policy: clean(row['政策']),
          measure: clean(row['施策']),
          responsibleOffice: clean(row['事業所管課室']),
          accountClass: clean(row['会計区分']),
          officialProjectUrl,
          reviewTeamFinding: clean(row['行政事業レビュー推進チームの所見']),
          projectCategory: 'existing_or_new_start',
          startYear: parseIntValue(row['事業開始年度'], { noneIfBlank: true }),
          startYearRaw: clean(row['事業開始年度']),
          endYear: parseIntValue(row['事業終了（予定）年度'], { noneIfBlank: true }),
          endYearRaw: clean(row['事業終了（予定）年度']),
          priorBudgetFiscalYear: prior,
          priorBudgetYen: yenFromThousand(row[`${prior}年度予算額計`], { noneIfBlank: true }),
          priorExecutionYen: yenFromThousand(row[`${prior}年度執行額`], { noneIfBlank: true }),
          currentInitialFiscalYear: year,
          currentInitialYen: yenFromThousand(row[`${year}年度当初予算額`], { noneIfBlank: true }),
          nextRequestFiscalYear: next,
          nextRequestYen: yenFromThousand(row[`${next}年度要求額`], { noneIfBlank: true }),
          requestDifferenceYen: yenFromThousand(row['差引き（要求-当初）'], { noneIfBlank: true }),
          externalExpertFinding: clean(row['外部有識者の所見']),
          reflectionAmountYen: yenFromThousand(row['反映額'], { noneIfBlank: true }),
          improvementReflection: clean(row['改善点・反映状況']),
          externalReviewTarget: clean(row[`${year}年度外部有識者点検対象`]),
          externalReviewReason: clean(row[`${year}年度外部有識者点検対象とした理由`]),
          latestExternalReviewYearRaw: clean(row['直近の外部有識者点検実施年度']),
          extraFields: {},
          source: src,
        };
      } else {
        const next = year + 1;
        consumed.add(`${next}年度要求額`);
        rec = {
          schemaVersion: 2,
          recordType: 'rs_review_sheet',
          recordId: stableId([path.relative(rawRoot, filePath).split(path.sep).join('/'), rowNumber], 'rssheet_'),
          sheetForm: 'form2',
          sourceYear: year,
          reviewYear: year,
          projectId: pid,
          projectIdRaw: rawId,
          projectName: clean(row['事業名']),
          ministryFromFile: ministry,
          policy: clean(row['政策']),
          measure: clean(row['施策']),
          responsibleOffice: clean(row['事業所管課室']),
          accountClass: clean(row['会計区分']),
          officialProjectUrl,
          reviewTeamFinding: clean(row['行政事業レビュー推進チームの所見']),
          projectCategory: 'new_request',
          nextRequestFiscalYear: next,
          nextRequestYen: yenFromThousand(row[`${next}年度要求額`], { noneIfBlank: true }),
          extraFields: {},
          source: src,
        };
      }

      const extra: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        if (consumed.has(k)) continue;
        const cleaned = clean(v);
        if (cleaned) extra[k] = cleaned;
      }
      rec.extraFields = extra;
      out.push(rec);
      formCounts[form] = (formCounts[form] ?? 0) + 1;
    });
  }

  return {
    rows: out,
    manifest: { sourceYear: year, available: true, files, ignoredFiles, rowCount: out.length, formCounts, officialProjectUrlCount },
  };
}
