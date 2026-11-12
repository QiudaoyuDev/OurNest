const { formatMoney: formatDisplayMoney } = require("../../utils/money");
const { resolveCategoryScheme } = require("../../utils/category-color");
const ICON_GLYPHS = require("../tl-icon/glyphs");
const CATEGORY_ICONS = require("../tl-icon/category-icons");
const { categoryChartColor } = require("./chart-options");

function categoryDisplayIcon(item, type) {
  const fallback = type === "income" ? "funds-line" : "price-tag-3-line";
  return [
    item.categoryIcon,
    ...(item.recordCategoryIcons || []),
    item.recordCategoryIcon,
    fallback,
  ].find(
    (icon) =>
      typeof icon === "string" &&
      (Object.prototype.hasOwnProperty.call(ICON_GLYPHS, icon) ||
        Object.prototype.hasOwnProperty.call(CATEGORY_ICONS, icon))
  );
}

function dayAdd(value, delta) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function calendarAmount(value) {
  if (!value) return "—";
  if (Math.abs(value) >= 10000) {
    const rounded = Math.round(value / 1000) * 1000;
    return `${rounded === value ? "" : "≈"}${(rounded / 10000).toFixed(1).replace(/\.0$/, "")}万`;
  }
  if (Math.abs(value) >= 1000)
    return `${Math.round(value) === value ? "" : "≈"}${Math.round(value)}`;
  return formatDisplayMoney(value);
}

function generateEditorialSummary({
  mode,
  type,
  total,
  categories,
  delta,
  comparisonLabel,
  balance,
  budget,
}) {
  if (!total || total === 0) {
    return mode === "week"
      ? "本周暂无记录，记下第一笔收支开启小家记账生活。"
      : mode === "month"
        ? "本月暂无收支记录，保持记账让家庭财务更清晰。"
        : "本年度暂无收支记录。";
  }
  const topCategory =
    categories && categories[0] && categories[0].recordCount ? categories[0] : null;
  const parts = [];
  if (topCategory) {
    parts.push(`${topCategory.name}占${type === "income" ? "收入" : "支出"} ${topCategory.rate}%`);
  }
  if (delta !== 0) {
    const isLess = delta < 0;
    if (type === "expense") {
      parts.push(isLess ? `开销较${comparisonLabel}有所放缓` : `开销较${comparisonLabel}有所增加`);
    } else {
      parts.push(isLess ? `收入较${comparisonLabel}有所减少` : `收入较${comparisonLabel}稳步提升`);
    }
  } else {
    parts.push(`整体节奏与${comparisonLabel}持平`);
  }
  if (budget && budget.enabled && type === "expense" && mode === "month") {
    parts.push(`月预算已使用 ${budget.rate}%`);
  } else if (type === "expense" && Number.isFinite(balance)) {
    if (balance > 0) {
      parts.push("小家结余保持健康盈余");
    } else if (balance < 0) {
      parts.push("本期结余暂为赤字，需注意适度节流");
    }
  }
  return parts.join("，") + "。";
}

function calculateFamilySettlement(family = {}, rangeLabel = "", ledgerName = "咱家小账") {
  const payers = (family && family.payers) || [];
  if (!family || payers.length < 2) {
    return {
      enabled: false,
      advice: "本期支出主要由单人支付，暂无需对账结算。",
      copyText: "",
    };
  }
  const [first, second] = payers;
  const firstAmount = Number(first.amount || 0);
  const secondAmount = Number(second.amount || 0);
  const diffCents = Math.round(Math.abs(firstAmount - secondAmount) * 100);
  const halfDiff = diffCents / 200;
  const diffText = formatDisplayMoney(halfDiff);

  const higher = firstAmount >= secondAmount ? first : second;
  const lower = firstAmount >= secondAmount ? second : first;

  let advice = "";
  if (diffCents === 0) {
    advice = `${first.name} 与 ${second.name} 付款金额一致，收支平衡！`;
  } else {
    advice = `${lower.name} 需向 ${higher.name} 转账 ¥${diffText} 结清平摊开支`;
  }

  const copyText = [
    `【咱家小账 · ${rangeLabel || "生活"}对账单】`,
    `🏠 账本：${ledgerName}`,
    `💰 家庭总支出：¥${family.totalText || formatDisplayMoney(family.total)}`,
    `👤 ${first.name} 垫付：¥${first.amountText || formatDisplayMoney(first.amount)} (${first.rate || 50}%)`,
    `👤 ${second.name} 垫付：¥${second.amountText || formatDisplayMoney(second.amount)} (${second.rate || 50}%)`,
    diffCents === 0
      ? `🤝 结算结果：双人开销一致，无需结算`
      : `🤝 结算建议：${lower.name} 需转给 ${higher.name} ¥${diffText} 结清本期公共开支`,
  ].join("\n");

  return {
    enabled: true,
    advice,
    diffText,
    higherName: higher.name,
    lowerName: lower.name,
    copyText,
  };
}

