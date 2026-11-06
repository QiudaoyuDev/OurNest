const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {
  collapseRanking,
  groupCategories,
  makeComparison,
  makeRecentYearTrend,
  makeTrendBuckets,
  summarizeRecords,
  makeAnalysisDashboard,
  applyCategoryIcons,
} = require("../cloudfunctions/ourNest/analysis.helpers");

test("category icon resolution uses category id and preserves historical fallback", () => {
  const rows = [
    { key: "a", categoryId: "a", categoryIcon: "old-line" },
    { key: "b", categoryId: "b", categoryIcon: "history-line" },
    { key: "legacy", categoryId: "", categoryIcon: "legacy-line" },
  ];
  const resolved = applyCategoryIcons(rows, [
    { _id: "a", icon: "new-line" },
    { _id: "b", icon: "" },
  ]);
  assert.equal(resolved[0].categoryIcon, "new-line");
  assert.equal(resolved[0].recordCategoryIcon, "old-line");
  assert.equal(resolved[1].categoryIcon, "history-line");
  assert.equal(resolved[2].categoryIcon, "legacy-line");
});

test("dashboard aggregates income and expense independently without merging missing accounts", () => {
  const rows = [
    {
      _id: "a",
      date: "2026-03-01",
      type: "income",
      amount: 0.1,
      categoryId: "pay",
      account: "银行卡",
    },
    { _id: "b", date: "2026-03-01", type: "income", amount: 0.2, categoryId: "pay", account: "" },
    {
      _id: "c",
      date: "2026-03-02",
      type: "expense",
      amount: 8,
      categoryId: "food",
      account: "银行卡",
    },
  ];
  const result = makeAnalysisDashboard(
    rows,
    [{ type: "income", amount: 1, categoryId: "old" }],
    "income",
    2
  );
  assert.equal(result.total, 0.3);
  assert.equal(result.recordCount, 2);
  assert.equal(result.dailyAverage, 0.15);
  assert.equal(result.categories.find((row) => row.categoryId === "pay").recordCount, 2);
  assert.equal(result.categories.find((row) => row.categoryId === "old").previousAmount, 1);
  assert.equal(result.accounts.find((row) => row.missing).recordCount, 1);
  assert.equal(result.daily[0].income, 0.3);
  assert.equal(result.topRecords[0]._id, "b");
});

test("category aggregation carries the recorded icon without changing category identity", () => {
  const rows = groupCategories(
    [
      {
        type: "expense",
        categoryId: "food",
        categoryName: "餐饮",
        categoryIcon: "restaurant-line",
        amount: 10,
      },
      {
        type: "expense",
        categoryId: "food",
        categoryName: "餐饮",
        categoryIcon: "restaurant-line",
        amount: 20,
      },
      {
        type: "expense",
        categoryId: "travel",
        categoryName: "出行",
        categoryIcon: "bus-line",
        amount: 5,
      },
    ],
    "expense"
  );
  assert.equal(rows[0].categoryIcon, "restaurant-line");
  assert.equal(rows[0].amount, 30);
  assert.equal(rows[1].categoryIcon, "bus-line");
});

test("dashboard keeps recent historical icon candidates for legacy categories", () => {
  const dashboard = makeAnalysisDashboard(
    [
      {
        date: "2026-01-01",
        type: "expense",
        categoryName: "交通",
        categoryIcon: "bus-line",
        amount: 1,
      },
      {
        date: "2026-01-02",
        type: "expense",
        categoryName: "交通",
        categoryIcon: "not-a-glyph",
        amount: 2,
      },
    ],
    [],
    "expense",
    2
  );
  assert.deepEqual(dashboard.categories[0].recordCategoryIcons, ["not-a-glyph", "bus-line"]);
});

