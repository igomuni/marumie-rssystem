/**
 * FY2025（令和7年度）概算要求 取得manifest（候補の初版）。
 *
 * 出典: 財務省「令和７年度予算 各府省の概算要求書…公開ページへのリンク先一覧」の29リンクを起点に、
 * 各掲載ページに実際に現れたPDFリンクだけを拾った（URLは推測していない。Orca worker 4体が独立に調査し、
 * HTTP状態・Content-Type・先頭bytes(%%PDF)・頁数を確認）。生成物は評価に使っていない（X anchorは未評価）。
 *
 * verificationStatus: pdf-confirmed = 先頭bytesが%%PDFのPDFであることを調査時に確認（本文の内容までは未確認）/
 *   url-confirmed = 掲載ページ上のURLまで（調査時にbot遮断等でPDF応答を確認できず、acquisitionPolicy=manual-required）。
 *
 * FY2024にあって、FY2025の掲載ページで確認できていないもの（欠落として残す。後から都合よく足さない）:
 *   - 衆議院（概要のみで歳出概算要求書なし）、参議院（掲載ページ404）、内閣官房（掲載ページ404）
 *   - こども家庭庁の年金特別会計、法務省の復興特別会計
 * jcrc.go.jp はMOF一覧の「カジノ管理委員会」のリンク（publisherAuthority修正済み。調査依頼文の「公害等調整委員会」は依頼側の誤記）。
 * 総務省の特別会計リンクは、PDF本文（22頁）の表題「9502 交付税及び譲与税配付金特別会計」で会計を確認済み。
 */
import type {
  BudgetRequestFile,
  BudgetRequestManifest,
  VerificationStatus,
} from "./budget-request-manifest";

type Extra = Partial<Omit<BudgetRequestFile, "url" | "verificationStatus">>;
const file = (
  url: string,
  verificationStatus: VerificationStatus,
  extra: Extra = {},
): BudgetRequestFile => ({
  ...extra,
  url,
  verificationStatus,
});

