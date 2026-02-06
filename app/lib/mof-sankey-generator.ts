/**
 * MOF予算全体ビューのサンキー図生成ロジック
 */

import type {
  MOFBudgetData,
  MOFBudgetOverviewData,
  MOFBudgetNodeDetails,
  MOFBudgetNodeType,
} from '@/types/mof-budget-overview';
import type { SankeyNode, SankeyLink } from '@/types/sankey';

/**
 * MOF予算全体ビューのサンキー図データを生成
 */
export function generateMOFBudgetOverviewSankey(
  mofData: MOFBudgetData
): MOFBudgetOverviewData {
  const nodes: (SankeyNode & { details?: MOFBudgetNodeDetails })[] = [];
  const links: SankeyLink[] = [];

  // Column 1: 財源詳細ノード
  const revenueNodes = createRevenueDetailNodes(mofData);
  nodes.push(...revenueNodes);

  // Column 2: 会計区分ノード
  const accountNodes = createAccountTypeNodes(mofData);
  nodes.push(...accountNodes);

  // Column 3: RS対象区分ノード
  const rsCategoryNodes = createRSCategoryNodes(mofData);
  nodes.push(...rsCategoryNodes);

  // Column 4: 詳細内訳ノード
  const detailNodes = createBudgetDetailNodes(mofData);
  nodes.push(...detailNodes);

  // Column 5: RS集約ノード
  const summaryNodes = createRSSummaryNodes(mofData);
  nodes.push(...summaryNodes);

  // リンク生成
  links.push(...createRevenueToAccountLinks(revenueNodes, accountNodes, mofData));
  links.push(...createAccountToRSCategoryLinks(accountNodes, rsCategoryNodes, mofData));
  links.push(...createRSCategoryToDetailLinks(rsCategoryNodes, detailNodes));
  links.push(...createDetailToSummaryLinks(detailNodes, summaryNodes));

  // メタデータとサマリー
  const metadata = {
    generatedAt: new Date().toISOString(),
    fiscalYear: mofData.fiscalYear,
    totalBudget: mofData.generalAccount.total + mofData.specialAccount.total,
    rsTargetBudget:
      mofData.generalAccount.expenditure.rsTarget +
      mofData.specialAccount.expenditure.rsTarget.total,
    rsExcludedBudget:
      mofData.generalAccount.expenditure.debtService +
      mofData.generalAccount.expenditure.localAllocationTax +
      mofData.generalAccount.expenditure.reserves +
      mofData.specialAccount.expenditure.rsExcluded.total,
    dataSource: '財務省 令和5年度予算（2023年度）',
    notes: [
      '予算総額556.3兆円は「予算書上の金額」です（重複含む）',
      'RS対象範囲は「事業レビュー対象」のみです（151.1兆円、27.2%）',
      '国債費・地方交付税等の制度的支出（405.2兆円）は含まれません',
    ],
  };

  const summary = {
    generalAccount: {
      total: mofData.generalAccount.total,
      rsTarget: mofData.generalAccount.expenditure.rsTarget,
      rsExcluded:
        mofData.generalAccount.expenditure.debtService +
        mofData.generalAccount.expenditure.localAllocationTax +
        mofData.generalAccount.expenditure.reserves,
      rsTargetRate:
        (mofData.generalAccount.expenditure.rsTarget /
          mofData.generalAccount.total) *
        100,
    },
    specialAccount: {
      total: mofData.specialAccount.total,
      rsTarget: mofData.specialAccount.expenditure.rsTarget.total,
      rsExcluded: mofData.specialAccount.expenditure.rsExcluded.total,
      rsTargetRate:
        (mofData.specialAccount.expenditure.rsTarget.total /
          mofData.specialAccount.total) *
        100,
    },
    overall: {
      total: mofData.generalAccount.total + mofData.specialAccount.total,
      rsTarget:
        mofData.generalAccount.expenditure.rsTarget +
        mofData.specialAccount.expenditure.rsTarget.total,
      rsExcluded:
        mofData.generalAccount.expenditure.debtService +
        mofData.generalAccount.expenditure.localAllocationTax +
        mofData.generalAccount.expenditure.reserves +
        mofData.specialAccount.expenditure.rsExcluded.total,
      rsTargetRate: 0,
    },
  };
  summary.overall.rsTargetRate =
    (summary.overall.rsTarget / summary.overall.total) * 100;

  return {
    metadata,
    sankey: { nodes, links },
    summary,
  };
}

