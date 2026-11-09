function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function moneyCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function summarizeRecords(records = []) {
  let income = 0;
  let expense = 0;
  let expenseCount = 0;
  let largestExpense = 0;
  records.forEach((record) => {
    const amount = moneyCents(record.amount);
    if (record.type === "income") income += amount;
    if (record.type === "expense") {
      expense += amount;
      expenseCount += 1;
      largestExpense = Math.max(largestExpense, amount);
    }
  });
  return {
    income: income / 100,
    expense: expense / 100,
    balance: (income - expense) / 100,
    recordCount: records.length,
    expenseCount,
    averageExpense: expenseCount ? Math.round(expense / expenseCount) / 100 : 0,
    largestExpense: largestExpense / 100,
    saveRateAvailable: income > 0,
    saveRate: income ? Math.round(((income - expense) * 100) / income) : 0,
  };
}

function makeComparison(current, previous, enabled) {
  const metrics = ["income", "expense", "balance", "recordCount"];
  return metrics.reduce(
    (result, metric) => {
      const currentValue = Number(current[metric] || 0);
      const previousValue = Number(previous[metric] || 0);
      const delta = (moneyCents(currentValue) - moneyCents(previousValue)) / 100;
      result[metric] = {
        current: currentValue,
        previous: previousValue,
        delta,
        rate: previousValue ? Math.round((delta * 100) / Math.abs(previousValue)) : null,
        direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
      };
      return result;
    },
    { enabled: Boolean(enabled) }
  );
}

function makeTrendBuckets(mode, range, records = []) {
  const buckets = {};
  const ensureBucket = (key, label) => {
    buckets[key] = buckets[key] || { key, label, income: 0, expense: 0, balance: 0 };
  };
  if (["week", "month", "calendar", "custom"].includes(mode)) {
    const days = Math.round(
      (new Date(`${range.end}T00:00:00Z`) - new Date(`${range.start}T00:00:00Z`)) /
        (24 * 60 * 60 * 1000)
    );
    for (let day = 0; day < days; day += 1) {
      const key = new Date(
        new Date(`${range.start}T00:00:00Z`).getTime() + day * 24 * 60 * 60 * 1000
      )
        .toISOString()
        .slice(0, 10);
      ensureBucket(key, mode === "custom" ? key.slice(5) : `${Number(key.slice(8, 10))}\u65e5`);
    }
  } else if (mode === "year") {
    const year = range.start.slice(0, 4);
    const lastDate = new Date(`${range.end}T00:00:00Z`);
    lastDate.setUTCDate(lastDate.getUTCDate() - 1);
    const lastMonth = lastDate.getUTCFullYear() === Number(year) ? lastDate.getUTCMonth() + 1 : 12;
    for (let month = 1; month <= lastMonth; month += 1) {
      const key = `${year}-${String(month).padStart(2, "0")}`;
      ensureBucket(key, `${month}月`);
    }
  } else if (records.length) {
    const years = records.map((record) => Number(record.date.slice(0, 4))).filter(Number.isFinite);
    const firstYear = Math.min(...years);
    const lastYear = Math.max(...years);
    for (let year = firstYear; year <= lastYear; year += 1) ensureBucket(String(year), `${year}年`);
  }
  records.forEach((record) => {
    const key = ["week", "month", "calendar", "custom"].includes(mode)
      ? record.date
      : mode === "year"
        ? record.date.slice(0, 7)
        : record.date.slice(0, 4);
    const label = ["week", "month", "calendar", "custom"].includes(mode)
      ? mode === "custom"
        ? record.date.slice(5)
        : `${Number(record.date.slice(8, 10))}日`
      : mode === "year"
        ? `${Number(record.date.slice(5, 7))}月`
        : `${key}年`;
    ensureBucket(key, label);
    const amount = moneyCents(record.amount);
    buckets[key][record.type === "income" ? "income" : "expense"] += amount;
  });
  return Object.keys(buckets)
    .sort()
    .map((key) => ({
      ...buckets[key],
      income: buckets[key].income / 100,
      expense: buckets[key].expense / 100,
      balance: (buckets[key].income - buckets[key].expense) / 100,
    }));
}

