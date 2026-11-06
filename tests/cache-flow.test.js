const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function load(file, mocks = {}, app = { globalData: {} }, wx = {}) {
  const filename = path.resolve(file);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  let definition;
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      module,
      exports: module.exports,
      require: (name) => (Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name)),
      getApp: () => app,
      wx,
      console: { warn() {}, error() {} },
      App: (value) => {
        definition = value;
      },
      Page: (value) => {
        definition = value;
      },
      Component: (value) => {
        definition = value;
      },
      setTimeout,
      clearTimeout,
    },
    { filename }
  );
  return definition || module.exports;
}
function instance(definition) {
  return {
    ...definition,
    ...definition.methods,
    data: structuredClone(definition.data),
    isAttached: true,
    recordsRequestId: 0,
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
}
function storageApi() {
  const storage = {};
  return {
    storage,
    wx: {
      getStorageSync: (key) => storage[key],
      setStorageSync: (key, value) => {
        storage[key] = structuredClone(value);
      },
      removeStorageSync: (key) => {
        delete storage[key];
      },
    },
  };
}

function recordsComponent(service) {
  return instance(
    load("miniprogram/components/tl-tab-records/index.js", {
      "../../services/record.service": service,
      "../../utils/avatar": { resolveAvatarUrls: async (rows) => rows },
    })
  );
}

test("partial record pages preserve server totals, cursor and records beyond 50", async () => {
  const calls = [];
  const component = recordsComponent({
    listRecords: async (payload) => {
      calls.push(payload);
      const start = payload.cursor ? 30 : 0;
      return {
        records: Array.from({ length: 30 }, (_, i) => ({
          _id: String(start + i),
          type: "expense",
          amount: 1,
          date: "2026-10-24",
        })),
        rangeSummary: { income: 2000, expense: 1234.56 },
        rangeRecordCount: 71,
        historyRecordCount: 240,
        hasMore: true,
        nextCursor: { date: "2026-10-24", id: String(start + 29) },
      };
    },
  });
  component.data.ledgerId = "shared";
  component.data.currentRange = { start: "2026-10-01", end: "2026-11-01" };
  await component.loadRecords();
  assert.equal(component.data.monthExpense, "1234.56");
  assert.equal(component.data.monthRecordCount, 71);
  assert.equal(component.data.hasMore, true);
  await component.loadRecords(component.data.currentRange, true);
  assert.equal(component.data.records.length, 60);
  assert.equal(component.data.monthExpense, "1234.56");
  assert.equal(calls[1].cursor.id, "29");
  await component.refreshRecords();
  assert.equal(calls.length, 3);
  assert.equal(component.data.ledgerId, "shared");
  assert.equal(component.data.monthRecordCount, 71);
});

test("record type filter queries the server and ignores stale pages", async () => {
  const calls = [];
  const pending = [deferred(), deferred()];
  const component = recordsComponent({
    listRecords: (payload) => {
      calls.push(payload);
      return pending[calls.length - 1].promise;
    },
  });
  component.data.ledgerId = "ledger";
  component.data.currentRange = { start: "2026-10-01", end: "2026-11-01" };
  const oldRequest = component.loadRecords();
  const filtered = component.switchType({ currentTarget: { dataset: { type: "income" } } });
  assert.equal(calls[0].type, "all");
  assert.equal(calls[1].type, "income");
  assert.equal(calls[1].cursor, null);
  pending[1].resolve({
    records: [{ _id: "income", type: "income", amount: 5, date: "2026-10-01" }],
  });
  await filtered;
  pending[0].resolve({
    records: [{ _id: "expense", type: "expense", amount: 2, date: "2026-10-01" }],
  });
  await oldRequest;
  assert.equal(component.data.records[0].id, "income");
});

test("an old record month response cannot overwrite a newly selected month", async () => {
  const pending = [deferred(), deferred()];
  let i = 0;
  const component = recordsComponent({ listRecords: () => pending[i++].promise });
  component.data.ledgerId = "ledger";
  const first = component.loadRecords({ start: "2026-10-01", end: "2026-11-01" });
  const second = component.loadRecords({ start: "2026-11-01", end: "2026-12-01" });
  pending[1].resolve({ records: [], rangeSummary: { expense: 20 }, rangeRecordCount: 2 });
  await second;
  pending[0].resolve({ records: [], rangeSummary: { expense: 10 }, rangeRecordCount: 1 });
  await first;
  assert.equal(component.data.monthExpense, "20");
  assert.equal(component.data.monthRecordCount, 2);
});

test("analysis and record list requery cloud without persisting results", async () => {
  let requests = 0;
  const api = { callApi: async () => ({ value: ++requests }) };
  const ledger = load("miniprogram/services/ledger.service.js", { "./api": api });
  assert.equal((await ledger.getAnalysis({ ledgerId: "a", anchor: "2026-10" })).value, 1);
  assert.equal((await ledger.getAnalysis({ ledgerId: "a", anchor: "2026-10" })).value, 2);
  const records = load("miniprogram/services/record.service.js", { "./api": api });
  assert.equal((await records.listRecords({ ledgerId: "a" })).value, 3);
});

test("saving waits for cloud; a failed save preserves input and supports retry", async () => {
  let request = deferred();
  let navigations = 0;
  const toasts = [];
  const page = instance(
    load(
      "miniprogram/pages/record-edit/index.js",
      {
        "../../services/record.service": { createRecord: () => request.promise },
        "../../services/feedback-ui": { showToast: (value) => toasts.push(value) },
      },
      { globalData: {} },
      {
        navigateBack: () => {
          navigations++;
        },
      }
    )
  );
  Object.assign(page.data, {
    ledgerId: "a",
    amount: "39",
    note: "午饭",
    categoryId: "lunch",
    categoryLoading: false,
  });
  const failed = page.saveRecord();
  assert.equal(navigations, 0);
  assert.equal(toasts.length, 0);
  request.reject(new Error("offline"));
  await failed;
  assert.equal(page.data.note, "午饭");
  assert.equal(page.data.amount, "39");
  assert.equal(page.data.saving, false);
  assert.equal(navigations, 0);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].type, "error");
  assert.match(toasts[0].message, /输入已保留/);
  request = deferred();
  const retry = page.saveRecord();
  assert.equal(page.data.saving, true);
  assert.equal(navigations, 0);
  request.resolve({ recordId: "real" });
  await retry;
  assert.equal(navigations, 1);
  assert.equal(toasts.length, 1);
});

