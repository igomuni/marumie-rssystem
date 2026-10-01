/**
 * FY2024（令和6年度）概算要求 取得manifest。
 *
 * 出典: 人間確認済みURL（指示書の事前調査）と marumie-rssystem-research の
 * sources/source-registry.csv。URLは番号規則等から推測して足していない。
 *
 * verificationStatus:
 *   - pdf-confirmed: registryでPDF本文・先頭bytesまで確認済み
 *   - url-confirmed: 事前調査でURLまでは確認したが、PDF本文まで再検証していない（実取得で404になり得る）。
 *     research repoへの収録有無とは無関係で、provenance/verificationの事実だけを表す
 *
 * 対象外（research repoには残るがmanifestに入れない）:
 *   - 厚労省 01-02.pdf / 内閣官房 r6_yosan_gaisan.pdf / デジタル庁 table_03: 説明・概要資料
 *   - 裁判官訴追委員会 r6_budget.pdf: 決算段階の各目明細書（概算要求ではない）
 *   - MOF 一般会計集計 sy050905.pdf: logicalDocumentsではなく referenceFiles（purpose: validation）に保持
 *   - 参議院 /japanese/ 側のURL: 現時点でlive 404。取得対象にしない（下記notes参照）
 */
import type { BudgetRequestDocument, BudgetRequestFile, BudgetRequestManifest, VerificationStatus } from './budget-request-manifest';

type Extra = Partial<Omit<BudgetRequestFile, 'url' | 'verificationStatus'>>;
const file = (url: string, verificationStatus: VerificationStatus, extra: Extra = {}): BudgetRequestFile => ({
  ...extra,
  url,
  verificationStatus,
});

const general = (files: BudgetRequestFile[], extra: Partial<BudgetRequestDocument> = {}): BudgetRequestDocument => ({
  accountType: 'general',
  account: '一般会計',
  documentType: 'budget-request-expenditure',
  ...extra,
  files,
});

const RECON = '東日本大震災復興特別会計';

const special = (account: string, files: BudgetRequestFile[], extra: Partial<BudgetRequestDocument> = {}): BudgetRequestDocument => ({
  accountType: 'special',
  account,
  documentType: 'budget-request-expenditure',
  // 復興特会は各府省が自所管分を別PDFで公開する（復興庁aggregateのみ個別にaggregateを指定）
  ...(account === RECON ? { documentScope: 'authority-specific' as const } : {}),
  ...extra,
  files,
});

const ENERGY = 'エネルギー対策特別会計';
const PDF = 'pdf-confirmed' as const;
const URL_ONLY = 'url-confirmed' as const;

// 経産省は自動取得できない（source notes参照）。verificationStatusは取得結果で変更しない
const metiPdf = (name: string, status: VerificationStatus) =>
  file(`https://www.meti.go.jp/main/yosangaisan/fy2024/pdf/${name}`, status, { acquisitionPolicy: 'manual-required' });
const mofPdf = (name: string) => file(`https://www.mof.go.jp/about_mof/mof_budget/budget/fy2024/${name}`, URL_ONLY);

/** 内閣官房 r6_NN.pdf（registryで確認済みのhrefのみ。番号規則からの推測追加はしない） */
const cas = (nn: string, title: string, role: string) =>
  file(`https://www.cas.go.jp/jp/yosan/pdf/r6_${nn}.pdf`, PDF, { role, title });