function makeAllTimeTrend(records = []) {
  if (!records.length) return { granularity: "month", buckets: [] };
  const months = records.map((record) => String(record.date).slice(0, 7)).sort();
  const first = months[0];
  const last = months[months.length - 1];
  const monthIndex = (value) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
  const count = monthIndex(last) - monthIndex(first) + 1;
  if (count > 24) return { granularity: "year", buckets: makeTrendBuckets("all", {}, records) };
  const buckets = {};
  for (let index = monthIndex(first); index <= monthIndex(last); index += 1) {
    const key = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
    buckets[key] = { key, label: key, income: 0, expense: 0 };
  }
  records.forEach((record) => {
    const bucket = buckets[record.date.slice(0, 7)];
    bucket[record.type === "income" ? "income" : "expense"] += moneyCents(record.amount);
  });
  return {
    granularity: "month",
    buckets: Object.values(buckets).map((item) => ({
      ...item,
      income: item.income / 100,
      expense: item.expense / 100,
      balance: (item.income - item.expense) / 100,
    })),
  };
}

function makeRecentYearTrend(currentYear, records = [], yearCount = 5) {
  const safeCurrentYear = Number(currentYear);
  const safeYearCount = Math.max(1, Number(yearCount) || 5);
  if (!Number.isInteger(safeCurrentYear)) return [];
  const firstYear = safeCurrentYear - safeYearCount + 1;
  const buckets = {};
  for (let year = firstYear; year <= safeCurrentYear; year += 1) {
    buckets[year] = { key: String(year), label: String(year), income: 0, expense: 0 };
  }
  records.forEach((record) => {
    const year = Number(String(record.date || "").slice(0, 4));
    if (!buckets[year]) return;
    const metric = record.type === "income" ? "income" : "expense";
    buckets[year][metric] += moneyCents(record.amount);
  });
  return Object.values(buckets).map((item) => ({
    ...item,
    income: item.income / 100,
    expense: item.expense / 100,
    balance: (item.income - item.expense) / 100,
  }));
}