test("deletion waits for cloud and remains on page when rejected", async () => {
  const request = deferred();
  let navigations = 0;
  const page = instance(
    load(
      "miniprogram/pages/record-edit/index.js",
      {
        "../../services/record.service": { deleteRecord: () => request.promise },
        "../../services/feedback-ui": { showToast() {} },
      },
      { globalData: {} },
      {
        showModal: (options) => options.success({ confirm: true }),
        navigateBack: () => {
          navigations++;
        },
      }
    )
  );
  Object.assign(page.data, { isEditing: true, recordId: "record", ledgerId: "a" });
  const deletion = page.deleteRecord();
  await Promise.resolve();
  assert.equal(navigations, 0);
  request.reject(new Error("offline"));
  await deletion;
  assert.equal(navigations, 0);
  assert.equal(page.data.deleting, false);
});

test("category memory is scoped and a previous login request cannot repopulate storage", async () => {
  const { storage, wx } = storageApi();
  const app = { globalData: { openid: "first", environment: { key: "test" } } };
  let request = deferred();
  const categories = load(
    "miniprogram/services/category.store.js",
    {
      "./api": { callApi: () => request.promise },
    },
    app,
    wx
  );
  const initial = categories.refreshCategories("shared");
  request.resolve({ categories: [{ _id: "old" }] });
  await initial;
  assert.equal(categories.getCategoriesSync("shared")[0]._id, "old");
  request = deferred();
  const stale = categories.refreshCategories("shared");
  categories.clearAll();
  app.globalData.openid = "second";
  assert.equal(categories.getCategoriesSync("shared").length, 0);
  request.resolve({ categories: [{ _id: "old-response" }] });
  await assert.rejects(stale, /状态已变化/);
  assert.equal(storage.ourNestCategoryCache, undefined);
});

