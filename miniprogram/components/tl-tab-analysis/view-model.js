const { formatDisplayMoney } = require("../../utils/money");
const { isCurrentMonthAnchor, isCurrentYearAnchor } = require("./dates");

function amount(value) {
  return Number(value || 0);
}

function money(value) {
  return `¥${formatDisplayMoney(value)}`;
}

function comparisonText(comparison = {}, metric) {
  if (!comparison.enabled) return "";
  const item = comparison[metric] || {};
  if (item.direction === "flat") return "持平";
  if (item.rate === null) return "上期为 0";
  return `${item.direction === "up" ? "↑" : "↓"} ${Math.abs(item.rate)}%`;
}

function comparisonLabel(mode, anchor) {
  if (mode === "month") return isCurrentMonthAnchor(anchor) ? "较上月同期" : "较上月";
  if (mode === "year") return isCurrentYearAnchor(anchor) ? "较去年同期" : "较去年";
  return "";
}

function decorateRanking(rows = []) {
  return rows.map((item, index) => ({
    ...item,
    rank: index + 1,
    amountText: formatDisplayMoney(item.amount),
    barStyle: `width: ${Math.max(4, Math.min(100, Number(item.rate || 0)))}%`,
  }));
}

function decorateTrend(rows = []) {
  return rows.map((item) => ({
    ...item,
    incomeText: formatDisplayMoney(item.income),
    expenseText: formatDisplayMoney(item.expense),
    balanceText: formatDisplayMoney(item.balance),
  }));
}

function decorateTopExpenseRecords(records = []) {
  return records.map((item) => ({
    ...item,
    categoryText: item.categoryName || "其他",
    categoryIcon: item.categoryIcon || "bill-line",
    amountText: formatDisplayMoney(item.amount),
    account: item.account || "未设置账户",
    timeText: item.date
      ? `${Number(item.date.slice(5, 7))} 月 ${Number(item.date.slice(8, 10))} 日`
      : "",
    noteText: item.note || "未填写备注",
  }));
}

function getDetailRows(data, chartType) {
  if (chartType === "trend") return decorateTrend(data.trend || []);
  const rows =
    chartType === "category"
      ? data.categories
      : chartType === "income"
        ? data.incomeCategories
        : getRanking(data, chartType);
  return decorateRanking(rows || []);
}

function decorateInsightGroups(data = {}) {
  const groups = data.insightGroups || {};
  return {
    up: Array.isArray(groups.up) ? groups.up : [],
    down: Array.isArray(groups.down) ? groups.down : [],
    neutral: Array.isArray(groups.neutral)
      ? groups.neutral
      : Array.isArray(data.insights)
        ? data.insights
        : [],
  };
}

function decorate(data = {}) {
  const overview = data.overview || {};
  const budget = data.budget || {};
  const categoryChart = data.categoryChart || data.categories || [];
  const insightGroups = decorateInsightGroups(data);
  const saveRateText = overview.saveRateAvailable ? `储蓄率 ${overview.saveRate}%` : "暂无收入";
  return {
    ...data,
    overview: {
      ...overview,
      incomeText: formatDisplayMoney(overview.income),
      expenseText: formatDisplayMoney(overview.expense),
      balanceText: formatDisplayMoney(overview.balance),
      dailyExpenseText: formatDisplayMoney(overview.dailyExpense),
      averageExpenseText: formatDisplayMoney(overview.averageExpense),
      largestExpenseText: formatDisplayMoney(overview.largestExpense),
      saveRateText,
    },
    budget: {
      ...budget,
      amountText: formatDisplayMoney(budget.amount),
      spentText: formatDisplayMoney(budget.spent),
      remainingText: formatDisplayMoney(Math.abs(Number(budget.remaining || 0))),
    },
    comparison: data.comparison || { enabled: false },
    trend: data.trend || [],
    categories: decorateRanking(data.categories || []),
    categoryChart,
    incomeCategories: decorateRanking(data.incomeCategories || []),
    incomeCategoryChart: data.incomeCategoryChart || data.incomeCategories || [],
    accounts: decorateRanking(data.accounts || []),
    family: data.family
      ? {
          ...data.family,
          totalText: formatDisplayMoney(data.family.total),
          payers: decorateRanking(data.family.payers || []).map((item) => ({
            ...item,
            categories: decorateRanking(item.categories || []),
          })),
          consumers: decorateRanking(data.family.consumers || []).map((item) => ({
            ...item,
            publicText: formatDisplayMoney(item.publicAmount),
            multipleText: formatDisplayMoney(item.multipleAmount),
            categories: decorateRanking(item.categories || []),
          })),
        }
      : null,
    members: decorateRanking(data.members || []).map((item) => ({
      ...item,
      categories: decorateRanking(item.categories || []),
    })),
    insightGroups,
    insights: data.insights || [],
  };
}

function getRanking(data, chartType) {
  if (chartType === "category") return data.categoryChart || [];
  if (chartType === "income") return data.incomeCategoryChart || [];
  if (chartType === "account") return data.accounts || [];
  if (chartType === "member") return data.members || [];
  return [];
}

module.exports = {
  amount,
  money,
  comparisonText,
  comparisonLabel,
  decorateRanking,
  decorateTrend,
  decorateTopExpenseRecords,
  getDetailRows,
  decorateInsightGroups,
  decorate,
  getRanking,
};
