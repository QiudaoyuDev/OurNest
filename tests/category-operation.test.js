const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("new ledger defaults are flat and unique within each income or expense type", () => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync("cloudfunctions/ourNest/handlers/category-tree.js", "utf8"), {
    module,
    require: () => ({ db: {}, now: () => 0, OTHER_CATEGORY_SORT: 999 }),
  });
  const defaults = module.exports.flatLedgerDefaults();
  assert.deepEqual(
    Array.from(
      defaults.filter((item) => item.type === "income"),
      (item) => item.name
    ),
    ["工资", "兼职", "理财", "礼金", "其它"]
  );
  assert.deepEqual(
    Array.from(
      defaults.filter((item) => item.type === "expense"),
      (item) => item.name
    ),
    [
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
      "社交",
      "旅行",
      "烟酒",
      "数码",
      "汽车",
      "医疗",
      "书籍",
      "学习",
      "宠物",
      "礼金",
      "礼物",
      "办公",
      "维修",
      "捐赠",
      "彩票",
      "亲友",
      "快递",
      "还款",
      "高铁动车",
      "其他",
    ]
  );
  for (const type of ["expense", "income"]) {
    const categories = defaults.filter((item) => item.type === type);
    assert.ok(categories.length);
    assert.equal(new Set(categories.map((item) => item.name)).size, categories.length);
    assert.equal(categories.filter((item) => item.isOther).length, 1);
    assert.ok(categories.every((item) => !item.parentId && !item.level));
  }
  assert.ok(defaults.some((item) => item.type === "expense" && item.name === "餐饮"));
  assert.equal(defaults.find((item) => item.name === "高铁动车").systemKey, "high_speed_rail");
  const categoryIcons = require("../miniprogram/components/tl-icon/category-icons");
  assert.ok(
    defaults.every((item) => categoryIcons[item.icon]),
    "every default category must use a local category illustration"
  );
});

test("default category initialization uses the provided transaction", async () => {
  const added = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync("cloudfunctions/ourNest/handlers/category-tree.js", "utf8"), {
    module,
    require: () => ({ db: {}, now: () => 0 }),
  });
  const transaction = {
    collection(name) {
      assert.equal(name, "categories");
      return { add: async ({ data }) => added.push(data) };
    },
  };
  await module.exports.createDefaultCategories("ledger", "owner", transaction);
  assert.equal(added.length, 41);
  assert.ok(added.every((item) => item.ledgerId === "ledger" && item.createdBy === "owner"));
  assert.equal(added.filter((item) => item.isOther).length, 2);
  assert.equal(added.filter((item) => item.systemKey === "high_speed_rail").length, 1);
});

test("existing flat categories are preserved while missing defaults are identified by type", () => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync("cloudfunctions/ourNest/handlers/category-tree.js", "utf8"), {
    module,
    require: () => ({ db: {}, now: () => 0 }),
  });
  const existing = [
    { _id: "custom", type: "expense", name: "餐饮", icon: "custom-icon" },
    { _id: "legacy", type: "income", name: "工资", level: "child", parentId: "parent" },
    { _id: "income-gift", type: "income", name: "礼金" },
  ];
  const before = JSON.stringify(existing);
  const missing = module.exports.missingFlatDefaults(existing);
  assert.equal(
    missing.some((item) => item.type === "expense" && item.name === "餐饮"),
    false
  );
  assert.equal(
    missing.some((item) => item.type === "income" && item.name === "工资"),
    true
  );
  assert.equal(
    missing.some((item) => item.type === "expense" && item.name === "礼金"),
    true
  );
  assert.equal(
    missing.some((item) => item.type === "income" && item.name === "礼金"),
    false
  );
  assert.equal(JSON.stringify(existing), before);
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

test("flat category save ignores duplicate submissions while pending", async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const calls = [];
  const { page } = createPage((payload) => {
    calls.push(payload);
    return pending;
  });
  const first = page.saveEditor();
  const second = page.saveEditor();
  assert.equal(calls.length, 1);
  assert.equal(page.data.saving, true);
  page.closeEditor();
  assert.equal(page.data.showEditor, true);
  finish();
  await Promise.all([first, second]);
  assert.equal(calls[0].type, "expense");
  assert.equal(Object.hasOwn(calls[0], "parentId"), false);
  assert.equal(Object.hasOwn(calls[0], "level"), false);
  assert.equal(page.data.saving, false);
  assert.equal(page.data.showEditor, false);
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

function categoryFixture() {
  const rows = {
    ledger: { _id: "ledger", ownerOpenid: "owner", memberOpenids: ["member"], syncRevision: 1 },
    categories: [
      { _id: "food", ledgerId: "ledger", type: "expense", name: "餐饮", icon: "restaurant-line" },
      {
        _id: "other",
        ledgerId: "ledger",
        type: "expense",
        name: "其他",
        icon: "more-2-line",
        isOther: true,
      },
      { _id: "salary", ledgerId: "ledger", type: "income", name: "工资", icon: "wallet-line" },
    ],
    operations: [],
  };
  let stale = false;
  const increment = (data, target) => {
    for (const [key, value] of Object.entries(data))
      target[key] = value && value.increment ? (target[key] || 0) + value.increment : value;
  };
  const collection = (name) => ({
    where: (query) => ({
      limit: () => ({
        get: async () => ({
          data: rows.categories.filter((item) =>
            Object.entries(query).every(([key, value]) => item[key] === value)
          ),
        }),
      }),
      orderBy: () => ({
        limit: () => ({
          get: async () => ({
            data: rows.categories.filter((item) => item.ledgerId === query.ledgerId),
          }),
        }),
      }),
    }),
    doc: (id) => ({
      get: async () => ({
        data: name === "ledgers" ? rows.ledger : rows.categories.find((item) => item._id === id),
      }),
      update: async ({ data }) =>
        increment(
          data,
          name === "ledgers" ? rows.ledger : rows.categories.find((item) => item._id === id)
        ),
    }),
    add: async ({ data }) => {
      rows.categories.push({ _id: `new-${rows.categories.length}`, ...data });
    },
  });
  const helpers = {
    db: { collection, runTransaction: async (fn) => fn({ collection }) },
    _: { inc: (increment) => ({ increment }) },
    ok: (data) => ({ success: true, data }),
    now: () => 0,
    getLedgerForUser: async () => ({
      ...rows.ledger,
      syncRevision: rows.ledger.syncRevision - (stale ? 1 : 0),
    }),
    getLedgerRole: (openid, ledger) =>
      openid === ledger.ownerOpenid
        ? "owner"
        : ledger.memberOpenids.includes(openid)
          ? "member"
          : "readonly",
    assertReadable: () => {},
    assertLedgerId: () => {},
    getOperation: async () => null,
    saveOperation: async (_operation, data) => {
      rows.operations.push(data);
      return data;
    },
    getCategoryById: async (id) => rows.categories.find((item) => item._id === id),
  };
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync("cloudfunctions/ourNest/handlers/category.handler.js", "utf8"),
    {
      module,
      require: (name) =>
        name.includes("ledger-state")
          ? require("../cloudfunctions/ourNest/shared/ledger-state")
          : name.includes("validators")
            ? { assertCategoryInput: ({ name }) => ({ name: name.trim() }) }
            : helpers,
    }
  );
  return {
    handler: module.exports,
    rows,
    setStale: () => {
      stale = true;
    },
  };
}

