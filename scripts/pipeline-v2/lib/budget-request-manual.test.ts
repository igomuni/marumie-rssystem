import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { expandTargets, type BudgetRequestFs } from './budget-request-download';
import { getBudgetRequestManifest } from './budget-request-manifest';
import {
  MANUAL_INSTRUCTIONS_FILE,
  manualPurpose,
  manualState,
  planManual,
  prepareManual,
  renderManualInstructions,
  selectManualTargets,
} from './budget-request-manual';

const PDF = Buffer.from('%PDF-1.4\nbody');
const BASE = 'data/download';
const METI_DIR = path.join(BASE, 'meti.go.jp', 'main', 'yosangaisan', 'fy2024', 'pdf');

function memFs(initial: Record<string, Buffer> = {}) {
  const files = new Map(Object.entries(initial));
  const dirs: string[] = [];
  const writes: string[] = [];
  const fs: BudgetRequestFs = {
    size: p => files.get(p)?.length,
    readHead: (p, n) => files.get(p)!.subarray(0, n),
    mkdirp: d => void dirs.push(d),
    writeAtomic: (p, data) => (writes.push(p), void files.set(p, data)),
  };
  return { fs, files, dirs, writes };
}

const targets = expandTargets(getBudgetRequestManifest(2024));

describe('selectManualTargets', () => {
  it('manual-requiredだけを抽出する（FY2024は経産省6件。autoは対象外）', () => {
    const manual = selectManualTargets(targets);
    expect(manual).toHaveLength(6);
    expect(manual.every(t => t.publisherDomain === 'meti.go.jp')).toBe(true);
    expect(targets.length).toBe(83);
  });
});

describe('planManual / manualState', () => {
  it('canonical URLから既存規則でlocal pathを作る', () => {
    const entries = planManual(targets, memFs().fs, BASE);
    expect(entries.map(e => e.localPath)).toEqual(
      ['ippan_o', 'eneju_o', 'eneden_o', 'enegen_o', 'tokkyo_o', 'fukko_o'].map(n => path.join(METI_DIR, `${n}.pdf`)),
    );
  });

  it('MISSING / VALID PDF / INVALID FILE を判定する', () => {
    const m = memFs({
      [path.join(METI_DIR, 'ippan_o.pdf')]: PDF,
      [path.join(METI_DIR, 'eneju_o.pdf')]: Buffer.from('<html>Human Verification</html>'),
      [path.join(METI_DIR, 'eneden_o.pdf')]: Buffer.alloc(0),
    });
    const state = Object.fromEntries(planManual(targets, m.fs, BASE).map(e => [path.basename(e.localPath), e.state]));
    expect(state).toEqual({
      'ippan_o.pdf': 'VALID PDF',
      'eneju_o.pdf': 'INVALID FILE',
      'eneden_o.pdf': 'INVALID FILE',
      'enegen_o.pdf': 'MISSING',
      'tokkyo_o.pdf': 'MISSING',
      'fukko_o.pdf': 'MISSING',
    });
    expect(manualState('x', memFs().fs)).toBe('MISSING');
  });

  it('用途はmanifestのaccount/subAccounts/relatedAuthorityから生成する', () => {
    const purposes = planManual(targets, memFs().fs, BASE).map(e => e.purpose);
    expect(purposes).toEqual([
      '一般会計',
      'エネルギー対策特別会計・エネルギー需給勘定',
      'エネルギー対策特別会計・電源開発促進勘定',
      'エネルギー対策特別会計・原子力損害賠償支援勘定',
      '特許特別会計',
      '東日本大震災復興特別会計・経済産業省',
    ]);
    expect(manualPurpose(targets.find(t => t.kind === 'reference')!)).toContain('財政投融資計画要求額');
  });
});