test("category invalidation and deletion do not retain stale memory", async () => {
  const { wx } = storageApi();
  const app = { globalData: { openid: "user", environment: { key: "test" } } };
  let count = 0;
  const categories = load(
    "miniprogram/services/category.store.js",
    {
      "./api": { callApi: async () => ({ categories: [{ _id: String(++count) }] }) },
    },
    app,
    wx
  );
  await categories.getCategories("shared");
  assert.equal(categories.getCategoriesSync("shared")[0]._id, "1");
  categories.invalidate("shared");
  await categories.refreshCategories("shared", { force: true });
  assert.equal(categories.getCategoriesSync("shared")[0]._id, "2");
  categories.removeLedger("shared");
  assert.equal(categories.getCategoriesSync("shared").length, 0);
});

function syncService(refreshCategories) {
  const app = {
    authGeneration: 0,
    globalData: {
      openid: "user",
      loggedIn: true,
      environment: { key: "test" },
      currentLedger: { _id: "shared" },
      dataSyncedAt: 0,
    },
    loginWithWechat: async () => {},
  };
  const calls = [];
  const service = load(
    "miniprogram/services/data-sync.service.js",
    {
      "./ledger.store": {
        syncLedgers: async (options) => {
          calls.push(options);
          return { changed: false };
        },
      },
      "./category.store": { invalidateAll: () => calls.push("invalidate"), refreshCategories },
    },
    app
  );
  return { app, service, calls };
}

test("manual sync with unchanged revisions still awaits categories and shares in-flight work", async () => {
  const request = deferred();
  let count = 0;
  const { app, service, calls } = syncService(() => {
    count++;
    return request.promise;
  });
  const first = service.syncData();
  const second = service.syncData();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(count, 1);
  assert.equal(app.globalData.dataSyncedAt, 0);
  assert.equal(calls[0].force, true);
  request.resolve([]);
  await Promise.all([first, second]);
  assert.ok(app.globalData.dataSyncedAt > 0);
});

test("manual sync failure or logout cannot report a successful timestamp", async () => {
  const failure = syncService(async () => {
    throw new Error("offline");
  });
  await assert.rejects(failure.service.syncData(), /offline/);
  assert.equal(failure.app.globalData.dataSyncedAt, 0);
  const request = deferred();
  const logout = syncService(() => request.promise);
  const pending = logout.service.syncData();
  await new Promise((resolve) => setImmediate(resolve));
  logout.app.authGeneration++;
  logout.app.globalData.openid = "";
  request.resolve([]);
  await assert.rejects(pending, /登录状态已变化/);
  assert.equal(logout.app.globalData.dataSyncedAt, 0);
});

test("logout invalidates a pending login and persisted auth excludes ledger/stat copies", async () => {
  const { wx, storage } = storageApi();
  const request = deferred();
  const app = load(
    "miniprogram/app.js",
    {
      "./services/profile.service": { login: () => request.promise },
      "./services/ledger.store": { clearLedgers() {} },
      "./services/category.store": { clearAll() {} },
    },
    undefined,
    wx
  );
  app.globalData = {
    openid: "user",
    user: { currentLedgerId: "a" },
    currentLedger: { _id: "a" },
    stats: { recordCount: 71 },
    environment: { key: "test" },
  };
  app.persistAuthState();
  assert.equal(storage.ourNestAuth.currentLedger, undefined);
  assert.equal(storage.ourNestAuth.stats, undefined);
  const login = app.loginWithWechat();
  app.logout();
  request.resolve({ openid: "user", user: {} });
  await assert.rejects(login, /登录状态已变化/);
  assert.equal(app.globalData.loggedIn, false);
  assert.equal(storage.ourNestAuth, undefined);
});

test("shared ledger revisions invalidate categories and removed ledgers clear categories", async () => {
  const { wx } = storageApi();
  const app = { globalData: { openid: "user", environment: { key: "test" } } };
  const invalidated = [],
    removed = [];
  const store = load(
    "miniprogram/services/ledger.store.js",
    {
      "./ledger.service": {
        syncLedgers: async () => ({
          changed: true,
          changedLedgerIds: ["shared"],
          removedLedgerIds: ["removed"],
          ledgers: [{ _id: "shared", ownerOpenid: "user", syncRevision: 2 }],
          currentLedgerId: "shared",
        }),
      },
      "./category.store": {
        invalidate: (id) => invalidated.push(id),
        removeLedger: (id) => removed.push(id),
      },
    },
    app,
    wx
  );
  await store.syncLedgers({ force: true });
  assert.deepEqual(invalidated, ["shared"]);
  assert.deepEqual(removed, ["removed"]);
  assert.equal(app.globalData.currentLedger._id, "shared");
});

