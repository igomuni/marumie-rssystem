import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { expandTargets, localPathFor, type BudgetRequestFs } from './budget-request-download';
import {
  EXTRACTION_WORK_DIR,
  goldenSamplePath,
  inspectTarget,
  inventoryPath,
  listExtractionTargets,
  resolveGoldenSamples,
  summarizeInspection,
  writeInventory,
  type GoldenSampleFile,
} from './budget-request-extraction';
import { getBudgetRequestManifest } from './budget-request-manifest';

const BASE = 'data/download';
const PDF = Buffer.from('%PDF-1.4\nbody');
const manifest = getBudgetRequestManifest(2024);
const targets = listExtractionTargets(manifest, BASE);

function memFs(initial: Record<string, Buffer> = {}) {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  const dirs: string[] = [];
  const bfs: BudgetRequestFs = {
    size: p => files.get(p)?.length,
    readHead: (p, n) => files.get(p)!.subarray(0, n),
    mkdirp: d => void dirs.push(d),
    writeAtomic: (p, data) => (writes.push(p), void files.set(p, data)),
  };
  return { bfs, files, writes, dirs };
}

describe('listExtractionTargets', () => {
  it('manifestのdocument PDFだけを列挙する（reference/validationは含めない）', () => {
    expect(targets).toHaveLength(82);
    expect(expandTargets(manifest)).toHaveLength(83);
    expect(targets.some(t => t.canonicalUrl.endsWith('sy050905.pdf'))).toBe(false);
  });

  it('localPathはDownloaderと同じ規則（localPathFor）で解決される', () => {
    for (const t of targets) expect(t.localPath).toBe(localPathFor(t.canonicalUrl, t.publisherDomain, BASE));
    const ippan = targets.find(t => t.canonicalUrl.endsWith('/ippan_o.pdf'))!;
    expect(ippan.localPath).toBe(path.join(BASE, 'meti.go.jp', 'main', 'yosangaisan', 'fy2024', 'pdf', 'ippan_o.pdf'));
  });

  it('document metadata（account・logicalAuthority・role）を保持する', () => {
    const cas = targets.filter(t => t.publisherDomain === 'cas.go.jp');
    expect(cas).toHaveLength(17);
    expect(cas.filter(t => t.account === '東日本大震災復興特別会計')).toHaveLength(2);
    expect(targets.find(t => t.logicalAuthority === '皇室費')).toBeDefined();
  });
});

describe('inspectTarget', () => {
  const t = targets[0];
  it('valid PDF → FOUND（bytes付き）', () => {
    expect(inspectTarget(t, memFs({ [t.localPath]: PDF }).bfs)).toMatchObject({ state: 'FOUND', bytes: PDF.length });
  });
  it('ファイルなし → MISSING', () => {
    expect(inspectTarget(t, memFs().bfs).state).toBe('MISSING');
  });
  it('0 byte / HTML → INVALID', () => {
    expect(inspectTarget(t, memFs({ [t.localPath]: Buffer.alloc(0) }).bfs).state).toBe('INVALID');
    expect(inspectTarget(t, memFs({ [t.localPath]: Buffer.from('<html>WAF</html>') }).bfs).state).toBe('INVALID');
  });
  it('原本を変更しない（書き込みなし）', () => {
    const m = memFs({ [t.localPath]: PDF });
    inspectTarget(t, m.bfs);
    expect(m.writes).toEqual([]);
    expect(m.files.get(t.localPath)).toBe(PDF);
  });
});

describe('summarizeInspection', () => {
  it('件数はmanifestと実ファイルから算出される', () => {
    const m = memFs({ [targets[0].localPath]: PDF, [targets[1].localPath]: Buffer.from('x') });
    const items = targets.map(t => inspectTarget(t, m.bfs));
    expect(summarizeInspection(items)).toEqual({ total: 82, found: 1, missing: 80, invalid: 1 });
  });
});

describe('Golden Sample locator', () => {
  const file = JSON.parse(fs.readFileSync(goldenSamplePath(2024), 'utf8')) as GoldenSampleFile;

  it('fixtureはmanifestのdocument targetへすべて解決でき、問題が無い', () => {
    const { resolved, problems } = resolveGoldenSamples(file, targets);
    expect(problems).toEqual([]);
    expect(resolved.map(r => [r.sample.tier, r.target.publisherDomain, path.basename(r.target.localPath), r.sample.pdfPage])).toEqual([
      ['normal', 'meti.go.jp', 'ippan_o.pdf', 9],
      ['moderate', 'mhlw.go.jp', '05-1b-01.pdf', 1268],
      ['extreme', 'mhlw.go.jp', '05-1b-01.pdf', 1555],
    ]);
  });

  it('正解データは未作成（pending-human-review）で、PDFはfixtureへコピーしていない', () => {
    expect(file.samples.every(s => s.groundTruthStatus === 'pending-human-review')).toBe(true);
    const dir = path.dirname(goldenSamplePath(2024));
    expect(fs.readdirSync(dir)).toEqual(['golden-samples.json']);
  });

  it('未知のURL・不正なページ・id重複を検出する', () => {
    const base = file.samples[0];
    const { problems } = resolveGoldenSamples(
      { fiscalYear: 2024, samples: [{ ...base, canonicalUrl: 'https://www.example.go.jp/x.pdf' }, { ...base, pdfPage: 0 }] },
      targets,
    );
    expect(problems.join('\n')).toContain('manifestに無いcanonicalUrl');
    expect(problems.join('\n')).toContain('pdfPageは1以上の整数');
    expect(problems.join('\n')).toContain('idが重複');
  });
});

describe('work領域', () => {
  it('inventoryは data/work/budget-request-extraction/{year}/ へ書き、data/download には書かない', () => {
    const m = memFs({ [targets[0].localPath]: PDF });
    const items = targets.slice(0, 2).map(t => inspectTarget(t, m.bfs));
    const file = writeInventory(2024, items, m.bfs);
    expect(file).toBe(path.join(EXTRACTION_WORK_DIR, '2024', 'inventory.json'));
    expect(file).toBe(inventoryPath(2024));
    expect(m.writes).toEqual([file]);
    expect(m.writes.every(w => !w.startsWith('data/download'))).toBe(true);
    const json = JSON.parse(m.files.get(file)!.toString('utf8'));
    expect(json.summary).toEqual({ total: 2, found: 1, missing: 1, invalid: 0 });
  });
});
