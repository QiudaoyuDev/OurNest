const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const path = require("node:path");

function load(file, app, wx = {}, mocks = {}) {
  const filename = path.resolve(file);
  const realRequire = createRequire(filename);
  let definition;
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      module,
      exports: module.exports,
      getApp: () => app,
      getCurrentPages: () => [{ route: "pages/index/index" }, {}],
      wx,
      console,
      setTimeout,
      require: (name) => (Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name)),
      Page: (value) => {
        definition = value;
      },
      Component: (value) => {
        definition = value;
      },
    },
    { filename }
  );
  return definition
    ? {
        ...definition,
        ...definition.methods,
        data: structuredClone(definition.data),
        setData(patch) {
          Object.assign(this.data, patch);
        },
      }
    : module.exports;
}

for (const [component, method] of [
  ["tl-tab-home", "goRecordDetail"],
  ["tl-tab-records", "openRecord"],
]) {
  test(`${component} uses the viewed ledger permission for record navigation`, () => {
    const destinations = [];
    const app = { globalData: { currentLedger: { _id: "owned", readonly: false } } };
    const view = load(`miniprogram/components/${component}/index.js`, app, {
      navigateTo: ({ url }) => destinations.push(url),
    });
    view.data.readonly = true;
    view[method]({ currentTarget: { dataset: { id: "record/id" } } });
    assert.equal(destinations[0], "/pages/record-detail/index?id=record%2Fid");
    view.data.readonly = false;
    view[method]({ currentTarget: { dataset: { id: "own" } } });
    assert.equal(destinations[1], "/pages/record-edit/index?id=own");
  });
}

test("the retained plus button explains readonly access and recovers after switching ledgers", () => {
  const app = { globalData: { currentLedger: { _id: "shared", role: "readonly" } } };
  const destinations = [],
    toasts = [];
  const tabbar = load(
    "miniprogram/components/tl-tabbar/index.js",
    app,
    {
      navigateTo: ({ url }) => destinations.push(url),
    },
    {
      "../../services/feedback-ui": {
        showToast: (value) => toasts.push(value),
        showReadonlyToast: () => toasts.push({ message: "当前账本为只读账本，访客仅可查看" }),
      },
    }
  );
  tabbar.handleRecord();
  assert.equal(destinations.length, 0);
  assert.match(toasts[0].message, /只读账本.*访客仅可查看/);
  app.globalData.currentLedger = { _id: "owned", readonly: false };
  tabbar.handleRecord();
  assert.equal(destinations[0], "/pages/record-category/index");
});

