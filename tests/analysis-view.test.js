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
  toAnalysisViewData,
} = require("../miniprogram/components/tl-tab-analysis/view-model");
const {
  getChartOption,
  hasChartData,
  categoryChartColor,
} = require("../miniprogram/components/tl-tab-analysis/chart-options");
const {
  makeDashboardView,
  calendarAmount,
  categoryDisplayIcon,
} = require("../miniprogram/components/tl-tab-analysis/dashboard");

test("dashboard bars preserve small amounts and distinguish zero", () => {
  const result = makeDashboardView(
    {
      recentMonths: [
        { key: "2026-01", expense: 0 },
        { key: "2026-02", expense: 1 },
        { key: "2026-03", expense: 1000 },
      ],
    },
    "month",
    "expense",
    "2026-03-15"
  );
  assert.deepEqual(
    result.bars.map((bar) => bar.height),
    [0, 0.1, 100]
  );
  assert.equal(result.bars[2].partial, true);
});

test("category chart colors follow category identity across ordering", () => {
  const first = { key: '["id","food"]', name: "餐饮", amount: 20 };
  const second = { key: '["id","salary"]', name: "工资", amount: 100 };
  const a = getChartOption({ categoryChart: [first, second] }, "category").series[0].data;
  const b = getChartOption({ categoryChart: [second, first] }, "category").series[0].data;
  assert.equal(a[0].itemStyle.color, b[1].itemStyle.color);
  assert.equal(a[0].itemStyle.color, categoryChartColor(first.key, "expense"));
  assert.equal(categoryChartColor(null), "#c8bcb5");
  const incomeOption = getChartOption({ incomeCategoryChart: [second] }, "income").series[0].data;
  assert.equal(incomeOption[0].itemStyle.color, categoryChartColor(second.key, "income"));
});

test("analysis visual fixture conserves category, account and daily totals", async () => {
  const { validateAnalysisResponse } = require("../miniprogram/services/analysis-contract");
  const fixture = require("./visual-fixtures/analysis-data");
  const result = await fixture.getAnalysis();
  assert.doesNotThrow(() =>
    validateAnalysisResponse(result, {
      ledgerId: "fixture",
      mode: "month",
      analysisView: true,
      analysisType: "expense",
    })
  );
});

test("analysis view bridge excludes transport-only response fields", () => {
  const result = {
    ledger: { _id: "ledger-1", name: "账本" },
    role: "member",
    readonly: false,
    mode: "month",
    range: { label: "2024-01" },
    previousOverview: { expense: 1 },
    comparisonRange: { start: "2023-12-01" },
    topExpenseRecords: [{ _id: "record-1" }],
    overview: { expense: 2 },
    trend: [{ label: "1日", expense: 2 }],
  };
  assert.deepEqual(toAnalysisViewData(result), {
    range: result.range,
    comparisonRange: result.comparisonRange,
    overview: result.overview,
    trend: result.trend,
  });
});

test("analysis offers supported modes without removed views", () => {
  const filename = path.resolve("miniprogram/components/tl-tab-analysis/index.js");
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8").replace(/^import .*;\r?\n/, ""), {
    getApp: () => ({}),
    require: createRequire(filename),
    Component: (value) => {
      definition = value;
    },
  });
  assert.deepEqual(
    Array.from(definition.data.modeOptions, (item) => item.value),
    ["week", "month", "year", "custom", "all"]
  );
  assert.ok(
    !JSON.parse(fs.readFileSync("miniprogram/app.json", "utf8")).pages.includes(
      "pages/analysis-comparison/index"
    )
  );
});

test("category display icons prefer valid configuration then valid historical icon", () => {
  assert.equal(
    categoryDisplayIcon(
      { categoryIcon: "restaurant-line", recordCategoryIcon: "bus-line" },
      "expense"
    ),
    "restaurant-line"
  );
  assert.equal(
    categoryDisplayIcon(
      { categoryIcon: "invalid-glyph", recordCategoryIcon: "bus-line" },
      "expense"
    ),
    "bus-line"
  );
  assert.equal(categoryDisplayIcon({}, "income"), "funds-line");
  assert.equal(
    categoryDisplayIcon(
      { categoryIcon: "unknown", recordCategoryIcons: ["also-unknown", "bus-line"] },
      "expense"
    ),
    "bus-line"
  );
});

test("calendar amounts stay compact without changing stored amounts", () => {
  assert.equal(calendarAmount(0), "—");
  assert.equal(calendarAmount(8.5), "8.50");
  assert.equal(calendarAmount(1234.56), "≈1235");
  assert.equal(calendarAmount(12500), "≈1.3万");
});

test("dashboard preserves zero, future dates and the selected income series", () => {
  const result = {
    range: { start: "2024-02-01", end: "2024-02-11" },
    dashboard: {
      total: 25,
      recordCount: 1,
      dailyAverage: 2.5,
      daily: [{ date: "2024-02-02", income: 25, expense: 3 }],
    },
    comparison: { income: { delta: 25 } },
    recentMonths: [{ key: "2024-02", label: "2月", income: 25, expense: 3 }],
  };
  const view = makeDashboardView(result, "month", "income", "2024-02-10");
  assert.equal(view.cells.filter((item) => !item.blank).length, 29);
  assert.equal(view.cells.find((item) => item.key === "2024-02-02").amountText, "25.00");
  assert.equal(view.cells.find((item) => item.key === "2024-02-11").future, true);
  assert.equal(view.bars[0].height, 100);
  assert.match(view.comparisonText, /增加/);
});

