const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const {
  createChartController,
} = require("../miniprogram/components/tl-tab-analysis/chart-controller");

function mountedChart() {
  return {
    options: [],
    on() {},
    setOption(option) {
      this.options.push(option);
    },
    dispose() {},
  };
}

test("dashboard chart waits until its card enters the scroll viewport", () => {
  const definition = loadAnalysisDefinition(() => Promise.resolve());
  let observerCallback;
  const instance = {
    ...definition.methods,
    data: {
      ...definition.data,
      active: true,
      foreground: true,
      loading: false,
      hasChartData: true,
    },
    isAttached: true,
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
    createIntersectionObserver() {
      return {
        relativeTo() {
          return this;
        },
        observe(_selector, callback) {
          observerCallback = callback;
        },
      };
    },
    ensureChartHostInitialized(key) {
      this.initialized = key;
    },
  };
  instance.setupChartVisibilityObserver();
  observerCallback({
    intersectionRatio: 0,
    boundingClientRect: { top: 900 },
    relativeRect: { top: 100 },
  });
  assert.equal(instance.data.categoryChartActivated, false);
  assert.equal(instance.initialized, undefined);
  observerCallback({
    intersectionRatio: 0.1,
    boundingClientRect: { top: 400 },
    relativeRect: { top: 100 },
  });
  assert.equal(instance.data.categoryChartActivated, true);
  assert.equal(instance.initialized, "dashboardCategory");
});

test("chart init accepts WeChat metadata for primary and secondary hosts", () => {
  const definition = loadAnalysisDefinition(() => Promise.resolve());
  const instance = {
    ...definition.methods,
    data: {
      ...definition.data,
      active: true,
      foreground: true,
      loading: false,
      hasChartData: true,
      chartNodeGeneration: 7,
    },
    analysisNodeGeneration: 7,
    isAttached: true,
    chartController: createChartController({
      canRender: () => true,
      createChart: () => mountedChart(),
      getOption: (key) => ({ key }),
    }),
    secondaryCharts: {},
    selectComponent(selector) {
      return { selector };
    },
  };

  instance.onChartInit({
    currentTarget: { dataset: { chartHost: "main", chartGeneration: "7" } },
    detail: { canvas: { id: "main" }, width: 320, height: 180, dpr: 2 },
  });
  instance.onSecondaryChartInit({
    currentTarget: {
      dataset: { chartHost: "secondary", chartKey: "dashboardCategory", chartGeneration: "7" },
    },
    detail: { canvas: { id: "secondary" }, width: 240, height: 140, dpr: 1 },
  });

  assert.equal(instance.chartController.size(), 2);
  assert.equal(instance.chartController.get("main").generation, 7);
  assert.equal(instance.chartController.get("dashboardCategory").generation, 7);
  assert.equal(instance.chartController.get("main").chart.options.length, 1);
  assert.equal(instance.chartController.get("dashboardCategory").chart.options.length, 1);
  assert.strictEqual(instance.chart, instance.chartController.get("main").chart);
  assert.strictEqual(
    instance.secondaryCharts.dashboardCategory,
    instance.chartController.get("dashboardCategory").chart
  );
});