test("logout rejects pending ledger reads without restoring their cache", async () => {
  const { wx, storage } = storageApi();
  const app = { globalData: { openid: "user", environment: { key: "test" } } };
  const request = deferred();
  const store = load(
    "miniprogram/services/ledger.store.js",
    {
      "./ledger.service": { listLedgers: () => request.promise },
      "./category.store": {},
    },
    app,
    wx
  );
  const pending = store.refreshLedgers();
  store.clearLedgers();
  request.resolve({ ledgers: [{ _id: "old" }] });
  await assert.rejects(pending, /登录状态已变化/);
  assert.equal(storage.ourNestLedgerCache, undefined);
});

test("cancelling the import file picker restores the page without uploading or an error", async () => {
  const toasts = [];
  let tickets = 0;
  const page = instance(
    load(
      "miniprogram/pages/record-import/index.js",
      {
        "../../services/record.service": {
          createImportUpload: async () => {
            tickets += 1;
          },
        },
        "../../services/payment-account.service": { getPaymentAccounts: () => [] },
        "../../services/feedback-ui": { showToast: (toast) => toasts.push(toast) },
      },
      { globalData: { openid: "user" } },
      {
        chooseMessageFile: async () => {
          throw { errMsg: "chooseMessageFile:fail cancel" };
        },
      }
    )
  );
  page.data.ledgerId = "ledger";
  await page.chooseAndImport();
  assert.equal(page.data.uploading, false);
  assert.equal(tickets, 0);
  assert.equal(toasts.length, 0);
});

test("import page previews before writing and submits only selected rows", async () => {
  let imports = 0;
  let sent;
  let uploadPath;
  const service = {
    createImportUpload: async () => ({ ticketId: "ticket", cloudPath: "imports/user/random.xls" }),
    previewImport: async () => ({
      fileHash: "hash",
      batchId: "batch",
      errors: [],
      rows: [
        { rowNumber: 2, date: "2026-01-01", type: "expense", amount: 1 },
        { rowNumber: 3, date: "2026-01-02", type: "income", amount: 2 },
      ],
    }),
    importRecords: async (payload) => {
      imports += 1;
      sent = payload;
      return { imported: 1 };
    },
  };
  const page = instance(
    load(
      "miniprogram/pages/record-import/index.js",
      {
        "../../services/record.service": service,
        "../../services/payment-account.service": { getPaymentAccounts: () => ["微信"] },
        "../../services/feedback-ui": { showToast() {} },
      },
      { globalData: { openid: "user" } },
      {
        chooseMessageFile: async () => ({
          tempFiles: [{ path: "local", name: "../私人账单.xls", size: 100 }],
        }),
        cloud: {
          uploadFile: async ({ cloudPath }) => {
            uploadPath = cloudPath;
            return { fileID: "cloud://env/imports/user/bill.xls" };
          },
        },
        setStorageSync() {},
        removeStorageSync() {},
      }
    )
  );
  page.data.ledgerId = "ledger";
  await page.chooseAndImport();
  assert.equal(uploadPath, "imports/user/random.xls");
  assert.equal(imports, 0);
  assert.equal(page.data.previewVisible, true);
  page.togglePreviewRow({ currentTarget: { dataset: { row: 3 } } });
  await page.confirmImport();
  assert.equal(imports, 1);
  assert.deepEqual(Array.from(sent.selectedRows), [2]);
  assert.equal(sent.batchId, "batch");
  assert.equal(page.data.resultVisible, true);
});

test("failed preview releases its server-issued upload when no batch was created", async () => {
  let abandoned;
  const definition = load(
    "miniprogram/pages/record-import/index.js",
    {
      "../../services/record.service": {
        createImportUpload: async () => ({
          ticketId: "ticket",
          cloudPath: "imports/user/random.csv",
        }),
        previewImport: async () => {
          throw new Error("bad file");
        },
        abandonImportUpload: async (payload) => {
          abandoned = payload;
          return { cleanupStatus: "done" };
        },
      },
      "../../services/payment-account.service": { getPaymentAccounts: () => ["微信"] },
      "../../services/feedback-ui": { showToast() {} },
    },
    { globalData: { openid: "user" } },
    {
      chooseMessageFile: async () => ({
        tempFiles: [{ path: "local", name: "bill.csv", size: 1 }],
      }),
      cloud: { uploadFile: async () => ({ fileID: "cloud://env/imports/user/random.csv" }) },
    }
  );
  const page = instance(definition);
  page.data.ledgerId = "ledger";
  await page.chooseAndImport();
  assert.equal(abandoned.ticketId, "ticket");
  assert.equal(abandoned.fileId, "cloud://env/imports/user/random.csv");
  assert.equal(page.data.uploading, false);
});

