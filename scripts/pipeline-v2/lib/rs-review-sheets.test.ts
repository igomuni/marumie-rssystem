import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { normalizeReviewSheets } from './rs-review-sheets';

let tmpDir: string | null = null;

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = null;
});

function writeSheetFile(year: number, ministry: string, formLabel: string, csvContent: string): void {
  const dir = path.join(tmpDir!, 'rssystem.go.jp', 'sheets', String(year), 'test-ministry');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${ministry}_${year}年度_${formLabel}テスト.csv`), csvContent, 'utf-8');
}

describe('normalizeReviewSheets', () => {
  it('sheetsディレクトリが無い年度はavailable=falseで空を返す', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-sheets-test-'));
    const { rows, manifest } = normalizeReviewSheets(tmpDir, 2024);
    expect(rows).toHaveLength(0);
    expect(manifest.available).toBe(false);
  });

  it('様式1のCSVを正しく正規化し、千円→円変換とpriorBudgetFiscalYearを計算する', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-sheets-test-'));
    const csv = [
      '"政策","施策","予算事業ID","事業名","事業所管課室","事業開始年度","事業終了（予定）年度","会計区分","2023年度予算額計","2023年度執行額","2024年度当初予算額","2025年度要求額","差引き（要求-当初）","外部有識者の所見","行政事業レビュー推進チームの所見","反映額","改善点・反映状況","2024年度外部有識者点検対象","2024年度外部有識者点検対象とした理由","直近の外部有識者点検実施年度"',
      '"政策A","施策B","007","テスト事業","戦略室","2021","","一般会計","1000","500","300","400","100","所見","","0","","","",""',
    ].join('\n');
    writeSheetFile(2024, 'テスト省', '(様式1)', csv);
    const { rows, manifest } = normalizeReviewSheets(tmpDir, 2024);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.sheetForm).toBe('form1');
    expect(row.projectId).toBe('7');
    expect(row.ministryFromFile).toBe('テスト省');
    if (row.sheetForm === 'form1') {
      expect(row.priorBudgetFiscalYear).toBe(2023);
      expect(row.priorBudgetYen).toBe(1000000);
      expect(row.currentInitialYen).toBe(300000);
      expect(row.nextRequestFiscalYear).toBe(2025);
    }
    expect(manifest.available).toBe(true);
    expect(manifest.formCounts?.form1).toBe(1);
  });

  it('様式1・様式2以外のファイルはignoredFilesに記録し正規化対象から除外する', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-sheets-test-'));
    writeSheetFile(2024, 'テスト省', '(様式3)', '"事業名"\n"X"');
    const { rows, manifest } = normalizeReviewSheets(tmpDir, 2024);
    expect(rows).toHaveLength(0);
    expect(manifest.ignoredFiles).toHaveLength(1);
  });
});