test("a host init lost during loading is retried for main and secondary without duplicates", async () => {
  const definition = loadAnalysisDefinition(() => Promise.resolve());
  const created = [];
  const components = {};
  const instance = {
    ...definition.methods,
    data: {
      ...definition.data,
      active: true,
      foreground: true,
      loading: true,
      hasChartData: true,
      chartHostMounted: true,
      categoryChartActivated: true,
      chartNodeGeneration: 4,
      dashboardView: { recordCount: 2 },
      categories: [{ key: "food", amount: 1 }],
    },
    analysisNodeGeneration: 4,
    isAttached: true,
    secondaryCharts: {},
    setData(patch) {
      Object.assign(this.data, patch);
    },
    selectComponent(selector) {
      return (components[selector] ||= {
        init: () => {
          const detail = {
            canvas: { id: selector },
            width: 320,
            height: 180,
            dpr: 1,
          };
          if (selector === "#analysis-chart")
            this.onChartInit({
              currentTarget: { dataset: { chartHost: "main", chartGeneration: "4" } },
              detail,
            });
          else
            this.onSecondaryChartInit({
              currentTarget: {
                dataset: {
                  chartHost: "secondary",
                  chartKey:
                    selector === "#dashboard-category-chart" ? "dashboardCategory" : "category",
                  chartGeneration: "4",
                },
              },
              detail,
            });
        },
        setChart() {},
      });
    },
  };
  instance.chartController = createChartController({
    canRender: () => instance.canInitializeChartHost(),
    createChart: () => {
      const value = mountedChart();
      created.push(value);
      return value;
    },
    getOption: (key) => ({ key }),
  });

  // The real ec-canvas emits this while the parent is loading. The lifecycle
  // gate rejects it, but the host itself remains mounted.
  instance.onChartInit({
    currentTarget: { dataset: { chartHost: "main", chartGeneration: "4" } },
    detail: { canvas: {}, width: 320, height: 180 },
  });
  instance.onSecondaryChartInit({
    currentTarget: {
      dataset: { chartHost: "secondary", chartKey: "category", chartGeneration: "4" },
    },
    detail: { canvas: {}, width: 320, height: 180 },
  });
  assert.equal(instance.chartController.size(), 0);

  instance.data.loading = false;
  instance.renderChart();
  instance.renderChart();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(instance.chartController.size(), 3);
  assert.equal(created.length, 3);

  // Once mounted, repeated ready passes do not call ec-canvas.init again.
  const initCounts = Object.fromEntries(
    Object.entries(components).map(([key, value]) => [key, value.init])
  );
  instance.renderChart();
  assert.equal(instance.chartController.size(), 3);
  assert.deepEqual(
    Object.keys(initCounts).sort(),
    ["#all-category-chart", "#analysis-chart", "#dashboard-category-chart"].sort()
  );
});

test("chart init retries a zero-size host without mounting duplicate charts", async () => {
  const definition = loadAnalysisDefinition(() => Promise.resolve());
  let retries = 0;
  const component = {
    init() {
      retries += 1;
    },
  };
  const instance = {
    ...definition.methods,
    data: {
      ...definition.data,
      active: true,
      foreground: true,
      loading: false,
      hasChartData: true,
      chartNodeGeneration: 3,
    },
    analysisNodeGeneration: 3,
    isAttached: true,
    chartController: {
      mount() {
        return null;
      },
      update() {},
    },
    selectComponent() {
      return component;
    },
  };
  instance.onChartInit({
    currentTarget: { dataset: { chartHost: "main", chartGeneration: "3" } },
    detail: { canvas: {}, width: 0, height: 0 },
  });
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(retries, 1);
});

test("chart init retries remain bounded when a host stays unusable", async () => {
  const definition = loadAnalysisDefinition(() => Promise.resolve());
  let attempts = 0;
  const instance = {
    ...definition.methods,
    data: {
      ...definition.data,
      active: true,
      foreground: true,
      loading: false,
      hasChartData: true,
      chartNodeGeneration: 5,
    },
    analysisNodeGeneration: 5,
    isAttached: true,
    chartController: { mount: () => null, get: () => null, update() {} },
    setData(patch) {
      Object.assign(this.data, patch);
    },
    selectComponent() {
      return {
        init: () => {
          attempts += 1;
          instance.onChartInit({
            currentTarget: { dataset: { chartHost: "main", chartGeneration: "5" } },
            detail: { canvas: {}, width: 0, height: 0 },
          });
        },
      };
    },
  };
  instance.onChartInit({
    currentTarget: { dataset: { chartHost: "main", chartGeneration: "5" } },
    detail: { canvas: {}, width: 0, height: 0 },
  });
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(attempts, 3);
  assert.equal(instance.data.trendChartError, true);
});

test("chart init rejects delayed callbacks from a replaced node", () => {
  const definition = loadAnalysisDefinition(() => Promise.resolve());
  let mounts = 0;
  const instance = {
    ...definition.methods,
    data: { ...definition.data, hasChartData: true, chartNodeGeneration: 9 },
    analysisNodeGeneration: 9,
    chartController: {
      mount() {
        mounts += 1;
        return {};
      },
      update() {},
    },
    selectComponent() {
      return {};
    },
  };

  instance.onChartInit({
    currentTarget: { dataset: { chartHost: "main", chartGeneration: "8" } },
    detail: { canvas: {}, width: 320, height: 180 },
  });
  instance.onSecondaryChartInit({
    currentTarget: {
      dataset: { chartHost: "secondary", chartKey: "category", chartGeneration: "8" },
    },
    detail: { canvas: {}, width: 240, height: 140 },
  });

  assert.equal(mounts, 0);
});