test("directly opening edit uses server permission and redirects visitors before showing the form", async () => {
  const destinations = [];
  let writes = 0;
  const app = { globalData: { currentLedger: { _id: "owned", readonly: false } } };
  const page = load(
    "miniprogram/pages/record-edit/index.js",
    app,
    {
      redirectTo: async ({ url }) => destinations.push(url),
    },
    {
      "../../services/record.service": {
        getRecord: async () => ({
          readonly: true,
          record: { _id: "record", ledgerId: "shared", amount: 12 },
          ledger: { _id: "shared" },
        }),
        createRecord: async () => {
          writes++;
        },
        updateRecord: async () => {
          writes++;
        },
        deleteRecord: async () => {
          writes++;
        },
      },
    }
  );
  await page.loadRecord("record");
  assert.equal(page.data.readonly, true);
  assert.equal(page.data.amount, "");
  assert.equal(destinations[0], "/pages/record-detail/index?id=record");
  await page.saveRecord();
  await page.deleteRecord();
  assert.equal(writes, 0);
  const template = fs.readFileSync("miniprogram/pages/record-edit/index.wxml", "utf8");
  assert.match(template, /<tl-page-actions wx:if="{{!readonly &&/);
  const detail = fs.readFileSync("miniprogram/pages/record-detail/index.wxml", "utf8");
  assert.doesNotMatch(detail, /bind:tap="(?:saveRecord|deleteRecord)"|tl-record-form/);
});

test("a writable record can still open in edit even when the current ledger is readonly", async () => {
  let redirects = 0;
  const page = load(
    "miniprogram/pages/record-edit/index.js",
    {
      globalData: { currentLedger: { _id: "readonly", readonly: true } },
    },
    {
      redirectTo: () => {
        redirects++;
      },
    },
    {
      "../../services/record.service": {
        getRecord: async () => ({
          readonly: false,
          record: { _id: "own", ledgerId: "owned", amount: 12 },
          ledger: { _id: "owned" },
        }),
      },
    }
  );
  await page.loadRecord("own");
  assert.equal(redirects, 0);
  assert.equal(page.data.readonly, false);
  assert.equal(page.data.amount, "12");
});

test("direct creation in a readonly viewed ledger is blocked despite an owned current ledger", () => {
  let navigations = 0;
  const toasts = [];
  const page = load(
    "miniprogram/pages/record-edit/index.js",
    {
      globalData: { currentLedger: { _id: "owned" }, ledgers: [{ _id: "shared", readonly: true }] },
    },
    {
      navigateBack: () => {
        navigations++;
      },
    },
    {
      "../../services/feedback-ui": {
        showToast: (value) => toasts.push(value),
        showReadonlyToast: () => toasts.push({ message: "当前账本为只读账本，访客仅可查看" }),
      },
    }
  );
  page.onLoad({ ledgerId: "shared" });
  assert.equal(navigations, 1);
  assert.equal(page.data.readonly, true);
  assert.match(toasts[0].message, /访客仅可查看/);
});

test("continuous recording clears only record-specific fields after cloud confirmation", async () => {
  const created = [];
  const toasts = [];
  const page = load(
    "miniprogram/pages/record-edit/index.js",
    { globalData: { currentLedger: { _id: "owned" } } },
    {},
    {
      "../../services/feedback-ui": {
        showToast: (value) => toasts.push(value),
      },
      "../../services/record.service": {
        createRecord: async (payload) => created.push(payload),
      },
    }
  );
  Object.assign(page.data, {
    ledgerId: "owned",
    type: "expense",
    categoryName: "午餐",
    categoryLabel: "餐饮",
    categoryIcon: "restaurant-line",
    parentCategory: "餐饮",
    parentIcon: "restaurant-line",
    amount: "36",
    note: "工作日午餐",
    tagInput: "外卖",
    tags: ["午餐"],
    date: "2026-03-13",
    accounts: ["现金", "银行卡"],
    accountIndex: 1,
  });

  await page.saveAndContinue();

  assert.equal(created.length, 1);
  assert.equal(created[0].account, "银行卡");
  assert.equal(page.data.amount, "");
  assert.equal(page.data.note, "");
  assert.equal(page.data.tagInput, "");
  assert.equal(page.data.tags.length, 0);
  assert.equal(page.data.type, "expense");
  assert.equal(page.data.categoryName, "午餐");
  assert.equal(page.data.date, "2026-03-13");
  assert.equal(page.data.accountIndex, 1);
  assert.equal(page.data.saving, false);
  assert.equal(toasts[0].message, "已记账，可继续记录");
});

test("failed continuous recording retains all user input and unlocks submission", async () => {
  const toasts = [];
  const page = load(
    "miniprogram/pages/record-edit/index.js",
    { globalData: { currentLedger: { _id: "owned" } } },
    {},
    {
      "../../services/feedback-ui": {
        showToast: (value) => toasts.push(value),
      },
      "../../services/record.service": {
        createRecord: async () => {
          throw new Error("network unavailable");
        },
      },
    }
  );
  Object.assign(page.data, {
    ledgerId: "owned",
    amount: "36",
    note: "工作日午餐",
    tagInput: "外卖",
    tags: ["午餐"],
    accounts: ["现金"],
  });

  await page.saveAndContinue();

  assert.equal(page.data.amount, "36");
  assert.equal(page.data.note, "工作日午餐");
  assert.equal(page.data.tagInput, "外卖");
  assert.deepEqual(page.data.tags, ["午餐"]);
  assert.equal(page.data.saving, false);
  assert.equal(toasts[0].message, "保存失败，输入已保留，请重试");
});

test("record editor exposes separate new-record actions and keeps edit save singular", () => {
  const template = fs.readFileSync("miniprogram/pages/record-edit/index.wxml", "utf8");
  assert.match(template, /bind:tap="saveAndLeave">保存并离开/);
  assert.match(template, /bind:tap="saveAndContinue">保存后再记一笔/);
  assert.match(template, /wx:if="{{isEditing}}"[\s\S]*保存记录/);
});

test("cloud handlers reject visitor create/update/delete before any database write", async () => {
  let writes = 0;
  const db = {
    command: { aggregate: {} },
    collection: () => {
      writes++;
      throw new Error("unexpected write");
    },
  };
  const sdk = { init() {}, database: () => db };
  const helpers = load(
    "cloudfunctions/tomatoLedger/shared/helpers.js",
    {},
    {},
    { "wx-server-sdk": sdk }
  );
  const handler = load(
    "cloudfunctions/tomatoLedger/handlers/record.handler.js",
    {},
    {},
    {
      "wx-server-sdk": sdk,
      "../shared/helpers": {
        ...helpers,
        getLedgerForUser: async () => ({
          _id: "shared",
          ownerOpenid: "owner",
          viewerOpenids: ["visitor"],
        }),
        getRecordById: async () => ({ _id: "record", ledgerId: "shared", ownerOpenid: "owner" }),
      },
    }
  );
  const payload = {
    ledgerId: "shared",
    recordId: "record",
    amount: 12,
    date: "2026-10-01",
    type: "expense",
  };
  for (const operation of ["createRecord", "updateRecord", "deleteRecord"]) {
    await assert.rejects(handler[operation]("visitor", payload), /READONLY_LEDGER/);
  }
  assert.equal(writes, 0);
});
