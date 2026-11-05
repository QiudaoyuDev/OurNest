const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("default other categories do not create separate other income or expense entries", () => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync("cloudfunctions/ourNest/handlers/category-tree.js", "utf8"), {
    module,
    require: () => ({ db: {}, now: () => 0, OTHER_CATEGORY_SORT: 999 }),
  });
  for (const defaults of [module.exports.categoryTreeDefaults, module.exports.newLedgerDefaults]) {
    assert.equal(defaults.expense.find(([name]) => name === "其他")[2].includes("其他支出"), false);
    assert.equal(defaults.income.find(([name]) => name === "其他")[2].includes("其他收入"), false);
  }
});

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
  vm.runInNewContext(fs.readFileSync("cloudfunctions/ourNest/handlers/category-tree.js", "utf8"), {
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
  const defaults = module.exports.categoryTreeDefaults.expense.find(([name]) => name === "交通")[2];

  assert.equal(
    await module.exports.ensureSystemChildren("ledger", traffic, defaults, "owner"),
    true
  );
  assert.deepEqual(
    added.map((item) => item.name),
    ["打车", "加油充电", "停车", "过路过桥", "维修保养", "车险", "其他车费"]
  );
  assert.ok(added.every((item) => item.source === "system"));
  assert.equal(
    await module.exports.ensureSystemChildren("ledger", traffic, defaults, "owner"),
    false
  );
});

test("new ledger template extends legacy defaults without changing legacy repair rules", () => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync("cloudfunctions/ourNest/handlers/category-tree.js", "utf8"), {
    module,
    exports: module.exports,
    require: () => ({ db: {}, now: () => "now", OTHER_CATEGORY_SORT: 999 }),
  });
  const legacy = module.exports.categoryTreeDefaults;
  const fresh = module.exports.newLedgerDefaults;
  const names = fresh.expense.map(([name]) => name);
  for (const name of [
    "餐饮",
    "购物",
    "日用",
    "交通",
    "蔬菜",
    "水果",
    "零食",
    "运动",
    "娱乐",
    "通讯",
    "服饰",
    "美容",
    "住房",
    "居家",
    "孩子",
    "长辈",
  ])
    assert.ok(names.includes(name));
  for (const [name, , children] of legacy.expense) {
    const current = fresh.expense.find(([item]) => item === name);
    assert.ok(current);
    assert.deepEqual(Array.from(current[2]), Array.from(children));
  }
  assert.equal(fresh.income, legacy.income);
});

test("new template does not alter lazy repair for an existing parent", async () => {
  const parent = {
    _id: "daily",
    ledgerId: "old",
    type: "expense",
    level: "parent",
    name: "日用",
    icon: "shopping-basket-2-line",
  };
  const child = {
    _id: "daily-default",
    ledgerId: "old",
    level: "child",
    parentId: "daily",
    isDefaultChild: true,
    source: "system",
  };
  const writes = [];
  const db = {
    collection: () => ({
      where: (query) => ({
        limit: () => ({
          get: async () => ({ data: query.level === "parent" ? [parent] : [child] }),
        }),
      }),
      add: async (payload) => {
        writes.push(payload);
        return { _id: "added" };
      },
    }),
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync("cloudfunctions/ourNest/handlers/category-tree.js", "utf8"), {
    module,
    exports: module.exports,
    require: () => ({ db, now: () => "now", OTHER_CATEGORY_SORT: 999 }),
  });
  assert.equal(await module.exports.ensureLedgerCategoryTree("old", "owner"), false);
  assert.equal(writes.length, 0);
});

test("category list bumps the ledger revision after repairing a default tree", async () => {
  let revisions = 0;
  const ledger = { _id: "ledger", ownerOpenid: "owner" };
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync("cloudfunctions/ourNest/handlers/category.handler.js", "utf8"),
    {
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
          getLedgerForUser: async () => ledger,
          getLedgerRole: () => "owner",
          assertReadable: () => {},
          assertLedgerId: () => {},
          getOperation: async () => null,
          saveOperation: async () => ({}),
          getCategoryById: async () => null,
        };
      },
    }
  );

  await module.exports.listCategories("owner", { ledgerId: "ledger" });
  assert.equal(revisions, 1);
  ledger.categoryDeletionId = "child";
  await module.exports.listCategories("owner", { ledgerId: "ledger" });
  assert.equal(revisions, 1);
});

