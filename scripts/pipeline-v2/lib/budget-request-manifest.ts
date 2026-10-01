/**
 * 概算要求（歳出概算要求書）PDFの取得manifest — 型とvalidation。
 *
 * manifestは「人間確認済みの取得対象と論理構造のground truth」。URLを番号規則等から
 * 推測して足さない。下記を混同しないこと:
 *   - publisher（PDFを配布するauthority/domain）
 *   - budgetJurisdiction / logicalAuthority（予算上の所管・論理区分。皇室費と宮内庁等）
 *   - relatedAuthority（関連府省。復興特会・エネルギー特会等）
 *   - logical document（1つの概算要求書）と physical files（それを構成するPDF、N本）
 *   - canonical/original URL と acquisitionFallbacks（取得経路。archive host等はpublisherではない）
 *
 * `verificationStatus` はmanifest作成時の確認度であり、実取得の成否（runtime）とは別。
 * 実取得成功時にmanifestを自動で書き換えて昇格させることはしない。
 */
import { FY2024_BUDGET_REQUEST_MANIFEST } from './fy2024-budget-request-manifest';

export type VerificationStatus =
  | 'pdf-confirmed' // PDF本文まで確認済み
  | 'human-confirmed' // ユーザーがブラウザで直接確認
  | 'url-confirmed' // 事前調査でURLまで確認（本文は未確認）
  | 'search-index-confirmed'
  | 'historically-content-confirmed'; // 過去に内容確認。現在のliveでは取得できない場合がある

export interface BudgetRequestAcquisitionFallback {
  type: 'warp' | 'alternate-live-url';
  url: string;
  verificationStatus: Extract<VerificationStatus, 'human-confirmed' | 'pdf-confirmed' | 'url-confirmed'>;
}

export interface BudgetRequestFile {
  role?: string;
  /** registry/ページ上のタイトル（原表記のまま保持） */
  title?: string;
  /** 原本のcanonical/original URL。liveで404でも原本URLが確認できているなら保持する */
  url: string;
  /** 明示された取得fallback。WARP URL等を自動生成・推測しない */
  acquisitionFallbacks?: BudgetRequestAcquisitionFallback[];
  /** direct fetch等が失敗した場合にPlaywright取得を試してよい（最初からPlaywrightで取る指定ではない） */
  allowPlaywrightFallback?: boolean;
  /**
   * auto（既定）: 自動取得する / manual-required: 公式URLは確認済みだが自動取得はWAF等で阻まれ人手取得が必要。
   * valid cacheが無い場合、networkへ出ず manual-required を返す。人手で所定pathへ置けば通常のcachedになる。
   * URLが壊れている（failed）こととは区別する。日付付きの観測はnotesに残し、恒久的な取得不能とは扱わない。
   */
  acquisitionPolicy?: 'auto' | 'manual-required';
  timeoutMs?: number;
  verificationStatus: VerificationStatus;
  /** 調査証跡（過去に観測したが現在取得できないURL等。fallbackにはしない） */
  notes?: string;
}

export interface BudgetRequestDocument {
  /** 予算上の所管（PDF配布元と異なる場合のみ。例: 国会所管） */
  budgetJurisdiction?: string;
  /** 予算上の論理区分（例: 皇室費 / 宮内庁、内閣府 / 内閣本府） */
  logicalAuthority?: string;
  accountType: 'general' | 'special';
  /** 一般会計 or 特別会計名 */
  account: string;
  subAccounts?: string[];
  relatedAuthority?: string;
  documentType: 'budget-request-expenditure';
  /**
   * authority-specific: 各府省が自所管分を公開した原本 / aggregate: 複数府省分を集計した原本（復興庁等）。
   * 復興特会を複数publisherから取得していることと、同一documentの重複登録を区別するために持つ。
   */
  documentScope?: 'authority-specific' | 'aggregate';
  /** known-confirmed-files-only: 確認済みfileのみ。全体を構成するfileが揃っている保証はない */
  coverage?: 'known-confirmed-files-only';
  files: BudgetRequestFile[];
  notes?: string;
}

export interface BudgetRequestSource {
  /** PDFの配布元authority（registryの表記） */
  publisherAuthority: string;
  /** `www.`を除いたdomain。保存先 `data/download/{publisherDomain}/` に使う */
  publisherDomain: string;
  landingPageUrl?: string;
  logicalDocuments: BudgetRequestDocument[];
  notes?: string;
}

/** 検算・参照用のraw file。概算要求原本のlogical documentとは別枠で保持する */
export interface BudgetRequestReferenceFile {
  purpose: 'validation';
  title: string;
  publisherAuthority: string;
  publisherDomain: string;
  url: string;
  verificationStatus: Extract<
    VerificationStatus,
    'pdf-confirmed' | 'human-confirmed' | 'url-confirmed' | 'historically-content-confirmed'
  >;
  notes?: string;
}

/**
 * 会計単位のcoverageと、その会計に関係する全府省PDFのcoverageは別。
 * 会計自体は logicalDocuments に1件以上あれば covered。ここでは府省/publisher側の網羅度だけを持つ。
 */
export interface BudgetRequestAccountCoverage {
  account: string;
  authorityCoverage: 'partial' | 'unknown';
  notes?: string;
}

export interface BudgetRequestManifest {
  fiscalYear: number;
  sources: BudgetRequestSource[];
  referenceFiles?: BudgetRequestReferenceFile[];
  accountCoverage?: BudgetRequestAccountCoverage[];
}