test("dashboard weekly bars align the previous period across a year boundary", () => {
  const view = makeDashboardView(
    {
      range: { start: "2025-12-29", end: "2026-01-02" },
      dashboard: {},
      trend: [{ key: "2026-01-01", expense: 10 }],
      previousTrend: [{ expense: 1 }, { expense: 2 }, { expense: 3 }, { expense: 5 }],
    },
    "week",
    "expense",
    "2026-01-01"
  );
  assert.equal(view.bars.length, 7);
  assert.equal(view.bars[3].key, "2026-01-01");
  assert.equal(view.bars[3].previous, 5);
  assert.equal(view.bars[4].future, true);
});

test("analysis dates cross year boundaries", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(
    formatAnalysisRangeLabel("custom", "", "2024-02-01 至 2024-02-29"),
    "2024-02-01 至 2024-02-29"
  );
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
  page.openTrendRecords({ componentType: "series", dataIndex: 0 });
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
  assert.equal(cashflow.series[1].data[1].itemStyle.color, "#f0442f");
  assert.equal(cashflow.series[1].data[2].itemStyle.color, "#f0442f");
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
  instance.loadAnalysis();
  const result = (name, expense, ledgerId = "second") => ({
    ledger: { _id: ledgerId, name, type: "personal" },
    range: { start: "2026-10-01", end: "2026-11-01", label: "2026年10月" },
    trendMeta: { isPartial: true, asOf: "2026-10-13" },
    overview: { income: 0, expense, balance: -expense, recordCount: 1 },
    dashboard: {
      type: "expense",
      total: expense,
      recordCount: 1,
      daily: [{ date: "2026-10-01", expense }],
      categories: [{ amount: expense }],
      accounts: [{ amount: expense }],
      topRecords: [],
    },
  });
  assert.equal(pending.length, 1);
  pending[0](result("旧账本", 10));
  await first;
  assert.equal(pending.length, 2);
  pending[1](result("新账本", 20));
  const second = instance._analysisFlight;
  await second;
  assert.equal(instance.data.ledgerName, "新账本");
  assert.equal(instance.data.overview.expense, 20);
  assert.equal(instance.data.trendCaption, "截至2026-10-13");
  const outdated = instance.loadAnalysis();
  const oldResponse = result("旧接口", 30);
  delete oldResponse.dashboard;
  pending[2](oldResponse);
  await outdated;
  assert.equal(instance.data.error, true);
});

test("analysis load retains runtime ranges for ratio preview and record drill-down", async () => {
  const filename = path.resolve("miniprogram/components/tl-tab-analysis/index.js");
  const realRequire = createRequire(filename);
  let definition;
  let resolveAnalysis;
  const ratioRequests = [];
  const destinations = [];
  vm.runInNewContext(fs.readFileSync(filename, "utf8").replace(/^import .*;\r?\n/, ""), {
    getApp: () => ({ globalData: {} }),
    require: (name) => {
      if (name.includes("ledger.service"))
        return { getAnalysis: () => new Promise((resolve) => (resolveAnalysis = resolve)) };
      if (name.includes("record.service"))
        return {
          listRecords: (query) =>
            new Promise((resolve, reject) => ratioRequests.push({ query, resolve, reject })),
        };
      return realRequire(name);
    },
    wx: { navigateTo: ({ url }) => destinations.push(new URL(url, "https://ournest.test")) },
    Component: (value) => {
      definition = value;
    },
    console,
  });
  const category = {
    key: '["id","food"]',
    categoryId: "food",
    name: "餐饮",
    amount: 12,
  };
  const page = {
    ...definition.methods,
    data: {
      ...definition.data,
      ledgerId: "ledger",
      mode: "month",
      activeChart: "monthRatio",
      anchor: "2026-01",
      loading: false,
    },
    isAttached: true,
    analysisRequestId: 0,
    secondaryCharts: {},
    selectComponent: () => null,
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
    disposeChart() {},
    disposeSecondaryCharts() {},
    renderChart() {},
  };

  const load = page.loadAnalysis();
  resolveAnalysis({
    ledger: { _id: "ledger", name: "测试账本", type: "personal" },
    range: { start: "2026-01-01", end: "2026-02-01", label: "2026年1月" },
    comparisonRange: { start: "2025-12-01", end: "2026-01-01" },
    overview: { income: 0, expense: 12, balance: -12, recordCount: 1 },
    categories: [category],
    trend: [{ key: "2026-01-15", label: "15日", expense: 12 }],
    dashboard: {
      type: "expense",
      total: 12,
      recordCount: 1,
      daily: [{ date: "2026-01-15", expense: 12 }],
      categories: [{ amount: 12 }],
      accounts: [{ amount: 12 }],
      topRecords: [],
    },
  });
  await load;

  assert.deepEqual(page.data.range, { start: "2026-01-01", end: "2026-02-01", label: "2026年1月" });
  assert.deepEqual(page.data.comparisonRange, { start: "2025-12-01", end: "2026-01-01" });
  const preview = page.selectRatioCategory({ currentTarget: { dataset: { key: category.key } } });
  assert.equal(ratioRequests.length, 1);
  assert.deepEqual(ratioRequests[0].query, {
    ledgerId: "ledger",
    start: "2026-01-01",
    end: "2026-02-01",
    type: "expense",
    categoryFilter: { kind: "id", id: "food" },
    summaryFiltered: true,
    pageSize: 3,
    cursor: null,
  });
  ratioRequests[0].resolve({
    records: [{ _id: "record-1", amount: 12 }],
    rangeSummary: { expense: 12 },
    rangeRecordCount: 1,
  });
  await preview;
  assert.equal(page.data.ratioPreviewStatus, "ready");
  page.openRatioRecords();
  assert.equal(destinations[0].searchParams.get("start"), "2026-01-01");
  assert.equal(destinations[0].searchParams.get("end"), "2026-02-01");
  assert.equal(
    destinations[0].searchParams.get("filter"),
    JSON.stringify({ kind: "id", id: "food" })
  );
});

