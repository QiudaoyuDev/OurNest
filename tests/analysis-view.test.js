const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const {
  shiftMonth,
  formatAnalysisRangeLabel,
} = require("../miniprogram/components/tl-tab-analysis/dates");
const {
  comparisonText,
  decorate,
  decorateCalendar,
} = require("../miniprogram/components/tl-tab-analysis/view-model");
const {
  getChartOption,
  hasChartData,
} = require("../miniprogram/components/tl-tab-analysis/chart-options");

test("analysis dates cross year boundaries and calendar preserves leap-day records", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(
    formatAnalysisRangeLabel("custom", "", "2024-02-01 至 2024-02-29"),
    "2024-02-01 至 2024-02-29"
  );
  const calendar = decorateCalendar(
    {
      range: { start: "2024-02-01" },
      calendarDays: [{ date: "2024-02-29", income: 100, expense: 25.5, recordCount: 2 }],
      calendarRecords: [
        { _id: "income", date: "2024-02-29", type: "income", amount: 100 },
        { _id: "expense", date: "2024-02-29", type: "expense", amount: 25.5, note: "午餐" },
      ],
    },
    "2024-02-29"
  );
  assert.equal(calendar.calendarCells.filter((cell) => !cell.blank).length, 29);
  assert.equal(calendar.calendarCells.filter((cell) => cell.blank).length, 4);
  assert.equal(calendar.selectedCalendarSummary.count, 2);
  assert.equal(calendar.selectedCalendarSummary.expenseText, "25.50");
  assert.equal(calendar.selectedCalendarRecords[1].noteText, "午餐");
  const nextMonth = decorateCalendar({ range: { start: "2024-03-01" } }, "2024-02-29");
  assert.equal(nextMonth.selectedCalendarDate, "2024-03-01");
  assert.deepEqual(nextMonth.selectedCalendarRecords, []);
});

test("custom analysis supports bounded selection and category and day drill-down", () => {
  const filename = path.resolve("miniprogram/components/tl-tab-analysis/index.js");
  const realRequire = createRequire(filename);
  const destinations = [];
  const notices = [];
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8").replace(/^import .*;\r?\n/, ""), {
    getApp: () => ({ globalData: {} }),
    require: (name) =>
      name.includes("feedback-ui")
        ? { showToast: (value) => notices.push(value) }
        : realRequire(name),
    wx: { navigateTo: ({ url }) => destinations.push(url) },
    Component: (value) => {
      definition = value;
    },
    console,
  });
  let loads = 0;
  const page = {
    ...definition.methods,
    data: {
      ...definition.data,
      mode: "custom",
      activeChart: "trend",
      ledgerId: "ledger",
      customStart: "2026-01-01",
      customEnd: "2026-01-31",
      range: { start: "2026-01-01", end: "2026-02-01" },
      categories: [{ categoryId: "c1", name: "餐饮" }],
      trend: [{ key: "2026-01-31", label: "01-31" }],
    },
    setData(patch) {
      Object.assign(this.data, patch);
    },
    loadAnalysis() {
      loads += 1;
    },
  };
  assert.ok(page.data.modeOptions.some((item) => item.value === "custom"));
  page.changeCustomStart({ detail: { value: "2024-01-01" } });
  assert.equal(loads, 0);
  assert.match(notices[0].message, /366/);
  page.changeCustomStart({ detail: { value: "2025-12-31" } });
  assert.equal(loads, 1);
  page.openCategoryRecords({ currentTarget: { dataset: { source: "custom", index: 0 } } });
  page.openTrendRecords({ dataIndex: 0 });
  assert.match(destinations[0], /filter=.*c1/);
  assert.match(destinations[1], /start=2026-01-31/);
  assert.match(destinations[1], /end=2026-02-01/);
});

test("analysis charts use supplied data for zero days, yearly extrema and negative balance", () => {
  const month = getChartOption({
    activeChart: "monthTrend",
    trend: [
      { label: "1日", expense: 0 },
      { label: "2日", expense: 20 },
    ],
  });
  assert.deepEqual(month.series[0].data, [0, 20]);
  const cashflow = getChartOption({
    activeChart: "yearCashflow",
    trend: [
      { label: "1月", income: 10, expense: 0 },
      { label: "2月", income: 20, expense: 2 },
      { label: "3月", income: 30, expense: 8 },
    ],
  });
  assert.deepEqual(cashflow.series[0].data, [10, 20, 30]);
  assert.equal(cashflow.series[1].data[1].itemStyle.color, "#6f9ceb");
  assert.equal(cashflow.series[1].data[2].itemStyle.color, "#f5b04e");
  const data = {
    activeChart: "yearBalance",
    overview: { recordCount: 0 },
    recentYearTrend: [{ label: "2025", income: 0, expense: 3, balance: -3 }],
  };
  assert.equal(hasChartData(data, "yearBalance"), true);
  assert.equal(getChartOption(data).series[0].data[0].value, -3);
  assert.deepEqual(getChartOption(data).series[0].data[0].itemStyle.borderRadius, [0, 0, 6, 6]);
  const empty = decorate({});
  assert.deepEqual(empty.categories, []);
  assert.deepEqual(empty.insights, []);
  assert.equal(hasChartData(empty, "monthRatio"), false);
});