/**
 * Column 1: 財源詳細ノード作成
 * 並び順: 一般会計分（金額降順）→特別会計分
 */
function createRevenueDetailNodes(
  mofData: MOFBudgetData
): (SankeyNode & { details?: MOFBudgetNodeDetails })[] {
  const nodes: (SankeyNode & { details?: MOFBudgetNodeDetails })[] = [];

  // 一般会計の歳入項目（金額降順でソート）
  const taxes = mofData.generalAccount.revenue.taxes;
  const otherTaxes =
    taxes.inheritanceTax +
    taxes.gasolineTax +
    taxes.sakeTax +
    taxes.customsDuty +
    taxes.tobaccoTax +
    taxes.petroleumCoalTax +
    taxes.automobileWeightTax +
    taxes.powerDevelopmentTax +
    taxes.otherTaxes;

  const generalAccountRevenues = [
    {
      id: 'revenue-consumption-tax',
      name: '消費税',
      type: 'tax-detail' as MOFBudgetNodeType,
      value: taxes.consumptionTax,
      details: {
        taxType: '消費税',
        description: '最大の税収源（34.2%）',
        amount: taxes.consumptionTax,
      },
    },
    {
      id: 'revenue-income-tax',
      name: '所得税',
      type: 'tax-detail' as MOFBudgetNodeType,
      value: taxes.incomeTax,
      details: {
        taxType: '所得税',
        description: '個人所得への課税（30.7%）',
        amount: taxes.incomeTax,
      },
    },
    {
      id: 'revenue-corporate-tax',
      name: '法人税',
      type: 'tax-detail' as MOFBudgetNodeType,
      value: taxes.corporateTax,
      details: {
        taxType: '法人税',
        description: '企業利益への課税（21.3%）',
        amount: taxes.corporateTax,
      },
    },
    {
      id: 'revenue-public-bonds',
      name: '公債金（国債）',
      type: 'public-bonds' as MOFBudgetNodeType,
      value: mofData.generalAccount.revenue.publicBonds,
      details: {
        description: '新規国債発行（将来世代の負担）',
        amount: mofData.generalAccount.revenue.publicBonds,
      },
    },
    {
      id: 'revenue-other-taxes',
      name: 'その他税',
      type: 'tax-detail' as MOFBudgetNodeType,
      value: otherTaxes,
      details: {
        taxType: 'その他税',
        description: '相続税、揮発油税、酒税、関税等',
        amount: otherTaxes,
      },
    },
  ];

  // 一般会計分を金額降順でソート
  generalAccountRevenues.sort((a, b) => b.value - a.value);
  nodes.push(...generalAccountRevenues);

  // 特別会計の歳入項目
  const insurancePremiums = mofData.specialAccount.revenue.insurancePremiums;
  const otherRevenue =
    mofData.generalAccount.revenue.stampRevenue +
    mofData.generalAccount.revenue.otherRevenue +
    mofData.specialAccount.revenue.other;

  nodes.push(
    {
      id: 'revenue-insurance-premiums',
      name: '社会保険料',
      type: 'insurance-premium' as MOFBudgetNodeType,
      value: insurancePremiums.total,
      details: {
        description: '年金・医療・雇用保険料（国民・企業が負担）',
        amount: insurancePremiums.total,
      },
    },
    {
      id: 'revenue-refinancing-bonds',
      name: '公債金（借換債）',
      type: 'public-bonds' as MOFBudgetNodeType,
      value: mofData.specialAccount.revenue.publicBonds,
      details: {
        description: '既存国債の借り換え（特別会計）',
        amount: mofData.specialAccount.revenue.publicBonds,
      },
    },
    {
      id: 'revenue-transfer-from-general',
      name: '一般会計繰入',
      type: 'other-revenue' as MOFBudgetNodeType,
      value: mofData.specialAccount.revenue.transferFromGeneral,
      details: {
        description: '一般会計から特別会計への繰入（税金由来）',
        amount: mofData.specialAccount.revenue.transferFromGeneral,
      },
    },
    {
      id: 'revenue-transfer-from-other',
      name: '他会計繰入',
      type: 'other-revenue' as MOFBudgetNodeType,
      value: mofData.specialAccount.revenue.transferFromOther,
      details: {
        description: '特別会計間の資金移動（重複計上）',
        amount: mofData.specialAccount.revenue.transferFromOther,
      },
    },
    {
      id: 'revenue-other',
      name: 'その他収入',
      type: 'other-revenue' as MOFBudgetNodeType,
      value: otherRevenue,
      details: {
        description: '印紙収入、諸収入等',
        amount: otherRevenue,
      },
    }
  );

  return nodes;
}