test("negative balance from a zero baseline is not described as returning to zero", () => {
  assert.equal(
    comparisonText({ enabled: true, balance: { direction: "down", rate: null } }, "balance"),
    "上期为 0"
  );
});

function trendDrillDown(data) {
  const filename = path.resolve("miniprogram/components/tl-tab-analysis/index.js");
  const destinations = [];
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8").replace(/^import .*;\r?\n/, ""), {
    getApp: () => ({ globalData: {} }),
    require: createRequire(filename),
    wx: { navigateTo: ({ url }) => destinations.push(new URL(url, "https://ournest.test")) },
    Component: (value) => {
      definition = value;
    },
    console,
  });
  return {
    page: { ...definition.methods, data: { ledgerId: "ledger", ...data } },
    destinations,
  };
}

function realMarkPointPayloads(data, pie = false, onClick = () => {}) {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(global, "navigator");
  let chart;
  try {
    // ECharts detects its environment when required; Node's navigator is not a browser.
    delete global.navigator;
    const echarts = require("../miniprogram/components/ec-canvas/echarts");
    const context = new Proxy(
      { measureText: (text) => ({ width: String(text).length * 7 }) },
      { get: (target, key) => target[key] || (() => {}) }
    );
    const canvas = {
      width: 600,
      height: 400,
      style: {},
      getContext: () => context,
      addEventListener() {},
      removeEventListener() {},
    };
    echarts.setCanvasCreator(() => canvas);
    chart = echarts.init(canvas, null, { width: 600, height: 400 });
    chart.setOption({ ...getChartOption(data), animation: false });
    const series = chart.getModel().getSeriesByIndex(0);
    const marker = pie
      ? null
      : chart
          .getModel()
          .getComponent("markPoint")
          .constructor.getMarkerModelFromSeries(series, "markPoint");
    const payloads = [];
    chart.on("click", (params) => {
      payloads.push(params);
      onClick(params, chart);
    });
    const items = pie ? series.getData() : marker.getData();
    for (let index = 0; index < items.count(); index += 1) {
      chart.getZr().trigger("click", {
        target: pie ? items.getItemGraphicEl(index) : items.getItemGraphicEl(index).childAt(0),
        event: {},
      });
    }
    return payloads;
  } finally {
    if (chart) chart.dispose();
    if (navigatorDescriptor) Object.defineProperty(global, "navigator", navigatorDescriptor);
    else delete global.navigator;
  }
}

test("real ECharts min/max clicks follow bucket keys, not marker ordinals", () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(global, "navigator");
  for (const expenses of [
    [20, 5, 100],
    [20, 0, 100],
    [20, 5, 5],
    [0, 0, 0],
  ]) {
    const data = {
      activeChart: "monthTrend",
      range: { start: "2026-01-01", end: "2026-02-01" },
      trend: expenses.map((expense, index) => ({
        key: `2026-01-0${index + 1}`,
        label: `${index + 1}日`,
        expense,
      })),
    };
    const payloads = realMarkPointPayloads(data);
    assert.equal(payloads.length, 2);
    assert.deepEqual(
      payloads.map((params) => params.componentType),
      ["markPoint", "markPoint"]
    );
    assert.deepEqual(
      payloads.map((params) => params.dataIndex),
      [0, 1]
    );
    const { page, destinations } = trendDrillDown(data);
    const expected = [Math.min(...expenses), Math.max(...expenses)];
    payloads.forEach((params, index) => {
      const bucketIndex = expenses.indexOf(expected[index]);
      assert.deepEqual(params.data.coord, [bucketIndex, expected[index]]);
      page.openTrendRecords(params);
      assert.equal(destinations[index].searchParams.get("start"), data.trend[bucketIndex].key);
      assert.equal(destinations[index].searchParams.get("type"), "expense");
      assert.equal(params.data.bucketKey, data.trend[bucketIndex].key);
      assert.equal(params.data.type, index === 0 ? "min" : "max");
      assert.equal(params.data.name, index === 0 ? "最低" : "最高");
      assert.equal(params.data.itemStyle.color, index === 0 ? "#25a66a" : "#f0442f");
    });
  }
  assert.deepEqual(Object.getOwnPropertyDescriptor(global, "navigator"), navigatorDescriptor);
});