function makeDashboardView(result, mode, type, today) {
  const dashboard = result.dashboard || {};
  const total = Number(dashboard.total || 0);
  const comparison = (result.comparison || {})[type] || {};
  const delta = Number(comparison.delta || 0);
  const categories = (dashboard.categories || []).map((item) => {
    const icon = categoryDisplayIcon(item, type);
    const scheme = resolveCategoryScheme(item.name, type, icon);
    return {
      ...item,
      displayIcon: icon,
      chipClass: scheme.chipClass,
      iconColor: scheme.iconColor,
      chartColor: categoryChartColor(item.key, type),
      amountText: formatDisplayMoney(item.amount),
      previousText: formatDisplayMoney(item.previousAmount),
      deltaText: formatDisplayMoney(
        Math.abs(Number(item.amount || 0) - Number(item.previousAmount || 0))
      ),
      deltaDirection:
        Number(item.amount || 0) >= Number(item.previousAmount || 0) ? "增加" : "减少",
    };
  });
  const accounts = (dashboard.accounts || []).map((item) => ({
    ...item,
    amountText: formatDisplayMoney(item.amount),
  }));
  const topRecords = (dashboard.topRecords || []).map((item) => {
    const icon = item.categoryIcon || categoryDisplayIcon(item, type);
    const scheme = resolveCategoryScheme(item.categoryName || item.note || "", type, icon);
    return {
      ...item,
      categoryIcon: icon,
      chipClass: scheme.chipClass,
      iconColor: scheme.iconColor,
      amountText: formatDisplayMoney(item.amount),
    };
  });
  const label = type === "income" ? "收入" : "支出";
  const previousLabel = mode === "week" ? "上周" : mode === "year" ? "去年" : "上月";
  const partial = result.trendMeta && result.trendMeta.isPartial;
  const comparisonLabel = `${previousLabel}${partial ? "同期" : ""}`;
  const comparisonText =
    delta === 0
      ? `与${comparisonLabel}持平`
      : `较${comparisonLabel}${delta > 0 ? "增加" : "减少"} ¥${formatDisplayMoney(Math.abs(delta))}`;
  const comparisonTag =
    delta === 0
      ? `与${comparisonLabel}持平`
      : `${delta > 0 ? "↑" : "↓"} 较${comparisonLabel}${delta > 0 ? "增加" : "减少"} ¥${formatDisplayMoney(Math.abs(delta))}`;
  const editorialSummary = generateEditorialSummary({
    mode,
    type,
    total,
    categories,
    delta,
    comparisonLabel,
    balance: Number((result.overview || {}).balance),
    budget: result.budget,
  });
  const dates = new Map((dashboard.daily || []).map((day) => [day.date, day]));
  const start = (result.range || {}).start || "";
  const cells = [];
  if (mode === "month" && start) {
    const date = new Date(`${start}T00:00:00Z`);
    for (let i = 0; i < date.getUTCDay(); i += 1) cells.push({ key: `blank-${i}`, blank: true });
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let i = 0; i < days; i += 1) {
      const key = dayAdd(start, i);
      const future = key > today;
      const value = Number((dates.get(key) || {})[type] || 0);
      cells.push({
        key,
        day: i + 1,
        future,
        isToday: key === today,
        amountText: future ? "—" : calendarAmount(value),
        fullAmountText: formatDisplayMoney(value),
        hasAmount: value !== 0,
      });
    }
  }
  let source = mode === "month" ? result.recentMonths || [] : result.trend || [];
  if (mode === "week" && start) {
    const previous = result.previousTrend || [];
    source = Array.from({ length: 7 }, (_, index) => {
      const key = dayAdd(start, index);
      const current = (result.trend || []).find((item) => item.key === key) || {};
      return {
        ...current,
        key,
        label: ["一", "二", "三", "四", "五", "六", "日"][index],
        previous: previous[index] ? previous[index][type] : 0,
        future: key > today,
      };
    });
  }
  if (mode === "year" && start) {
    const byMonth = new Map(source.map((item) => [item.key, item]));
    source = Array.from({ length: 12 }, (_, index) => {
      const key = `${start.slice(0, 4)}-${String(index + 1).padStart(2, "0")}`;
      return {
        ...(byMonth.get(key) || {}),
        key,
        label: `${index + 1}月`,
        future: key > today.slice(0, 7),
      };
    });
  }
  const max = Math.max(
    0,
    ...source.map((item) => Math.max(Number(item[type] || 0), Number(item.previous || 0)))
  );
  const bars = source.map((item) => ({
    ...item,
    partial: !item.future && (item.key === today || item.key === today.slice(0, 7)),
    amountText: item.future ? "—" : formatDisplayMoney(item[type]),
    height: max ? (Number(item[type] || 0) * 100) / max : 0,
    previousHeight: max ? (Number(item.previous || 0) * 100) / max : 0,
  }));
  const completed = source.filter((item) => !item.future);
  const average = completed.length
    ? completed.reduce((sum, item) => sum + Math.round(Number(item[type] || 0) * 100), 0) /
      completed.length /
      100
    : 0;
  const settlement = calculateFamilySettlement(
    result.family,
    (result.range || {}).label || "",
    (result.ledger || {}).name || "咱家小账"
  );
  return {
    typeLabel: label,
    totalText: formatDisplayMoney(total),
    recordCount: Number(dashboard.recordCount || 0),
    dailyAverageText: formatDisplayMoney(dashboard.dailyAverage),
    comparisonText,
    comparisonTag,
    editorialSummary,
    settlement,
    isBalancePositive: Number((result.overview || {}).balance || 0) >= 0,
    categories,
    accounts,
    topRecords,
    cells,
    bars,
    maxText: formatDisplayMoney(max),
    averageText: formatDisplayMoney(average),
    incomeText: formatDisplayMoney((result.overview || {}).income),
    expenseText: formatDisplayMoney((result.overview || {}).expense),
    balanceText: formatDisplayMoney((result.overview || {}).balance),
  };
}

module.exports = {
  makeDashboardView,
  dayAdd,
  calendarAmount,
  categoryDisplayIcon,
  generateEditorialSummary,
  calculateFamilySettlement,
};