function groupCategories(records = [], type) {
  const grouped = new Map();
  let total = 0;
  records
    .filter((record) => record.type === type)
    .forEach((record) => {
      const categoryId = String(record.categoryId || "");
      const categoryName = String(record.categoryName || "");
      const parentCategory = String(record.parentCategory || "");
      const key = categoryId
        ? JSON.stringify(["id", categoryId])
        : JSON.stringify(["legacy", parentCategory, categoryName]);
      const item = grouped.get(key) || { key, categoryId, categoryName, parentCategory, amount: 0 };
      item.categoryName = categoryName;
      item.parentCategory = parentCategory;
      if (record.categoryIcon) item.categoryIcon = String(record.categoryIcon);
      item.name = categoryName || parentCategory || "其他";
      item.amount += moneyCents(record.amount);
      total += moneyCents(record.amount);
      grouped.set(key, item);
    });
  return Array.from(grouped.values())
    .filter((item) => item.amount > 0)
    .map((item) => ({
      ...item,
      amount: item.amount / 100,
      rate: total ? Math.round((item.amount * 100) / total) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

function applyCategoryIcons(rows = [], categories = []) {
  const icons = new Map(categories.map((category) => [String(category._id || ""), category.icon]));
  return rows.map((row) => ({
    ...row,
    recordCategoryIcon: row.categoryIcon || "",
    categoryIcon: (row.categoryId && icons.get(String(row.categoryId))) || row.categoryIcon || "",
  }));
}

function collapseRanking(rows = [], limit = 5) {
  if (rows.length <= limit) return rows;
  const visible = rows.slice(0, limit);
  const hidden = rows.slice(limit);
  const amount = hidden.reduce((sum, item) => sum + moneyCents(item.amount), 0);
  const total = rows.reduce((sum, item) => sum + moneyCents(item.amount), 0);
  return [
    ...visible,
    {
      name: "其余分类",
      amount: amount / 100,
      rate: total ? Math.round((amount * 100) / total) : 0,
    },
  ];
}

function makeAnalysisDashboard(records = [], previousRecords = [], type = "expense", dayCount = 0) {
  const selected = records.filter((record) => record.type === type);
  const totalCents = selected.reduce((sum, record) => sum + moneyCents(record.amount), 0);
  const currentCategories = groupCategories(selected, type);
  const previousCategories = groupCategories(previousRecords, type);
  const counts = new Map();
  const iconCandidates = new Map();
  const accounts = new Map();
  const daily = new Map();
  [...previousRecords, ...records].forEach((record) => {
    if (record.type !== type || typeof record.categoryIcon !== "string" || !record.categoryIcon)
      return;
    const key = record.categoryId
      ? JSON.stringify(["id", String(record.categoryId)])
      : JSON.stringify([
          "legacy",
          String(record.parentCategory || ""),
          String(record.categoryName || ""),
        ]);
    const candidates = iconCandidates.get(key) || new Map();
    candidates.delete(record.categoryIcon);
    candidates.set(record.categoryIcon, true);
    iconCandidates.set(key, candidates);
  });
  records.forEach((record) => {
    const day = daily.get(record.date) || { date: record.date, income: 0, expense: 0 };
    if (record.type === "income" || record.type === "expense") {
      day[record.type] += moneyCents(record.amount);
      daily.set(record.date, day);
    }
  });
  selected.forEach((record) => {
    const key = record.categoryId
      ? JSON.stringify(["id", String(record.categoryId)])
      : JSON.stringify([
          "legacy",
          String(record.parentCategory || ""),
          String(record.categoryName || ""),
        ]);
    counts.set(key, (counts.get(key) || 0) + 1);
    const missing = !record.account;
    const accountKey = JSON.stringify([missing, String(record.account || "")]);
    const account = accounts.get(accountKey) || {
      name: missing ? "未设置账户" : String(record.account),
      missing,
      amount: 0,
      recordCount: 0,
    };
    account.amount += moneyCents(record.amount);
    account.recordCount += 1;
    accounts.set(accountKey, account);
  });
  const previousByKey = new Map(previousCategories.map((item) => [item.key, item]));
  const currentByKey = new Map(currentCategories.map((item) => [item.key, item]));
  const categories = [...new Set([...currentByKey.keys(), ...previousByKey.keys()])].map((key) => {
    const current = currentByKey.get(key);
    const previous = previousByKey.get(key);
    return {
      ...(current || { ...previous, amount: 0, rate: 0 }),
      recordCount: counts.get(key) || 0,
      recordCategoryIcons: Array.from((iconCandidates.get(key) || new Map()).keys()).reverse(),
      previousAmount: previous ? previous.amount : 0,
    };
  });
  categories.sort(
    (left, right) => right.amount - left.amount || right.previousAmount - left.previousAmount
  );
  return {
    type,
    total: totalCents / 100,
    recordCount: selected.length,
    dailyAverage: dayCount > 0 ? Math.round(totalCents / dayCount) / 100 : 0,
    categories,
    accounts: Array.from(accounts.values())
      .map((item) => ({
        ...item,
        amount: item.amount / 100,
        rate: totalCents ? Math.round((item.amount * 100) / totalCents) : 0,
      }))
      .sort((left, right) => right.amount - left.amount),
    daily: Array.from(daily.values())
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((item) => ({ ...item, income: item.income / 100, expense: item.expense / 100 })),
    topRecords: [...selected]
      .sort(
        (left, right) =>
          Number(right.amount) - Number(left.amount) ||
          String(right.date).localeCompare(String(left.date)) ||
          String(right._id).localeCompare(String(left._id))
      )
      .slice(0, 5)
      .map((record) => ({
        _id: record._id,
        date: record.date,
        amount: roundMoney(record.amount),
        categoryName: record.categoryName || record.parentCategory || "其他",
        categoryIcon: record.categoryIcon || "",
        account: record.account || "",
        note: record.note || "",
      })),
  };
}

module.exports = {
  applyCategoryIcons,
  collapseRanking,
  groupCategories,
  makeComparison,
  makeAnalysisDashboard,
  makeRecentYearTrend,
  makeTrendBuckets,
  makeAllTimeTrend,
  moneyCents,
  roundMoney,
  summarizeRecords,
};