test("flat category creation validates roles, duplicates, type and revision", async () => {
  const { handler, rows, setStale } = categoryFixture();
  await assert.rejects(
    handler.saveCategory("visitor", { ledgerId: "ledger", type: "expense", name: "旅行" }),
    /NO_CATEGORY_PERMISSION/
  );
  await assert.rejects(
    handler.saveCategory("owner", { ledgerId: "ledger", type: "expense", name: "餐饮" }),
    /CATEGORY_NAME_EXISTS/
  );
  await handler.saveCategory("member", {
    ledgerId: "ledger",
    type: "income",
    name: "餐饮",
    icon: "wallet-line",
  });
  const added = rows.categories.at(-1);
  assert.equal(added.name, "餐饮");
  assert.equal(added.type, "income");
  assert.equal(added.level, undefined);
  assert.equal(added.parentId, undefined);
  assert.equal(rows.ledger.syncRevision, 2);
  setStale();
  await assert.rejects(
    handler.saveCategory("owner", { ledgerId: "ledger", type: "expense", name: "旅行" }),
    /CATEGORY_CHANGED_RETRY/
  );
  assert.equal(rows.categories.length, 4);
});

test("flat category editing and deletion protect permissions and fallback", async () => {
  const { handler, rows } = categoryFixture();
  await assert.rejects(
    handler.saveCategory("member", {
      ledgerId: "ledger",
      type: "expense",
      categoryId: "food",
      name: "饮食",
    }),
    /NO_CATEGORY_PERMISSION/
  );
  await assert.rejects(
    handler.saveCategory("owner", {
      ledgerId: "ledger",
      type: "expense",
      categoryId: "other",
      name: "新名称",
    }),
    /SYSTEM_CATEGORY_PROTECTED/
  );
  await assert.rejects(
    handler.removeCategory("member", { ledgerId: "ledger", categoryId: "food" }),
    /ONLY_OWNER_CAN_DELETE_CATEGORY/
  );
  await assert.rejects(
    handler.removeCategory("owner", { ledgerId: "ledger", categoryId: "other" }),
    /SYSTEM_CATEGORY_PROTECTED/
  );
  await handler.saveCategory("owner", {
    ledgerId: "ledger",
    type: "expense",
    categoryId: "food",
    name: "饮食",
    icon: "bowl-line",
  });
  assert.equal(rows.categories[0].name, "饮食");
  assert.equal(rows.categories[0].icon, "bowl-line");
  assert.equal(rows.ledger.syncRevision, 2);
  assert.equal(rows.operations.length, 0);
});

test("categoryStore caches server role and allows category-manage to accurately identify owner in shared ledger", async () => {
  const categoryStorePath = require.resolve("../miniprogram/services/category.store");
  const apiPath = require.resolve("../miniprogram/services/api");
  const storage = {};
  const globalApp = {
    globalData: {
      environment: { key: "test" },
      openid: "owner_openid",
      currentLedger: {
        _id: "shared_ledger_1",
        type: "shared",
        ownerOpenid: "owner_openid",
        role: "owner",
      },
    },
  };
  global.getApp = () => globalApp;
  global.wx = {
    getStorageSync(key) {
      return storage[key];
    },
    setStorageSync(key, val) {
      storage[key] = val;
    },
    removeStorageSync(key) {
      delete storage[key];
    },
  };
  require.cache[apiPath] = {
    id: apiPath,
    filename: apiPath,
    loaded: true,
    exports: {
      callApi: async (route, payload) => {
        if (route === "category/list") {
          return { categories: [{ _id: "c1", name: "餐饮", type: "expense" }], role: "owner" };
        }
        return {};
      },
    },
  };
  delete require.cache[categoryStorePath];
  const categoryStore = require(categoryStorePath);
  const items = await categoryStore.getCategories("shared_ledger_1");
  assert.equal(items.length, 1);
  assert.equal(categoryStore.getCategoryRole("shared_ledger_1"), "owner");
});