test("analysis handler marks current month and year trends as partial", () => {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync("cloudfunctions/ourNest/handlers/analysis.handler.js", "utf8"),
    {
      module,
      exports: module.exports,
      require: (modulePath) =>
        modulePath.includes("shared/helpers")
          ? {
              getCurrentMonthRange: () => ({ year: 2026, month: 3, day: 13, start: "2026-03-01" }),
              makeDateText: (year, month, day) =>
                `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
              addMonth: (year, month, delta) => {
                const date = new Date(Date.UTC(year, month - 1 + delta, 1));
                return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
              },
            }
          : {},
    }
  );
  const current = { year: 2026, month: 3, day: 13, start: "2026-03-01" };
  const week = module.exports.getAnalysisRange("week", "2026-03-13");
  assert.equal(week.start, "2026-03-09");
  assert.equal(week.end, "2026-03-16");
  const previous = module.exports.getPreviousAnalysisRange("week", week, current);
  assert.equal(previous.start, "2026-03-02");
  assert.equal(previous.end, "2026-03-07");
  assert.throws(() => module.exports.getAnalysisRange("week", "2026-03-14"));
  assert.equal(
    module.exports.getTrendRange("month", { start: "2026-03-01", end: "2026-04-01" }, current).end,
    "2026-03-14"
  );
  assert.equal(
    module.exports.getTrendRange("year", { start: "2026-01-01", end: "2027-01-01" }, current).end,
    "2026-04-01"
  );
});

test("monthly analysis fills leap-year days and keeps zero buckets", () => {
  const trend = makeTrendBuckets("month", { start: "2024-02-01", end: "2024-03-01" }, [
    { date: "2024-02-29", type: "expense", amount: 88.5 },
  ]);

  assert.equal(trend.length, 29);
  assert.deepEqual(trend[0], {
    key: "2024-02-01",
    label: "1日",
    income: 0,
    expense: 0,
    balance: 0,
  });
  assert.equal(trend[28].expense, 88.5);
  assert.equal(trend[28].balance, -88.5);
});

test("yearly and all-time analysis fill stable time buckets", () => {
  const yearly = makeTrendBuckets("year", { start: "2026-01-01", end: "2027-01-01" }, [
    { date: "2026-08-13", type: "income", amount: 100 },
  ]);
  assert.equal(yearly.length, 12);
  assert.equal(yearly[7].income, 100);

  const allTime = makeTrendBuckets("all", {}, [
    { date: "2022-01-01", type: "expense", amount: 10 },
    { date: "2024-01-01", type: "income", amount: 30 },
  ]);
  assert.deepEqual(
    allTime.map((item) => item.key),
    ["2022", "2023", "2024"]
  );
});

test("current analysis trends stop at the supplied partial period", () => {
  const daily = makeTrendBuckets("month", { start: "2026-03-01", end: "2026-03-14" }, []);
  assert.equal(daily.length, 13);
  assert.equal(daily.at(-1).key, "2026-03-13");

  const yearly = makeTrendBuckets("year", { start: "2026-01-01", end: "2026-04-01" }, []);
  assert.deepEqual(
    yearly.map((item) => item.key),
    ["2026-01", "2026-02", "2026-03"]
  );
});

test("custom trends show unambiguous cross-month dates", () => {
  const rows = makeTrendBuckets("custom", { start: "2025-12-31", end: "2026-01-02" }, []);
  assert.deepEqual(
    rows.map((item) => item.label),
    ["12-31", "01-01"]
  );
});

test("weekly trends include every day across year boundaries", () => {
  const rows = makeTrendBuckets("week", { start: "2025-12-29", end: "2026-01-05" }, [
    { date: "2026-01-01", type: "income", amount: 12.34 },
  ]);
  assert.equal(rows.length, 7);
  assert.equal(rows[0].key, "2025-12-29");
  assert.equal(rows[3].income, 12.34);
  assert.equal(rows[6].key, "2026-01-04");
});

test("recent year trend always includes current year and the previous four years", () => {
  const trend = makeRecentYearTrend(2026, [
    { date: "2021-12-31", type: "income", amount: 999 },
    { date: "2022-01-01", type: "income", amount: 100 },
    { date: "2022-02-01", type: "expense", amount: 40 },
    { date: "2026-08-23", type: "expense", amount: 25.5 },
  ]);

  assert.deepEqual(
    trend.map((item) => item.label),
    ["2022", "2023", "2024", "2025", "2026"]
  );
  assert.equal(trend[0].balance, 60);
  assert.equal(trend[1].balance, 0);
  assert.equal(trend[4].balance, -25.5);
});

test("analysis overview and comparison handle expense-only periods", () => {
  const current = summarizeRecords([
    { type: "expense", amount: 10 },
    { type: "expense", amount: 25 },
  ]);
  const previous = summarizeRecords([{ type: "expense", amount: 20 }]);
  const comparison = makeComparison(current, previous, true);

  assert.equal(current.balance, -35);
  assert.equal(current.averageExpense, 17.5);
  assert.equal(current.largestExpense, 25);
  assert.equal(current.saveRateAvailable, false);
  assert.equal(current.saveRate, 0);
  assert.equal(comparison.expense.delta, 15);
  assert.equal(comparison.expense.rate, 75);
});

test("large repeated amounts conserve cents across summaries, trends and family groups", () => {
  const {
    familyExpenseGroups,
    creatorExpenseGroups,
  } = require("../cloudfunctions/ourNest/family.helpers");
  const rows = Array.from({ length: 5000 }, (_, index) => ({
    date: "2026-03-01",
    type: "expense",
    amount: 12345678.91,
    categoryId: "lunch",
    categoryName: "午餐",
    ownerOpenid: index % 2 ? "a" : "b",
    familyAttribution: { payerOpenid: index % 2 ? "a" : "b", consumerKind: "public" },
  }));
  const total = 61728394550;
  assert.equal(summarizeRecords(rows).expense, total);
  assert.equal(groupCategories(rows, "expense")[0].amount, total);
  assert.equal(
    makeTrendBuckets("month", { start: "2026-03-01", end: "2026-03-02" }, rows)[0].expense,
    total
  );
  assert.equal(makeRecentYearTrend(2026, rows).at(-1).expense, total);
  const family = familyExpenseGroups(rows);
  assert.equal(family.total, total);
  assert.equal(
    family.payers.reduce((sum, item) => sum + item.amount, 0),
    total
  );
  assert.equal(
    family.consumers.reduce((sum, item) => sum + item.amount, 0),
    total
  );
  assert.equal(
    creatorExpenseGroups(rows).reduce((sum, item) => sum + item.amount, 0),
    total
  );
});

test("chart ranking keeps top five and combines the remainder", () => {
  const rows = [60, 50, 40, 30, 20, 10, 5].map((amount, index) => ({
    name: `分类${index + 1}`,
    amount,
    rate: 0,
  }));
  const ranking = collapseRanking(rows);

  assert.equal(ranking.length, 6);
  assert.equal(ranking[5].name, "其余分类");
  assert.equal(ranking[5].amount, 15);
  assert.equal(ranking[5].rate, 7);
});

test("empty current periods still compare with real previous records", async () => {
  const module = { exports: {} };
  const rows = [{ date: "2026-02-10", type: "expense", amount: 42, ownerOpenid: "user" }];
  const categoryQueries = [];
  const command = {
    gte: (start) => ({ and: (end) => ({ start, end }) }),
    lt: (end) => end,
    in: (values) => values,
  };
  const helpers = {
    db: {
      collection: (name) =>
        name === "categories"
          ? {
              where: (query) => {
                categoryQueries.push(query);
                return {
                  limit: () => ({
                    get: async () => ({ data: [{ _id: "food", icon: "restaurant-line" }] }),
                  }),
                };
              },
            }
          : {
              where: (query) => ({
                orderBy: () => ({
                  orderBy: () => ({
                    skip: () => ({
                      limit: () => ({
                        get: async () => ({
                          data: rows.filter(
                            (row) => row.date >= query.date.start && row.date < query.date.end
                          ),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            },
    },
    _: command,
    ok: (data) => data,
    getLedgerForUser: async () => ({ _id: "ledger", type: "shared" }),
    getLedgerRole: () => "owner",
    assertReadable: () => {},
    getUsersByOpenids: async () => ({}),
    getCurrentMonthRange: () => ({ year: 2026, month: 3, day: 13, start: "2026-03-01" }),
    makeDateText: (year, month, day) =>
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    addMonth: (year, month, delta) => {
      const date = new Date(Date.UTC(year, month - 1 + delta, 1));
      return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
    },
  };
  vm.runInNewContext(
    fs.readFileSync("cloudfunctions/ourNest/handlers/analysis.handler.js", "utf8"),
    {
      module,
      exports: module.exports,
      require: (path) =>
        path.includes("shared/helpers")
          ? helpers
          : path.includes("family.helpers")
            ? require("../cloudfunctions/ourNest/family.helpers")
            : require("../cloudfunctions/ourNest/analysis.helpers"),
    }
  );
  const previous = module.exports.getPreviousAnalysisRange;
  const feb = previous(
    "month",
    { year: 2024, month: 3, start: "2024-03-01" },
    {
      year: 2024,
      month: 3,
      day: 31,
      start: "2024-03-01",
    }
  );
  assert.equal(feb.start, "2024-02-01");
  assert.equal(feb.end, "2024-03-01");
  const leap = previous(
    "year",
    { start: "2024-01-01" },
    {
      year: 2024,
      month: 2,
      day: 29,
    }
  );
  assert.equal(leap.end, "2023-03-01");
  const custom = previous("custom", { start: "2026-01-01", end: "2026-01-04" }, {});
  assert.equal(custom.start, "2025-12-29");
  assert.equal(custom.end, "2026-01-01");
  const customRange = module.exports.getAnalysisRange("custom", "", "2025-12-30", "2026-01-02");
  assert.equal(customRange.end, "2026-01-03");
  assert.throws(
    () => module.exports.getAnalysisRange("custom", "", "2024-01-01", "2026-01-01"),
    /INVALID_ANALYSIS_RANGE/
  );
  assert.throws(
    () => module.exports.getAnalysisRange("custom", "", "2026-03-01", "2026-03-14"),
    /INVALID_ANALYSIS_RANGE/
  );
  const result = await module.exports.getAnalysis("user", { mode: "month", anchor: "2026-03" });
  assert.equal(result.overview.expense, 0);
  assert.equal(result.previousOverview.expense, 42);
  assert.equal(result.comparisonRange.start, "2026-02-01");
  assert.equal(result.comparisonRange.end, "2026-02-14");
  assert.equal(result.comparison.expense.delta, -42);
  assert.equal(result.comparison.expense.rate, -100);
  rows.push({ date: "2026-03-20", type: "expense", amount: 999, ownerOpenid: "user" });
  const currentMonth = await module.exports.getAnalysis("user", {
    mode: "month",
    anchor: "2026-03",
  });
  assert.equal(currentMonth.range.end, "2026-03-14");
  assert.equal(currentMonth.overview.expense, 0);
  const dashboardMonth = await module.exports.getAnalysis("user", {
    mode: "month",
    anchor: "2026-03",
    analysisView: true,
    analysisType: "expense",
  });
  assert.equal(dashboardMonth.dashboard.total, 0);
  assert.equal(dashboardMonth.previousOverview.expense, 42);
  assert.equal(dashboardMonth.recentMonths.length, 6);
  assert.equal(dashboardMonth.recentMonths[4].expense, 42);
  assert.equal(dashboardMonth.recentMonths[5].expense, 0);
  const currentYear = await module.exports.getAnalysis("user", { mode: "year", anchor: "2026" });
  assert.equal(currentYear.range.end, "2026-03-14");
  assert.equal(currentYear.overview.expense, 42);
  assert.equal(currentYear.recentYearTrend.at(-1).expense, 42);
  const comparison = await module.exports.getPeriodComparison("user", {
    ledgerId: "ledger",
    unit: "month",
    periods: ["2026-02", "2026-03"],
  });
  assert.equal(comparison.periods[0].overview.expense, 42);
  assert.equal(comparison.periods[1].overview.expense, 0);
  assert.equal(comparison.periods[1].end, "2026-03-14");
  assert.equal(comparison.periods[1].partial, true);
  await assert.rejects(
    module.exports.getPeriodComparison("user", {
      ledgerId: "ledger",
      unit: "month",
      periods: ["2026-02", "2026-04"],
    }),
    /INVALID_COMPARISON_PERIODS/
  );
  const february = await module.exports.getAnalysis("user", { mode: "month", anchor: "2026-02" });
  assert.equal(february.members[0].amount, 42);
  assert.equal(february.members[0].recordCount, 1);
  assert.equal(february.members[0].openid, "user");
  assert.equal(february.family.total, 42);
  assert.equal(february.family.payers[0].name, "其他");
  assert.equal(february.family.consumers[0].name, "其他");
  const historic = await module.exports.getAnalysis("user", { mode: "year", anchor: "2023" });
  assert.deepEqual(
    Array.from(historic.recentYearTrend, (item) => item.key),
    ["2019", "2020", "2021", "2022", "2023"]
  );
  const future = await module.exports.getAnalysis("user", { mode: "year", anchor: "2027" });
  assert.equal(future.recentYearTrend.length, 0);
  rows.push({
    date: "2026-03-02",
    type: "expense",
    amount: 10,
    categoryId: "food",
    categoryIcon: "bus-line",
  });
  const withCategory = await module.exports.getAnalysis("user", {
    mode: "month",
    anchor: "2026-03",
    analysisView: true,
  });
  assert.equal(withCategory.dashboard.categories[0].categoryIcon, "restaurant-line");
  assert.equal(withCategory.dashboard.categories[0].recordCategoryIcon, "bus-line");
  assert.equal(categoryQueries[0].ledgerId, "ledger");
  assert.equal(categoryQueries[0]._id[0], "food");
});

test("category grouping uses stable identifiers and distinguishes unlinked parents", () => {
  const rows = groupCategories(
    [
      {
        type: "expense",
        categoryId: "c1",
        categoryName: "旧名",
        parentCategory: "餐饮",
        amount: 3,
      },
      {
        type: "expense",
        categoryId: "c1",
        categoryName: "新名",
        parentCategory: "餐饮",
        amount: 4,
      },
      { type: "expense", categoryName: "其他", parentCategory: "餐饮", amount: 5 },
      { type: "expense", categoryName: "其他", parentCategory: "交通", amount: 6 },
      { type: "income", categoryId: "c1", amount: 100 },
    ],
    "expense"
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].categoryId, "c1");
  assert.equal(rows[0].name, "新名");
  assert.equal(rows[0].amount, 7);
  assert.equal(rows[1].parentCategory, "交通");
  assert.equal(rows[2].parentCategory, "餐饮");
});

test("family attribution validates members and preserves unknown historical values", () => {
  const { normalizeFamilyAttribution } = require("../cloudfunctions/ourNest/family.helpers");
  const ledger = {
    type: "shared",
    ownerOpenid: "a",
    memberOpenids: ["a", "b"],
    viewerOpenids: ["v"],
  };
  assert.deepEqual(normalizeFamilyAttribution({ ledger, openid: "a", isImport: true }), {
    payerOpenid: "",
    consumerKind: "unknown",
    consumerOpenid: "",
  });
  assert.deepEqual(
    normalizeFamilyAttribution({
      ledger,
      openid: "a",
      input: { payerOpenid: "b", consumerKind: "personal", consumerOpenid: "a" },
    }),
    { payerOpenid: "b", consumerKind: "personal", consumerOpenid: "a" }
  );
  assert.throws(
    () =>
      normalizeFamilyAttribution({
        ledger,
        openid: "a",
        input: { payerOpenid: "v", consumerKind: "personal", consumerOpenid: "a" },
      }),
    /INVALID_FAMILY_MEMBER/
  );
  const existing = { payerOpenid: "removed", consumerKind: "personal", consumerOpenid: "removed" };
  assert.deepEqual(
    normalizeFamilyAttribution({ ledger, openid: "a", existing, input: existing }),
    existing
  );
});

test("family payer and consumption totals count each expense once with public attributed to recorder", () => {
  const { familyExpenseGroups } = require("../cloudfunctions/ourNest/family.helpers");
  const rows = [
    {
      type: "expense",
      amount: 10,
      ownerOpenid: "a",
      categoryId: "food",
      familyAttribution: { payerOpenid: "b", consumerKind: "personal", consumerOpenid: "a" },
    },
    {
      type: "expense",
      amount: 20,
      ownerOpenid: "a",
      categoryId: "food",
      familyAttribution: { payerOpenid: "a", consumerKind: "public" },
    },
    {
      type: "expense",
      amount: 30,
      ownerOpenid: "b",
      categoryId: "travel",
      familyAttribution: { payerOpenid: "b", consumerKind: "multiple" },
    },
    { type: "expense", amount: 5, ownerOpenid: "a" },
    { type: "income", amount: 100, ownerOpenid: "a" },
  ];
  const result = familyExpenseGroups(rows);
  assert.equal(result.total, 65);
  assert.deepEqual(
    result.payers.map((row) => [row.openid, row.amount]),
    [
      ["b", 40],
      ["a", 20],
      ["", 5],
    ]
  );
  assert.deepEqual(
    result.consumers.map((row) => [row.openid, row.amount]),
    [
      ["a", 30],
      ["b", 30],
      ["", 5],
    ]
  );
  assert.equal(result.consumers[0].publicAmount, 20);
  assert.equal(result.consumers[1].multipleAmount, 30);
  assert.equal(result.consumers[0].categories[0].amount, 30);
});

test("all-time trend automatically selects monthly buckets up to 24 months", () => {
  const { makeAllTimeTrend } = require("../cloudfunctions/ourNest/analysis.helpers");
  const records = [
    { date: "2025-01-05", type: "income", amount: 20 },
    { date: "2026-12-10", type: "expense", amount: 5 },
  ];
  const monthly = makeAllTimeTrend(records);
  assert.equal(monthly.granularity, "month");
  assert.equal(monthly.buckets.length, 24);
  assert.equal(monthly.buckets[1].income, 0);
  assert.equal(monthly.buckets[23].expense, 5);
  const yearly = makeAllTimeTrend([...records, { date: "2027-01-01", type: "income", amount: 1 }]);
  assert.equal(yearly.granularity, "year");
  assert.deepEqual(
    yearly.buckets.map((item) => item.key),
    ["2025", "2026", "2027"]
  );
  assert.deepEqual(makeAllTimeTrend([]), { granularity: "month", buckets: [] });
});
