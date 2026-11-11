const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const feedback = require("../miniprogram/services/feedback-ui");

function component(name, overrides = {}) {
  const filename = path.resolve("miniprogram/components", name, "index.js");
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require: overrides.require || createRequire(filename),
    Component(value) {
      definition = value;
    },
  });
  const events = [];
  const instance = {
    ...definition.methods,
    data: {
      ...Object.fromEntries(
        Object.entries(definition.properties || {}).map(([key, value]) => [key, value.value])
      ),
      ...definition.data,
    },
    setData(patch) {
      Object.assign(this.data, patch);
    },
    triggerEvent(name, detail) {
      events.push({ name, detail });
    },
  };
  return { definition, instance, events };
}

function loadAnalysisComponentDefinition() {
  const filename = path.resolve("miniprogram/components/tl-tab-analysis/index.js");
  const realRequire = createRequire(filename);
  let definition;
  let getAnalysis = () => Promise.resolve({ noLedger: true });
  vm.runInNewContext(fs.readFileSync(filename, "utf8").replace(/^import .*;\r?\n/, ""), {
    getApp: () => ({ globalData: {} }),
    require: (name) =>
      name.includes("ledger.service")
        ? { getAnalysis: (...args) => getAnalysis(...args) }
        : realRequire(name),
    Component: (value) => {
      definition = value;
    },
    console,
    setTimeout,
  });
  definition.__setGetAnalysis = (next) => {
    getAnalysis = next;
  };
  return definition;
}

function makeAnalysisLifecycleInstance(definition, data, getAnalysis) {
  definition.__setGetAnalysis(getAnalysis);
  const instance = {
    ...definition.methods,
    data: { ...data },
    isAttached: true,
    clearRatioPreview() {},
    disposeChart() {},
    disposeSecondaryCharts() {},
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
  };
  return instance;
}

test("analysis record row preserves the record identity when opened", () => {
  const { instance, events } = component("tl-analysis-record");
  instance.data.record = { _id: "record-1", type: "income", categoryIcon: "funds-line" };
  instance.open();
  assert.equal(events[0].name, "open");
  assert.equal(events[0].detail.id, "record-1");
  instance.data.record = { id: "record-2" };
  instance.open();
  assert.equal(events[1].detail.id, "record-2");
});

test("every component tag resolves through its global or local registration", () => {
  const root = path.resolve("miniprogram");
  const global = JSON.parse(fs.readFileSync(path.join(root, "app.json"))).usingComponents;
  function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(filename) : [filename];
    });
  }
  for (const filename of walk(root).filter((name) => name.endsWith(".wxml"))) {
    const config = JSON.parse(fs.readFileSync(filename.replace(/\.wxml$/, ".json"), "utf8"));
    const registrations = { ...global, ...config.usingComponents };
    const tags = [
      ...fs.readFileSync(filename, "utf8").matchAll(/<(tl-[\w-]+|ec-canvas)(?=[\s>])/g),
    ].map((match) => match[1]);
    for (const tag of tags) {
      assert.ok(registrations[tag], `${filename}: ${tag} is not registered`);
      assert.ok(
        fs.existsSync(path.join(root, registrations[tag] + ".json")),
        `${tag}: component path does not exist`
      );
    }
    for (const tag of Object.keys(config.usingComponents || {})) {
      assert.ok(tags.includes(tag), `${filename}: unused local registration ${tag}`);
      assert.ok(!global[tag], `${filename}: redundant global registration ${tag}`);
    }
  }
});