export const FY2024_BUDGET_REQUEST_MANIFEST: BudgetRequestManifest = {
  fiscalYear: 2024,
  referenceFiles: [
    {
      purpose: 'validation',
      title: '令和6年度一般会計概算要求・要望額／財政投融資計画要求額',
      publisherAuthority: '財務省',
      publisherDomain: 'mof.go.jp',
      url: 'https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy2024/sy050905.pdf',
      verificationStatus: 'pdf-confirmed',
      notes: '2頁。一般会計は18の大分類（皇室費・国会・裁判所・会計検査院・内閣・内閣府・デジタル庁・各省）で集計。manifestの一般会計32 documentとは粒度が異なる',
    },
  ],
  accountCoverage: [
    { account: RECON, authorityCoverage: 'partial', notes: '法務・経産・農水・国交・環境・警察・消費者・内閣府・内閣官房の各府省分＋復興庁aggregate。他府省分は未確認' },
    { account: ENERGY, authorityCoverage: 'partial', notes: '経産・環境・内閣府分。他に関係府省があるかは未確認' },
    { account: '年金特別会計', authorityCoverage: 'partial', notes: '厚労・こども家庭庁分。勘定はPDF本文未確認のためsubAccounts未指定' },
    { account: '労働保険特別会計', authorityCoverage: 'unknown' },
    { account: '交付税及び譲与税配付金特別会計', authorityCoverage: 'unknown' },
    { account: '食料安定供給特別会計', authorityCoverage: 'unknown' },
    { account: '国有林野事業債務管理特別会計', authorityCoverage: 'unknown' },
    { account: '特許特別会計', authorityCoverage: 'unknown' },
    { account: '自動車安全特別会計', authorityCoverage: 'unknown' },
    { account: '地震再保険特別会計', authorityCoverage: 'unknown' },
    { account: '国債整理基金特別会計', authorityCoverage: 'unknown' },
    { account: '外国為替資金特別会計', authorityCoverage: 'unknown' },
    { account: '財政投融資特別会計', authorityCoverage: 'unknown' },
  ],
  sources: [
    {
      publisherAuthority: '総務省',
      publisherDomain: 'soumu.go.jp',
      landingPageUrl: 'https://www.soumu.go.jp/menu_yosan/yosan_R06.html',
      logicalDocuments: [
        general([file('https://www.soumu.go.jp/main_content/000901372.pdf', PDF)]),
        special('交付税及び譲与税配付金特別会計', [file('https://www.soumu.go.jp/main_content/000901375.pdf', URL_ONLY)], {
          notes: 'landing上のリンクタイトルは単に「特別会計」。anchor textで会計を分類しないこと',
        }),
      ],
    },
    {
      publisherAuthority: '法務省',
      publisherDomain: 'moj.go.jp',
      landingPageUrl: 'https://www.moj.go.jp/kaikei/bunsho/kaikei02_00121.html',
      logicalDocuments: [
        general([file('https://www.moj.go.jp/content/001402818.pdf', PDF, { notes: '約147MB・737頁（registry）' })]),
        special(RECON, [file('https://www.moj.go.jp/content/001402819.pdf', URL_ONLY)], { relatedAuthority: '法務省' }),
      ],
    },
    {
      publisherAuthority: '経済産業省',
      publisherDomain: 'meti.go.jp',
      landingPageUrl: 'https://www.meti.go.jp/main/yosangaisan/fy2024/index.html',
      notes:
        '[日付付き観測] 2026-09-25: researchでPlaywright/Chromium取得成功（plain fetchはAWS WAF challenge HTTP 202）。' +
        ' 2026-10-02: direct fetch HTTP 403、Playwrightのlanding=Human Verification（人間操作を要求）、PDF navigation=HTTP 405。' +
        ' 自動取得は無効化(manual-required)。人手でブラウザ取得し data/download/meti.go.jp/main/yosangaisan/fy2024/pdf/ へ同名で配置する。' +
        ' WAF状態が変われば再検証できる（恒久的な取得不能ではない）。CAPTCHA/Human Verificationの突破処理は実装しない',
      logicalDocuments: [
        general([metiPdf('ippan_o.pdf', PDF)]),
        special(ENERGY, [metiPdf('eneju_o.pdf', URL_ONLY)], { subAccounts: ['エネルギー需給勘定'] }),
        special(ENERGY, [metiPdf('eneden_o.pdf', URL_ONLY)], { subAccounts: ['電源開発促進勘定'] }),
        special(ENERGY, [metiPdf('enegen_o.pdf', URL_ONLY)], { subAccounts: ['原子力損害賠償支援勘定'] }),
        special('特許特別会計', [metiPdf('tokkyo_o.pdf', URL_ONLY)]),
        special(RECON, [metiPdf('fukko_o.pdf', URL_ONLY)], { relatedAuthority: '経済産業省' }),
      ],
    },
    {
      publisherAuthority: '財務省',
      publisherDomain: 'mof.go.jp',
      logicalDocuments: [
        general([file('https://www.mof.go.jp/about_mof/mof_budget/budget/fy2024/2024ippan_2.pdf', PDF)]),
        special('地震再保険特別会計', [mofPdf('2024jisinn_2.pdf')]),
        special('国債整理基金特別会計', [mofPdf('2024kokusaiseirikikinn_2.pdf')]),
        special('外国為替資金特別会計', [mofPdf('2024gaitame_2.pdf')]),
        special('財政投融資特別会計', [mofPdf('2024zaiyuu_2.pdf')], { subAccounts: ['財政融資資金勘定'] }),
        special('財政投融資特別会計', [mofPdf('2024tousi_2.pdf')], { subAccounts: ['投資勘定'] }),
        special('財政投融資特別会計', [mofPdf('2024tokuzai_2.pdf')], { subAccounts: ['特定国有財産整備勘定'] }),
      ],
    },
    {
      publisherAuthority: '厚生労働省',
      publisherDomain: 'mhlw.go.jp',
      notes: '一般会計は総表・明細表(05-1b-01)のみ。01-02(詳細版)は項目別の説明資料で対象外',
      logicalDocuments: [
        general([file('https://www.mhlw.go.jp/wp/yosan/yosan/24syokan/dl/05-1b-01.pdf', PDF, { title: '令和６年度歳出概算要求書（一般会計）総表・明細表', notes: '1,723頁（registry）' })]),
        special('労働保険特別会計', [file('https://www.mhlw.go.jp/wp/yosan/yosan/24syokan/dl/05-2b-01.pdf', URL_ONLY)]),
        special('年金特別会計', [file('https://www.mhlw.go.jp/wp/yosan/yosan/24syokan/dl/05-3b-01.pdf', URL_ONLY)]),
      ],
    },
    {
      publisherAuthority: '農林水産省',
      publisherDomain: 'maff.go.jp',
      logicalDocuments: [
        general([file('https://www.maff.go.jp/j/budget/attach/pdf/230901-2.pdf', PDF)]),
        special(RECON, [file('https://www.maff.go.jp/j/budget/attach/pdf/230901-4.pdf', URL_ONLY)], { relatedAuthority: '農林水産省' }),
        special('食料安定供給特別会計', [file('https://www.maff.go.jp/j/budget/attach/pdf/230901-6.pdf', URL_ONLY)]),
        special('国有林野事業債務管理特別会計', [file('https://www.maff.go.jp/j/budget/attach/pdf/230901-8.pdf', URL_ONLY)]),
      ],
    },
    {
      publisherAuthority: '国土交通省',
      publisherDomain: 'mlit.go.jp',
      landingPageUrl: 'https://www.mlit.go.jp/page/kanbo05_hy_003158.html',
      logicalDocuments: [
        general([file('https://www.mlit.go.jp/page/content/001630995.pdf', PDF)]),
        special('自動車安全特別会計', [file('https://www.mlit.go.jp/page/content/001630393.pdf', URL_ONLY)], {
          subAccounts: ['自動車事故対策勘定', '自動車検査登録勘定', '空港整備勘定'],
          notes: '1 PDFに3勘定を含む（1 subAccount = 1 file ではない）',
        }),
        special(RECON, [file('https://www.mlit.go.jp/page/content/001630395.pdf', URL_ONLY)], { relatedAuthority: '国土交通省' }),
      ],
    },
    {
      publisherAuthority: '環境省',
      publisherDomain: 'env.go.jp',
      logicalDocuments: [
        general([file('https://www.env.go.jp/content/000157010.pdf', PDF)]),
        special(ENERGY, [file('https://www.env.go.jp/content/000157012.pdf', URL_ONLY)], { subAccounts: ['エネルギー需給勘定'] }),
        special(ENERGY, [file('https://www.env.go.jp/content/000157013.pdf', URL_ONLY)], { subAccounts: ['電源開発促進勘定'] }),
        special(RECON, [file('https://www.env.go.jp/content/000157016.pdf', URL_ONLY)], { relatedAuthority: '環境省' }),
      ],
    },
    {
      publisherAuthority: 'こども家庭庁',
      publisherDomain: 'cfa.go.jp',
      logicalDocuments: [
        general([file('https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/585bb95a/20230907_policies_budget_04.pdf', PDF)]),
        special('年金特別会計', [file('https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/aac2d779/20230907_policies_budget_05.pdf', URL_ONLY)], {
          subAccounts: ['子ども・子育て支援勘定'],
        }),
      ],
    },
    {
      publisherAuthority: 'デジタル庁',
      publisherDomain: 'digital.go.jp',
      logicalDocuments: [
        general([file('https://www.digital.go.jp/assets/contents/node/basic_page/field_ref_resources/e9b99425-437c-4750-b4e2-6cca3cd877a6/0fab2c74/20230914_policies_budget_r6request_table_01.pdf', PDF)]),
      ],
    },
    {
      publisherAuthority: '警察庁',
      publisherDomain: 'npa.go.jp',
      logicalDocuments: [
        general([file('https://www.npa.go.jp/policies/budget/r6/gaisanyokyu/ippankaikei.pdf', PDF)]),
        special(RECON, [file('https://www.npa.go.jp/policies/budget/r6/gaisanyokyu/hukkoutokubetukaikei.pdf', URL_ONLY)], { relatedAuthority: '警察庁' }),
      ],
    },
    {
      publisherAuthority: '防衛省',
      publisherDomain: 'mod.go.jp',
      logicalDocuments: [general([file('https://www.mod.go.jp/j/budget/gaisan/r6/gaisanyoukyu.pdf', PDF)])],
    },
    {
      publisherAuthority: '外務省',
      publisherDomain: 'mofa.go.jp',
      landingPageUrl: 'https://www.mofa.go.jp/mofaj/annai/yosan_kessan/mofa_yosan_kessan/',
      logicalDocuments: [
        general([
          file('https://www.mofa.go.jp/mofaj/files/100546568.pdf', PDF, {
            allowPlaywrightFallback: true,
            notes: 'researchの自動取得（plain fetch/WebFetch/Playwright）はAkamaiでdomain全体がブロックされた。人手取得が必要になり得る',
          }),
        ]),
      ],
    },
    {
      publisherAuthority: '参議院',
      publisherDomain: 'sangiin.go.jp',
      landingPageUrl: 'https://www.sangiin.go.jp/jpn/annai/oshirase/yosan-gaisan.html',
      notes:
        'canonicalは /jpn/（live 200、registry・ユーザー実ブラウザで確認）。' +
        '/japanese/ 側（landing ".../japanese/annai/oshirase/yosan-gaisan.html" と PDF ".../japanese/annai/oshirase/pdf/r6gaisan-yokyusyo-250905.pdf"）は' +
        ' historically observed by ChatGPT web/search environment, current live fetch not reproducible（2026-10-01時点でlive 404）。' +
        'そのため取得対象にもfallbackにも含めない。',
      logicalDocuments: [
        general([file('https://www.sangiin.go.jp/jpn/annai/oshirase/pdf/r6gaisan-yokyusyo-250905.pdf', PDF)], {
          budgetJurisdiction: '国会所管',
          logicalAuthority: '参議院',
        }),
      ],
    },
    {
      publisherAuthority: '衆議院',
      publisherDomain: 'shugiin.go.jp',
      logicalDocuments: [
        general(
          [
            file(
              'https://www.shugiin.go.jp/internet/itdb_annai.nsf/html/statics/osirase/kaikei-saishutsugaisan6.pdf/$File/kaikei-saishutsugaisan6.pdf',
              PDF,
              { notes: 'URLに$Fileを含む。redirect・保存path変換に注意（URL文字列自体は書き換えない）' },
            ),
          ],
          { budgetJurisdiction: '国会所管', logicalAuthority: '衆議院' },
        ),
      ],
    },
    {
      publisherAuthority: '国立国会図書館',
      publisherDomain: 'ndl.go.jp',
      logicalDocuments: [
        general(
          [
            file('https://www.ndl.go.jp/jp/aboutus/outline/r06_budgetrequest.pdf', 'historically-content-confirmed', {
              role: 'detail',
              acquisitionFallbacks: [
                {
                  type: 'warp',
                  url: 'https://warp.ndl.go.jp/web/20231004165212/https://www.ndl.go.jp/jp/aboutus/outline/r06_budgetrequest.pdf',
                  verificationStatus: 'human-confirmed',
                },
              ],
              notes:
                '現行サイトの https://www.ndl.go.jp/file/aboutus/outline/finances/r06_budgetrequest.pdf はChatGPT Web検索基盤でPDF本文を確認(17頁)できたが、' +
                'ユーザーの通常ブラウザではlive 404。取得fallbackとして確認できていないため含めない。WARPの2023-10-04 snapshotに原本が保存されている。',
            }),
          ],
          { budgetJurisdiction: '国会所管', logicalAuthority: '国立国会図書館' },
        ),
      ],
    },
    {
      publisherAuthority: '裁判官訴追委員会',
      publisherDomain: 'sotsui.go.jp',
      landingPageUrl: 'https://www.sotsui.go.jp/budget/',
      logicalDocuments: [
        general([file('https://www.sotsui.go.jp/budget/images/r6budget_yokyu.pdf', PDF)], {
          budgetJurisdiction: '国会所管',
          logicalAuthority: '裁判官訴追委員会',
        }),
      ],
    },
    {
      publisherAuthority: '裁判官弾劾裁判所',
      publisherDomain: 'dangai.go.jp',
      landingPageUrl: 'https://www.dangai.go.jp/info/report.html',
      logicalDocuments: [
        general([file('https://www.dangai.go.jp/info/pdf/r06_saisyutu-gaisan.pdf', PDF)], {
          budgetJurisdiction: '国会所管',
          logicalAuthority: '裁判官弾劾裁判所',
        }),
      ],
    },
    {
      publisherAuthority: '裁判所',
      publisherDomain: 'courts.go.jp',
      logicalDocuments: [general([file('https://www.courts.go.jp/vc-files/courts/2023/R06saisyutsu_gaisanyoukyusyo_720kb.pdf', PDF)])],
    },
    {
      publisherAuthority: '会計検査院',
      publisherDomain: 'jbaudit.go.jp',
      logicalDocuments: [general([file('https://www.jbaudit.go.jp/jbaudit/bud_clo/bud/pdf/r06/20230906_02.pdf', PDF)])],
    },
    {
      publisherAuthority: '人事院',
      publisherDomain: 'jinji.go.jp',
      landingPageUrl: 'https://www.jinji.go.jp/seisaku/yosan/6yosantop.html',
      logicalDocuments: [general([file('https://www.jinji.go.jp/content/900024096.pdf', PDF)])],
    },
    {
      publisherAuthority: '公正取引委員会',
      publisherDomain: 'jftc.go.jp',
      landingPageUrl: 'https://www.jftc.go.jp/soshiki/kyotsukoukai/yosan/yosankessan/r6.html',
      logicalDocuments: [general([file('https://www.jftc.go.jp/soshiki/kyotsukoukai/yosan/yosankessan/r6/r6sandanhyou.pdf', PDF)])],
    },
    {
      publisherAuthority: '個人情報保護委員会',
      publisherDomain: 'ppc.go.jp',
      logicalDocuments: [general([file('https://www.ppc.go.jp/files/pdf/230831youkyu.pdf', PDF)])],
    },
    {
      publisherAuthority: 'カジノ管理委員会',
      publisherDomain: 'jcrc.go.jp',
      landingPageUrl: 'https://www.jcrc.go.jp/about/budget.html',
      logicalDocuments: [general([file('https://www.jcrc.go.jp/content/000001746.pdf', PDF)])],
    },
    {
      publisherAuthority: '金融庁',
      publisherDomain: 'fsa.go.jp',
      landingPageUrl: 'https://www.fsa.go.jp/common/budget/yosan/6youkyuu-2.html',
      logicalDocuments: [
        general([file('https://www.fsa.go.jp/common/budget/yosan/6youkyuu-2/01.pdf', PDF, { role: 'full', notes: '全体版（77頁）。分割版は取得対象にしない' })]),
      ],
    },
    {
      publisherAuthority: '消費者庁',
      publisherDomain: 'caa.go.jp',
      landingPageUrl: 'https://www.caa.go.jp/policies/budget/',
      logicalDocuments: [
        general([file('https://www.caa.go.jp/policies/budget/assets/cms_caa205_230914_03.pdf', PDF)]),
        special(RECON, [file('https://www.caa.go.jp/policies/budget/assets/cms_caa205_230914_02.pdf', URL_ONLY)], { relatedAuthority: '消費者庁' }),
      ],
    },
    {
      publisherAuthority: '内閣法制局',
      publisherDomain: 'clb.go.jp',
      landingPageUrl: 'https://www.clb.go.jp/policy/budget/detail/id=4473',
      logicalDocuments: [general([file('https://www.clb.go.jp/files/topics/4473_ext_05_1.pdf', PDF)])],
    },
    {
      publisherAuthority: '内閣府',
      publisherDomain: 'cao.go.jp',
      landingPageUrl: 'https://www.cao.go.jp/yosan/soshiki/r06/yosangaisan_r6.html',
      notes: 'registryでは内閣府(内閣本府)と表記が分かれる。titleに原表記を保持',
      logicalDocuments: [
        general(
          [
            file('https://www.cao.go.jp/yosan/soshiki/r06/pdf/0.pdf', PDF, { role: 'cover-summary', title: '令和6年度歳出概算要求額総表' }),
            file('https://www.cao.go.jp/yosan/soshiki/r06/pdf/1.pdf', PDF, { role: 'detail-naikaku-honfu', title: '令和6年度歳出概算要求額明細表（内閣本府）' }),
          ],
          {
            logicalAuthority: '内閣府',
            coverage: 'known-confirmed-files-only',
            notes: 'researchによれば0.pdf〜50.pdf程度の部局別分割。確認済みの2本のみ。2.pdf以降は推測せず未収録',
          },
        ),
        special(ENERGY, [file('https://www.cao.go.jp/yosan/soshiki/r06/pdf/e2.pdf', URL_ONLY, { title: '電源開発促進勘定 全体版' })], {
          subAccounts: ['電源開発促進勘定'],
        }),
        special(
          RECON,
          [
            file('https://www.cao.go.jp/yosan/soshiki/r06/pdf/f1.pdf', URL_ONLY, { role: 'cover-summary', title: '表紙及び総表' }),
            file('https://www.cao.go.jp/yosan/soshiki/r06/pdf/f2.pdf', URL_ONLY, { role: 'detail', title: '明細' }),
          ],
          { relatedAuthority: '内閣府' },
        ),
      ],
    },
    {
      publisherAuthority: '内閣官房',
      publisherDomain: 'cas.go.jp',
      landingPageUrl: 'https://www.cas.go.jp/jp/yosan/gaisan_youkyuu_r6.html',
      notes: 'registry(fifth pass)で確認済みのr6_01〜r6_17のみ。r6_yosan_gaisan.pdf(概要)は対象外',
      logicalDocuments: [
        general([
          cas('01', '令和6年度歳出概算要求書', 'cover'),
          cas('02', '（１）令和６年度歳出概算要求額明細表（総務課）', 'detail-02'),
          cas('03', '（２）令和６年度歳出概算要求額明細表（会計課）', 'detail-03'),
          cas('04', '（３）令和６年度歳出概算要求額明細表（官邸事務所）', 'detail-04'),
          cas('05', '（４）令和６年度歳出概算要求額明細表（厚生管理官室）', 'detail-05'),
          cas('06', '（５）令和６年度歳出概算要求額明細表（内閣官房・人に伴う経費）', 'detail-06'),
          ...['07', '08', '09', '10', '11', '12', '13', '14', '15'].map(nn => cas(nn, '令和６年度歳出概算要求額明細表', `detail-${nn}`)),
        ]),
        special(
          RECON,
          [
            cas('16', '令和６年度歳出概算要求書（東日本大震災復興特別会計）', 'cover'),
            cas('17', '令和６年度歳出概算要求額明細表（東日本大震災復興特別会計）', 'detail'),
          ],
          { relatedAuthority: '内閣官房' },
        ),
      ],
    },
    {
      publisherAuthority: '復興庁',
      publisherDomain: 'reconstruction.go.jp',
      logicalDocuments: [
        special(RECON, [file('https://www.reconstruction.go.jp/files/user/topics/2023_fukkochougaisansaisyutsu.pdf', PDF)], {
          budgetJurisdiction: '復興庁',
          logicalAuthority: '復興庁',
          documentScope: 'aggregate',
          notes: '復興特会のcanonical aggregate。復興特会は所管・関連府省・publisherを同一視しない',
        }),
      ],
    },
    {
      publisherAuthority: '文部科学省',
      publisherDomain: 'mext.go.jp',
      landingPageUrl: 'https://www.mext.go.jp/a_menu/yosan/r01/1420955_00005.htm',
      logicalDocuments: [
        general([
          file('https://www.mext.go.jp/content/20230914-mxt_kaikesou01-000031817_01.pdf', URL_ONLY, { role: 'cover-toc', title: '表紙・目次' }),
          file('https://www.mext.go.jp/content/20230914-mxt_kaikesou01-000031817_02.pdf', URL_ONLY, { role: 'table-1-summary', title: '第1表 概算要求額総表' }),
          file('https://www.mext.go.jp/content/20230914-mxt_kaikesou01-000031817_03.pdf', PDF, { role: 'table-2-detail', title: '第2表 概算要求額明細表' }),
          file('https://www.mext.go.jp/content/20230914-mxt_kaikesou01-000031817_04.pdf', URL_ONLY, { role: 'table-3-staffing', title: '第3表 概算要求定員表' }),
        ]),
      ],
    },
    {
      publisherAuthority: '宮内庁',
      publisherDomain: 'kunaicho.go.jp',
      notes: '皇室費と宮内庁は同一domain・同一landingだが別PDF。予算上の論理区分をlogicalAuthorityで保持',
      logicalDocuments: [
        general([file('https://www.kunaicho.go.jp/kunaicho/kunaicho/pdf/r06-02.pdf', PDF, { title: '令和6年度概算要求書（皇室費）' })], {
          logicalAuthority: '皇室費',
        }),
        general([file('https://www.kunaicho.go.jp/kunaicho/kunaicho/pdf/r06-03.pdf', PDF, { title: '令和6年度概算要求書（宮内庁費）' })], {
          logicalAuthority: '宮内庁',
        }),
      ],
    },
  ],
};
