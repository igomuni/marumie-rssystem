export interface MiraiSummaryData {
  generatedAt: string;
  sourceFile: string;
  summary: {
    totalIncome: number;
    totalExpense: number;
    totalTransactions: number;
    dateRange: { from: string; to: string };
  };
  monthly: Array<{
    month: string;
    income: number;
    expense: number;
    incomeCount: number;
    expenseCount: number;
  }>;
  incomeByCategory: Array<{
    category: string;
    subCategory: string;
    amount: number;
    count: number;
  }>;
  expenseByCategory: Array<{
    category: string;
    amount: number;
    count: number;
  }>;
  partyFeeDistribution: Array<{
    amount: number;
    count: number;
    percentage: number;
  }>;
  donationDistribution: Array<{
    label: string;
    count: number;
    totalAmount: number;
  }>;
  partyFeeMonthly: Array<{
    month: string;
    count: number;
    totalAmount: number;
    byTier: Array<{ amount: number; count: number }>;
  }>;
}
