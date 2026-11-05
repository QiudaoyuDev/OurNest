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