test("ordinary series drill-down preserves daily, monthly, yearly and recent-year buckets", () => {
  for (const [activeChart, key, end, rangeEnd] of [
    ["monthTrend", "2024-02-29", "2024-03-01"],
    ["yearCashflow", "2026-02", "2026-03-01"],
    ["trend", "2025", "2026-01-01"],
    ["trend", "2026-01", "2026-01-14", "2026-01-14"],
    ["yearBalance", "2024", "2025-01-01"],
  ]) {
    const row = { key, label: key };
    const { page, destinations } = trendDrillDown({
      activeChart,
      range: { end: rangeEnd },
      trend: [activeChart === "yearBalance" ? { key: "2026-01" } : row],
      recentYearTrend: [row],
    });
    page.openTrendRecords({ componentType: "series", dataIndex: 0 });
    assert.equal(destinations.length, 1);
    const start = key.length === 4 ? `${key}-01-01` : key.length === 7 ? `${key}-01` : key;
    assert.equal(destinations[0].searchParams.get("start"), start);
    assert.equal(destinations[0].searchParams.get("end"), end);
    // Stable keys also resolve independently of label, value, coordinate or marker ordinal.
    page.openTrendRecords({ componentType: "markPoint", data: { bucketKey: key } });
    assert.equal(destinations[1].searchParams.get("start"), start);
    assert.equal(destinations[1].searchParams.get("end"), end);
  }
});

test("invalid trend events never navigate or coerce empty indices to the first bucket", () => {
  const { page, destinations } = trendDrillDown({
    activeChart: "monthTrend",
    trend: [{ key: "2026-01-01", label: "1日" }],
  });
  const invalidIndices = [
    undefined,
    null,
    "",
    " ",
    false,
    true,
    [],
    {},
    -1,
    0.5,
    1,
    NaN,
    Infinity,
    "0",
  ];
  for (const dataIndex of invalidIndices) {
    page.openTrendRecords({ componentType: "series", dataIndex });
  }
  for (const event of [
    null,
    {},
    { componentType: "unknown", dataIndex: 0 },
    { componentType: "markLine", dataIndex: 0 },
    { componentType: "markPoint", dataIndex: 0 },
    { componentType: "markPoint", dataIndex: 0, data: { bucketKey: "2026-01-02" } },
    { componentType: "markPoint", dataIndex: 0, data: { coord: [0, 0] } },
    { componentType: "markPoint", dataIndex: 0, data: { bucketKey: "" } },
  ]) {
    page.openTrendRecords(event);
  }
  assert.equal(destinations.length, 0);
  for (const key of ["", "not-a-date", "2026-13", "2026-02-30", "2026-01-32"]) {
    page.data.trend = [{ key }];
    page.openTrendRecords({ componentType: "series", dataIndex: 0 });
    page.openTrendRecords({ componentType: "markPoint", dataIndex: 0, data: { bucketKey: key } });
  }
  assert.equal(destinations.length, 0);
});

function ratioPreviewHarness(overrides = {}) {
  const filename = path.resolve("miniprogram/components/tl-tab-analysis/index.js");
  const realRequire = createRequire(filename);
  const pending = [];
  const destinations = [];
  const actions = [];
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8").replace(/^import .*;\r?\n/, ""), {
    getApp: () => ({ globalData: {} }),
    require: (name) => {
      if (name.includes("record.service"))
        return {
          listRecords: (query) =>
            new Promise((resolve, reject) => pending.push({ query, resolve, reject })),
        };
      if (name.includes("ledger.service")) return { getAnalysis: () => new Promise(() => {}) };
      if (name.includes("ledger.store")) return { getCachedLedgers: () => [] };
      return realRequire(name);
    },
    wx: { navigateTo: ({ url }) => destinations.push(new URL(url, "https://ournest.test")) },
    Component: (value) => {
      definition = value;
    },
    console,
  });
  const category = (id, amount = 100) => ({
    key: JSON.stringify(["id", id]),
    categoryId: id,
    name: "其他",
    amount,
  });
  const categories = [category("a"), category("b", 200)];
  const page = {
    ...definition.methods,
    data: {
      ...definition.data,
      ledgerId: "ledger",
      mode: "month",
      activeChart: "monthRatio",
      anchor: "2026-01",
      range: { start: "2026-01-01", end: "2026-02-01" },
      rangeLabel: "2026年1月",
      loading: false,
      categories,
      categoryChart: categories,
      activeRanking: categories,
      ...overrides,
    },
    isAttached: true,
    analysisRequestId: 0,
    chart: {
      dispatchAction: (action) => actions.push(action),
      dispose() {},
      setOption() {
        throw new Error("selection must not render");
      },
    },
    selectComponent: () => null,
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
  };
  const choose = (key) => page.selectRatioCategory({ currentTarget: { dataset: { key } } });
  const result = (expense, count = 8) => ({
    records: [{ _id: "r", amount: 1 }],
    rangeSummary: { expense },
    rangeRecordCount: count,
  });
  return { page, pending, destinations, actions, choose, result, definition, category };
}