const MANIFESTS: Record<number, BudgetRequestManifest> = {
  2024: FY2024_BUDGET_REQUEST_MANIFEST,
};

/** manifest未定義の年度はURLを推測せずエラーにする */
export function getBudgetRequestManifest(fiscalYear: number): BudgetRequestManifest {
  const manifest = MANIFESTS[fiscalYear];
  if (!manifest) {
    throw new Error(
      `概算要求manifestが未定義の年度です: ${fiscalYear}（対応年度: ${Object.keys(MANIFESTS).join(', ')}）`,
    );
  }
  return manifest;
}

/** hostから先頭の`www.`を除く */
export function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

const WARP_URL = /^https?:\/\/[^/]+\/web\/\d{12,14}[a-z_]*\/(https?:\/\/.+)$/;

/** manifestの整合性を検査し、問題の一覧を返す（空なら問題なし） */
export function validateBudgetRequestManifest(manifest: BudgetRequestManifest): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(manifest.fiscalYear) || manifest.fiscalYear < 2000) {
    errors.push(`fiscalYearが不正: ${manifest.fiscalYear}`);
  }
  if (manifest.sources.length === 0) errors.push('sourcesが空');

  const seenUrls = new Map<string, string>();
  for (const src of manifest.sources) {
    const where = `${src.publisherAuthority}(${src.publisherDomain})`;
    if (src.publisherDomain !== stripWww(src.publisherDomain)) {
      errors.push(`${where}: publisherDomainは小文字・www無しで記述する`);
    }
    if (src.logicalDocuments.length === 0) errors.push(`${where}: logicalDocumentsが空`);
    if (src.landingPageUrl) checkUrl(src.landingPageUrl, `${where}: landingPageUrl`, errors);

    for (const doc of src.logicalDocuments) {
      const docName = `${where}/${doc.logicalAuthority ?? ''}/${doc.account}`;
      if (doc.accountType === 'general' && doc.account !== '一般会計') {
        errors.push(`${docName}: accountType=generalなのにaccountが一般会計でない`);
      }
      if (doc.accountType === 'special' && !doc.account.endsWith('特別会計')) {
        errors.push(`${docName}: accountType=specialなのにaccountが特別会計でない`);
      }
      if (doc.files.length === 0) {
        errors.push(`${docName}: filesが0件`);
        continue;
      }
      const roles = new Set<string>();
      for (const file of doc.files) {
        if (file.role !== undefined) {
          if (roles.has(file.role)) errors.push(`${docName}: role重複 "${file.role}"`);
          roles.add(file.role);
        }
        if (file.acquisitionPolicy === 'manual-required' && file.allowPlaywrightFallback) {
          errors.push(`${docName}: manual-requiredとallowPlaywrightFallbackは併用できない: ${file.url}`);
        }
        const u = checkUrl(file.url, `${docName}: url ${file.url}`, errors);
        if (u) {
          if (stripWww(u.hostname) !== src.publisherDomain) {
            errors.push(`${docName}: canonical urlのhostがpublisherDomainと不一致: ${file.url}`);
          }
          const prev = seenUrls.get(file.url);
          if (prev) errors.push(`URL重複: ${file.url}（${prev} と ${docName}）`);
          else seenUrls.set(file.url, docName);
        }
        for (const fb of file.acquisitionFallbacks ?? []) {
          validateFallback(fb, file, docName, errors);
        }
      }
    }
  }

  const docAccounts = new Set(manifest.sources.flatMap(s => s.logicalDocuments.map(d => d.account)));
  for (const c of manifest.accountCoverage ?? []) {
    if (!docAccounts.has(c.account)) errors.push(`accountCoverageの会計がlogicalDocumentsに無い: ${c.account}`);
  }
  for (const ref of manifest.referenceFiles ?? []) {
    const label = `reference(${ref.purpose}) ${ref.url}`;
    const u = checkUrl(ref.url, label, errors);
    if (!u) continue;
    if (stripWww(u.hostname) !== ref.publisherDomain) errors.push(`${label}: hostがpublisherDomainと不一致`);
    const prev = seenUrls.get(ref.url);
    if (prev) errors.push(`URL重複: ${ref.url}（${prev} と reference）`);
    else seenUrls.set(ref.url, 'reference');
  }
  return errors;
}

function checkUrl(raw: string, label: string, errors: string[]): URL | undefined {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    errors.push(`${label}: URL形式が不正`);
    return undefined;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    errors.push(`${label}: http(s)でない`);
    return undefined;
  }
  return u;
}

function validateFallback(
  fb: BudgetRequestAcquisitionFallback,
  file: BudgetRequestFile,
  docName: string,
  errors: string[],
): void {
  const label = `${docName}: fallback(${fb.type}) ${fb.url}`;
  const u = checkUrl(fb.url, label, errors);
  if (!u) return;
  if (fb.url === file.url) errors.push(`${label}: canonical URLと同一`);
  const warp = WARP_URL.exec(fb.url);
  if (fb.type === 'warp') {
    // `https://{archive host}/web/{timestamp}/{原本URL}` 形式で、埋め込まれた原本URLがcanonicalと一致すること。
    // hostはpublisherDomainと異なってよい（archive取得経路でありpublisherではない）。
    if (!warp) {
      errors.push(`${label}: warp URLが /web/{timestamp}/{原本URL} 形式でない`);
    } else if (warp[1] !== file.url) {
      errors.push(`${label}: warp URLに埋め込まれた原本URLがcanonicalと一致しない`);
    }
  } else if (warp) {
    errors.push(`${label}: alternate-live-urlがwarp形式`);
  }
}