test("category tree renders one controlled selection by ID and preserves selection events", () => {
  const { instance, events } = component("tl-category-tree");
  assert.equal(instance.data.selectedCategoryId, "");
  const template = fs.readFileSync("miniprogram/components/tl-category-tree/index.wxml", "utf8");
  const childClass = template.match(/class="(tl-category-tree__child(?:\s[^"]*)?)"/)[1];
  const selectedClass = (child, selectedCategoryId) =>
    childClass.replace(/\{\{(.*?)\}\}/g, (_match, expression) =>
      vm.runInNewContext(expression, { child, selectedCategoryId })
    );
  const children = [
    { _id: "lunch", name: "午餐" },
    { id: "dinner", name: "午餐" },
  ];
  for (const id of ["", "lunch", "dinner", "deleted"]) {
    const selected = children.filter((child) => selectedClass(child, id).includes("is-selected"));
    assert.equal(selected.length, id === "lunch" || id === "dinner" ? 1 : 0);
    if (selected.length) assert.equal(selected[0]._id || selected[0].id, id);
  }
  assert.match(
    template,
    /wx:if="\{\{selectedCategoryId && \(child\._id \|\| child\.id\) === selectedCategoryId\}\}"/
  );
  assert.match(template, /name="check-line"/);
  const style = fs.readFileSync("miniprogram/components/tl-category-tree/index.wxss", "utf8");
  assert.match(style, /\.tl-category-tree__child\.is-selected\s*\{[^}]*border-color:/);
  assert.match(style, /\.tl-category-tree__child\.is-selected\s*\{[^}]*background:/);
  instance.select({ currentTarget: { dataset: { categoryId: "dinner" } } });
  assert.equal(events[0].name, "select");
  assert.equal(events[0].detail.categoryId, "dinner");
  assert.equal(instance.data.selectedCategoryId, "");
});

test("record entry opens its keypad only after selecting a category", () => {
  const template = fs.readFileSync("miniprogram/pages/record-edit/index.wxml", "utf8");
  const form = fs.readFileSync("miniprogram/components/tl-record-form/index.wxml", "utf8");
  assert.match(template, /wx:for="\{\{flatCategories\}\}"/);
  assert.match(template, /entry-visible="\{\{!!categoryId\}\}"/);
  assert.doesNotMatch(template, /openCategoryManager/);
  assert.match(form, /quickEntry && entryVisible/);
  assert.match(template, /class="entry-family"/);
});

test("analysis dashboard exposes loading, error and category detail actions", () => {
  const template = fs.readFileSync("miniprogram/components/tl-tab-analysis/index.wxml", "utf8");
  assert.match(template, /categoryPreviewStatus === 'loading'/);
  assert.match(template, /categoryPreviewStatus === 'error'/);
  assert.match(template, /categoryPreviewStatus === 'stale'/);
  assert.match(template, /categoryPreviewStatus === 'ready'/);
  assert.match(template, /<tl-skeleton[^>]*categoryPreviewStatus/);
  assert.match(template, /<tl-empty-state[^>]*variant="error"/);
  assert.match(template, /bindtap="selectDashboardCategory"/);
  assert.match(template, /bind:tap="openDashboardCategoryRecords"/);
});

test("analysis has no unused ratio section outside the page root", () => {
  const template = fs.readFileSync("miniprogram/components/tl-tab-analysis/index.wxml", "utf8");
  assert.match(template.trimStart(), /^<view class="tab-panel analysis-page">/);
  assert.doesNotMatch(template, /<template\s+name="ratio-section"/);
});

test("analysis uses the 2D-capable canvas path and record icons", () => {
  const template = fs.readFileSync("miniprogram/components/tl-tab-analysis/index.wxml", "utf8");
  const chart = template.match(/<ec-canvas\b[^>]*id="dashboard-category-chart"[^>]*>/);
  assert.ok(chart);
  assert.doesNotMatch(chart[0], /force-use-old-canvas/);
  assert.match(chart[0], /wx:if="\{\{categoryChartActivated\}\}"/);
  assert.match(template, /item\.displayIcon/);
  assert.match(template, /<tl-analysis-record/);
});

test("analysis cumulative branch includes all mode while custom pickers stay custom-only", () => {
  const template = fs.readFileSync("miniprogram/components/tl-tab-analysis/index.wxml", "utf8");
  const branch = template.match(
    /<block\s+wx:elif="\{\{\s*(mode\s*===\s*'custom'\s*\|\|\s*mode\s*===\s*'all')\s*\}\}"\s*>([\s\S]*?)<\/block\s*>/
  );
  assert.ok(branch, "custom/all analysis branch is present");
  const branchCondition = branch[1];
  assert.equal(vm.runInNewContext(branchCondition, { mode: "custom" }), true);
  assert.equal(vm.runInNewContext(branchCondition, { mode: "all" }), true);
  assert.equal(vm.runInNewContext(branchCondition, { mode: "month" }), false);

  const customRange = branch[2].match(
    /<view\s+wx:if="\{\{\s*([^}]+?)\s*\}\}"\s+class="custom-range card"\s*>([\s\S]*?)<view\s+class="analysis-summary-card/
  );
  assert.ok(customRange, "custom date range is conditionally rendered");
  assert.equal(vm.runInNewContext(customRange[1], { mode: "custom" }), true);
  assert.equal(vm.runInNewContext(customRange[1], { mode: "all" }), false);
  assert.equal([...customRange[2].matchAll(/<picker\b/g)].length, 2);
  assert.equal([...branch[2].matchAll(/<picker\b/g)].length, 2);
});

