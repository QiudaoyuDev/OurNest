const { formatDisplayMoney } = require("../../utils/money");

function recentPeriods(unit, count, today = new Date()) {
  const result = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    if (unit === "year") {
      result.push(String(today.getFullYear() - offset));
    } else {
      const date = new Date(today.getFullYear(), today.getMonth() - offset, 1);
      result.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
    }
  }
  return result;
}

function familyRow(period, family) {
  if (!family || family.value === "all") return null;
  const rows =
    family.dimension === "creator"
      ? period.creators || []
      : (period.family || {})[family.dimension === "payer" ? "payers" : "consumers"] || [];
  return rows.find((item) => (item.openid || "") === family.openid) || null;
}

function makeFamilyOptions(periods) {
  const options = [{ label: "全部成员", value: "all" }];
  const seen = new Set();
  periods.forEach((period) => {
    [
      ["payer", (period.family || {}).payers || []],
      ["consumer", (period.family || {}).consumers || []],
      ["creator", period.creators || []],
    ].forEach(([dimension, rows]) => {
      rows.forEach((row) => {
        const value = JSON.stringify([dimension, row.openid || ""]);
        if (seen.has(value)) return;
        seen.add(value);
        const label =
          dimension === "payer" ? "付款" : dimension === "consumer" ? "消费归属" : "录入";
        options.push({
          label: `${label} · ${row.name}`,
          value,
          dimension,
          openid: row.openid || "",
        });
      });
    });
  });
  return options;
}

function makeCategoryOptions(periods, family) {
  const options = [
    { label: family && family.value !== "all" ? "全部支出" : "全部收支", value: "all" },
  ];
  const seen = new Set();
  periods.forEach((period) => {
    const member = familyRow(period, family);
    const sources =
      family && family.value !== "all"
        ? [["expense", member ? member.categories || [] : []]]
        : [
            ["expense", period.expenseCategories || []],
            ["income", period.incomeCategories || []],
          ];
    sources.forEach(([type, categories]) => {
      categories.forEach((category) => {
        const value = `${type}:${category.key}`;
        if (seen.has(value)) return;
        seen.add(value);
        options.push({
          label: `${type === "expense" ? "支出" : "收入"} · ${category.parentCategory ? `${category.parentCategory} / ` : ""}${category.name}`,
          value,
          type,
          key: category.key,
          categoryFilter: category.categoryId
            ? { kind: "id", id: category.categoryId }
            : {
                kind: "legacy",
                name: category.categoryName || "",
                parent: category.parentCategory || "",
              },
        });
      });
    });
  });
  return options;
}

function changeText(value, base) {
  const delta = Math.round((value - base) * 100) / 100;
  if (!delta) return "与基准持平";
  const prefix = delta > 0 ? "+" : "-";
  const amount = formatDisplayMoney(Math.abs(delta));
  const rate = base
    ? `（${prefix}${Math.round((Math.abs(delta) * 100) / Math.abs(base))}%）`
    : "（基准为 0）";
  return `较基准 ${prefix}¥${amount}${rate}`;
}

function comparisonRows(periods, category, family) {
  const amounts = periods.map((period) => {
    const member = familyRow(period, family);
    if (!category || category.value === "all")
      return family && family.value !== "all"
        ? Number(member ? member.amount : 0)
        : Number((period.overview || {}).expense || 0);
    const rows =
      family && family.value !== "all"
        ? member
          ? member.categories || []
          : []
        : period[category.type === "income" ? "incomeCategories" : "expenseCategories"] || [];
    const item = rows.find((entry) => entry.key === category.key);
    return Number(item ? item.amount : 0);
  });
  const selectedOnly = (category && category.value !== "all") || (family && family.value !== "all");
  const maximum = Math.max(
    0.01,
    ...amounts.map(Math.abs),
    ...(selectedOnly
      ? []
      : periods.flatMap((period) => [
          Math.abs(Number(period.overview.income || 0)),
          Math.abs(Number(period.overview.expense || 0)),
          Math.abs(Number(period.overview.balance || 0)),
        ]))
  );
  const width = (value) =>
    Math.min(100, Math.max(0, (Math.abs(Number(value || 0)) * 100) / maximum));
  return periods.map((period, index) => ({
    ...period,
    amountWidth: width(amounts[index]),
    incomeWidth: width(period.overview.income),
    expenseWidth: width(period.overview.expense),
    balanceWidth: width(period.overview.balance),
    incomeText: formatDisplayMoney(period.overview.income),
    expenseText: formatDisplayMoney(period.overview.expense),
    balanceText: formatDisplayMoney(period.overview.balance),
    amountText: formatDisplayMoney(amounts[index]),
    chartAmount: amounts[index],
    chartIncome: Number(period.overview.income || 0),
    chartExpense: Number(period.overview.expense || 0),
    chartBalance: Number(period.overview.balance || 0),
    changeText: index ? changeText(amounts[index], amounts[0]) : "基准期",
    incomeChange: index
      ? changeText(Number(period.overview.income || 0), Number(periods[0].overview.income || 0))
      : "基准期",
    expenseChange: index
      ? changeText(Number(period.overview.expense || 0), Number(periods[0].overview.expense || 0))
      : "基准期",
    balanceChange: index
      ? changeText(Number(period.overview.balance || 0), Number(periods[0].overview.balance || 0))
      : "基准期",
  }));
}

module.exports = {
  recentPeriods,
  makeFamilyOptions,
  makeCategoryOptions,
  changeText,
  comparisonRows,
};