test("all-time income chart and selection use income records and actual record range", async () => {
  const salary = { key: '["id","salary"]', categoryId: "salary", name: "工资", amount: 6000 };
  const h = ratioPreviewHarness({
    mode: "all",
    analysisType: "income",
    range: { start: "", end: "" },
    recordRange: { start: "2026-01-01", end: "2026-02-01" },
    rangeCategories: [salary],
    incomeCategoryChart: [salary],
  });
  h.page.categoryRequestId = 0;
  assert.equal(h.page.getChartOptionForKey("category").series[0].data[0].displayName, "工资");
  h.page.handleChartEvent("category", { dataIndex: 0 });
  assert.equal(h.pending[0].query.type, "income");
  assert.equal(h.pending[0].query.start, "2026-01-01");
  h.pending[0].resolve({ records: [], rangeSummary: { income: 6000 }, rangeRecordCount: 2 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.page.data.categoryPreviewCount, 2);
  h.page.openDashboardCategoryRecords();
  assert.equal(h.destinations[0].searchParams.get("type"), "income");
});

test("monthly bar selection leaves the current context intact and opens the selected month", () => {
  const h = ratioPreviewHarness({
    mode: "month",
    anchor: "2026-03",
    analysisType: "expense",
    dashboardView: { bars: [{ key: "2026-02", label: "2月", amountText: "100" }] },
  });
  h.page.selectDashboardBar({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(h.page.data.anchor, "2026-03");
  assert.equal(h.page.data.selectedBar.key, "2026-02");
  h.page.openSelectedMonth();
  assert.equal(h.destinations[0].searchParams.get("start"), "2026-02-01");
  assert.equal(h.destinations[0].searchParams.get("end"), "2026-03-01");
});

test("dashboard income category preview ignores stale results and opens the matching filter", async () => {
  const category = {
    key: '["id","salary"]',
    categoryId: "salary",
    name: "工资",
    amount: 100,
    recordCount: 1,
    displayIcon: "funds-line",
  };
  const h = ratioPreviewHarness({
    analysisType: "income",
    dashboardView: { categories: [category] },
  });
  h.page.categoryRequestId = 0;
  const first = h.page.selectDashboardCategory({ currentTarget: { dataset: { index: 0 } } });
  h.page.selectDashboardCategory({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(h.page.data.selectedCategory, null);
  const second = h.page.selectDashboardCategory({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(h.pending[0].query.type, "income");
  h.pending[1].resolve({
    records: [{ _id: "new", amount: 100, categoryIcon: "bus-line" }],
    rangeSummary: { income: 100 },
    rangeRecordCount: 1,
  });
  await second;
  h.pending[0].resolve({
    records: [{ _id: "old", amount: 100 }],
    rangeSummary: { income: 100 },
    rangeRecordCount: 1,
  });
  await first;
  assert.equal(h.page.data.categoryPreview[0]._id, "new");
  assert.equal(h.page.data.categoryPreview[0].categoryIcon, "funds-line");
  h.page.openDashboardCategoryRecords();
  assert.equal(h.destinations[0].searchParams.get("type"), "income");
  assert.equal(JSON.parse(h.destinations[0].searchParams.get("filter")).id, "salary");
});

test("dashboard category switching closes old preview and prevents stale response reopening", async () => {
  const categories = [
    {
      key: '["id","a"]',
      categoryId: "a",
      name: "餐饮",
      amount: 10,
      recordCount: 1,
      displayIcon: "restaurant-line",
    },
    {
      key: '["id","b"]',
      categoryId: "b",
      name: "交通",
      amount: 20,
      recordCount: 1,
      displayIcon: "bus-line",
    },
  ];
  const h = ratioPreviewHarness({ dashboardView: { categories } });
  h.page.categoryRequestId = 0;
  const first = h.page.selectDashboardCategory({ currentTarget: { dataset: { index: 0 } } });
  const second = h.page.selectDashboardCategory({ currentTarget: { dataset: { index: 1 } } });
  h.pending[1].resolve({
    records: [{ _id: "b", amount: 20 }],
    rangeSummary: { expense: 20 },
    rangeRecordCount: 1,
  });
  await second;
  h.pending[0].resolve({
    records: [{ _id: "a", amount: 10 }],
    rangeSummary: { expense: 10 },
    rangeRecordCount: 1,
  });
  await first;
  assert.equal(h.page.data.selectedCategory.key, categories[1].key);
  assert.equal(h.page.data.categoryPreview[0].categoryIcon, "bus-line");
  h.page.selectDashboardCategory({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(h.page.data.selectedCategory, null);
  assert.equal(h.pending.length, 2);
});

test("dashboard day pagination appends matching records and ignores an older selected day", async () => {
  const h = ratioPreviewHarness({ analysisType: "expense" });
  h.page.dayRequestId = 0;
  const first = h.page.selectDashboardDay({ currentTarget: { dataset: { date: "2026-01-01" } } });
  const second = h.page.selectDashboardDay({ currentTarget: { dataset: { date: "2026-01-02" } } });
  h.pending[1].resolve({
    records: [{ _id: "new", amount: 1 }],
    hasMore: true,
    nextCursor: { date: "2026-01-02", id: "new" },
  });
  await second;
  h.pending[0].resolve({ records: [{ _id: "old", amount: 1 }], hasMore: false });
  await first;
  assert.equal(h.page.data.dayRecords[0]._id, "new");
  const more = h.page.loadMoreDashboardDay();
  assert.equal(h.pending[2].query.cursor.id, "new");
  h.pending[2].resolve({ records: [{ _id: "next", amount: 2 }], hasMore: false });
  await more;
  assert.deepEqual(
    Array.from(h.page.data.dayRecords, (item) => item._id),
    ["new", "next"]
  );
});

test("section navigation reissues the same target after manual scrolling and ignores stale measurements", () => {
  const h = ratioPreviewHarness();
  const callbacks = [];
  const writes = [];
  h.page.createSelectorQuery = () => ({
    select() {
      return this;
    },
    boundingClientRect() {
      return this;
    },
    scrollOffset() {
      return this;
    },
    exec(callback) {
      callbacks.push(callback);
    },
  });
  h.page.setData = (patch, callback) => {
    writes.push(patch);
    Object.assign(h.page.data, patch);
    if (callback) callback();
  };
  h.page._scrollTop = 200;
  h.page.data.scrollTop = 500;
  h.page.goSection({ currentTarget: { dataset: { section: "category" } } });
  h.page.goSection({ currentTarget: { dataset: { section: "account" } } });
  callbacks[1]([{ top: 100 }, { height: 48 }, { top: 448 }]);
  callbacks[0]([{ top: 100 }, { height: 48 }, { top: 348 }]);
  assert.equal(h.page.data.activeSection, "account");
  assert.equal(h.page.data.scrollTop, 500);
  assert.ok(writes.length >= 2);
  h.page.goSection({ currentTarget: { dataset: { section: "account" } } });
  callbacks[2]([
    { top: 100, height: 600 },
    { height: 48 },
    { top: 448 },
    { scrollTop: 200, scrollHeight: 900 },
  ]);
  assert.equal(h.page.data.scrollTop, 500);
  assert.equal(h.page.data.sectionEndSpace, 200);
});

test("ratio selection queries three records but displays full server totals and identical readonly detail filters", async () => {
  for (const [activeChart, start, end] of [
    ["monthRatio", "2024-02-01", "2024-03-01"],
    ["yearRatio", "2025-01-01", "2026-01-01"],
    ["yearRatio", "2026-01-01", "2026-08-13"],
  ]) {
    const { page, pending, choose, result, destinations, actions } = ratioPreviewHarness({
      activeChart,
      mode: activeChart === "yearRatio" ? "year" : "month",
      range: { start, end },
    });
    const work = choose(page.data.categories[1].key);
    assert.equal(page.data.ratioPreviewStatus, "loading");
    assert.equal(page.data.ratioPreviewRecords.length, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(pending[0].query)), {
      ledgerId: "ledger",
      start,
      end,
      type: "expense",
      categoryFilter: { kind: "id", id: "b" },
      summaryFiltered: true,
      pageSize: 3,
      cursor: null,
    });
    page.openRatioRecords();
    assert.equal(destinations.length, 0);
    pending[0].resolve(result(200, 22));
    await work;
    assert.equal(page.data.ratioPreviewStatus, "ready");
    assert.equal(page.data.ratioPreviewAmountText, "200");
    assert.equal(page.data.ratioPreviewCount, 22);
    assert.equal(page.data.ratioPreviewRangeLabel, `${start} 起至 ${end} 前`);
    assert.equal(page.data.ratioPreviewRecords[0].amountText, "1");
    assert.ok(actions.some((action) => action.type === "select" && action.dataIndex === 1));
    page.openRatioRecords();
    const params = destinations[0].searchParams;
    for (const key of ["ledgerId", "start", "end", "type"])
      assert.equal(params.get(key), pending[0].query[key]);
    assert.deepEqual(JSON.parse(params.get("filter")), { kind: "id", id: "b" });
    assert.equal(page.data.ratioPreviewReadonly, true);
  }
});

test("ratio identity distinguishes real other and same-name legacy parents from merged remainder", async () => {
  const h = ratioPreviewHarness();
  const legacy = (parent) => ({
    key: JSON.stringify(["legacy", parent, "其他"]),
    parentCategory: parent,
    categoryName: "其他",
    name: "其他",
    amount: 20,
  });
  const categories = [
    h.category("other"),
    legacy("甲"),
    legacy("乙"),
    ...[1, 2, 3].map((id) => h.category(String(id))),
  ];
  h.page.data.categories = categories;
  // Deliberately reorder real chart sectors; chart ordinal is not a categories ordinal.
  h.page.data.categoryChart = [
    categories[3],
    categories[0],
    categories[4],
    categories[5],
    categories[1],
    { name: "其余分类", amount: 20 },
  ];
  h.page.openRatioChartSelection({
    componentType: "series",
    seriesType: "pie",
    dataIndex: 5,
    data: { ratioRemainder: true },
  });
  assert.equal(h.pending.length, 0);
  assert.equal(h.page.data.ratioRemainderVisible, true);
  assert.equal(h.actions.at(-1).type, "select");
  assert.equal(h.actions.at(-1).dataIndex, 5);
  assert.deepEqual(
    Array.from(h.page.data.ratioRemainderOptions, (row) => row.key),
    [categories[2].key]
  );
  const work = h.page.chooseRatioRemainder({
    currentTarget: { dataset: { key: categories[2].key } },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(h.pending[0].query.categoryFilter)), {
    kind: "legacy",
    parent: "乙",
    name: "其他",
  });
  h.pending[0].resolve(h.result(20));
  await work;
  assert.equal(h.page.data.ratioSelection.key, categories[2].key);
  assert.equal(h.page.data.ratioSelection.parentCategory, "乙");
  assert.equal(h.actions.at(-1).type, "select");
  assert.equal(h.actions.at(-1).dataIndex, 5);
  const second = h.page.openRatioChartSelection({
    componentType: "series",
    seriesType: "pie",
    dataIndex: 1,
    data: { ratioKey: categories[0].key },
  });
  assert.equal(h.pending[1].query.categoryFilter.id, "other");
  h.pending[1].resolve(h.result(100));
  await second;
  h.page.openRatioChartSelection({ componentType: "series", dataIndex: 0, data: {} });
  assert.equal(h.pending.length, 2);
});

test("ratio clicks reject null events and invalid row indices without selecting a category", async () => {
  const h = ratioPreviewHarness();
  h.page.openRatioChartSelection(null);
  for (const index of [undefined, null, "", " ", false, true, [], {}, -1, 0.5, NaN, Infinity]) {
    await h.page.selectRatioCategory({ currentTarget: { dataset: { index } } });
  }
  assert.equal(h.pending.length, 0);
  assert.equal(h.page.data.ratioSelection, null);
});

test("ratio races ignore both old successes and old failures; failures retry the same selection", async () => {
  for (const failOld of [false, true]) {
    const h = ratioPreviewHarness();
    const a = h.choose(h.page.data.categories[0].key);
    const b = h.choose(h.page.data.categories[1].key);
    h.pending[1].resolve(h.result(200));
    await b;
    if (failOld) h.pending[0].reject(new Error("old"));
    else h.pending[0].resolve(h.result(100));
    await a;
    assert.equal(h.page.data.ratioSelection.key, h.page.data.categories[1].key);
    assert.equal(h.page.data.ratioPreviewAmountText, "200");
    assert.equal(h.page.data.ratioPreviewStatus, "ready");
  }
  const h = ratioPreviewHarness();
  const first = h.choose(h.page.data.categories[0].key);
  h.pending[0].reject(new Error("offline"));
  await first;
  assert.equal(h.page.data.ratioPreviewStatus, "error");
  const retry = h.page.retryRatioPreview();
  assert.deepEqual(h.pending[1].query, h.pending[0].query);
  h.pending[1].resolve(h.result(100));
  await retry;
  assert.equal(h.page.data.ratioPreviewStatus, "ready");
});

test("ratio stale totals demand analysis refresh and empty results still use server summaries", async () => {
  const h = ratioPreviewHarness();
  const work = h.choose(h.page.data.categories[0].key);
  h.pending[0].resolve(h.result(99.99));
  await work;
  assert.equal(h.page.data.ratioPreviewStatus, "error");
  assert.equal(h.page.data.ratioPreviewStale, true);
  assert.match(h.page.data.ratioPreviewError, /刷新分析/);
  assert.equal(h.page.data.ratioPreviewRecords.length, 0);
  h.page.openRatioRecords();
  assert.equal(h.destinations.length, 0);
  h.page.data.categories[0].amount = 0;
  const empty = h.choose(h.page.data.categories[0].key);
  h.pending[1].resolve({ records: [], rangeSummary: { expense: 0 }, rangeRecordCount: 0 });
  await empty;
  assert.equal(h.page.data.ratioPreviewStatus, "empty");
  h.page.openRatioRecords();
  assert.equal(h.destinations.length, 1);
});

test("ratio requests invalidate on chart, period, ledger, reload, removal and detach", async () => {
  const transitions = [
    (h) => h.page.switchChart({ currentTarget: { dataset: { chart: "monthTrend" } } }),
    (h) => h.page.setAnalysisMode("year"),
    (h) => h.page.shift({ currentTarget: { dataset: { delta: 1 } } }),
    (h) => {
      h.page.data.ledgerOptions = [{ _id: "new" }];
      h.page.chooseViewLedger({ detail: { ledgerId: "new" } });
    },
    (h) => h.page.loadAnalysis(),
    (h) => h.page.refreshAnalysis({ removedLedgerIds: ["ledger"] }),
    (h) => h.definition.lifetimes.detached.call(h.page),
  ];
  for (const transition of transitions) {
    const h = ratioPreviewHarness();
    const work = h.choose(h.page.data.categories[0].key);
    transition(h);
    h.pending[0].resolve(h.result(100));
    await work;
    assert.equal(h.page.data.ratioPreviewStatus, "idle");
    assert.equal(h.page.data.ratioSelection, null);
    assert.equal(h.page.data.ratioPreviewRecords.length, 0);
    h.page.openRatioRecords();
    assert.equal(h.destinations.length, 0);
  }
});

test("real ECharts pie clicks carry stable identity and keep same-name categories singly selected", async () => {
  const h = ratioPreviewHarness();
  const payloads = realMarkPointPayloads(h.page.data, true, (params, chart) => {
    h.page.chart = chart;
    h.page.openRatioChartSelection(params);
    const series = chart.getModel().getSeriesByIndex(0);
    for (let index = 0; index < h.page.data.categories.length; index += 1) {
      assert.equal(series.isSelected(index), index === params.dataIndex);
    }
  });
  assert.equal(payloads.length, 2);
  assert.deepEqual(
    payloads.map((params) => params.data.ratioKey),
    h.page.data.categories.map((row) => row.key)
  );
  assert.equal(h.pending[0].query.categoryFilter.id, "a");
  assert.equal(h.pending[1].query.categoryFilter.id, "b");
  assert.equal(getChartOption(h.page.data).series[0].selectedMode, "single");
  h.pending[1].resolve(h.result(200));
  h.pending[0].resolve(h.result(100));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.page.data.ratioPreviewStatus, "ready");
});

test("real merged pie click opens only omitted identities without querying a real category named other", () => {
  const h = ratioPreviewHarness();
  const categories = Array.from({ length: 7 }, (_, i) => h.category(String(i), 10));
  categories[6].name = "其余分类";
  h.page.data.categories = categories;
  h.page.data.categoryChart = [...categories.slice(0, 5), { name: "其余分类", amount: 20 }];
  const clicks = realMarkPointPayloads(h.page.data, true);
  h.page.openRatioChartSelection(clicks[5]);
  assert.equal(h.pending.length, 0);
  assert.deepEqual(
    Array.from(h.page.data.ratioRemainderOptions, (item) => item.key),
    categories.slice(5).map((item) => item.key)
  );
  h.page.closeRatioRemainder();
  assert.equal(h.page.data.ratioRemainderVisible, false);
  h.page.data.categoryChart = categories.slice(0, 5);
  const small = realMarkPointPayloads(h.page.data, true);
  assert.equal(small.length, 5);
  assert.ok(small.every((params) => params.data.ratioKey && !params.data.ratioRemainder));
});

test("ratio entrypoints guard detached/loading contexts and stale query navigation", async () => {
  const h = ratioPreviewHarness();
  const key = h.page.data.categories[0].key;
  h.page.isAttached = false;
  await h.choose(key);
  h.page.isAttached = true;
  h.page.data.loading = true;
  await h.choose(key);
  h.page.data.loading = false;
  await h.choose("unknown");
  assert.equal(h.pending.length, 0);
  const work = h.choose(key);
  h.page.data.range = { start: "2026-02-01", end: "2026-03-01" };
  h.pending[0].reject(new Error("obsolete context"));
  await work;
  assert.equal(h.page.data.ratioPreviewStatus, "loading");
  assert.equal(h.page.data.ratioPreviewRecords.length, 0);
  h.page.openRatioRecords();
  assert.equal(h.destinations.length, 0);
});

test("ratio category rows preview rather than navigate and refresh invalidates stale errors", async () => {
  const h = ratioPreviewHarness();
  const work = h.page.openCategoryRecords({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(h.pending[0].query.categoryFilter.id, "b");
  assert.equal(h.destinations.length, 0);
  h.pending[0].resolve(h.result(10));
  await work;
  assert.equal(h.page.data.ratioPreviewStale, true);
  h.page.retryRatioPreview();
  assert.equal(h.pending.length, 1);
  h.page.refreshRatioAnalysis();
  assert.equal(h.page.data.ratioPreviewStatus, "idle");
  assert.equal(h.page.data.loading, true);
});

test("record change invalidations clear ratio selection and reject obsolete responses", async () => {
  const dataRefresh = require("../miniprogram/services/data-refresh.service");
  dataRefresh.clear();
  for (const reject of [false, true]) {
    const h = ratioPreviewHarness();
    h.page.bootstrap = () => {};
    h.definition.lifetimes.attached.call(h.page);
    const work = h.choose(h.page.data.categories[0].key);
    dataRefresh.invalidate({ ledgerId: "unrelated", source: "test" });
    await Promise.resolve();
    assert.equal(h.page.data.ratioPreviewStatus, "loading");
    dataRefresh.invalidate({ ledgerId: "ledger", source: "test" });
    await Promise.resolve();
    assert.equal(h.page.data.ratioPreviewStatus, "idle");
    if (reject) h.pending[0].reject(new Error("obsolete"));
    else h.pending[0].resolve(h.result(100));
    await work;
    assert.equal(h.page.data.ratioPreviewStatus, "idle");
    assert.equal(h.page.data.ratioSelection, null);
    h.definition.lifetimes.detached.call(h.page);
  }
});

test("range trend selection and category drill-down preserve bucket and ledger range", () => {
  const row = { key: "2026-02", label: "2026-02", incomeText: "2.00", expenseText: "1.00" };
  const { page, destinations } = trendDrillDown({
    mode: "all",
    activeChart: "trend",
    analysisType: "income",
    range: {},
    recordRange: { start: "2026-02-11", end: "2026-03-06" },
    trend: [row],
    trendRows: [row],
    rangeCategories: [{ categoryId: "salary", name: "工资" }],
  });
  page.setData = (patch) => Object.assign(page.data, patch);
  page.selectTrendPoint({ componentType: "series", dataIndex: 0 });
  assert.equal(page.data.selectedTrend.key, "2026-02");
  page.openSelectedTrend();
  assert.equal(destinations[0].searchParams.get("start"), "2026-02-01");
  assert.equal(destinations[0].searchParams.get("end"), "2026-03-01");
  page.openRangeCategory({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(destinations[1].searchParams.get("start"), "2026-02-11");
  assert.equal(destinations[1].searchParams.get("end"), "2026-03-06");
  assert.equal(destinations[1].searchParams.get("type"), "income");
  assert.deepEqual(JSON.parse(destinations[1].searchParams.get("filter")), {
    kind: "id",
    id: "salary",
  });
});