test("analysis chart hosts encode the loading and terminal-state invariant", () => {
  const template = fs.readFileSync("miniprogram/components/tl-tab-analysis/index.wxml", "utf8");
  const mainHosts = [...template.matchAll(/<ec-canvas\b[^>]*id="analysis-chart"[^>]*>/g)].map(
    (match) => match[0]
  );
  assert.equal(mainHosts.length, 2);
  mainHosts.forEach((host) => {
    assert.match(
      host,
      /data-chart-host="main"[^>]*data-chart-generation="\{\{chartHostGeneration\}\}"/
    );
    assert.match(host, /bind:init="onChartInit"/);
  });

  // The host is absent on the first loading pass, but the same-context refresh
  // may keep it mounted. The content is hidden and pointer-inert for that pass.
  assert.match(
    template,
    /wx:if="\{\{chartHostMounted && chartFirstReadyEver && hasChartData\}\}" class="chart-card card"/
  );
  assert.match(
    template,
    /class="analysis-content \{\{loading \|\| error \|\| noLedger \? 'is-analysis-hidden' : ''\}\}"/
  );
  const style = fs.readFileSync("miniprogram/components/tl-tab-analysis/index.wxss", "utf8");
  assert.match(style, /\.analysis-content\.is-analysis-hidden\s*\{[^}]*visibility:\s*hidden;/);
  assert.match(style, /\.analysis-content\.is-analysis-hidden\s*\{[^}]*pointer-events:\s*none;/);

  // Both cumulative and period chart hosts use the same lifecycle guard.
  assert.match(
    template,
    /wx:if="\{\{chartHostMounted && chartFirstReadyEver && categories\.length\}\}" class="analysis-chart-canvas"/
  );
  assert.match(template, /id="all-category-chart"[^>]*bind:initerror="onSecondaryChartInitError"/);
});

test("analysis lifecycle keeps only ready same-context content and clears old hosts on failure", async () => {
  const definition = loadAnalysisComponentDefinition();
  const initial = definition.data;
  const hostVisible = (state) =>
    state.chartHostMounted && state.chartFirstReadyEver && state.hasChartData;
  assert.equal(initial.loading, true);
  assert.equal(hostVisible(initial), false);

  const requests = [];
  const ready = {
    ...definition.data,
    active: true,
    foreground: true,
    ledgerId: "ledger-1",
    loading: false,
    chartHostMounted: true,
    chartFirstReadyEver: true,
    hasChartData: true,
  };
  const instance = makeAnalysisLifecycleInstance(definition, ready, (request) => {
    requests.push(request);
    return Promise.resolve({ noLedger: true });
  });
  instance._analysisNodeContext = instance.getAnalysisRequestContext();
  const refresh = instance.loadAnalysis();
  assert.equal(instance.data.loading, true);
  assert.equal(hostVisible(instance.data), true);
  assert.equal(instance.data.error, false);
  await refresh;
  assert.equal(instance.data.noLedger, true);
  assert.equal(instance.data.hasChartData, false);
  assert.equal(instance.data.chartHostMounted, false);
  assert.equal(hostVisible(instance.data), false);
  assert.equal(requests.length, 1);

  const failed = makeAnalysisLifecycleInstance(definition, { ...ready }, () =>
    Promise.reject(new Error("network"))
  );
  await failed.loadAnalysis();
  assert.equal(failed.data.error, true);
  assert.equal(failed.data.hasChartData, false);
  assert.equal(failed.data.chartHostMounted, false);
  assert.equal(hostVisible(failed.data), false);
});