test("preview cleanup cancels its batch if category loading fails after preview", async () => {
  let cancelled;
  let abandoned = false;
  const definition = load(
    "miniprogram/pages/record-import/index.js",
    {
      "../../services/record.service": {
        createImportUpload: async () => ({
          ticketId: "ticket",
          cloudPath: "imports/user/random.csv",
        }),
        previewImport: async () => ({ batchId: "batch", rows: [{ categoryChoiceRequired: true }] }),
        cancelImportPreview: async (payload) => {
          cancelled = payload;
          return { cleanupStatus: "done" };
        },
        abandonImportUpload: async () => {
          abandoned = true;
        },
      },
      "../../services/category.service": {
        listCategories: async () => {
          throw new Error("network");
        },
      },
      "../../services/payment-account.service": { getPaymentAccounts: () => ["微信"] },
      "../../services/feedback-ui": { showToast() {} },
    },
    { globalData: { openid: "user" } },
    {
      chooseMessageFile: async () => ({
        tempFiles: [{ path: "local", name: "bill.csv", size: 1 }],
      }),
      cloud: { uploadFile: async () => ({ fileID: "cloud://env/imports/user/random.csv" }) },
    }
  );
  const page = instance(definition);
  page.data.ledgerId = "ledger";
  await page.chooseAndImport();
  assert.equal(cancelled.batchId, "batch");
  assert.equal(abandoned, false);
  assert.equal(page.data.previewVisible, false);
});

test("import resumes the same saved batch after a network failure", async () => {
  const storage = {};
  let attempts = 0;
  const payloads = [];
  const service = {
    createImportUpload: async () => ({ ticketId: "ticket", cloudPath: "imports/user/random.xls" }),
    previewImport: async () => ({
      batchId: "batch",
      fileHash: "hash",
      rows: [{ rowNumber: 2 }],
      errors: [],
    }),
    importRecords: async (payload) => {
      payloads.push(payload);
      attempts += 1;
      if (attempts === 1) throw new Error("network");
      return { imported: 1, hasMore: false };
    },
  };
  const wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => {
      storage[key] = value;
    },
    removeStorageSync: (key) => {
      delete storage[key];
    },
    chooseMessageFile: async () => ({ tempFiles: [{ path: "local", name: "bill.xls", size: 1 }] }),
    cloud: { uploadFile: async () => ({ fileID: "cloud://env/imports/user/bill.xls" }) },
  };
  const app = {
    globalData: {
      openid: "user",
      loggedIn: true,
      environment: { id: "test" },
      currentLedger: { _id: "ledger" },
    },
  };
  const definition = load(
    "miniprogram/pages/record-import/index.js",
    {
      "../../services/record.service": service,
      "../../services/payment-account.service": { getPaymentAccounts: () => ["微信"] },
      "../../services/feedback-ui": { showToast() {} },
    },
    app,
    wx
  );
  const first = instance(definition);
  first.onLoad();
  await first.chooseAndImport();
  await first.confirmImport();
  assert.equal(first.data.pendingImport.batchId, "batch");
  const reopened = instance(definition);
  reopened.onLoad();
  await reopened.resumeImport();
  assert.equal(reopened.data.resultVisible, true);
  assert.equal(reopened.data.pendingImport, null);
  assert.equal(payloads[1].batchId, "batch");
  assert.deepEqual(Array.from(payloads[1].selectedRows), [2]);
  assert.equal(Object.keys(storage).length, 0);
});