/**
 * Column 2: 会計区分ノード作成
 */
function createAccountTypeNodes(
  mofData: MOFBudgetData
): (SankeyNode & { details?: MOFBudgetNodeDetails })[] {
  const nodes: (SankeyNode & { details?: MOFBudgetNodeDetails })[] = [];

  // 1. 一般会計 (Top)
  const generalRSTarget = mofData.generalAccount.expenditure.rsTarget;
  const generalRSExcluded =
    mofData.generalAccount.expenditure.debtService +
    mofData.generalAccount.expenditure.localAllocationTax +
    mofData.generalAccount.expenditure.reserves;

  nodes.push({
    id: 'account-general',
    name: '一般会計',
    type: 'account-type' as MOFBudgetNodeType,
    value: mofData.generalAccount.total,
    details: {
      accountType: '一般会計',
      rsTargetAmount: generalRSTarget,
      rsExcludedAmount: generalRSExcluded,
      rsTargetRate: (generalRSTarget / mofData.generalAccount.total) * 100,
      description: '国の基本的な予算（114.4兆円）',
      amount: mofData.generalAccount.total,
    },
  });

  // 2. 特別会計 (Detailed & Sorted)
  const accounts = mofData.specialAccount.expenditure.accounts;
  const specialNodes = [
    { key: 'pension', name: '年金特会', data: accounts.pension },
    { key: 'labor', name: '労働保険特会', data: accounts.labor },
    { key: 'energy', name: 'エネ対策特会', data: accounts.energy },
    { key: 'food', name: '食料安定特会', data: accounts.food },
    { key: 'reconstruction', name: '復興特会', data: accounts.reconstruction },
    { key: 'forex', name: '外為特会', data: accounts.forex },
    { key: 'debt-retirement', name: '国債償還', data: accounts.debtRetirement },
    { key: 'allocation-tax', name: '交付税配付', data: accounts.allocationTax },
    { key: 'filp', name: '財政投融資', data: accounts.filp },
    { key: 'others', name: 'その他特会', data: accounts.others },
  ];

  specialNodes.forEach((acc) => {
    nodes.push({
      id: `account-${acc.key}`,
      name: acc.name,
      type: 'account-type' as MOFBudgetNodeType,
      value: acc.data.total,
      details: {
        accountType: '特別会計',
        rsTargetAmount: acc.data.rsTarget,
        rsExcludedAmount: acc.data.rsExcluded,
        rsTargetRate: acc.data.total > 0 ? (acc.data.rsTarget / acc.data.total) * 100 : 0,
        description: `${acc.name}（${(acc.data.total / 1e12).toFixed(1)}兆円）`,
        amount: acc.data.total,
      },
    });
  });

  return nodes;
}

/**
 * Column 3: RS対象区分ノード作成
 * 並び順: RS対象を上に配置（一般会計RS対象、特別会計RS対象、一般会計RS対象外、特別会計RS対象外）
 */
