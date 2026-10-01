import { describe, expect, it } from 'vitest';
import {
  getBudgetRequestManifest,
  validateBudgetRequestManifest,
  type BudgetRequestManifest,
} from './budget-request-manifest';

const NDL = 'https://www.ndl.go.jp/jp/aboutus/outline/r06_budgetrequest.pdf';

function minimal(overrides: Partial<BudgetRequestManifest['sources'][number]['logicalDocuments'][number]> = {}): BudgetRequestManifest {
  return {
    fiscalYear: 2024,
    sources: [
      {
        publisherAuthority: '国立国会図書館',
        publisherDomain: 'ndl.go.jp',
        logicalDocuments: [
          {
            accountType: 'general',
            account: '一般会計',
            documentType: 'budget-request-expenditure',
            files: [{ url: NDL, verificationStatus: 'url-confirmed' }],
            ...overrides,
          },
        ],
      },
    ],
  };
}

describe('FY2024 manifest', () => {
  const manifest = getBudgetRequestManifest(2024);

  it('validationエラーが無い', () => {
    expect(validateBudgetRequestManifest(manifest)).toEqual([]);
  });

  it('1 logical document が複数filesを持てる（文科省4本・内閣府復興2本）', () => {
    const docs = manifest.sources.flatMap(s => s.logicalDocuments);
    const mext = manifest.sources.find(s => s.publisherDomain === 'mext.go.jp')!.logicalDocuments[0];
    expect(mext.files).toHaveLength(4);
    const caoRecon = manifest.sources
      .find(s => s.publisherDomain === 'cao.go.jp')!
      .logicalDocuments.find(d => d.account === '東日本大震災復興特別会計')!;
    expect(caoRecon.files.map(f => f.url.split('/').pop())).toEqual(['f1.pdf', 'f2.pdf']);
    expect(docs.some(d => d.files.length > 1)).toBe(true);
  });

  it('皇室費と宮内庁・参議院等のlogicalAuthorityを保持する', () => {
    const kunaicho = manifest.sources.find(s => s.publisherDomain === 'kunaicho.go.jp')!;
    expect(kunaicho.logicalDocuments.map(d => d.logicalAuthority)).toEqual(['皇室費', '宮内庁']);
    const sangiin = manifest.sources.find(s => s.publisherDomain === 'sangiin.go.jp')!;
    expect(sangiin.logicalDocuments[0].budgetJurisdiction).toBe('国会所管');
  });

  it('参議院は /jpn/ のみ取得対象で /japanese/ はfiles/fallbackに入れない', () => {
    const sangiin = manifest.sources.find(s => s.publisherDomain === 'sangiin.go.jp')!;
    const files = sangiin.logicalDocuments.flatMap(d => d.files);
    expect(files.map(f => f.url).every(u => u.includes('/jpn/'))).toBe(true);
    expect(files.every(f => !f.acquisitionFallbacks?.length)).toBe(true);
  });

  it('NDLはcanonicalがndl.go.jp、WARPはfallbackとして分離される', () => {
    const f = manifest.sources.find(s => s.publisherDomain === 'ndl.go.jp')!.logicalDocuments[0].files[0];
    expect(f.url).toBe(NDL);
    expect(f.acquisitionFallbacks?.[0].type).toBe('warp');
    expect(f.acquisitionFallbacks?.[0].url).toContain('warp.ndl.go.jp');
  });

  it('sy050905.pdfはreferenceFiles(validation)にあり、logicalDocumentsには入らない', () => {
    expect(manifest.referenceFiles?.map(r => [r.purpose, r.url.split('/').pop()])).toEqual([['validation', 'sy050905.pdf']]);
    const urls = manifest.sources.flatMap(s => s.logicalDocuments.flatMap(d => d.files.map(f => f.url)));
    expect(urls.some(u => u.endsWith('sy050905.pdf'))).toBe(false);
  });

  it('復興特会: 復興庁のみaggregate、他はauthority-specific', () => {
    const recon = manifest.sources.flatMap(s => s.logicalDocuments.map(d => ({ s, d }))).filter(x => x.d.account === '東日本大震災復興特別会計');
    const aggregate = recon.filter(x => x.d.documentScope === 'aggregate');
    expect(aggregate.map(x => x.s.publisherDomain)).toEqual(['reconstruction.go.jp']);
    expect(recon.filter(x => x.d.documentScope === 'authority-specific')).toHaveLength(recon.length - 1);
  });

  it('特別会計13会計すべてにdocumentがあり、accountCoverageが付く', () => {
    const accounts = new Set(manifest.sources.flatMap(s => s.logicalDocuments).filter(d => d.accountType === 'special').map(d => d.account));
    expect(accounts.size).toBe(13);
    expect(new Set(manifest.accountCoverage?.map(c => c.account))).toEqual(accounts);
  });

  it('経産省6件はmanual-required、verificationStatusは変更していない（ippan_oのみpdf-confirmed）', () => {
    const files = manifest.sources.find(s => s.publisherDomain === 'meti.go.jp')!.logicalDocuments.flatMap(d => d.files);
    expect(files).toHaveLength(6);
    expect(files.every(f => f.acquisitionPolicy === 'manual-required')).toBe(true);
    expect(files.filter(f => f.verificationStatus === 'pdf-confirmed').map(f => f.url.split('/').pop())).toEqual(['ippan_o.pdf']);
    expect(manifest.sources.find(s => s.publisherDomain === 'meti.go.jp')!.notes).toContain('2026-10-02');
  });

  it('対象外資料を含まない', () => {
    const urls = manifest.sources.flatMap(s => s.logicalDocuments.flatMap(d => d.files.map(f => f.url)));
    for (const excluded of ['24syokan/dl/01-02.pdf', 'r6_yosan_gaisan.pdf', 'table_03.pdf', 'r6_budget.pdf']) {
      expect(urls.some(u => u.endsWith(excluded))).toBe(false);
    }
  });
});