export const FY2025_BUDGET_REQUEST_MANIFEST: BudgetRequestManifest = {
  fiscalYear: 2025,
  sources: [
    {
      publisherAuthority: "国立国会図書館",
      publisherDomain: "ndl.go.jp",
      landingPageUrl: "https://www.ndl.go.jp/jp/aboutus/outline/finances.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          logicalAuthority: "国立国会図書館",
          files: [
            file(
              "https://www.ndl.go.jp/file/aboutus/outline/finances/r07_budgetrequest.pdf",
              "pdf-confirmed",
              { title: "令和7年度（PDF: 306KB）", notes: "17頁" },
            ),
          ],
        },
      ],
      notes:
        "MOF FY2025掲載ページからリンクされた公式掲載ページ。 / 曖昧: 同一ページに令和7年度「概算要求の概要」（168KB）もあるが、対象の概算要求書とは別資料のため除外。",
    },
    {
      publisherAuthority: "裁判所",
      publisherDomain: "courts.go.jp",
      landingPageUrl:
        "https://www.courts.go.jp/about/yosan_kessan/07yosan/index.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.courts.go.jp/vc-files/courts/2024/R07saisyutsu_gaisanyoukyusyo_527kb.pdf",
              "pdf-confirmed",
              {
                title: "令和7年度 一般会計歳出概算要求書等(PDF:527KB)",
                notes: "120頁",
              },
            ),
          ],
        },
      ],
      notes:
        "MOF FY2025掲載ページからリンクされた公式掲載ページ。 / 曖昧: 同ページの「令和7年度概算要求の概要」「歳入予算概算見積書」は対象外として除外。",
    },
    {
      publisherAuthority: "会計検査院",
      publisherDomain: "jbaudit.go.jp",
      landingPageUrl: "https://www.jbaudit.go.jp/jbaudit/bud_clo/bud/07.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.jbaudit.go.jp/jbaudit/bud_clo/bud/pdf/r07/20240904_02.pdf",
              "pdf-confirmed",
              { title: "令和7年度歳出概算要求書", notes: "33頁" },
            ),
          ],
        },
      ],
      notes:
        "MOF FY2025掲載ページからリンクされた公式掲載ページ。 / 曖昧: 同ページの歳入概算見積書・概要説明・要望一覧は対象外として除外。",
    },
    {
      publisherAuthority: "内閣法制局",
      publisherDomain: "clb.go.jp",
      landingPageUrl: "https://www.clb.go.jp/policy/budget/",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.clb.go.jp/files/topics/4742_ext_05_0.pdf",
              "pdf-confirmed",
              { title: "概算要求書（PDF形式/105 KB）", notes: "27頁" },
            ),
          ],
        },
      ],
      notes: "MOF FY2025掲載ページからリンクされた公式掲載ページ。",
    },
    {
      publisherAuthority: "人事院",
      publisherDomain: "jinji.go.jp",
      landingPageUrl: "https://www.jinji.go.jp/seisaku/yosan/7yosantop.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.jinji.go.jp/content/000012445.pdf",
              "pdf-confirmed",
              { title: "令和７年度歳出概算要求書", notes: "96頁" },
            ),
          ],
        },
      ],
      notes:
        "MOF FY2025掲載ページからリンクされた公式掲載ページ。 / 曖昧: 「予算概算要求・要望の概要」「重要政策推進枠要望一覧」「政策評価調書」等は対象外として除外。",
    },
    {
      publisherAuthority: "内閣府",
      publisherDomain: "cao.go.jp",
      landingPageUrl: "https://www.cao.go.jp/yosan/yosan.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          logicalAuthority: "内閣府",
          files: [
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/0.pdf",
              "pdf-confirmed",
              { role: "cover-summary", title: "表紙及び総表", notes: "25頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/1.pdf",
              "pdf-confirmed",
              { role: "detail-1", title: "官房総務課", notes: "2頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/2.pdf",
              "pdf-confirmed",
              {
                role: "detail-2",
                title: "みどりの学術賞及び式典担当室",
                notes: "1頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/3.pdf",
              "pdf-confirmed",
              { role: "detail-3", title: "官房人事課", notes: "2頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/4.pdf",
              "pdf-confirmed",
              { role: "detail-4", title: "官房会計課", notes: "13頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/5.pdf",
              "pdf-confirmed",
              { role: "detail-5", title: "企画調整課", notes: "6頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/6.pdf",
              "pdf-confirmed",
              { role: "detail-6", title: "企画調整課 国際室", notes: "1頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/7.pdf",
              "pdf-confirmed",
              {
                role: "detail-7",
                title: "野口英世アフリカ賞担当室",
                notes: "2頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/8.pdf",
              "pdf-confirmed",
              {
                role: "detail-8",
                title: "拉致被害者等支援担当室",
                notes: "1頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/9.pdf",
              "pdf-confirmed",
              { role: "detail-9", title: "政策評価広報課", notes: "1頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/10.pdf",
              "pdf-confirmed",
              { role: "detail-10", title: "公文書管理課", notes: "3頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/11.pdf",
              "pdf-confirmed",
              { role: "detail-11", title: "政府広報室", notes: "3頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/12.pdf",
              "pdf-confirmed",
              { role: "detail-12", title: "厚生管理官室", notes: "1頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/13.pdf",
              "pdf-confirmed",
              {
                role: "detail-13",
                title: "サイバーセキュリティ・情報化推進室",
                notes: "3頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/14.pdf",
              "pdf-confirmed",
              { role: "detail-14", title: "アイヌ施策推進室", notes: "1頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/15.pdf",
              "pdf-confirmed",
              {
                role: "detail-15",
                title: "孤独・孤立対策推進室",
                notes: "2頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/16.pdf",
              "pdf-confirmed",
              { role: "detail-16", title: "大臣官房（人件費）", notes: "7頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/17.pdf",
              "pdf-confirmed",
              {
                role: "detail-17",
                title: "政策統括官（経済財政運営担当）",
                notes: "8頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/18.pdf",
              "pdf-confirmed",
              { role: "detail-18", title: "地方分権改革推進室", notes: "1頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/19.pdf",
              "pdf-confirmed",
              {
                role: "detail-19",
                title: "地域経済活性化支援機構担当室",
                notes: "1頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/20.pdf",
              "pdf-confirmed",
              {
                role: "detail-20",
                title: "政策統括官（経済社会システム担当）",
                notes: "9頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/21.pdf",
              "pdf-confirmed",
              {
                role: "detail-21",
                title: "政策統括官（経済財政分析担当）",
                notes: "5頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/22.pdf",
              "pdf-confirmed",
              { role: "detail-22", title: "地方創生推進室", notes: "11頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/23.pdf",
              "pdf-confirmed",
              {
                role: "detail-23",
                title: "政策統括官（防災担当）",
                notes: "11頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/24.pdf",
              "pdf-confirmed",
              {
                role: "detail-24",
                title: "政策統括官（原子力防災担当）",
                notes: "2頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/25.pdf",
              "pdf-confirmed",
              {
                role: "detail-25",
                title: "政策統括官（沖縄政策担当）",
                notes: "15頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/26.pdf",
              "pdf-confirmed",
              {
                role: "detail-26",
                title: "政策統括官（共生・共助担当）",
                notes: "11頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/27.pdf",
              "pdf-confirmed",
              {
                role: "detail-27",
                title: "遺棄化学兵器処理担当室",
                notes: "2頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/28.pdf",
              "pdf-confirmed",
              {
                role: "detail-28",
                title: "政策統括官（重要土地担当）",
                notes: "2頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/29.pdf",
              "pdf-confirmed",
              {
                role: "detail-29",
                title: "政策統括官（経済安全保障担当）",
                notes: "2頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/30.pdf",
              "pdf-confirmed",
              { role: "detail-30", title: "情報保全監察室", notes: "1頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/31.pdf",
              "pdf-confirmed",
              { role: "detail-31", title: "公文書監察室", notes: "1頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/32.pdf",
              "pdf-confirmed",
              { role: "detail-32", title: "賞勲局", notes: "2頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/33.pdf",
              "pdf-confirmed",
              { role: "detail-33", title: "男女共同参画局", notes: "7頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/34.pdf",
              "pdf-confirmed",
              { role: "detail-34", title: "沖縄振興局", notes: "51頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/35.pdf",
              "pdf-confirmed",
              {
                role: "detail-35",
                title: "食品安全委員会事務局",
                notes: "3頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/36.pdf",
              "pdf-confirmed",
              {
                role: "detail-36",
                title: "公益認定等委員会事務局",
                notes: "2頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/37.pdf",
              "pdf-confirmed",
              {
                role: "detail-37",
                title: "再就職等監視委員会事務局",
                notes: "1頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/38.pdf",
              "pdf-confirmed",
              { role: "detail-38", title: "消費者委員会事務局", notes: "1頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/39.pdf",
              "pdf-confirmed",
              { role: "detail-39", title: "経済社会総合研究所", notes: "13頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/40.pdf",
              "pdf-confirmed",
              { role: "detail-40", title: "迎賓館", notes: "5頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/41.pdf",
              "pdf-confirmed",
              { role: "detail-41", title: "地方創生推進事務局", notes: "19頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/42.pdf",
              "pdf-confirmed",
              {
                role: "detail-42",
                title: "知的財産戦略推進事務局",
                notes: "2頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/43.pdf",
              "pdf-confirmed",
              {
                role: "detail-43",
                title: "科学技術・イノベーション推進事務局",
                notes: "12頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/44.pdf",
              "pdf-confirmed",
              {
                role: "detail-44",
                title: "健康・医療戦略推進事務局",
                notes: "3頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/45.pdf",
              "pdf-confirmed",
              {
                role: "detail-45",
                title: "宇宙開発戦略推進事務局",
                notes: "7頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/46.pdf",
              "pdf-confirmed",
              { role: "detail-46", title: "北方対策本部", notes: "5頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/47.pdf",
              "pdf-confirmed",
              {
                role: "detail-47",
                title: "総合海洋政策推進事務局",
                notes: "3頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/48.pdf",
              "pdf-confirmed",
              { role: "detail-48", title: "国際平和協力本部", notes: "10頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/49.pdf",
              "pdf-confirmed",
              {
                role: "detail-49",
                title: "官民人材交流センター",
                notes: "3頁",
              },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/50.pdf",
              "pdf-confirmed",
              { role: "detail-50", title: "沖縄総合事務局", notes: "16頁" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "エネルギー対策特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/e1.pdf",
              "pdf-confirmed",
              { role: "cover-summary", title: "表紙及び総表", notes: "3頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/e2.pdf",
              "pdf-confirmed",
              { title: "全体版", notes: "19頁" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "東日本大震災復興特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/f1.pdf",
              "pdf-confirmed",
              { role: "cover-summary", title: "表紙及び総表", notes: "2頁" },
            ),
            file(
              "https://www.cao.go.jp/yosan/soshiki/r07/pdf/f2.pdf",
              "pdf-confirmed",
              { title: "概算要求書", notes: "5頁" },
            ),
          ],
        },
      ],
      notes:
        "MOF一覧の内閣府トップからFY2025予算ページをたどり、「概算要求書（歳出概算要求書）」の令和7年度掲載ページを確認。一般会計51本（表紙及び総表、部局別50本）と、エネルギー対策特別会計2本、復興特別会計2本のリンクがある。",
    },
    {
      publisherAuthority: "宮内庁",
      publisherDomain: "kunaicho.go.jp",
      landingPageUrl:
        "https://www.kunaicho.go.jp/kunaicho/kunaicho/gaisanyokyu.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          logicalAuthority: "皇室費",
          files: [
            file(
              "https://www.kunaicho.go.jp/kunaicho/kunaicho/pdf/r07-02.pdf",
              "pdf-confirmed",
              {
                title:
                  "令和7年度概算要求書（皇室費）（PDF形式：ページ表記）（PDF形式：83KB）",
                notes: "33頁",
              },
            ),
          ],
        },
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          logicalAuthority: "宮内庁",
          files: [
            file(
              "https://www.kunaicho.go.jp/kunaicho/kunaicho/pdf/r07-03.pdf",
              "pdf-confirmed",
              {
                title:
                  "令和7年度概算要求書（宮内庁費）（PDF形式：ページ表記）（PDF形式：308KB）",
                notes: "20頁",
              },
            ),
          ],
        },
      ],
      notes:
        "同一ページに皇室費と宮内庁費の別PDFが掲載されているため、FY2024 manifest同様に別logical documentとして記録。FY2025「概算要求の概要」「要望一覧」「政府案の概要」は対象外。",
    },
    {
      publisherAuthority: "財務省",
      publisherDomain: "mof.go.jp",
      landingPageUrl:
        "https://www.mof.go.jp/about_mof/mof_budget/budget/fy2025/20240913.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.mof.go.jp/about_mof/mof_budget/budget/fy2025/2025ippan_2.pdf",
              "pdf-confirmed",
              { title: "歳出(PDF:805KB)", notes: "291頁" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "地震再保険特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.mof.go.jp/about_mof/mof_budget/budget/fy2025/2025jisinn_2.pdf",
              "pdf-confirmed",
              { title: "歳出(PDF:59KB)", notes: "9頁" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "国債整理基金特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.mof.go.jp/about_mof/mof_budget/budget/fy2025/2025kokusaiseirikikinn_2.pdf",
              "pdf-confirmed",
              { title: "歳出(PDF:23KB)", notes: "9頁" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "外国為替資金特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.mof.go.jp/about_mof/mof_budget/budget/fy2025/2025gaitame_2.pdf",
              "pdf-confirmed",
              { title: "歳出(PDF:80KB)", notes: "18頁" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "財政投融資特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.mof.go.jp/about_mof/mof_budget/budget/fy2025/2025zaiyuu_2.pdf",
              "pdf-confirmed",
              { title: "歳出(PDF:89KB)", notes: "18頁" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "財政投融資特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.mof.go.jp/about_mof/mof_budget/budget/fy2025/2025tousi_2.pdf",
              "pdf-confirmed",
              { title: "歳出(PDF:72KB)", notes: "11頁" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "財政投融資特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.mof.go.jp/about_mof/mof_budget/budget/fy2025/2025tokuzai_2.pdf",
              "pdf-confirmed",
              { title: "歳出(PDF:14KB)", notes: "6頁" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "東日本大震災復興特別会計",
          documentType: "budget-request-expenditure",
          logicalAuthority: "財務省",
          files: [
            file(
              "https://www.mof.go.jp/about_mof/mof_budget/budget/fy2025/2025fukkou_2.pdf",
              "pdf-confirmed",
              { title: "歳出(PDF:12KB)", notes: "5頁" },
            ),
          ],
        },
      ],
      notes:
        "指定起点の財務省FY2025ページから、同省の「概算要求書及び要望一覧」ページへ遷移。ページ上で歳出の各リンクを確認。要望一覧および歳入PDFは除外。",
    },
    {
      publisherAuthority: "公正取引委員会",
      publisherDomain: "jftc.go.jp",
      landingPageUrl:
        "https://www.jftc.go.jp/soshiki/kyotsukoukai/yosan/yosankessan/r7.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.jftc.go.jp/soshiki/kyotsukoukai/yosan/yosankessan/r7/r7sandanhyou.pdf",
              "url-confirmed",
              {
                title: "令和7年度歳出概算要求書(164 KB)",
                acquisitionPolicy: "manual-required",
                notes:
                  "調査時blocked: 公式掲載ページの検索表示にリンク文言・URLあり。curl -sIはHTTP 403、curl -s -r 0-7の先頭はHTML。ページ数・PDFタイトル未取得。manual-required候補。",
              },
            ),
          ],
        },
      ],
      notes:
        "通常のHTTP取得は403。公式サイトの検索表示でページ見出し「令和7年度」とリンク文言「令和7年度歳出概算要求書(164 KB)」およびPDF URLを確認。PDFへのcurl HEAD/rangeも403。FY2024 manifestの同publisherはpdf-confirmedでmanual-requiredではない。FY2025候補はacquisitionPolicy manual-required相当。 / 曖昧: 掲載ページ本文とPDF本文は403のため直接確認できず、公式サイト検索表示をリンク証跡とした。 / 掲載ページ HTTP 403（調査時）",
    },
    {
      publisherAuthority: "警察庁",
      publisherDomain: "npa.go.jp",
      landingPageUrl:
        "https://www.npa.go.jp/policies/budget/r7/gaisanyokyu/index.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.npa.go.jp/policies/budget/r7/gaisanyokyu/ippankaikei.pdf",
              "pdf-confirmed",
              {
                title: "Ⅱ 令和７年度歳出概算要求書（一般会計）（394KB）",
                notes: "114頁",
              },
            ),
          ],
        },
        {
          accountType: "special",
          account: "東日本大震災復興特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.npa.go.jp/policies/budget/r7/gaisanyokyu/hukkoutokubetukikei.pdf",
              "pdf-confirmed",
              {
                title:
                  "Ⅲ 令和７年度歳出概算要求書（東日本大震災復興特別会計）（15KB）",
                notes: "9頁",
              },
            ),
          ],
        },
      ],
      notes:
        "ページ本文のFY2025リンクを確認。概要・要望一覧・政策評価調書は対象外。",
    },
    {
      publisherAuthority: "個人情報保護委員会",
      publisherDomain: "ppc.go.jp",
      landingPageUrl: "https://www.ppc.go.jp/aboutus/budget/budget_R7/",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.ppc.go.jp/files/pdf/240830youkyu.pdf",
              "pdf-confirmed",
              { title: "概算要求書 (PDF : 165KB)", notes: "29頁" },
            ),
          ],
        },
      ],
      notes:
        "ページ本文の「概算要求書」リンクを確認。概要、重点施策、要望一覧、政策評価調書は対象外。 / 曖昧: PDFリンクのページ上表記は年度を含まない「概算要求書」。令和7年度予算関連資料の並びにあるためFY2025として採用。",
    },
    {
      publisherAuthority: "カジノ管理委員会",
      publisherDomain: "jcrc.go.jp",
      landingPageUrl: "https://www.jcrc.go.jp/about/budget.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.jcrc.go.jp/content/000002243.pdf",
              "pdf-confirmed",
              {
                title: "令和７年度歳出概算要求書（PDF形式：87KB）",
                notes: "17頁",
              },
            ),
          ],
        },
      ],
      notes:
        "FY2025欄の「歳出概算要求書」リンクを確認。概要、要望一覧、政策評価調書は対象外。 / 補足: 調査依頼でpublisherを公害等調整委員会と誤記していた。MOF一覧のリンク名・FY2024 manifestとも「カジノ管理委員会」。",
    },
    {
      publisherAuthority: "金融庁",
      publisherDomain: "fsa.go.jp",
      landingPageUrl:
        "https://www.fsa.go.jp/common/budget/yosan/7youkyuu-2.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.fsa.go.jp/common/budget/yosan/7youkyuu-2/01.pdf",
              "pdf-confirmed",
              { title: "全体版（PDF：338KB）", notes: "74頁" },
            ),
          ],
        },
      ],
      notes:
        "MOFリンクの7youkyuu.htmlは「令和７年度予算、機構・定員要求について」の概要PDFを掲載。金融庁の予算・決算索引が「令和７年度歳出概算要求書について」として本ページへリンクし、全体版と分割版を掲載。FY2024 manifestと同様に全体版のみ採用。",
    },
    {
      publisherAuthority: "消費者庁",
      publisherDomain: "caa.go.jp",
      landingPageUrl: "https://www.caa.go.jp/policies/budget/",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.caa.go.jp/policies/budget/assets/caa_cms205_240913_01.pdf",
              "pdf-confirmed",
              {
                title: "令和7年度概算要求一般会計概算要求書 [PDF:388KB]",
                notes: "211頁",
              },
            ),
          ],
        },
        {
          accountType: "special",
          account: "東日本大震災復興特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.caa.go.jp/policies/budget/assets/caa_cms205_240913_02.pdf",
              "pdf-confirmed",
              {
                title: "令和7年度概算要求復興特別会計概算要求書 [PDF:19KB]",
                notes: "9頁",
              },
            ),
          ],
        },
      ],
      notes:
        "年度別リンク一覧から令和7年度一般会計・復興特別会計概算要求書を確認。要望一覧、政策評価調書、概要、予算案・補正は対象外。",
    },
    {
      publisherAuthority: "こども家庭庁",
      publisherDomain: "cfa.go.jp",
      landingPageUrl: "https://www.cfa.go.jp/policies/budget",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/d8acbb82/20240830_policies_budget_28.pdf",
              "pdf-confirmed",
              {
                title: "資料7 令和7年度一般会計歳出概算要求書（PDF／281KB）",
                notes: "150頁",
              },
            ),
          ],
        },
        {
          accountType: "special",
          account: "子ども・子育て支援特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.cfa.go.jp/assets/contents/node/basic_page/field_ref_resources/88749a20-e454-4a5b-9da8-3a32e1788a23/4cd52078/20240830_policies_budget_31.pdf",
              "pdf-confirmed",
              {
                title:
                  "資料10 令和7年度子ども・子育て支援特別会計（子ども・子育て支援勘定、育児休業等給付勘定）歳出概算要求書（PDF／101KB）",
                notes: "48頁",
              },
            ),
          ],
        },
      ],
      notes:
        "ページ内の資料7一般会計・資料10子ども・子育て支援特別会計の令和7年度歳出概算要求書を確認。 / 未確認: FY2024 manifestにある年金特別会計（子ども・子育て支援勘定）は、FY2025の掲載ページ内で歳出概算要求書を確認できず。ページ上で確認した該当資料は一般会計（資料7）と子ども・子育て支援特別会計（資料10）のみ。 / 曖昧: FY2024の年金特別会計とFY2025の子ども・子育て支援特別会計の関係は別制度会計である可能性があり、年度間の対応付けは行わず未対応として記録。",
    },
    {
      publisherAuthority: "デジタル庁",
      publisherDomain: "digital.go.jp",
      landingPageUrl: "https://www.digital.go.jp/budget/r7request",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.digital.go.jp/assets/contents/node/basic_page/field_ref_resources/7e109e66-b39c-40c5-a788-cab2cad79f95/d3e6a9cd/20240913_policies_budget_r7request_table_01.pdf",
              "pdf-confirmed",
              { title: "歳出（PDF／68KB）", notes: "32頁" },
            ),
          ],
        },
      ],
      notes:
        "MOFリンク先の予算ページから「概算要求書」ページへ進み、歳出・歳入等の実リンクを確認。歳出PDFのみ対象。概要と政策評価調書は対象外。",
    },
    {
      publisherAuthority: "復興庁",
      publisherDomain: "reconstruction.go.jp",
      landingPageUrl:
        "https://www.reconstruction.go.jp/topics/cat-55/cat-57/cat-58/post-72/",
      logicalDocuments: [
        {
          accountType: "special",
          account: "東日本大震災復興特別会計",
          documentType: "budget-request-expenditure",
          logicalAuthority: "復興庁",
          files: [
            file(
              "https://www.reconstruction.go.jp/files/user/topics/2024_fukkochougaisansaisyutsu.pdf",
              "pdf-confirmed",
              { title: "令和７年度歳出概算要求書", notes: "98頁" },
            ),
          ],
        },
      ],
      notes:
        "MOF掲載URL https://www.reconstruction.go.jp/topics/post-72.html から現行掲載ページへ遷移。FY2025歳出概算要求書のリンクを確認。",
    },
    {
      publisherAuthority: "総務省",
      publisherDomain: "soumu.go.jp",
      landingPageUrl: "https://www.soumu.go.jp/menu_yosan/yosan_R07.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.soumu.go.jp/main_content/000967291.pdf",
              "pdf-confirmed",
              { title: "令和7年度歳出予算概算要求書（一般会計）" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "交付税及び譲与税配付金特別会計",
          documentType: "budget-request-expenditure",
          notes:
            "総務省の掲載リンク名は単に「特別会計」。会計はPDF本文の表題「9502 交付税及び譲与税配付金特別会計」で確認済み（anchor textで会計を分類しない）",
          files: [
            file(
              "https://www.soumu.go.jp/main_content/000967302.pdf",
              "pdf-confirmed",
              { title: "令和7年度歳出予算概算要求書（特別会計）" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "東日本大震災復興特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.soumu.go.jp/main_content/000967305.pdf",
              "pdf-confirmed",
              {
                title:
                  "令和7年度歳出予算概算要求書（東日本大震災復興特別会計）",
              },
            ),
          ],
        },
      ],
      notes:
        "MOFリンク20（総務省、https://www.soumu.go.jp/menu_yosan/yosan.html#r7）から到達した令和7年度概算要求書ページ。掲載HTMLをShift_JISとして確認。特別会計のリンク見出しは会計名を特定せず『特別会計』のため、PDF本文の表題で交付税及び譲与税配付金特別会計と確認。 / 確認: 特別会計リンクのPDF本文（22頁）の表題が「9502 交付税及び譲与税配付金特別会計」であることを確認した。",
    },
    {
      publisherAuthority: "法務省",
      publisherDomain: "moj.go.jp",
      landingPageUrl: "https://www.moj.go.jp/kaikei/bunsho/kaikei02_00138.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.moj.go.jp/content/001424470.pdf",
              "pdf-confirmed",
              { title: "歳出" },
            ),
          ],
        },
      ],
      notes:
        "MOFリンク21の法務省ページ（kaikei02_00137.html）から『概算要求書』へ進んだ掲載ページ。掲載ページには歳入・歳出リンクが各1件。 / 未確認: FY2024 manifestにある法務省所管の東日本大震災復興特別会計（001402819.pdf）に対応するFY2025歳出要求書リンクは、法務省の掲載ページ kaikei02_00137.html とそこから進んだ kaikei02_00138.html の掲載内容（歳入・歳出各1リンク）で確認できなかった。 / 曖昧: 掲載ページの歳出リンク名に会計名がない。一般会計として記録し、FY2024にあった復興特会の別リンクは掲載ページで確認できなかったものとしている。PDF本文は調査対象外。",
    },
    {
      publisherAuthority: "外務省",
      publisherDomain: "mofa.go.jp",
      landingPageUrl:
        "https://www.mofa.go.jp/mofaj/annai/yosan_kessan/mofa_yosan_kessan/index.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.mofa.go.jp/mofaj/files/100718578.pdf",
              "url-confirmed",
              {
                title: "令和7年度歳出概算要求書（PDF）",
                acquisitionPolicy: "manual-required",
                notes:
                  "調査時blocked: 公式掲載ページでリンク文言『令和7年度歳出概算要求書（PDF）』とURLを確認。PDFのHEAD/Range取得はHTTP 403でContent-Type・%PDF先頭bytes・ページ数を確認できず。acquisitionPolicy: manual-required 候補。FY2024 manifestの外務省一般会計にはmanual-required指定なし（allowPlaywrightFallback true、取得環境でAkamaiブロックの注記あり）。",
              },
            ),
          ],
        },
      ],
      notes:
        "MOFリンク22の公式ページ。ブラウザ表示で令和7年度『概算要求』欄に『令和7年度歳出概算要求書（PDF）』リンクを確認。ローカルHTTPアクセスでは掲載ページ自体が403となったが、公式ページのブラウザ表示・リンクを確認した。 / 曖昧: 掲載ページはブラウザ表示で確認できた一方、作業環境からはページ・PDFのHTTP取得が遮断されたため、PDF実体とPDF応答ヘッダーは未検証。",
    },
    {
      publisherAuthority: "文部科学省",
      publisherDomain: "mext.go.jp",
      landingPageUrl:
        "https://www.mext.go.jp/a_menu/yosan/r01/1420955_00006.htm",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.mext.go.jp/content/20240911-mxt_kaikesou01-000038011_1.pdf",
              "pdf-confirmed",
              { role: "cover", title: "表紙・目次", notes: "6頁" },
            ),
            file(
              "https://www.mext.go.jp/content/20240911-mxt_kaikesou01-000038011_2.pdf",
              "pdf-confirmed",
              { role: "table1", title: "第1表 概算要求額総表", notes: "8頁" },
            ),
            file(
              "https://www.mext.go.jp/content/20240911-mxt_kaikesou01-000038011_3.pdf",
              "pdf-confirmed",
              { role: "table2", title: "第2表 概算要求額明細表" },
            ),
            file(
              "https://www.mext.go.jp/content/20240911-mxt_kaikesou01-000038011_4.pdf",
              "pdf-confirmed",
              { role: "table3", title: "第3表 概算要求定員表", notes: "5頁" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "エネルギー対策特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.mext.go.jp/content/20240911-mxt_kaikesou01-000038011_9.pdf",
              "pdf-confirmed",
              { title: "歳出概算要求書", notes: "25頁" },
            ),
          ],
        },
      ],
      notes:
        "MOFリンク23の文科省FY2025ページから『令和7年度 概算要求書』へ到達した掲載ページ。『一般会計／令和7年度 歳出予算概算要求書』に表紙・目次、第1表、第2表、第3表の4PDF、『エネルギー対策特別会計』に歳出概算要求書PDFを掲載。",
    },
    {
      publisherAuthority: "厚生労働省",
      publisherDomain: "mhlw.go.jp",
      landingPageUrl: "https://www.mhlw.go.jp/wp/yosan/yosan/25syokan/05.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.mhlw.go.jp/wp/yosan/yosan/25syokan/dl/05-1b-01.pdf",
              "pdf-confirmed",
              { title: "歳出" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "労働保険特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.mhlw.go.jp/wp/yosan/yosan/25syokan/dl/05-2b-01.pdf",
              "pdf-confirmed",
              { title: "歳出" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "年金特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.mhlw.go.jp/wp/yosan/yosan/25syokan/dl/05-3b-01.pdf",
              "pdf-confirmed",
              { title: "歳出" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "子ども・子育て支援特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.mhlw.go.jp/wp/yosan/yosan/25syokan/dl/05-4b-01.pdf",
              "pdf-confirmed",
              { title: "歳出" },
            ),
          ],
        },
      ],
      notes:
        "MOFリンク24の令和7年度厚生労働省所管概算要求関係ページから『「概算要求書」及び「政策評価調書」』へ進んだページ。令和7年度概算要求書の会計別欄から歳出PDFのみ選定し、同ページにある歳入PDF・政策評価調書・別ページの説明資料は除外。",
    },
    {
      publisherAuthority: "農林水産省",
      publisherDomain: "maff.go.jp",
      landingPageUrl: "https://www.maff.go.jp/j/budget/240902.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.maff.go.jp/j/budget/attach/pdf/240902-2.pdf",
              "pdf-confirmed",
              { title: "歳出(PDF : 947KB)", notes: "377頁" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "東日本大震災復興特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.maff.go.jp/j/budget/attach/pdf/240902-4.pdf",
              "pdf-confirmed",
              { title: "歳出(PDF : 133KB)", notes: "21頁" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "食料安定供給特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.maff.go.jp/j/budget/attach/pdf/240902-6.pdf",
              "pdf-confirmed",
              { title: "歳出(PDF : 169KB)", notes: "37頁" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "国有林野事業債務管理特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.maff.go.jp/j/budget/attach/pdf/240902-8.pdf",
              "pdf-confirmed",
              { title: "歳出(PDF : 8KB)", notes: "7頁" },
            ),
          ],
        },
      ],
      notes:
        "MOFリンク https://www.maff.go.jp/j/budget/r7yokyu.html は概要・PR資料のページ。農林水産省の令和7年度概算要求書ページで会計別の歳出リンクを確認した。各PDFはHTTP 200、Content-Type application/pdf、Range GET 206、先頭bytes %PDF。",
    },
    {
      publisherAuthority: "経済産業省",
      publisherDomain: "meti.go.jp",
      landingPageUrl:
        "https://www.meti.go.jp/main/yosangaisan/fy2025/index.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.meti.go.jp/main/yosangaisan/fy2025/pdf/ippan_o.pdf",
              "url-confirmed",
              {
                title: "歳出（PDF形式：282KB）",
                acquisitionPolicy: "manual-required",
                notes:
                  "調査時blocked: 掲載ページの一般会計欄にあるリンク文言とURLをブラウザーで確認。PDF HEAD/Range GETとも403のため未取得。FY2024 counterpartもmanual-required。",
              },
            ),
          ],
        },
        {
          accountType: "special",
          account: "エネルギー対策特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.meti.go.jp/main/yosangaisan/fy2025/pdf/eneju_o.pdf",
              "url-confirmed",
              {
                title: "歳出（PDF形式：35KB）",
                acquisitionPolicy: "manual-required",
                notes:
                  "調査時blocked: 掲載ページのエネルギー需給勘定欄にあるリンク文言とURLをブラウザーで確認。PDF HEAD/Range GETとも403のため未取得。FY2024 counterpartもmanual-required。",
              },
            ),
          ],
        },
        {
          accountType: "special",
          account: "エネルギー対策特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.meti.go.jp/main/yosangaisan/fy2025/pdf/eneden_o.pdf",
              "url-confirmed",
              {
                title: "歳出（PDF形式：56KB）",
                acquisitionPolicy: "manual-required",
                notes:
                  "調査時blocked: 掲載ページの電源開発促進勘定欄にあるリンク文言とURLをブラウザーで確認。PDF HEAD/Range GETとも403のため未取得。FY2024 counterpartもmanual-required。",
              },
            ),
          ],
        },
        {
          accountType: "special",
          account: "エネルギー対策特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.meti.go.jp/main/yosangaisan/fy2025/pdf/enegen_o.pdf",
              "url-confirmed",
              {
                title: "歳出（PDF形式：9KB）",
                acquisitionPolicy: "manual-required",
                notes:
                  "調査時blocked: 掲載ページの原子力損害賠償支援勘定欄にあるリンク文言とURLをブラウザーで確認。PDF HEAD/Range GETとも403のため未取得。FY2024 counterpartもmanual-required。",
              },
            ),
          ],
        },
        {
          accountType: "special",
          account: "特許特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.meti.go.jp/main/yosangaisan/fy2025/pdf/tokkyo_o.pdf",
              "url-confirmed",
              {
                title: "歳出（PDF形式：32KB）",
                acquisitionPolicy: "manual-required",
                notes:
                  "調査時blocked: 掲載ページの特許特別会計欄にあるリンク文言とURLをブラウザーで確認。PDF HEAD/Range GETとも403のため未取得。FY2024 counterpartもmanual-required。",
              },
            ),
          ],
        },
        {
          accountType: "special",
          account: "東日本大震災復興特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.meti.go.jp/main/yosangaisan/fy2025/pdf/fukko_o.pdf",
              "url-confirmed",
              {
                title: "歳出（PDF形式：56KB）",
                acquisitionPolicy: "manual-required",
                notes:
                  "調査時blocked: 掲載ページの東日本大震災復興特別会計欄にあるリンク文言とURLをブラウザーで確認。PDF HEAD/Range GETとも403のため未取得。FY2024 counterpartもmanual-required。",
              },
            ),
          ],
        },
      ],
      notes:
        "経済産業省の令和7年度概算要求書欄をブラウザーで確認（HTML表示200）。歳出リンクとURLを取得。FY2024 manifestでは経産省の全6対象PDFが acquisitionPolicy: manual-required。今回もPDF HEADおよびRange GETが6本とも403でContent-TypeとPDF magicを検証できず、manual-required候補としてblocked。 / 曖昧: PDF本文を確認できないため、ページ数および文書の表紙・総表・明細表の実収録範囲は未確認。掲載ページの会計別「歳出」リンクを候補として記録。",
    },
    {
      publisherAuthority: "国土交通省",
      publisherDomain: "mlit.go.jp",
      landingPageUrl: "https://www.mlit.go.jp/page/kanbo05_hy_003266.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.mlit.go.jp/page/content/001762903.pdf",
              "pdf-confirmed",
              { title: "歳出", notes: "935頁" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "自動車安全特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.mlit.go.jp/page/content/001761775.pdf",
              "pdf-confirmed",
              { title: "歳出", notes: "52頁" },
            ),
          ],
        },
        {
          accountType: "special",
          account: "東日本大震災復興特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.mlit.go.jp/page/content/001761776.pdf",
              "pdf-confirmed",
              { title: "歳出", notes: "9頁" },
            ),
          ],
        },
      ],
      notes:
        "MOFリンク https://www.mlit.go.jp/page/kanbo05_hy_003264.html は予算概算要求概要ページ。会計別の概算要求書PDFリンクは国土交通省の令和7年度概算要求書ページで確認した。各PDFはHTTP 200、Content-Type application/pdf、Range GET 206、先頭bytes %PDF。",
    },
    {
      publisherAuthority: "環境省",
      publisherDomain: "env.go.jp",
      landingPageUrl: "https://www.env.go.jp/guide/budget/r06/page_00004.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.env.go.jp/content/000248527.pdf",
              "pdf-confirmed",
              {
                title: "令和７年度歳出概算要求書（一般会計）［PDF 474KB］",
                notes: "248頁",
              },
            ),
          ],
        },
        {
          accountType: "special",
          account: "エネルギー対策特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.env.go.jp/content/000248531.pdf",
              "pdf-confirmed",
              {
                title:
                  "令和７年度歳出概算要求書（エネルギー対策特別会計・エネルギー需給勘定）［PDF 37KB］",
                notes: "16頁",
              },
            ),
          ],
        },
        {
          accountType: "special",
          account: "エネルギー対策特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.env.go.jp/content/000248532.pdf",
              "pdf-confirmed",
              {
                title:
                  "令和７年度歳出概算要求書（エネルギー対策特別会計・電源開発促進勘定）［PDF 36KB］",
                notes: "29頁",
              },
            ),
          ],
        },
        {
          accountType: "special",
          account: "東日本大震災復興特別会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.env.go.jp/content/000248529.pdf",
              "pdf-confirmed",
              {
                title:
                  "令和７年度歳出概算要求書（東日本大震災復興特別会計）［PDF 55KB］",
                notes: "21頁",
              },
            ),
          ],
        },
      ],
      notes:
        "MOFリンク https://www.env.go.jp/guide/budget/r06/page_00001.html は令和7年度の重点施策ページ。歳出概算要求書PDFは環境省の別ページ「令和７年度概算要求書について」で会計・勘定別に確認した。PDFはHTTP 200、Content-Type application/pdf、Range GET 206、先頭bytes %PDF。",
    },
    {
      publisherAuthority: "防衛省",
      publisherDomain: "mod.go.jp",
      landingPageUrl: "https://www.mod.go.jp/j/budget/gaisan/index.html",
      logicalDocuments: [
        {
          accountType: "general",
          account: "一般会計",
          documentType: "budget-request-expenditure",
          files: [
            file(
              "https://www.mod.go.jp/j/budget/gaisan/r7/gaisanyoukyu.pdf",
              "pdf-confirmed",
              { title: "歳出概算要求書", notes: "499頁" },
            ),
          ],
        },
      ],
      notes:
        "MOFリンク https://www.mod.go.jp/j/budget/yosan_gaiyo/index.html は概要ページ。防衛省サイト内ナビゲーションの「概算要求書」ページを開き、令和7年度タブの歳出概算要求書PDFリンクを確認した。PDFはHTTP 200、Content-Type application/pdf、Range GET 206、先頭bytes %PDF。",
    },
  ],
};