function createRSCategoryNodes(
  mofData: MOFBudgetData
): (SankeyNode & { details?: MOFBudgetNodeDetails })[] {
  return [
    // RS対象（上側）
    {
      id: 'rs-category-general-target',
      name: '一般会計RS対象',
      type: 'rs-category' as MOFBudgetNodeType,
      value: mofData.generalAccount.expenditure.rsTarget,
      details: {
        category: 'RS対象',
        parentAccount: '一般会計',
        description: '事業として計上された予算（63.4%）',
        amount: mofData.generalAccount.expenditure.rsTarget,
      },
    },
    {
      id: 'rs-category-special-target',
      name: '特別会計RS対象',
      type: 'rs-category' as MOFBudgetNodeType,
      value: mofData.specialAccount.expenditure.rsTarget.total,
      details: {
        category: 'RS対象',
        parentAccount: '特別会計',
        description: '年金・労働保険等の事業（17.8%）',
        amount: mofData.specialAccount.expenditure.rsTarget.total,
      },
    },
    // RS対象外（下側）
    {
      id: 'rs-category-general-excluded',
      name: '一般会計RS対象外',
      type: 'rs-category' as MOFBudgetNodeType,
      value:
        mofData.generalAccount.expenditure.debtService +
        mofData.generalAccount.expenditure.localAllocationTax +
        mofData.generalAccount.expenditure.reserves,
      details: {
        category: 'RS対象外',
        parentAccount: '一般会計',
        description: '国債費・地方交付税等（36.6%）',
        amount:
          mofData.generalAccount.expenditure.debtService +
          mofData.generalAccount.expenditure.localAllocationTax +
          mofData.generalAccount.expenditure.reserves,
      },
    },
    {
      id: 'rs-category-special-excluded',
      name: '特別会計RS対象外',
      type: 'rs-category' as MOFBudgetNodeType,
      value: mofData.specialAccount.expenditure.rsExcluded.total,
      details: {
        category: 'RS対象外',
        parentAccount: '特別会計',
        description: '国債整理・地方交付税配付金等（82.2%）',
        amount: mofData.specialAccount.expenditure.rsExcluded.total,
      },
    },
  ];
}

/**
 * Column 4: 詳細内訳ノード作成
 * 並び順: RS対象を上に配置（一般会計事業、特別会計事業たち、一般会計RS対象外たち、特別会計RS対象外たち）
 */