test("hidden analysis views mark dirty without issuing an analysis request", async () => {
  const filename = path.resolve("miniprogram/components/tl-tab-analysis/index.js");
  const requireFromComponent = createRequire(filename);
  let calls = 0;
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8").replace(/^import .*;\r?\n/, ""), {
    getApp: () => ({ globalData: {} }),
    require: (name) =>
      name.includes("ledger.service")
        ? { getAnalysis: async () => (calls += 1) }
        : requireFromComponent(name),
    Component: (value) => {
      definition = value;
    },
    console,
  });
  const instance = {
    ...definition.methods,
    data: { ...definition.data, active: false, foreground: true, ledgerId: "ledger" },
    isAttached: true,
    dirty: false,
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };

  await instance.loadAnalysis();
  assert.equal(calls, 0);
  assert.equal(instance.dirty, true);
});

function loadAnalysisDefinition(getAnalysis) {
  const filename = path.resolve("miniprogram/components/tl-tab-analysis/index.js");
  const requireFromComponent = createRequire(filename);
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8").replace(/^import .*;\r?\n/, ""), {
    getApp: () => ({ globalData: {} }),
    require: (name) =>
      name.includes("ledger.service") ? { getAnalysis } : requireFromComponent(name),
    Component: (value) => {
      definition = value;
    },
    console,
    setTimeout,
  });
  return definition;
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test("analysis refresh is single-flight and catches up after a true write", async () => {
  const requests = [];
  const definition = loadAnalysisDefinition(() => {
    const item = deferred();
    requests.push(item);
    return item.promise;
  });
  const instance = {
    ...definition.methods,
    data: { ...definition.data, active: true, foreground: true, ledgerId: "ledger" },
    isAttached: true,
    clearRatioPreview() {},
    disposeChart() {},
    disposeSecondaryCharts() {},
    renderChart() {},
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
  };

  const first = instance.loadAnalysis();
  const duplicate = instance.loadAnalysis();
  assert.strictEqual(duplicate, first);
  assert.equal(requests.length, 1);
  instance.handleDataInvalidation({ ledgerIds: ["ledger"] });
  requests[0].resolve({ noLedger: true });
  await first;
  assert.equal(requests.length, 2);
  requests[1].resolve({ noLedger: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await instance._analysisFlight;
  assert.equal(instance.dirty, false);
});

test("same-context refresh updates mounted secondary charts and disposes obsolete ones", () => {
  const definition = loadAnalysisDefinition(() => Promise.resolve());
  const updates = [];
  const disposed = [];
  const instance = {
    ...definition.methods,
    data: {
      ...definition.data,
      loading: false,
      active: true,
      foreground: true,
      hasChartData: true,
      dashboardView: { recordCount: 2 },
      categories: [{ key: "food", amount: 3 }],
    },
    isAttached: true,
    secondaryCharts: { dashboardCategory: {}, category: {}, obsolete: {} },
    chartController: {
      update(key) {
        updates.push(key);
      },
      dispose(key) {
        disposed.push(key);
      },
    },
    remeasureCharts() {},
  };
  instance.renderChart();
  assert.deepEqual(updates, ["main", "dashboardCategory", "category"]);
  assert.deepEqual(disposed, ["obsolete"]);
  assert.equal(instance.secondaryCharts.obsolete, undefined);

  instance.data.dashboardView = { recordCount: 0 };
  instance.data.categories = [];
  instance.renderChart();
  assert.deepEqual(disposed, ["obsolete", "dashboardCategory", "category"]);
});

test("context change during an analysis flight removes old chart data before new labels arrive", async () => {
  const requests = [];
  const definition = loadAnalysisDefinition(() => {
    const item = deferred();
    requests.push(item);
    return item.promise;
  });
  const disposed = [];
  const instance = {
    ...definition.methods,
    data: {
      ...definition.data,
      active: true,
      foreground: true,
      ledgerId: "ledger-a",
      mode: "month",
      anchor: "2026-01",
      loading: false,
      hasChartData: true,
      chartHostMounted: true,
    },
    isAttached: true,
    clearRatioPreview() {},
    disposeChart() {
      this.data.hasChartData = false;
      this.data.chartHostMounted = false;
      disposed.push("main");
    },
    disposeSecondaryCharts() {},
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
  };
  const first = instance.loadAnalysis();
  instance.data.ledgerId = "ledger-b";
  instance.data.anchor = "2026-02";
  instance.loadAnalysis();
  // The first request also clears its old node; the second clear is the
  // context switch itself. Both happen before the replacement response.
  assert.deepEqual(disposed, ["main", "main"]);
  assert.equal(instance.data.hasChartData, false);
  assert.equal(instance.data.chartHostMounted, false);
  requests[0].resolve({ noLedger: true });
  await first;
});

test("analysis failures preserve dirty for an explicit retry", async () => {
  const pending = deferred();
  const definition = loadAnalysisDefinition(() => pending.promise);
  const instance = {
    ...definition.methods,
    data: { ...definition.data, active: true, foreground: true, ledgerId: "ledger" },
    isAttached: true,
    clearRatioPreview() {},
    disposeChart() {},
    disposeSecondaryCharts() {},
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  const request = instance.loadAnalysis();
  pending.promise.catch(() => {});
  pending.resolve(Promise.reject(new Error("network")));
  await request;
  assert.equal(instance.data.error, true);
  assert.equal(instance.dirty, true);
});

test("a queued secondary init after failure cannot recreate a chart", async () => {
  const pending = deferred();
  const definition = loadAnalysisDefinition(() => pending.promise);
  let mounts = 0;
  const instance = {
    ...definition.methods,
    data: { ...definition.data, active: true, foreground: true, ledgerId: "ledger" },
    isAttached: true,
    clearRatioPreview() {},
    disposeChart() {},
    disposeSecondaryCharts() {},
    chartController: {
      mount() {
        mounts += 1;
        return {};
      },
      update() {},
    },
    selectComponent() {
      return { init() {} };
    },
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  const request = instance.loadAnalysis();
  const queuedGeneration = instance.analysisNodeGeneration;
  pending.resolve(Promise.reject(new Error("network")));
  await request;

  instance.onSecondaryChartInit({
    currentTarget: {
      dataset: {
        chartHost: "secondary",
        chartKey: "category",
        chartGeneration: String(queuedGeneration),
      },
    },
    detail: { canvas: {}, width: 240, height: 140 },
  });

  assert.equal(instance.data.error, true);
  assert.equal(mounts, 0);

  // A current-generation callback is also inert once the response is known to
  // have no ledger; this is independent of the stale-generation rejection.
  instance.data.error = false;
  instance.data.noLedger = true;
  instance.data.hasChartData = false;
  instance.onSecondaryChartInit({
    currentTarget: {
      dataset: {
        chartHost: "secondary",
        chartKey: "category",
        chartGeneration: String(instance.analysisNodeGeneration),
      },
    },
    detail: { canvas: {}, width: 240, height: 140 },
  });
  assert.equal(mounts, 0);
});

test("hidden or detached analysis flights never write stale state", async () => {
  const pending = deferred();
  const definition = loadAnalysisDefinition(() => pending.promise);
  const instance = {
    ...definition.methods,
    data: { ...definition.data, active: true, foreground: true, ledgerId: "ledger" },
    isAttached: true,
    clearRatioPreview() {},
    disposeChart() {},
    disposeSecondaryCharts() {},
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  const request = instance.loadAnalysis();
  instance.data.active = false;
  instance.updateAvailability();
  pending.resolve({ noLedger: true });
  await request;
  assert.equal(instance.data.noLedger, false);
  assert.equal(instance.dirty, true);

  instance.isAttached = false;
  instance.data.active = true;
  instance.detached = definition.lifetimes.detached;
  instance.detached();
  assert.equal(instance._analysisFlight, null);
});

test("hidden invalidations coalesce into one analysis refresh on activation", () => {
  const filename = path.resolve("miniprogram/components/tl-tab-analysis/index.js");
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8").replace(/^import .*;\r?\n/, ""), {
    getApp: () => ({ globalData: {} }),
    require: createRequire(filename),
    Component: (value) => {
      definition = value;
    },
    console,
  });
  let loads = 0;
  const instance = {
    ...definition.methods,
    data: { ...definition.data, active: false, foreground: true, ledgerId: "ledger" },
    isAttached: true,
    isBootstrapped: true,
    dirty: false,
    analysisRequestId: 0,
    clearRatioPreview() {},
    loadAnalysis() {
      loads += 1;
      this.dirty = false;
    },
  };

  instance.handleDataInvalidation({ ledgerIds: ["ledger"] });
  instance.handleDataInvalidation({ ledgerIds: ["ledger"] });
  assert.equal(loads, 0);
  assert.equal(instance.dirty, true);

  instance.data.active = true;
  instance.updateAvailability();
  assert.equal(loads, 1);
  assert.equal(instance.dirty, false);
});