test("category recovery persists its new choices before resuming an import", async () => {
  const storage = {};
  const payloads = [];
  const definition = load(
    "miniprogram/pages/record-import/index.js",
    {
      "../../services/record.service": {
        importRecords: async (payload) => {
          payloads.push(structuredClone(payload));
          if (payload.recoverCategories)
            return { recovered: true, categoryChoices: { 2: "" }, hasMore: true };
          assert.equal(storage.key.categoryChoices[2], "");
          return { imported: 1, hasMore: false };
        },
      },
      "../../services/payment-account.service": { getPaymentAccounts: () => ["微信"] },
      "../../services/feedback-ui": { showToast() {} },
    },
    { globalData: {} },
    {
      setStorageSync: (key, value) => {
        storage[key] = structuredClone(value);
      },
      removeStorageSync: (key) => {
        delete storage[key];
      },
    }
  );
  const page = instance(definition);
  page.importStorageKey = "key";
  page.data.pendingImport = {
    batchId: "batch",
    selectedRows: [2],
    categoryChoices: { 2: "deleted" },
  };
  await page.recoverImportCategories();
  assert.equal(payloads[0].recoverCategories, true);
  assert.equal(payloads[1].recoverCategories, undefined);
  assert.equal(payloads[1].categoryChoices[2], "");
  assert.equal(page.data.resultVisible, true);
  assert.equal(storage.key, undefined);
});

test("category service continues a bounded deletion until the server confirms completion", async () => {
  let calls = 0;
  const service = load("miniprogram/services/category.service.js", {
    "./api": {
      callApi: async (route, payload) => {
        assert.equal(route, "category/delete");
        assert.equal(payload.categoryId, "child");
        calls += 1;
        return { hasMore: calls < 3 };
      },
    },
    "./ledger.store": { syncLedgers: async () => {}, markSyncRequired() {} },
    "./category.store": { invalidate() {}, refreshCategories: async () => [] },
    "../utils/event-bus": { emit() {} },
  });
  const result = await service.removeCategory("child", "ledger");
  assert.equal(result.hasMore, false);
  assert.equal(calls, 3);
});

test("import cleanup retry preserves files queued while a retry is in flight", async () => {
  const storage = {};
  const request = deferred();
  const definition = load(
    "miniprogram/pages/record-import/index.js",
    {
      "../../services/record.service": { retryImportFileCleanup: () => request.promise },
      "../../services/payment-account.service": { getPaymentAccounts: () => ["微信"] },
      "../../services/feedback-ui": { showToast() {} },
    },
    { globalData: {} },
    {
      setStorageSync: (key, value) => {
        storage[key] = structuredClone(value);
      },
    }
  );
  const page = instance(definition);
  page.cleanupStorageKey = "cleanup";
  page.data.pendingCleanup = ["first"];
  const pending = page.retryPendingCleanup();
  assert.equal(page.rememberPendingCleanup("second"), true);
  request.resolve({ cleanupStatus: "done" });
  await pending;
  assert.deepEqual(Array.from(page.data.pendingCleanup), ["second"]);
  assert.deepEqual(Array.from(storage.cleanup), ["second"]);
});

test("cleanup of abandoned previews preserves the locally pending batch", async () => {
  let modal;
  const cancelled = [];
  let previews = [{ batchId: "pending" }, { batchId: "abandoned" }];
  const definition = load(
    "miniprogram/pages/record-import/index.js",
    {
      "../../services/record.service": {
        listImportPreviews: async () => ({ previews }),
        cancelImportPreview: async ({ batchId }) => {
          cancelled.push(batchId);
          previews = previews.filter((item) => item.batchId !== batchId);
          return { cleanupStatus: "pending" };
        },
      },
      "../../services/payment-account.service": { getPaymentAccounts: () => ["微信"] },
      "../../services/feedback-ui": { showToast() {} },
    },
    { globalData: {} },
    {
      showModal: (options) => {
        modal = options;
      },
      setStorageSync() {},
    }
  );
  const page = instance(definition);
  page.data.ledgerId = "ledger";
  page.data.pendingImport = { batchId: "pending" };
  page.cleanupStorageKey = "cleanup";
  await page.refreshAbandonedPreviews();
  assert.deepEqual(Array.from(page.data.abandonedPreviewIds), ["abandoned"]);
  page.cleanAbandonedPreviews();
  await modal.success({ confirm: true });
  assert.deepEqual(cancelled, ["abandoned"]);
  assert.deepEqual(Array.from(page.data.pendingCleanup), ["abandoned"]);
  assert.equal(page.data.pendingImport.batchId, "pending");
});