function createBudgetDetailNodes(
  mofData: MOFBudgetData
): (SankeyNode & { details?: MOFBudgetNodeDetails })[] {
  return [
    // RS対象（上側）- 一般会計
    {
      id: 'detail-general-projects',
      name: '一般会計事業',
      type: 'budget-detail' as MOFBudgetNodeType,
      value: mofData.generalAccount.expenditure.rsTarget,
      details: {
        detailType: '一般会計事業',
        isRSTarget: true,
        description: '各府省庁の事業予算',
        amount: mofData.generalAccount.expenditure.rsTarget,
      },
    },
    // RS対象（上側）- 特別会計
    {
      id: 'detail-pension-projects',
      name: '年金事業',
      type: 'budget-detail' as MOFBudgetNodeType,
      value: mofData.specialAccount.expenditure.accounts.pension.rsTarget,
      details: {
        detailType: '年金事業',
        isRSTarget: true,
        description: '年金制度の運営',
        amount: mofData.specialAccount.expenditure.accounts.pension.rsTarget,
      },
    },
    {
      id: 'detail-labor-projects',
      name: '労働保険',
      type: 'budget-detail' as MOFBudgetNodeType,
      value: mofData.specialAccount.expenditure.accounts.labor.rsTarget,
      details: {
        detailType: '労働保険',
        isRSTarget: true,
        description: '雇用保険・労災保険',
        amount: mofData.specialAccount.expenditure.accounts.labor.rsTarget,
      },
    },
    {
      id: 'detail-other-projects',
      name: 'その他事業',
      type: 'budget-detail' as MOFBudgetNodeType,
      value:
        mofData.specialAccount.expenditure.accounts.energy.rsTarget +
        mofData.specialAccount.expenditure.accounts.food.rsTarget +
        mofData.specialAccount.expenditure.accounts.reconstruction.rsTarget +
        mofData.specialAccount.expenditure.accounts.others.rsTarget,
      details: {
        detailType: 'その他事業',
        isRSTarget: true,
        description: 'エネルギー対策、食料安定等',
        amount:
          mofData.specialAccount.expenditure.accounts.energy.rsTarget +
          mofData.specialAccount.expenditure.accounts.food.rsTarget +
          mofData.specialAccount.expenditure.accounts.reconstruction.rsTarget +
          mofData.specialAccount.expenditure.accounts.others.rsTarget,
      },
    },
    // RS対象外（下側）- 一般会計
    {
      id: 'detail-debt-service',
      name: '国債費',
      type: 'budget-detail' as MOFBudgetNodeType,
      value: mofData.generalAccount.expenditure.debtService,
      details: {
        detailType: '国債費',
        isRSTarget: false,
        description: '国債の利払い・償還',
        amount: mofData.generalAccount.expenditure.debtService,
      },
    },
    {
      id: 'detail-local-allocation-tax',
      name: '地方交付税',
      type: 'budget-detail' as MOFBudgetNodeType,
      value: mofData.generalAccount.expenditure.localAllocationTax,
      details: {
        detailType: '地方交付税',
        isRSTarget: false,
        description: '地方自治体への財源移転',
        amount: mofData.generalAccount.expenditure.localAllocationTax,
      },
    },
    // RS対象外（下側）- 特別会計
    {
      id: 'detail-debt-retirement',
      name: '国債整理基金',
      type: 'budget-detail' as MOFBudgetNodeType,
      value: mofData.specialAccount.expenditure.accounts.debtRetirement.rsExcluded,
      details: {
        detailType: '国債整理基金',
        isRSTarget: false,
        description: '借換債が大部分',
        amount: mofData.specialAccount.expenditure.accounts.debtRetirement.rsExcluded,
      },
    },
    {
      id: 'detail-local-allocation-distribution',
      name: '地方交付税配付金',
      type: 'budget-detail' as MOFBudgetNodeType,
      value:
        mofData.specialAccount.expenditure.accounts.allocationTax.rsExcluded,
      details: {
        detailType: '地方交付税配付金',
        isRSTarget: false,
        description: '特別会計からの配付',
        amount:
          mofData.specialAccount.expenditure.accounts.allocationTax.rsExcluded,
      },
    },
    {
      id: 'detail-fiscal-investment-loan',
      name: '財政投融資',
      type: 'budget-detail' as MOFBudgetNodeType,
      value: mofData.specialAccount.expenditure.accounts.filp.rsExcluded,
      details: {
        detailType: '財政投融資',
        isRSTarget: false,
        description: '融資・投資活動',
        amount:
          mofData.specialAccount.expenditure.accounts.filp.rsExcluded,
      },
    },
    {
      id: 'detail-pension-benefits',
      name: '年金給付等',
      type: 'budget-detail' as MOFBudgetNodeType,
      value: mofData.specialAccount.expenditure.accounts.pension.rsExcluded,
      details: {
        detailType: '年金給付等',
        isRSTarget: false,
        description: '受給者への給付',
        amount: mofData.specialAccount.expenditure.accounts.pension.rsExcluded,
      },
    },
    {
      id: 'detail-other-excluded',
      name: 'その他対象外',
      type: 'budget-detail' as MOFBudgetNodeType,
      value:
        mofData.specialAccount.expenditure.accounts.labor.rsExcluded +
        mofData.specialAccount.expenditure.accounts.energy.rsExcluded +
        mofData.specialAccount.expenditure.accounts.food.rsExcluded +
        mofData.specialAccount.expenditure.accounts.reconstruction.rsExcluded +
        mofData.specialAccount.expenditure.accounts.forex.rsExcluded +
        mofData.specialAccount.expenditure.accounts.others.rsExcluded +
        mofData.generalAccount.expenditure.reserves,
      details: {
        detailType: 'その他',
        isRSTarget: false,
        description: '予備費、外為特会等',
        amount:
          mofData.specialAccount.expenditure.accounts.labor.rsExcluded +
          mofData.specialAccount.expenditure.accounts.energy.rsExcluded +
          mofData.specialAccount.expenditure.accounts.food.rsExcluded +
          mofData.specialAccount.expenditure.accounts.reconstruction.rsExcluded +
          mofData.specialAccount.expenditure.accounts.forex.rsExcluded +
          mofData.specialAccount.expenditure.accounts.others.rsExcluded +
          mofData.generalAccount.expenditure.reserves,
      },
    },
  ];
}

/**
 * Column 5: RS集約ノード作成
 */
function createRSSummaryNodes(
  mofData: MOFBudgetData
): (SankeyNode & { details?: MOFBudgetNodeDetails })[] {
  const rsTargetTotal =
    mofData.generalAccount.expenditure.rsTarget +
    mofData.specialAccount.expenditure.rsTarget.total;

  const rsExcludedTotal =
    mofData.generalAccount.expenditure.debtService +
    mofData.generalAccount.expenditure.localAllocationTax +
    mofData.generalAccount.expenditure.reserves +
    mofData.specialAccount.expenditure.rsExcluded.total;

  return [
    {
      id: 'summary-rs-target',
      name: 'RSシステム対象',
      type: 'rs-summary' as MOFBudgetNodeType,
      value: rsTargetTotal,
      details: {
        description: '事業レビュー対象（27.2%）',
        amount: rsTargetTotal,
      },
    },
    {
      id: 'summary-rs-excluded',
      name: 'RS対象外',
      type: 'rs-summary' as MOFBudgetNodeType,
      value: rsExcludedTotal,
      details: {
        description: '制度的支出・給付型支出（72.8%）',
        amount: rsExcludedTotal,
      },
    },
  ];
}

