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

test("record change events clear ratio selection and reject obsolete responses", async () => {
  const bus = require("../miniprogram/utils/event-bus");
  for (const reject of [false, true]) {
    const h = ratioPreviewHarness();
    h.page.bootstrap = () => {};
    h.definition.lifetimes.attached.call(h.page);
    const work = h.choose(h.page.data.categories[0].key);
    bus.emit("records:changed", { ledgerId: "unrelated" });
    assert.equal(h.page.data.ratioPreviewStatus, "loading");
    bus.emit("records:changed", { ledgerId: "ledger" });
    assert.equal(h.page.data.ratioPreviewStatus, "idle");
    if (reject) h.pending[0].reject(new Error("obsolete"));
    else h.pending[0].resolve(h.result(100));
    await work;
    assert.equal(h.page.data.ratioPreviewStatus, "idle");
    assert.equal(h.page.data.ratioSelection, null);
    h.definition.lifetimes.detached.call(h.page);
  }
});
