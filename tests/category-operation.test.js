const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createPage(saveCategory) {
  let definition;
  const toasts = [];
  const source = fs.readFileSync("miniprogram/pages/category-operation/index.js", "utf8");
  vm.runInNewContext(source, {
    getApp: () => ({ globalData: { currentLedger: {} } }),
    require: (modulePath) =>
      modulePath.includes("feedback-ui")
        ? { showToast: (options) => toasts.push(options) }
        : {
            saveCategory,
            listCategories: async () => ({ categories: [], role: "owner" }),
          },
    Page: (config) => {
      definition = config;
    },
  });
  const page = {
    ...definition,
    data: {
      ...definition.data,
      ledgerId: "ledger-1",
      level: "parent",
      showEditor: true,
      draftName: "餐饮",
      draftIcon: "restaurant-line",
    },
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  return { page, toasts };
}

for (const level of ["parent", "child"]) {
  test(`category ${level} save ignores a second event while pending`, async () => {
    let finish;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const calls = [];
    const { page } = createPage((payload) => {
      calls.push(payload);
      return pending;
    });
    page.data.level = level;
    page.data.parentId = level === "child" ? "parent-1" : "";

    const first = page.saveEditor();
    const second = page.saveEditor();
    assert.equal(calls.length, 1);
    assert.equal(page.data.saving, true);
    assert.equal(page.data.showEditor, true);
    page.closeEditor();
    assert.equal(page.data.showEditor, true);

    finish();
    await Promise.all([first, second]);
    assert.equal(calls[0].level, level);
    assert.equal(calls[0].parentId, page.data.parentId);
    assert.equal(page.data.saving, false);
    assert.equal(page.data.showEditor, false);
  });
}

test("existing ledgers receive missing transport defaults once without replacing custom categories", async () => {
  const children = [
    { name: "公交地铁", source: "system" },
    { name: "火车高铁", source: "custom" },
  ];
  const added = [];
  const db = {
    collection: () => ({
      where: () => ({
        limit: () => ({ get: async () => ({ data: children }) }),
      }),
      add: async ({ data }) => {
        children.push(data);
        added.push(data);
        return { _id: `child-${added.length}` };
      },
    }),
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync("cloudfunctions/tomatoLedger/handlers/category-tree.js", "utf8"), {
    module,
    exports: module.exports,
    require: () => ({ db, now: () => "now", OTHER_CATEGORY_SORT: 999 }),
  });
  const traffic = {
    _id: "traffic",
    type: "expense",
    name: "交通",
    icon: "taxi-line",
  };
  const defaults = module.exports.categoryTreeDefaults.expense.find(
    ([name]) => name === "交通"
  )[2];

  assert.equal(await module.exports.ensureSystemChildren("ledger", traffic, defaults, "owner"), true);
  assert.deepEqual(
    added.map((item) => item.name),
    ["打车", "加油充电", "停车", "过路过桥", "维修保养", "车险", "其他车费"]
  );
  assert.ok(added.every((item) => item.source === "system"));
  assert.equal(await module.exports.ensureSystemChildren("ledger", traffic, defaults, "owner"), false);
});

test("category list bumps the ledger revision after repairing a default tree", async () => {
  let revisions = 0;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync("cloudfunctions/tomatoLedger/handlers/category.handler.js", "utf8"), {
    module,
    exports: module.exports,
    require: (modulePath) => {
      if (modulePath.includes("category-tree")) {
        return { ensureLedgerCategoryTree: async () => true, addDefaultChild: async () => ({}) };
      }
      if (modulePath.includes("validators")) return { assertCategoryInput: (value) => value };
      return {
        db: {
          collection: () => ({
            where: () => ({
              orderBy: () => ({ limit: () => ({ get: async () => ({ data: [] }) }) }),
            }),
          }),
        },
        ok: (value) => value,
        now: () => "now",
        bumpLedgerSyncRevision: async () => {
          revisions += 1;
        },
        getLedgerForUser: async () => ({ _id: "ledger", ownerOpenid: "owner" }),
        getLedgerRole: () => "owner",
        assertReadable: () => {},
        assertLedgerId: () => {},
        getOperation: async () => null,
        saveOperation: async () => ({}),
        getCategoryById: async () => null,
      };
    },
  });

  await module.exports.listCategories("owner", { ledgerId: "ledger" });
  assert.equal(revisions, 1);
});

test("category save failure keeps editor open and allows retry", async () => {
  let calls = 0;
  const { page, toasts } = createPage(async () => {
    calls += 1;
    if (calls === 1) throw new Error("网络错误");
  });

  await page.saveEditor();
  assert.equal(page.data.saving, false);
  assert.equal(page.data.showEditor, true);
  assert.equal(toasts[0].type, "error");
  assert.equal(toasts[0].message, "网络错误");

  await page.saveEditor();
  assert.equal(calls, 2);
  assert.equal(page.data.showEditor, false);
});