test("ledger switcher normalizes both ledger shapes and only emits selection events", () => {
  const { definition, instance, events } = component("tl-ledger-switcher");
  definition.observers["ledgers, selectedId"].call(
    instance,
    [
      { _id: "active", name: "日常", type: "shared", roleTag: "成员", memberCount: 2 },
      { id: "view", displayName: "旅行", type: "personal" },
    ],
    "view"
  );
  assert.equal(instance.data.options[0].meta, "成员 · 2 人");
  assert.equal(instance.data.options[1].name, "旅行");
  assert.equal(instance.data.options[1].selected, true);
  instance.select({ currentTarget: { dataset: { id: "view" } } });
  assert.equal(events[0].name, "select");
  assert.equal(events[0].detail.ledgerId, "view");
  instance.data.busy = true;
  instance.select({ currentTarget: { dataset: { id: "active" } } });
  instance.close();
  instance.manage();
  instance.create();
  assert.equal(events.length, 1);
});

test("merged feedback host retains notifications and page visibility lifecycle", () => {
  feedback.clearFeedback();
  const { definition, instance } = component("tl-feedback-host", { require: () => feedback });
  definition.lifetimes.attached.call(instance);
  const token = feedback.showLoading({ message: "处理中" });
  feedback.showToast({ type: "warning", message: "请确认金额" });
  assert.equal(instance.data.loadingVisible, true);
  assert.equal(instance.data.toastIconName, "error-warning-line");
  definition.pageLifetimes.hide.call(instance);
  feedback.showToast({ type: "success", message: "完成" });
  assert.equal(instance.data.toastVisible, false);
  definition.pageLifetimes.show.call(instance);
  assert.equal(instance.data.toastVisible, true);
  assert.equal(instance.data.toastIconName, "checkbox-circle-line");
  feedback.hideLoading(token);
  assert.equal(instance.data.loadingVisible, false);
  definition.lifetimes.detached.call(instance);
  feedback.clearFeedback();
});

test("budget progress clamps invalid percentages and skeleton rejects unknown variants", () => {
  const bar = component("tl-budget-progress");
  for (const [input, expected] of [
    [0, "0"],
    [75.126, "75.13"],
    [163.52, "100"],
    [-10, "0"],
    [NaN, "0"],
    [Infinity, "0"],
  ]) {
    bar.definition.observers.rate.call(bar.instance, input);
    assert.equal(bar.instance.data.barStyle, `width: ${expected}%`);
  }
  const skeleton = component("tl-skeleton");
  skeleton.definition.observers.variant.call(skeleton.instance, "analysis");
  assert.equal(skeleton.instance.data.resolvedVariant, "analysis");
  skeleton.definition.observers.variant.call(skeleton.instance, "typo");
  assert.equal(skeleton.instance.data.resolvedVariant, "list");
});

test("index shell page lazily mounts and preserves visited tabs across switches", () => {
  const filename = path.resolve("miniprogram/pages/index/index.js");
  let definition;
  const requireFromIndex = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require: (name) =>
      name.includes("ledger.store")
        ? { subscribeSync: () => () => {}, syncLedgers: () => Promise.resolve({}) }
        : requireFromIndex(name),
    Page(value) {
      definition = value;
    },
    getApp: () => ({ globalData: { currentLedger: { _id: "ledger1" } } }),
    console,
  });
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  page.onLoad();
  assert.equal(page.data.activeTab, "index");
  assert.equal(page.data.foreground, true);
  assert.equal(page.data.visitedTabs.index, true);

  page.switchTab({ detail: { tab: "records" } });
  assert.equal(page.data.activeTab, "records");
  assert.equal(page.data.visitedTabs.index, true);
  assert.equal(page.data.visitedTabs.records, true);

  page.switchTab({ detail: { tab: "index" } });
  assert.equal(page.data.activeTab, "index");
  assert.equal(page.data.visitedTabs.index, true);
  assert.equal(page.data.visitedTabs.records, true);

  page.switchTab({ detail: { tab: "analysis" } });
  assert.equal(page.data.activeTab, "analysis");
  assert.equal(page.data.visitedTabs.analysis, true);
  assert.equal(page.data.visitedTabs.records, true);
  assert.equal(page.data.visitedTabs.index, true);

  page.onHide();
  assert.equal(page.data.foreground, false);
  page.onShow();
  assert.equal(page.data.foreground, true);
});