/**
 * 財源 → 会計区分 のリンク作成
 */
function createRevenueToAccountLinks(
  revenueNodes: SankeyNode[],
  accountNodes: SankeyNode[],
  mofData: MOFBudgetData
): SankeyLink[] {
  const links: SankeyLink[] = [];

  const generalAccount = accountNodes.find((n) => n.id === 'account-general')!;

  // Find Special accounts
  const specialAccounts = {
    pension: accountNodes.find((n) => n.id === 'account-pension')!,
    labor: accountNodes.find((n) => n.id === 'account-labor')!,
    energy: accountNodes.find((n) => n.id === 'account-energy')!,
    food: accountNodes.find((n) => n.id === 'account-food')!,
    reconstruction: accountNodes.find((n) => n.id === 'account-reconstruction')!,
    forex: accountNodes.find((n) => n.id === 'account-forex')!,
    debt: accountNodes.find((n) => n.id === 'account-debt-retirement')!,
    allocation: accountNodes.find((n) => n.id === 'account-allocation-tax')!,
    filp: accountNodes.find((n) => n.id === 'account-filp')!,
    others: accountNodes.find((n) => n.id === 'account-others')!,
  };

  // 1. 租税・公債金 → 一般会計
  // Link Taxes
  revenueNodes.filter(n => n.type === 'tax-detail').forEach(n => {
    links.push({ source: n.id, target: generalAccount.id, value: n.value || 0 });
  });

  // Link Public Bonds
  const pubBond = revenueNodes.find(n => n.id === 'revenue-public-bonds');
  if (pubBond) links.push({ source: pubBond.id, target: generalAccount.id, value: pubBond.value || 0 });

  // 2. Special Account Specific Revenues

  // Insurance -> Pension, Labor, Others
  const insuranceNode = revenueNodes.find(n => n.id === 'revenue-insurance-premiums')!;
  const insuranceBreakdown = mofData.specialAccount.revenue.insurancePremiums;

  if (insuranceBreakdown.pension > 0) {
    links.push({ source: insuranceNode.id, target: specialAccounts.pension.id, value: insuranceBreakdown.pension });
  }
  if (insuranceBreakdown.labor > 0) {
    links.push({ source: insuranceNode.id, target: specialAccounts.labor.id, value: insuranceBreakdown.labor });
  }
  if (insuranceBreakdown.other > 0) {
    // Distribute 'other' insurance to 'others' account for simplicity
    links.push({ source: insuranceNode.id, target: specialAccounts.others.id, value: insuranceBreakdown.other });
  }

  // Refinancing Bonds -> Debt Retirement
  const refBondsNode = revenueNodes.find(n => n.id === 'revenue-refinancing-bonds')!;
  links.push({ source: refBondsNode.id, target: specialAccounts.debt.id, value: refBondsNode.value || 0 });

  // 3. Pool Distribution (Transfers + Other Revenues)
  // All remaining revenues (General transfers, Output transfers, Other revenue) are pooled and distributed
  // to fill the remaining needs of each account.

  // General Need filled by Pool:
  // General Total - (Taxes + Bonds)
  // Wait, General 'other revenue' goes to General.
  const generalOtherRevenue = mofData.generalAccount.revenue.stampRevenue + mofData.generalAccount.revenue.otherRevenue;

  // Special Account Needs
  // Account Total - (Received Insurance + Received Bonds)
  const getNeed = (nodeId: string, total: number) => {
    const received = links.filter(l => l.target === nodeId).reduce((sum, l) => sum + l.value, 0);
    return Math.max(0, total - received);
  };

  // Pre-assign 'Other Revenue' (General part) to General
  const otherRevNode = revenueNodes.find(n => n.id === 'revenue-other')!;
  links.push({ source: otherRevNode.id, target: generalAccount.id, value: generalOtherRevenue });

  // Remaining 'Other Revenue' (Special part)
  const specialOtherRevenue = (otherRevNode.value || 0) - generalOtherRevenue;

  // Determine distribution of pooling sources
  // Pool Sources: TransferFromGeneral, TransferFromOther, SpecialOtherRevenue

  // We distribute these sources to Special Accounts based on their unfilled needs.

  const transferGen = revenueNodes.find(n => n.id === 'revenue-transfer-from-general')!;
  const transferOther = revenueNodes.find(n => n.id === 'revenue-transfer-from-other')!;

  // List of accounts and their needs
  const accountNeeds = Object.entries(specialAccounts).map(([_key, node]) => {
    return {
      id: node.id,
      need: getNeed(node.id, node.value || 0)
    };
  }).filter(a => a.need > 0);

  const totalNeed = accountNeeds.reduce((sum, a) => sum + a.need, 0);

  // Helper to distribute a source node's value
  const distributeSource = (sourceNode: SankeyNode, availableValue: number) => {
    accountNeeds.forEach(acc => {
      // ratio
      const ratio = totalNeed > 0 ? acc.need / totalNeed : 0;
      const amount = availableValue * ratio;
      if (amount > 0.01) { // threshold
        links.push({ source: sourceNode.id, target: acc.id, value: amount });
      }
    });
  };

  distributeSource(transferGen, transferGen.value || 0);
  distributeSource(transferOther, transferOther.value || 0);

  // Special part of Other Revenue. 
  if (specialOtherRevenue > 0) {
    // Virtual distribution of the 'Special' portion of the Other Revenue Node
    accountNeeds.forEach(acc => {
      const ratio = totalNeed > 0 ? acc.need / totalNeed : 0;
      const amount = specialOtherRevenue * ratio;
      if (amount > 0.01) {
        links.push({ source: otherRevNode.id, target: acc.id, value: amount });
      }
    });
  }

  return links;
}