test("category detail sends exact range and identity for every page", async () => {
  const calls = [];
  const definition = load("miniprogram/pages/record-filtered/index.js", {
    "../../services/record.service": {
      listRecords: async (payload) => {
        calls.push(payload);
        return {
          records: [{ _id: String(calls.length), amount: 5, date: "2026-02-01" }],
          rangeSummary: { expense: 10 },
          rangeRecordCount: 2,
          hasMore: calls.length === 1,
          nextCursor: { date: "2026-02-01", id: "1" },
          readonly: true,
        };
      },
    },
  });
  const page = instance(definition);
  page.onLoad({
    ledgerId: "shared",
    start: "2026-02-01",
    end: "2026-03-01",
    type: "expense",
    filter: encodeURIComponent(JSON.stringify({ kind: "id", id: "food" })),
    name: "餐饮",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await page.loadMore();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].categoryFilter.id, "food");
  assert.equal(calls[1].ledgerId, "shared");
  assert.equal(calls[1].cursor.id, "1");
  assert.equal(page.data.records.length, 2);
  assert.equal(page.data.expenseText, "10");
  assert.equal(page.data.readonly, true);
});

test("record-filtered automatically reloads when records change in the viewed ledger", async () => {
  const calls = [];
  const eventBus = require("../miniprogram/utils/event-bus");
  const definition = load("miniprogram/pages/record-filtered/index.js", {
    "../../services/record.service": {
      listRecords: async (payload) => {
        calls.push(payload);
        return {
          records: [{ _id: "1", amount: 15, date: "2026-03-01" }],
          rangeSummary: { expense: 15 },
          rangeRecordCount: 1,
          hasMore: false,
          nextCursor: null,
          readonly: false,
        };
      },
    },
    "../../utils/event-bus": eventBus,
  });
  const page = instance(definition);
  page.onLoad({
    ledgerId: "shared",
    start: "2026-03-01",
    end: "2026-04-01",
    type: "expense",
    filter: encodeURIComponent(JSON.stringify({ kind: "id", id: "food" })),
    name: "餐饮",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 1);

  eventBus.emit("records:changed", { ledgerId: "other" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 1);

  eventBus.emit("records:changed", { ledgerId: "shared" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 2);

  page.onUnload();
  eventBus.emit("records:changed", { ledgerId: "shared" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 2);
});

test("source import requires an explicit category choice before submitting", async () => {
  let submitted;
  const notices = [];
  const service = {
    createImportUpload: async () => ({ ticketId: "ticket", cloudPath: "imports/user/random.csv" }),
    previewImport: async () => ({
      batchId: "batch",
      fileHash: "hash",
      rows: [{ rowNumber: 2, type: "expense", categoryChoiceRequired: true }],
      errors: [],
    }),
    importRecords: async (payload) => {
      submitted = payload;
      return { imported: 1, hasMore: false };
    },
  };
  const definition = load(
    "miniprogram/pages/record-import/index.js",
    {
      "../../services/record.service": service,
      "../../services/category.service": {
        listCategories: async () => [
          { _id: "p", type: "expense", level: "parent", name: "餐饮" },
          { _id: "c", type: "expense", level: "child", parentId: "p", name: "午餐" },
        ],
      },
      "../../services/payment-account.service": { getPaymentAccounts: () => ["微信"] },
      "../../services/feedback-ui": { showToast: (item) => notices.push(item) },
    },
    { globalData: { openid: "user" } },
    {
      chooseMessageFile: async () => ({ tempFiles: [{ path: "local", name: "bill.csv" }] }),
      cloud: { uploadFile: async () => ({ fileID: "cloud://env/imports/user/bill.csv" }) },
      setStorageSync() {},
      removeStorageSync() {},
    }
  );
  const page = instance(definition);
  page.data.ledgerId = "ledger";
  await page.chooseAndImport();
  await page.confirmImport();
  assert.equal(submitted, undefined);
  assert.match(notices.at(-1).message, /分类/);
  page.choosePreviewCategory({ currentTarget: { dataset: { row: 2 } }, detail: { value: "1" } });
  await page.confirmImport();
  assert.equal(submitted.categoryChoices[2], "c");
});