test("category creation checks migration state within the transaction and creates a default child atomically", async () => {
  const module = { exports: {} };
  const added = [];
  let migrationActive = false;
  let ledgerWrites = 0;
  const ledger = { _id: "ledger", ownerOpenid: "owner" };
  const parent = {
    _id: "parent",
    ledgerId: "ledger",
    level: "parent",
    type: "expense",
    name: "交通",
  };
  const db = {
    runTransaction: async (fn) =>
      fn({
        collection: (name) => ({
          doc: () => ({
            get: async () => ({
              data:
                name === "ledgers"
                  ? { ...ledger, categoryDeletionId: migrationActive ? "other" : "" }
                  : parent,
            }),
            update: async () => {
              if (name === "ledgers") ledgerWrites += 1;
            },
          }),
          add: async ({ data }) => {
            added.push(data);
            return { _id: `new-${added.length}` };
          },
        }),
      }),
  };
  vm.runInNewContext(
    fs.readFileSync("cloudfunctions/ourNest/handlers/category.handler.js", "utf8"),
    {
      module,
      exports: module.exports,
      require: (name) => {
        if (name.includes("category-tree")) return {};
        if (name.includes("validators")) return { assertCategoryInput: (value) => value };
        return {
          db,
          _: { inc: () => 1 },
          ok: (value) => value,
          now: () => "now",
          getLedgerForUser: async () => ledger,
          getLedgerRole: () => "owner",
          getCategoryById: async () => parent,
        };
      },
    }
  );
  await assert.rejects(
    module.exports.saveCategory("owner", {
      ledgerId: "ledger",
      level: "child",
      parentId: "parent",
      type: "income",
      name: "不匹配",
    }),
    /PARENT_NOT_FOUND/
  );
  migrationActive = true;
  await assert.rejects(
    module.exports.saveCategory("owner", {
      ledgerId: "ledger",
      level: "parent",
      type: "expense",
      name: "旅行",
    }),
    /CATEGORY_DELETION_IN_PROGRESS/
  );
  assert.equal(added.length, 0);
  migrationActive = false;
  await module.exports.saveCategory("owner", {
    ledgerId: "ledger",
    level: "parent",
    type: "expense",
    name: "旅行",
  });
  assert.equal(added.length, 2);
  assert.equal(added[1].parentId, "new-1");
  assert.equal(added[1].isDefaultChild, true);
  assert.equal(ledgerWrites, 1);
});

test("category deletion targets linked IDs as well as unlinked matching legacy records", async () => {
  const module = { exports: {} };
  const categories = {
    child: {
      _id: "child",
      ledgerId: "ledger",
      type: "expense",
      level: "child",
      parentId: "parent",
      name: "新名称",
    },
    parent: { _id: "parent", ledgerId: "ledger", type: "expense", level: "parent", name: "交通" },
  };
  let migrationQuery;
  let remaining = 260;
  let operation = null;
  let failCleanup = true;
  let ledgerWrites = 0;
  const ledger = { _id: "ledger", categoryDeletionId: "" };
  const db = {
    runTransaction: async (fn) =>
      fn({
        collection: (name) => ({
          doc: (id) => ({
            get: async () => ({ data: name === "ledgers" ? ledger : categories[id] }),
            update: async ({ data }) => {
              if (name === "ledgers") {
                ledgerWrites += 1;
                Object.assign(ledger, data);
              }
              if (name === "categories") Object.assign(categories[id], data);
              if (name === "ledgerOperations") Object.assign(operation, data);
            },
            remove: async () => {
              if (name === "categories" && failCleanup) {
                failCleanup = false;
                throw new Error("network during cleanup");
              }
            },
          }),
        }),
      }),
    collection: (collection) => ({
      where: (query) => ({
        limit: () => ({
          get: async () => ({
            data:
              collection === "records"
                ? Array.from({ length: Math.min(remaining, 50) }, (_, index) => ({
                    _id: `record-${index}`,
                  }))
                : [{ _id: "other", type: "expense", name: "其他" }],
          }),
        }),
        update: async () => {
          if (collection === "records") {
            migrationQuery = query.and[0];
            remaining -= query.and[1]._id.in.length;
          }
        },
        remove: async () => {
          if (collection === "categories" && failCleanup) {
            failCleanup = false;
            throw new Error("network during cleanup");
          }
        },
      }),
      doc: () => ({ remove: async () => {}, update: async () => {} }),
    }),
  };
  const command = {
    inc: (value) => ({ inc: value }),
    in: (values) => ({ in: values }),
    or: (items) => ({ or: items }),
    and: (items) => ({ and: items }),
  };
  vm.runInNewContext(
    fs.readFileSync("cloudfunctions/ourNest/handlers/category.handler.js", "utf8"),
    {
      module,
      exports: module.exports,
      require: (name) => {
        if (name.includes("category-tree"))
          return { addDefaultChild: async () => ({ _id: "other-child", name: "其他" }) };
        if (name.includes("validators")) return {};
        return {
          db,
          _: command,
          ok: (value) => value,
          now: () => "now",
          bumpLedgerSyncRevision: async () => {},
          getLedgerForUser: async () => ledger,
          getLedgerRole: () => "owner",
          assertLedgerId: () => {},
          getOperation: async () => operation,
          saveOperation: async (previous, patch) => {
            operation = { ...(previous || { _id: "op" }), ...patch };
            return operation;
          },
          getCategoryById: async (id) => categories[id],
        };
      },
    }
  );
  const first = await module.exports.removeCategory("owner", {
    ledgerId: "ledger",
    categoryId: "child",
  });
  assert.equal(first.hasMore, true);
  assert.equal(ledgerWrites, 1);
  assert.equal(ledger.categoryDeletionId, "child");
  assert.equal(remaining, 10);
  await assert.rejects(
    module.exports.removeCategory("owner", {
      ledgerId: "ledger",
      categoryId: "child",
    }),
    /network during cleanup/
  );
  assert.equal(operation.stage, "cleanup");
  const second = await module.exports.removeCategory("owner", {
    ledgerId: "ledger",
    categoryId: "child",
  });
  assert.equal(second.hasMore, false);
  assert.equal(remaining, 0);
  assert.equal(ledger.categoryDeletionId, "");
  assert.equal(operation.stage, "complete");
  assert.equal(migrationQuery.and[0].type, "expense");
  assert.equal(migrationQuery.and[1].or[0].categoryId.in[0], "child");
  assert.equal(migrationQuery.and[1].or[1].categoryName, "新名称");
  assert.equal(migrationQuery.and[1].or[1].categoryId.in[0], "");
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