test("returning to the index refreshes the home dashboard when the current ledger changed", () => {
  const filename = path.resolve("miniprogram/pages/index/index.js");
  const requireFromIndex = createRequire(filename);
  let definition;
  const app = { globalData: { currentLedger: { _id: "new-ledger" } } };
  let refreshes = 0;
  const home = {
    data: { ledgerId: "" },
    refreshDashboard: () => {
      refreshes += 1;
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require: (name) =>
      name.includes("ledger.store")
        ? { subscribeSync: () => () => {}, syncLedgers: () => Promise.resolve({}) }
        : requireFromIndex(name),
    Page: (value) => {
      definition = value;
    },
    getApp: () => app,
    console,
  });
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) {
      Object.assign(this.data, patch);
    },
    selectComponent: () => home,
  };
  page.onShow();
  assert.equal(refreshes, 1);
  home.data.ledgerId = "new-ledger";
  page.onShow();
  assert.equal(refreshes, 1);
  app.globalData.currentLedger = null;
  page.onShow();
  assert.equal(refreshes, 2);
  page.selectComponent = () => null;
  page.onShow();
  assert.equal(refreshes, 2);
});

test("tl-navbar supports ledger brand flow and fires switchledger event", () => {
  const { definition, instance, events } = component("tl-navbar");
  assert.equal(definition.properties.ledgerName.type.name, "String");
  assert.equal(definition.properties.showLedger.type.name, "Boolean");
  instance.handleSwitchLedger();
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "switchledger");

  const template = fs.readFileSync("miniprogram/components/tl-navbar/index.wxml", "utf8");
  assert.match(template, /class="nav-brand-ledger-flow"/);
  assert.match(template, /class="brand-ledger-name"/);
  assert.match(template, /bindtap="handleSwitchLedger"/);
});

test("tl-tab-records and tl-tab-analysis remove overcrowded ledger chips from toolbar", () => {
  const recordsTemplate = fs.readFileSync(
    "miniprogram/components/tl-tab-records/index.wxml",
    "utf8"
  );
  assert.doesNotMatch(recordsTemplate, /class="ledger-chip"/);
  assert.match(recordsTemplate, /class="month-switcher"/);

  const analysisTemplate = fs.readFileSync(
    "miniprogram/components/tl-tab-analysis/index.wxml",
    "utf8"
  );
  assert.doesNotMatch(analysisTemplate, /class="context-ledger"/);
  assert.match(analysisTemplate, /class="context-period"/);
});

test("index page manages showNavbarLedger and triggers tab ledger switchers", () => {
  const filename = path.resolve("miniprogram/pages/index/index.js");
  const requireFromIndex = createRequire(filename);
  let definition;
  const app = { globalData: { currentLedger: { _id: "ledger-1", name: "我们的小窝" } } };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require: (name) =>
      name.includes("ledger.store")
        ? { subscribeSync: () => () => {}, syncLedgers: () => Promise.resolve({}) }
        : requireFromIndex(name),
    Page: (value) => {
      definition = value;
    },
    getApp: () => app,
    console,
  });
  let switchedTarget = "";
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) {
      Object.assign(this.data, patch);
    },
    selectComponent(selector) {
      switchedTarget = selector;
      return {
        switchLedger: () => {},
      };
    },
  };
  page.onLoad();
  assert.equal(page.data.activeTab, "index");
  assert.equal(page.data.showNavbarLedger, false);

  page.switchTab({ detail: { tab: "records" } });
  assert.equal(page.data.activeTab, "records");
  assert.equal(page.data.showNavbarLedger, true);
  assert.equal(page.data.currentLedgerName, "我们的小窝");

  page.onNavbarSwitchLedger();
  assert.equal(switchedTarget, "#tab-records");

  page.switchTab({ detail: { tab: "analysis" } });
  assert.equal(page.data.activeTab, "analysis");
  assert.equal(page.data.showNavbarLedger, true);

  page.onNavbarSwitchLedger();
  assert.equal(switchedTarget, "#tab-analysis");

  page.switchTab({ detail: { tab: "profile" } });
  assert.equal(page.data.activeTab, "profile");
  assert.equal(page.data.showNavbarLedger, false);
});