test("an older analysis response cannot replace a newer ledger selection", async () => {
  const filename = path.resolve("miniprogram/components/tl-tab-analysis/index.js");
  const requireFromComponent = createRequire(filename);
  const pending = [];
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8").replace(/^import .*;\r?\n/, ""), {
    getApp: () => ({ globalData: {} }),
    require: (name) =>
      name.includes("ledger.service")
        ? { getAnalysis: () => new Promise((resolve) => pending.push(resolve)) }
        : requireFromComponent(name),
    Component: (value) => {
      definition = value;
    },
    console,
  });
  const instance = {
    ...definition.methods,
    data: { ...definition.data, ledgerId: "first", anchor: "2026-10" },
    isAttached: true,
    analysisRequestId: 0,
    secondaryCharts: {},
    selectComponent: () => null,
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  assert.deepEqual(Array.from(instance.data.monthlyTopRecords), []);
  assert.deepEqual(Array.from(instance.data.yearRankingRows), []);
  const first = instance.loadAnalysis();
  instance.data.ledgerId = "second";
  const second = instance.loadAnalysis();
  const result = (name, expense) => ({
    ledger: { name, type: "personal" },
    range: { label: "2026年10月" },
    trendMeta: { isPartial: true, asOf: "2026-10-13" },
    overview: { recordCount: 1, expense },
  });
  pending[1](result("新账本", 20));
  await second;
  pending[0](result("旧账本", 10));
  await first;
  assert.equal(instance.data.ledgerName, "新账本");
  assert.equal(instance.data.overview.expense, 20);
  assert.equal(instance.data.trendCaption, "截至2026-10-13");
});

test("negative balance from a zero baseline is not described as returning to zero", () => {
  assert.equal(
    comparisonText({ enabled: true, balance: { direction: "down", rate: null } }, "balance"),
    "上期为 0"
  );
});

test("comparison periods cross years and preserve category identities and zero baselines", () => {
  const {
    recentPeriods,
    makeCategoryOptions,
    comparisonRows,
  } = require("../miniprogram/pages/analysis-comparison/view-model");
  assert.deepEqual(recentPeriods("month", 3, new Date(2026, 0, 10)), [
    "2025-11",
    "2025-12",
    "2026-01",
  ]);
  const periods = [
    {
      key: "2025",
      overview: { income: 0, expense: 0, balance: 0 },
      expenseCategories: [],
      incomeCategories: [],
    },
    {
      key: "2026",
      overview: { income: 0, expense: 5, balance: -5 },
      expenseCategories: [{ key: "id-food", categoryId: "food", name: "餐饮", amount: 5 }],
      incomeCategories: [],
    },
  ];
  const categories = makeCategoryOptions(periods);
  assert.equal(categories[1].categoryFilter.id, "food");
  const rows = comparisonRows(periods, categories[1]);
  assert.equal(rows[0].amountText, "0");
  assert.match(rows[1].changeText, /基准为 0/);
  assert.equal(rows[1].amountText, "5");
});

test("comparison trend widths preserve zeros and negative balance magnitudes", () => {
  const { comparisonRows } = require("../miniprogram/pages/analysis-comparison/view-model");
  const rows = comparisonRows(
    [
      { key: "2025", overview: { income: 0, expense: 0, balance: 0 } },
      { key: "2026", overview: { income: 3, expense: 8, balance: -5 } },
    ],
    { value: "all" }
  );
  assert.equal(rows[0].balanceWidth, 0);
  assert.equal(rows[1].expenseWidth, 100);
  assert.equal(rows[1].balanceWidth, 62.5);
  assert.equal(rows[1].chartBalance, -5);
});

test("category comparison scales small values independently from ledger totals", () => {
  const { comparisonRows } = require("../miniprogram/pages/analysis-comparison/view-model");
  const rows = comparisonRows(
    [
      {
        overview: { income: 1000, expense: 500, balance: 500 },
        expenseCategories: [{ key: "food", amount: 0.01 }],
      },
      {
        overview: { income: 2000, expense: 800, balance: 1200 },
        expenseCategories: [{ key: "food", amount: 0.02 }],
      },
    ],
    { value: "expense:food", type: "expense", key: "food" }
  );
  assert.equal(rows[0].amountWidth, 50);
  assert.equal(rows[1].amountWidth, 100);
});

test("family comparison preserves payer and consumer views across periods", () => {
  const {
    makeFamilyOptions,
    makeCategoryOptions,
    comparisonRows,
  } = require("../miniprogram/pages/analysis-comparison/view-model");
  const category = { key: "food-id", categoryId: "food", name: "餐饮", amount: 10 };
  const periods = [
    {
      key: "2025",
      overview: { income: 0, expense: 10, balance: -10 },
      family: {
        payers: [{ openid: "a", name: "甲", amount: 10, categories: [category] }],
        consumers: [{ openid: "b", name: "乙", amount: 10, categories: [category] }],
      },
      creators: [],
    },
    {
      key: "2026",
      overview: { income: 0, expense: 20, balance: -20 },
      family: {
        payers: [
          { openid: "a", name: "甲", amount: 20, categories: [{ ...category, amount: 20 }] },
        ],
        consumers: [
          { openid: "b", name: "乙", amount: 20, categories: [{ ...category, amount: 20 }] },
        ],
      },
      creators: [],
    },
  ];
  const families = makeFamilyOptions(periods);
  const payer = families.find((item) => item.dimension === "payer" && item.openid === "a");
  const consumer = families.find((item) => item.dimension === "consumer" && item.openid === "b");
  assert.ok(payer && consumer);
  const categories = makeCategoryOptions(periods, payer);
  const rows = comparisonRows(periods, categories[1], payer);
  assert.equal(rows[0].chartAmount, 10);
  assert.equal(rows[1].chartAmount, 20);
  assert.match(rows[1].changeText, /100%/);
  assert.equal(categories[1].categoryFilter.id, "food");
});
