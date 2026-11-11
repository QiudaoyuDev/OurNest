const { formatMoney: formatDisplayMoney } = require("../../utils/money");
const ICON_GLYPHS = require("../tl-icon/glyphs");
const CATEGORY_ICONS = require("../tl-icon/category-icons");

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

function makeDashboardView(result, mode, type, today) {
  const dashboard = result.dashboard || {};
  const total = Number(dashboard.total || 0);
  const comparison = (result.comparison || {})[type] || {};
  const delta = Number(comparison.delta || 0);
  const categories = (dashboard.categories || []).map((item) => ({
    ...item,
    displayIcon: categoryDisplayIcon(item, type),
    amountText: formatDisplayMoney(item.amount),
    previousText: formatDisplayMoney(item.previousAmount),
    deltaText: formatDisplayMoney(
      Math.abs(Number(item.amount || 0) - Number(item.previousAmount || 0))
    ),
    deltaDirection: Number(item.amount || 0) >= Number(item.previousAmount || 0) ? "增加" : "减少",
  }));
  const accounts = (dashboard.accounts || []).map((item) => ({
    ...item,
    amountText: formatDisplayMoney(item.amount),
  }));
  const topRecords = (dashboard.topRecords || []).map((item) => ({
    ...item,
    amountText: formatDisplayMoney(item.amount),
  }));
  const label = type === "income" ? "收入" : "支出";
  const previousLabel = mode === "week" ? "上周" : mode === "year" ? "去年" : "上月";
  const partial = result.trendMeta && result.trendMeta.isPartial;
  const comparisonLabel = `${previousLabel}${partial ? "同期" : ""}`;
  const comparisonText =
    delta === 0
      ? `与${comparisonLabel}持平`
      : `较${comparisonLabel}${delta > 0 ? "增加" : "减少"} ¥${formatDisplayMoney(Math.abs(delta))}`;
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
    amountText: item.future ? "—" : formatDisplayMoney(item[type]),
    height: max
      ? Math.max(Number(item[type] || 0) ? 4 : 0, Math.round((Number(item[type] || 0) * 100) / max))
      : 0,
    previousHeight: max
      ? Math.max(
          Number(item.previous || 0) ? 4 : 0,
          Math.round((Number(item.previous || 0) * 100) / max)
        )
      : 0,
  }));
  const completed = source.filter((item) => !item.future);
  const average = completed.length
    ? completed.reduce((sum, item) => sum + Math.round(Number(item[type] || 0) * 100), 0) /
      completed.length /
      100
    : 0;
  return {
    typeLabel: label,
    totalText: formatDisplayMoney(total),
    recordCount: Number(dashboard.recordCount || 0),
    dailyAverageText: formatDisplayMoney(dashboard.dailyAverage),
    comparisonText,
    categories,
    accounts,
    topRecords,
    cells,
    bars,
    averageText: formatDisplayMoney(average),
    incomeText: formatDisplayMoney((result.overview || {}).income),
    expenseText: formatDisplayMoney((result.overview || {}).expense),
    balanceText: formatDisplayMoney((result.overview || {}).balance),
  };
}

module.exports = { makeDashboardView, dayAdd, calendarAmount, categoryDisplayIcon };