describe('renderManualInstructions', () => {
  const entries = planManual(targets, memFs({ [path.join(METI_DIR, 'ippan_o.pdf')]: PDF }).fs, BASE);
  const md = renderManualInstructions(2024, entries);

  it('URL・保存先・状態・用途が入る', () => {
    for (const e of entries) {
      expect(md).toContain(e.target.canonicalUrl);
      expect(md).toContain(`\`${e.localPath}\``);
    }
    expect(md).toContain('| VALID PDF | 一般会計 | https://www.meti.go.jp/main/yosangaisan/fy2024/pdf/ippan_o.pdf |');
    expect(md).toContain('| MISSING | 特許特別会計 |');
  });

  it('手順・注意・検証コマンド（--only=meti.go.jp）が入る', () => {
    expect(md).toContain('FY2024 概算要求 — 人手取得が必要なPDF');
    expect(md).toContain('CAPTCHA/Human Verificationの自動突破は行わない');
    expect(md).toContain('HTMLページをPDFとして保存しない');
    expect(md).toContain('指定された6ファイル以外を上書きしない');
    expect(md).toContain('npm run pipeline:v2:download:budget-requests -- 2024 --only=meti.go.jp');
    expect(md).toContain('cached: 6');
  });
});

describe('prepareManual', () => {
  it('parent directoryを作り、directoryごとに指示書を1つ書く', () => {
    const m = memFs();
    const prep = prepareManual(2024, targets, m.fs, BASE);
    expect(prep.entries).toHaveLength(6);
    expect(m.dirs).toEqual([METI_DIR]);
    expect(prep.directories).toEqual([METI_DIR]);
    expect(prep.instructionFiles).toEqual([path.join(METI_DIR, MANUAL_INSTRUCTIONS_FILE)]);
    expect(m.writes).toEqual(prep.instructionFiles);
    expect(m.files.get(prep.instructionFiles[0])!.toString('utf8')).toContain('ippan_o.pdf');
  });

  it('PDFを作らず、既存PDF・不正ファイルを変更しない', () => {
    const bad = Buffer.from('<html>');
    const m = memFs({ [path.join(METI_DIR, 'ippan_o.pdf')]: PDF, [path.join(METI_DIR, 'tokkyo_o.pdf')]: bad });
    prepareManual(2024, targets, m.fs, BASE);
    expect(m.files.get(path.join(METI_DIR, 'ippan_o.pdf'))).toBe(PDF);
    expect(m.files.get(path.join(METI_DIR, 'tokkyo_o.pdf'))).toBe(bad);
    expect([...m.files.keys()].filter(k => k.endsWith('.pdf')).sort()).toEqual(
      [path.join(METI_DIR, 'ippan_o.pdf'), path.join(METI_DIR, 'tokkyo_o.pdf')].sort(),
    );
    expect(m.writes.every(w => w.endsWith(MANUAL_INSTRUCTIONS_FILE))).toBe(true);
  });

  it('manual-requiredが無ければ何も作らない', () => {
    const m = memFs();
    const prep = prepareManual(2024, targets.filter(t => t.acquisitionPolicy !== 'manual-required'), m.fs, BASE);
    expect(prep).toEqual({ entries: [], directories: [], instructionFiles: [] });
    expect(m.dirs).toEqual([]);
  });

  it('不正なlocal pathは例外（何も書かない）', () => {
    const m = memFs();
    const broken = { ...selectManualTargets(targets)[0], canonicalUrl: 'http://www.meti.go.jp/a.pdf' };
    expect(() => prepareManual(2024, [broken], m.fs, BASE)).toThrow(/https/);
    expect(m.writes).toEqual([]);
  });

  it('指示書が存在してもdownloaderのcache判定（exact PDF path）に影響しない', () => {
    const m = memFs({ [path.join(METI_DIR, MANUAL_INSTRUCTIONS_FILE)]: Buffer.from('# x') });
    const states = planManual(targets, m.fs, BASE).map(e => e.state);
    expect(new Set(states)).toEqual(new Set(['MISSING']));
  });
});