describe('getBudgetRequestManifest', () => {
  it('未定義年度はエラー', () => {
    expect(() => getBudgetRequestManifest(2023)).toThrow(/未定義/);
  });
});

describe('validateBudgetRequestManifest', () => {
  it('正常なmanifestはエラー無し', () => {
    expect(validateBudgetRequestManifest(minimal())).toEqual([]);
  });

  it('URL重複を検出する', () => {
    const m = minimal();
    m.sources[0].logicalDocuments.push({ ...m.sources[0].logicalDocuments[0], logicalAuthority: 'x' });
    expect(validateBudgetRequestManifest(m).join('\n')).toContain('URL重複');
  });

  it('canonical hostとpublisherDomainの不一致を検出する', () => {
    const m = minimal({ files: [{ url: 'https://www.example.com/a.pdf', verificationStatus: 'url-confirmed' }] });
    expect(validateBudgetRequestManifest(m).join('\n')).toContain('hostがpublisherDomainと不一致');
  });

  it('files 0件を検出する', () => {
    expect(validateBudgetRequestManifest(minimal({ files: [] })).join('\n')).toContain('filesが0件');
  });

  it('role重複を検出する', () => {
    const m = minimal({
      files: [
        { url: NDL, role: 'detail', verificationStatus: 'url-confirmed' },
        { url: NDL.replace('r06_', 'r06b_'), role: 'detail', verificationStatus: 'url-confirmed' },
      ],
    });
    expect(validateBudgetRequestManifest(m).join('\n')).toContain('role重複');
  });

  it('referenceFilesのhost不一致・URL重複を検出する', () => {
    const base = minimal();
    const ref = { purpose: 'validation' as const, title: 't', publisherAuthority: 'x', publisherDomain: 'mof.go.jp', verificationStatus: 'url-confirmed' as const };
    expect(validateBudgetRequestManifest({ ...base, referenceFiles: [{ ...ref, url: 'https://www.example.com/a.pdf' }] }).join('\n')).toContain('hostがpublisherDomainと不一致');
    expect(validateBudgetRequestManifest({ ...base, referenceFiles: [{ ...ref, publisherDomain: 'ndl.go.jp', url: NDL }] }).join('\n')).toContain('URL重複');
  });

  it('accountCoverageがdocumentに無い会計を指すとエラー', () => {
    const m = { ...minimal(), accountCoverage: [{ account: '特許特別会計', authorityCoverage: 'unknown' as const }] };
    expect(validateBudgetRequestManifest(m).join('\n')).toContain('accountCoverage');
  });

  it('manual-requiredとallowPlaywrightFallbackの併用を検出する', () => {
    const m = minimal({ files: [{ url: NDL, verificationStatus: 'url-confirmed', acquisitionPolicy: 'manual-required', allowPlaywrightFallback: true }] });
    expect(validateBudgetRequestManifest(m).join('\n')).toContain('併用できない');
  });

  it('不正なfiscalYearを検出する', () => {
    expect(validateBudgetRequestManifest({ ...minimal(), fiscalYear: 24 }).join('\n')).toContain('fiscalYear');
  });

  it('accountTypeとaccountの不整合を検出する', () => {
    expect(validateBudgetRequestManifest(minimal({ accountType: 'special' })).join('\n')).toContain('特別会計でない');
  });

  describe('acquisitionFallbacks', () => {
    const warpUrl = `https://warp.ndl.go.jp/web/20231004165212/${NDL}`;
    const withFallback = (fb: { type: 'warp' | 'alternate-live-url'; url: string }) =>
      minimal({
        files: [{ url: NDL, verificationStatus: 'url-confirmed', acquisitionFallbacks: [{ ...fb, verificationStatus: 'human-confirmed' }] }],
      });

    it('archive hostがpublisherDomainと異なってもvalidation errorにならない', () => {
      expect(validateBudgetRequestManifest(withFallback({ type: 'warp', url: warpUrl }))).toEqual([]);
    });

    it('warp URLに埋め込まれた原本URLがcanonicalと違えばエラー', () => {
      const bad = `https://warp.ndl.go.jp/web/20231004165212/https://www.ndl.go.jp/other.pdf`;
      expect(validateBudgetRequestManifest(withFallback({ type: 'warp', url: bad })).join('\n')).toContain('一致しない');
    });

    it('warp形式でないwarp fallbackはエラー', () => {
      expect(validateBudgetRequestManifest(withFallback({ type: 'warp', url: 'https://warp.ndl.go.jp/x.pdf' })).join('\n')).toContain('形式でない');
    });

    it('alternate-live-urlにwarp形式を使うとエラー', () => {
      expect(validateBudgetRequestManifest(withFallback({ type: 'alternate-live-url', url: warpUrl })).join('\n')).toContain('warp形式');
    });

    it('fallback URLが不正ならエラー', () => {
      expect(validateBudgetRequestManifest(withFallback({ type: 'alternate-live-url', url: 'not a url' })).join('\n')).toContain('URL形式が不正');
    });

    it('canonicalと同一のfallbackはエラー', () => {
      expect(validateBudgetRequestManifest(withFallback({ type: 'alternate-live-url', url: NDL })).join('\n')).toContain('同一');
    });
  });
});