/**
 * 会計区分 → RS対象区分 のリンク作成
 */
function createAccountToRSCategoryLinks(
  accountNodes: SankeyNode[],
  rsCategoryNodes: SankeyNode[],
  mofData: MOFBudgetData
): SankeyLink[] {
  const links: SankeyLink[] = [];

  const generalAccount = accountNodes.find((n) => n.id === 'account-general')!;

  const generalTarget = rsCategoryNodes.find(
    (n) => n.id === 'rs-category-general-target'
  )!;
  const generalExcluded = rsCategoryNodes.find(
    (n) => n.id === 'rs-category-general-excluded'
  )!;
  const specialTarget = rsCategoryNodes.find(
    (n) => n.id === 'rs-category-special-target'
  )!;
  const specialExcluded = rsCategoryNodes.find(
    (n) => n.id === 'rs-category-special-excluded'
  )!;

  // 一般会計 Links
  links.push(
    {
      source: generalAccount.id,
      target: generalTarget.id,
      value: generalTarget.value || 0,
    },
    {
      source: generalAccount.id,
      target: generalExcluded.id,
      value: generalExcluded.value || 0,
    }
  );

  // 特別会計 Links (Iterate all special accounts)
  const specialAccounts = accountNodes.filter(n => n.id.startsWith('account-') && n.id !== 'account-general');

  specialAccounts.forEach(acc => {
    let accKey = acc.id.replace('account-', '');

    // Manual mapping for kebab-case to camelCase
    if (accKey === 'debt-retirement') accKey = 'debtRetirement';
    if (accKey === 'allocation-tax') accKey = 'allocationTax';

    // Look up in mofData
    // @ts-expect-error - Dynamic key access for account mapping
    const accData = mofData.specialAccount.expenditure.accounts[accKey] as { rsTarget: number, rsExcluded: number };

    if (accData) {
      if (accData.rsTarget > 0) {
        links.push({ source: acc.id, target: specialTarget.id, value: accData.rsTarget });
      }
      if (accData.rsExcluded > 0) {
        links.push({ source: acc.id, target: specialExcluded.id, value: accData.rsExcluded });
      }
    }
  });

  return links;
}

/**
 * RS対象区分 → 詳細内訳 のリンク作成
 */
