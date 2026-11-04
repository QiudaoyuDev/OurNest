// Analysis 域：收支分析——按时间区间聚合、对比、趋势、分类占比。
const { familyExpenseGroups, creatorExpenseGroups } = require("../family.helpers");
const {
  db,
  _,
  ok,
  getLedgerForUser,
  getLedgerRole,
  assertReadable,
  getUsersByOpenids,
  getCurrentMonthRange,
  makeDateText,
  addMonth,
} = require("../shared/helpers");
const {
  collapseRanking: collapseAnalysisRanking,
  groupCategories: groupAnalysisCategories,
  makeComparison: getAnalysisComparison,
  makeRecentYearTrend: makeAnalysisRecentYearTrend,
  makeTrendBuckets: makeAnalysisTrendBuckets,
  moneyCents,
  roundMoney: roundAnalysisMoney,
  summarizeRecords: summarizeAnalysisRecords,
} = require("../analysis.helpers");

function isAnalysisDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
  );
}

function addAnalysisDays(dateText, delta) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function getAnalysisRange(mode, anchor, customStart, customEnd) {
  const current = getCurrentMonthRange();
  const today = makeDateText(current.year, current.month, current.day);
  if (mode === "all") return { start: "", end: "", label: "全部时间" };
  if (mode === "year") {
    const year = Number(anchor) || current.year;
    return {
      start: String(year) + "-01-01",
      end: String(year + 1) + "-01-01",
      label: `${year}年`,
    };
  }
  if (mode === "calendar") {
    const match = /^(\d{4})-(\d{1,2})$/.exec(String(anchor || ""));
    const year = match ? Number(match[1]) : current.year;
    const month = match ? Number(match[2]) : current.month;
    const nextMonth = addMonth(year, month, 1);
    return {
      year,
      month,
      start: makeDateText(year, month, 1),
      end: makeDateText(nextMonth.year, nextMonth.month, 1),
      label: `${year}年${month}月`,
    };
  }
  if (mode === "custom") {
    const start = String(customStart || current.start);
    const endInclusive = String(customEnd || today);
    if (
      !isAnalysisDate(start) ||
      !isAnalysisDate(endInclusive) ||
      endInclusive < start ||
      endInclusive > today ||
      (new Date(`${endInclusive}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000 >= 366
    )
      throw new Error("INVALID_ANALYSIS_RANGE");
    return {
      start,
      end: addAnalysisDays(endInclusive, 1),
      label: `${start} 至 ${endInclusive}`,
    };
  }
  const match = /^(\d{4})-(\d{1,2})$/.exec(String(anchor || ""));
  if (!match) return { ...current, label: `${current.year}年${current.month}月` };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const next = addMonth(year, month, 1);
  return {
    year,
    month,
    start: makeDateText(year, month, 1),
    end: makeDateText(next.year, next.month, 1),
    label: `${year}年${month}月`,
  };
}

function getTrendRange(mode, range, current) {
  if (mode === "month" && range.start === current.start) {
    return {
      ...range,
      end: addAnalysisDays(makeDateText(current.year, current.month, current.day), 1),
      isPartial: true,
      asOf: makeDateText(current.year, current.month, current.day),
    };
  }
  if (mode === "year" && Number(range.start.slice(0, 4)) === current.year) {
    const nextMonth = addMonth(current.year, current.month, 1);
    return {
      ...range,
      end: makeDateText(nextMonth.year, nextMonth.month, 1),
      isPartial: true,
      asOf: makeDateText(current.year, current.month, current.day),
    };
  }
  return { ...range, isPartial: false, asOf: "" };
}

function getMonthDayCount(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function makeComparablePeriodEnd(year, month, day) {
  const safeDay = Math.min(day, getMonthDayCount(year, month));
  return new Date(Date.UTC(year, month - 1, safeDay + 1)).toISOString().slice(0, 10);
}

function getPreviousAnalysisRange(mode, range, current) {
  if (mode === "month") {
    const previous = addMonth(range.year, range.month, -1);
    return {
      start: makeDateText(previous.year, previous.month, 1),
      end:
        range.start === current.start
          ? makeComparablePeriodEnd(previous.year, previous.month, current.day)
          : range.start,
    };
  }
  if (mode === "year") {
    const year = Number(range.start.slice(0, 4));
    return {
      start: `${year - 1}-01-01`,
      end:
        year === current.year
          ? makeComparablePeriodEnd(year - 1, current.month, current.day)
          : range.start,
    };
  }
  if (["calendar", "custom"].includes(mode)) {
    const days = Math.round(
      (new Date(`${range.end}T00:00:00Z`) - new Date(`${range.start}T00:00:00Z`)) / 86400000
    );
    return { start: addAnalysisDays(range.start, -Math.max(1, days)), end: range.start };
  }
  return null;
}

async function getAnalysisRecords(query, maxRecords = Infinity) {
  const rows = [];
  let offset = 0;
  while (true) {
    const page =
      (
        await db
          .collection("records")
          .where(query)
          .orderBy("date", "asc")
          .orderBy("_id", "asc")
          .skip(offset)
          .limit(100)
          .get()
      ).data || [];
    rows.push(...page);
    if (rows.length > maxRecords) throw new Error("ANALYSIS_RECORD_LIMIT_EXCEEDED");
    if (page.length < 100) return rows;
    offset += page.length;
  }
}

async function getAnalysis(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  if (!ledger) return ok({ noLedger: true });
  const role = getLedgerRole(openid, ledger);
  assertReadable(role);
  const mode = ["month", "year", "calendar", "custom", "all"].includes(data.mode)
    ? data.mode
    : "month";
  const range = getAnalysisRange(mode, data.anchor, data.customStart, data.customEnd);
  const currentMonthRange = getCurrentMonthRange();
  const today = makeDateText(
    currentMonthRange.year,
    currentMonthRange.month,
    currentMonthRange.day
  );
  if (
    (mode === "month" && range.start === currentMonthRange.start) ||
    (mode === "year" && range.start === `${currentMonthRange.year}-01-01`)
  ) {
    range.end = addAnalysisDays(today, 1);
  }
  const query = { ledgerId: ledger._id };
  if (range.start) query.date = _.gte(range.start).and(_.lt(range.end));
  const records = await getAnalysisRecords(query);
  let previousRecords = [];
  const isCurrentMonth = mode === "month" && range.start === currentMonthRange.start;
  let recentYearRecords = [];
  const selectedYear = mode === "year" ? Number(range.start.slice(0, 4)) : 0;
  if (mode === "year" && selectedYear <= currentMonthRange.year) {
    recentYearRecords = await getAnalysisRecords({
      ledgerId: ledger._id,
      date: _.gte(String(selectedYear - 4) + "-01-01").and(
        _.lt(
          selectedYear === currentMonthRange.year
            ? addAnalysisDays(today, 1)
            : String(selectedYear + 1) + "-01-01"
        )
      ),
    });
  }
  const previousRange = getPreviousAnalysisRange(mode, range, currentMonthRange);
  if (previousRange) {
    previousRecords = await getAnalysisRecords({
      ledgerId: ledger._id,
      date: _.gte(previousRange.start).and(_.lt(previousRange.end)),
    });
  }
  const hasDailyRange = ["month", "calendar", "custom"].includes(mode);
  const analysisEnd = hasDailyRange ? range.end : "";
  const analysisDayCount = hasDailyRange
    ? mode === "month" && isCurrentMonth
      ? currentMonthRange.day
      : Math.max(
          1,
          Math.round(
            (new Date(`${analysisEnd}T00:00:00Z`) - new Date(`${range.start}T00:00:00Z`)) / 86400000
          )
        )
    : 0;
  const trendRange = getTrendRange(mode, range, currentMonthRange);
  const trendRecords = records.filter(
    (record) =>
      !trendRange.start || (record.date >= trendRange.start && record.date < trendRange.end)
  );
  const overview = summarizeAnalysisRecords(records);
  const previousOverview = summarizeAnalysisRecords(previousRecords);
  const expense = overview.expense;
  const accounts = {},
    members = {},
    dailyExpense = {};
  records.forEach((record) => {
    const amount = moneyCents(record.amount),
      isIncome = record.type === "income";
    if (isIncome) return;
    const account = String(record.account || "未设置账户");
    accounts[account] = (accounts[account] || 0) + amount;
    const creatorId = String(record.ownerOpenid || "");
    const member = members[creatorId] || { amount: 0, recordCount: 0 };
    member.amount += amount;
    member.recordCount += 1;
    members[creatorId] = member;
    dailyExpense[record.date] = (dailyExpense[record.date] || 0) + amount;
  });
  const categoryList = groupAnalysisCategories(records, "expense");
  const incomeCategoryList = groupAnalysisCategories(records, "income");
  const accountList = Object.keys(accounts)
    .map((name) => ({
      name,
      amount: accounts[name] / 100,
      rate: expense ? Math.round(accounts[name] / expense) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
  const categoryChanges = (items) => {
    const result = {};
    ["income", "expense"].forEach((type) => {
      groupAnalysisCategories(items, type).forEach((item) => {
        result[`${type}:${item.key}`] = { amount: item.amount, name: item.name, type };
      });
    });
    return result;
  };
  const previousCategory = categoryChanges(previousRecords);
  const currentCategory = categoryChanges(records);
  const money = (value) =>
    Number(value || 0)
      .toFixed(2)
      .replace(/\.00$/, "");
  const insights = [];
  const topExpense = categoryList[0];
  if (topExpense)
    insights.push(
      "支出最多的是" +
        topExpense.name +
        "，共 ¥" +
        money(topExpense.amount) +
        "，占支出 " +
        topExpense.rate +
        "%"
    );
  if (mode !== "all") {
    const changes = Object.keys({ ...currentCategory, ...previousCategory })
      .map((key) => ({
        key,
        current: (currentCategory[key] || {}).amount || 0,
        previous: (previousCategory[key] || {}).amount || 0,
        name: (currentCategory[key] || previousCategory[key]).name,
        type: (currentCategory[key] || previousCategory[key]).type,
      }))
      .filter((item) => item.current !== item.previous)
      .sort((a, b) => Math.abs(b.current - b.previous) - Math.abs(a.current - a.previous));
    const change = changes[0];
    if (change) {
      const label = change.name + (change.type === "income" ? "收入" : "支出"),
        delta = change.current - change.previous;
      if (!change.previous) insights.push(label + "本期新增 ¥" + money(change.current));
      else
        insights.push(
          label +
            "较上期" +
            (delta > 0 ? "增加" : "减少") +
            " ¥" +
            money(Math.abs(delta)) +
            "，变化 " +
            Math.round((Math.abs(delta) * 100) / change.previous) +
            "%"
        );
    }
    const recordDelta = records.length - previousRecords.length;
    if (recordDelta && insights.length < 3)
      insights.push(
        "这期记了 " +
          records.length +
          " 笔，比上期" +
          (recordDelta > 0 ? "多" : "少") +
          " " +
          Math.abs(recordDelta) +
          " 笔"
      );
  } else {
    const peakDate = Object.keys(dailyExpense).sort((a, b) => dailyExpense[b] - dailyExpense[a])[0];
    if (peakDate && insights.length < 3)
      insights.push(peakDate + " 是累计支出最高的一天，共 ¥" + money(dailyExpense[peakDate] / 100));
    const topIncome = incomeCategoryList[0];
    if (topIncome && insights.length < 3)
      insights.push(topIncome.name + "是最主要的收入来源，累计 ¥" + money(topIncome.amount));
  }
  if (!insights.length) insights.push("这段时间还没有足够的记录可以分析");
  const comparison = getAnalysisComparison(overview, previousOverview, mode !== "all");
  const insightGroups = { up: [], down: [], neutral: [...insights] };
  if (comparison.enabled) {
    const labels = {
      income: "收入",
      expense: "支出",
      balance: "结余",
    };
    Object.keys(labels).forEach((metric) => {
      const item = comparison[metric];
      if (!item || item.direction === "flat") return;
      const direction = item.direction === "up" ? "up" : "down";
      const amount = money(Math.abs(item.delta));
      insightGroups[direction].push(
        `${labels[metric]}${direction === "up" ? "上升" : "下降"} ¥${amount}`
      );
    });
  }
  const family = ledger.type === "shared" ? familyExpenseGroups(records) : null;
  const familyIds = family
    ? [...family.payers, ...family.consumers].map((item) => item.openid)
    : [];
  const users = await getUsersByOpenids([...Object.keys(members), ...familyIds]);
  const decorateFamily = (rows) =>
    rows.map((item) => ({
      ...item,
      name: item.openid
        ? (users[item.openid] || {}).nickName || (item.openid === openid ? "我" : "历史成员")
        : "其他",
    }));
  return ok({
    ledger: {
      _id: ledger._id,
      name: ledger.name,
      type: ledger.type || "personal",
    },
    role,
    readonly: role === "readonly",
    mode,
    range,
    overview: {
      ...overview,
      dayCount: analysisDayCount,
      dailyExpense: hasDailyRange ? roundAnalysisMoney(expense / Math.max(1, analysisDayCount)) : 0,
    },
    previousOverview,
    comparisonRange: previousRange,
    comparison,
    insightGroups,
    budget: {
      enabled: isCurrentMonth && Boolean(ledger.budgetEnabled),
      amount: isCurrentMonth ? Number(ledger.monthlyBudget || 0) : 0,
      spent: expense,
      remaining: isCurrentMonth
        ? roundAnalysisMoney(Number(ledger.monthlyBudget || 0) - expense)
        : 0,
      rate:
        isCurrentMonth && Number(ledger.monthlyBudget || 0)
          ? Math.round((expense * 100) / Number(ledger.monthlyBudget || 0))
          : 0,
    },
    trend: makeAnalysisTrendBuckets(mode, trendRange, trendRecords),
    trendMeta: {
      isPartial: trendRange.isPartial,
      asOf: trendRange.asOf,
    },
    recentYearTrend:
      mode === "year" && selectedYear <= currentMonthRange.year
        ? makeAnalysisRecentYearTrend(selectedYear, recentYearRecords)
        : [],
    calendarDays:
      mode === "calendar"
        ? Object.keys(
            records.reduce((result, record) => {
              const item = result[record.date] || {
                date: record.date,
                income: 0,
                expense: 0,
                recordCount: 0,
              };
              item[record.type === "income" ? "income" : "expense"] += Number(record.amount || 0);
              item.recordCount += 1;
              result[record.date] = item;
              return result;
            }, {})
          )
            .sort()
            .map((date) => {
              const item = records
                .filter((record) => record.date === date)
                .reduce(
                  (result, record) => {
                    result[record.type === "income" ? "income" : "expense"] += moneyCents(
                      record.amount
                    );
                    result.recordCount += 1;
                    return result;
                  },
                  { date, income: 0, expense: 0, recordCount: 0 }
                );
              return {
                ...item,
                income: item.income / 100,
                expense: item.expense / 100,
              };
            })
        : [],
    calendarRecords:
      mode === "calendar"
        ? records.map((record) => ({
            _id: record._id,
            date: record.date,
            type: record.type,
            amount: Number(record.amount || 0),
            categoryName: record.parentCategory || record.categoryName || "其他",
            account: record.account || "",
            note: record.note || "",
          }))
        : [],
    topExpenseRecords:
      mode === "month"
        ? records
            .filter((record) => record.type === "expense")
            .sort((left, right) => Number(right.amount || 0) - Number(left.amount || 0))
            .slice(0, 5)
            .map((record) => ({
              _id: record._id,
              date: record.date,
              amount: roundAnalysisMoney(record.amount),
              categoryName: record.parentCategory || record.categoryName || "其他",
              categoryIcon: record.categoryIcon || "",
              account: record.account || "",
              note: record.note || "",
            }))
        : [],
    categories: categoryList,
    categoryChart: collapseAnalysisRanking(categoryList),
    incomeCategories: incomeCategoryList,
    incomeCategoryChart: collapseAnalysisRanking(incomeCategoryList),
    accounts: accountList,
    family: family
      ? {
          ...family,
          payers: decorateFamily(family.payers),
          consumers: decorateFamily(family.consumers),
        }
      : null,
    members: Object.keys(members)
      .map((id) => ({
        openid: id,
        name: id ? (users[id] || {}).nickName || (id === openid ? "我" : "历史成员") : "其他",
        amount: members[id].amount / 100,
        recordCount: members[id].recordCount,
        categories: groupAnalysisCategories(
          records.filter((record) => String(record.ownerOpenid || "") === id),
          "expense"
        ),
        rate: expense ? Math.round(members[id].amount / expense) : 0,
      }))
      .sort((a, b) => b.amount - a.amount),
    insights,
  });
}

function getComparisonPeriods(unit, periods, current) {
  const max = unit === "month" ? 12 : unit === "year" ? 5 : 0;
  if (
    !max ||
    !Array.isArray(periods) ||
    periods.length < 2 ||
    periods.length > max ||
    new Set(periods).size !== periods.length
  )
    throw new Error("INVALID_COMPARISON_PERIODS");
  const today = makeDateText(current.year, current.month, current.day);
  return periods.map((value) => {
    if (
      typeof value !== "string" ||
      !(unit === "month" ? /^\d{4}-(0[1-9]|1[0-2])$/ : /^\d{4}$/).test(value)
    )
      throw new Error("INVALID_COMPARISON_PERIODS");
    const year = Number(value.slice(0, 4));
    const month = unit === "month" ? Number(value.slice(5, 7)) : 1;
    if (
      year < current.year - 10 ||
      year > current.year ||
      (unit === "month" && year === current.year && month > current.month)
    )
      throw new Error("INVALID_COMPARISON_PERIODS");
    const start = makeDateText(year, month, 1);
    const next = unit === "month" ? addMonth(year, month, 1) : { year: year + 1, month: 1 };
    const naturalEnd = makeDateText(next.year, next.month, 1);
    const partial = start <= today && naturalEnd > today;
    return { key: value, start, end: partial ? addAnalysisDays(today, 1) : naturalEnd, partial };
  });
}

async function getPeriodComparison(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  const role = getLedgerRole(openid, ledger);
  assertReadable(role);
  const periods = getComparisonPeriods(data.unit, data.periods, getCurrentMonthRange());
  const start = periods.map((item) => item.start).sort()[0];
  const sortedEnds = periods.map((item) => item.end).sort();
  const end = sortedEnds[sortedEnds.length - 1];
  const records = await getAnalysisRecords(
    { ledgerId: ledger._id, date: _.gte(start).and(_.lt(end)) },
    5000
  );
  const results = periods.map((period) => {
    const rows = records.filter(
      (record) => record.date >= period.start && record.date < period.end
    );
    return {
      ...period,
      overview: summarizeAnalysisRecords(rows),
      incomeCategories: groupAnalysisCategories(rows, "income"),
      expenseCategories: groupAnalysisCategories(rows, "expense"),
      family: ledger.type === "shared" ? familyExpenseGroups(rows) : null,
      creators: ledger.type === "shared" ? creatorExpenseGroups(rows) : [],
    };
  });
  if (ledger.type === "shared") {
    const ids = results.flatMap((item) =>
      [...item.family.payers, ...item.family.consumers, ...item.creators].map((row) => row.openid)
    );
    const users = await getUsersByOpenids(ids);
    const decorate = (rows) =>
      rows.map((row) => ({
        ...row,
        name: row.openid
          ? (users[row.openid] || {}).nickName || (row.openid === openid ? "我" : "历史成员")
          : "其他",
      }));
    results.forEach((item) => {
      item.family.payers = decorate(item.family.payers);
      item.family.consumers = decorate(item.family.consumers);
      item.creators = decorate(item.creators);
    });
  }
  return ok({
    ledger: { _id: ledger._id, name: ledger.name, type: ledger.type || "personal" },
    role,
    unit: data.unit,
    periods: results,
  });
}

module.exports = {
  getAnalysis,
  getPeriodComparison,
  getComparisonPeriods,
  getAnalysisRange,
  getPreviousAnalysisRange,
  getTrendRange,
};
