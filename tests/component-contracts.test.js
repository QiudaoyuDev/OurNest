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

test("analysis uses the 2D-capable canvas path and record icons", () => {
  const template = fs.readFileSync("miniprogram/components/tl-tab-analysis/index.wxml", "utf8");
  const chart = template.match(/<ec-canvas\b[^>]*id="dashboard-category-chart"[^>]*>/);
  assert.ok(chart);
  assert.doesNotMatch(chart[0], /force-use-old-canvas/);
  assert.match(template, /item\.displayIcon/);
  assert.match(template, /<tl-analysis-record/);
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
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require: createRequire(filename),
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
});

test("joinLedger rejects personal ledgers with PERSONAL_LEDGER_NOT_SHARED", async () => {
  const filename = path.resolve("cloudfunctions/ourNest/handlers/ledger.handler.js");
  const mod = { exports: {} };
  let queriedCode = "";
  const mockDb = {
    collection: () => ({
      where: (query) => {
        queriedCode = query.inviteCode;
        return {
          limit: () => ({
            get: async () => ({
              data: [
                {
                  _id: "ledger-personal-1",
                  name: "个人账本",
                  type: "personal",
                  inviteCode: query.inviteCode,
                },
              ],
            }),
          }),
        };
      },
    }),
  };
  const mockHelpers = {
    db: mockDb,
    _: {},
    ok: (data) => ({ success: true, data }),
    fail: (message, code) => ({ success: false, code, message }),
    now: () => new Date(),
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require: (dep) => {
      if (dep.includes("shared/helpers")) return mockHelpers;
      if (dep.includes("category-tree")) return {};
      if (dep.includes("validators/schemas"))
        return {
          assertOpenid: () => {},
          assertLedgerInput: () => {},
          assertInviteInput: () => {},
        };
      return {};
    },
    module: mod,
    exports: mod.exports,
    console,
  });
  const res = await mod.exports.joinLedger("user-joiner", { inviteCode: "123456" });
  assert.equal(queriedCode, "123456");
  assert.equal(res.success, false);
  assert.equal(res.code, "PERSONAL_LEDGER_NOT_SHARED");
  assert.equal(res.message, "个人账本不能添加成员");
});