function createRSCategoryToDetailLinks(
  rsCategoryNodes: SankeyNode[],
  detailNodes: SankeyNode[]
): SankeyLink[] {
  const links: SankeyLink[] = [];

  const generalTarget = rsCategoryNodes.find(
    (n) => n.id === 'rs-category-general-target'
  )!;
  const generalExcluded = rsCategoryNodes.find(
    (n) => n.id === 'rs-category-general-excluded'
  )!;
  const specialTarget = rsCategoryNodes.find(
    (n) => n.id === 'rs-category-special-target'
  )!;
  const specialExcluded = rsCategoryNodes.find(
    (n) => n.id === 'rs-category-special-excluded'
  )!;

  // 一般会計RS対象 → 一般会計事業
  const generalProjectsNode = detailNodes.find(
    (n) => n.id === 'detail-general-projects'
  )!;
  links.push({
    source: generalTarget.id,
    target: generalProjectsNode.id,
    value: generalProjectsNode.value || 0,
  });

  // 一般会計RS対象外 → 国債費、地方交付税
  const debtServiceNode = detailNodes.find(
    (n) => n.id === 'detail-debt-service'
  )!;
  const localAllocationTaxNode = detailNodes.find(
    (n) => n.id === 'detail-local-allocation-tax'
  )!;
  links.push(
    {
      source: generalExcluded.id,
      target: debtServiceNode.id,
      value: debtServiceNode.value || 0,
    },
    {
      source: generalExcluded.id,
      target: localAllocationTaxNode.id,
      value: localAllocationTaxNode.value || 0,
    }
  );

  // 特別会計RS対象 → 年金事業、労働保険、その他事業
  const pensionProjectsNode = detailNodes.find(
    (n) => n.id === 'detail-pension-projects'
  )!;
  const laborProjectsNode = detailNodes.find(
    (n) => n.id === 'detail-labor-projects'
  )!;
  const otherProjectsNode = detailNodes.find(
    (n) => n.id === 'detail-other-projects'
  )!;
  links.push(
    {
      source: specialTarget.id,
      target: pensionProjectsNode.id,
      value: pensionProjectsNode.value || 0,
    },
    {
      source: specialTarget.id,
      target: laborProjectsNode.id,
      value: laborProjectsNode.value || 0,
    },
    {
      source: specialTarget.id,
      target: otherProjectsNode.id,
      value: otherProjectsNode.value || 0,
    }
  );

  // 特別会計RS対象外 → 各種詳細ノード
  // Note: Linking from Special Excluded Category node to Detailed nodes
  // Logic: specialExcluded -> Debt, Allocation, FILP, PensionBenefits, Others.

  const debtRetirementNode = detailNodes.find(
    (n) => n.id === 'detail-debt-retirement'
  )!;
  const localAllocationDistributionNode = detailNodes.find(
    (n) => n.id === 'detail-local-allocation-distribution'
  )!;
  const fiscalInvestmentLoanNode = detailNodes.find(
    (n) => n.id === 'detail-fiscal-investment-loan'
  )!;
  const pensionBenefitsNode = detailNodes.find(
    (n) => n.id === 'detail-pension-benefits'
  )!;
  const otherExcludedNode = detailNodes.find(
    (n) => n.id === 'detail-other-excluded'
  )!;

  links.push(
    {
      source: specialExcluded.id,
      target: debtRetirementNode.id,
      value: debtRetirementNode.value || 0,
    },
    {
      source: specialExcluded.id,
      target: localAllocationDistributionNode.id,
      value: localAllocationDistributionNode.value || 0,
    },
    {
      source: specialExcluded.id,
      target: fiscalInvestmentLoanNode.id,
      value: fiscalInvestmentLoanNode.value || 0,
    },
    {
      source: specialExcluded.id,
      target: pensionBenefitsNode.id,
      value: pensionBenefitsNode.value || 0,
    },
    {
      source: specialExcluded.id,
      target: otherExcludedNode.id,
      value: otherExcludedNode.value || 0,
    }
  );

  return links;
}

/**
 * 詳細内訳 → RS集約 のリンク作成
 */
function createDetailToSummaryLinks(
  detailNodes: SankeyNode[],
  summaryNodes: SankeyNode[]
): SankeyLink[] {
  const links: SankeyLink[] = [];

  const rsTargetSummary = summaryNodes.find(
    (n) => n.id === 'summary-rs-target'
  )!;
  const rsExcludedSummary = summaryNodes.find(
    (n) => n.id === 'summary-rs-excluded'
  )!;

  detailNodes.forEach((detailNode) => {
    const details = (detailNode as SankeyNode & { details?: MOFBudgetNodeDetails }).details;
    if (details) {
      const target = details.isRSTarget ? rsTargetSummary : rsExcludedSummary;
      links.push({
        source: detailNode.id,
        target: target.id,
        value: detailNode.value || 0,
      });
    }
  });

  return links;
}
