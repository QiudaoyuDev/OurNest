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
  assert.equal(destinations[0], "/pages/record-edit/index");
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
  assert.match(template, /<tl-page-actions wx:if="{{isEditing && !readonly &&/);
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

test("a member cannot open another member's record in edit and is redirected to detail", async () => {
  const destinations = [];
  const page = load(
    "miniprogram/pages/record-edit/index.js",
    {
      globalData: { currentLedger: { _id: "shared", role: "member" }, openid: "memberA" },
    },
    {
      redirectTo: ({ url }) => destinations.push(url),
    },
    {
      "../../services/record.service": {
        getRecord: async () => ({
          canEdit: false,
          readonly: true,
          role: "member",
          record: { _id: "otherRecord", ledgerId: "shared", ownerOpenid: "memberB", amount: 88 },
          ledger: { _id: "shared", type: "shared" },
        }),
      },
    }
  );
  await page.loadRecord("otherRecord");
  assert.equal(destinations[0], "/pages/record-detail/index?id=otherRecord");
  assert.equal(page.data.readonly, true);
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
    categoryId: "lunch",
    categoryLoading: false,
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
  assert.equal(page.data.categoryId, "lunch");
  assert.equal(toasts.length, 0);
});

test("continuous recording submits once and waits for cloud confirmation before resetting", async () => {
  let resolveCreate;
  let calls = 0;
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
        createRecord: () => {
          calls++;
          return new Promise((resolve) => {
            resolveCreate = resolve;
          });
        },
      },
    }
  );
  Object.assign(page.data, {
    ledgerId: "owned",
    amount: "36",
    accounts: ["现金"],
    categoryId: "lunch",
    categoryLoading: false,
  });

  const first = page.saveAndContinue();
  const duplicate = page.saveAndContinue();
  assert.equal(calls, 1);
  assert.equal(page.data.amount, "36");
  assert.equal(page.data.saving, true);
  assert.equal(toasts.length, 0);

  resolveCreate();
  await Promise.all([first, duplicate]);
  assert.equal(page.data.amount, "");
  assert.equal(page.data.saving, false);
  assert.equal(page.data.categoryId, "lunch");
  assert.equal(toasts.length, 0);
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
    categoryId: "lunch",
    categoryLoading: false,
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

test("quick entry submits from the keypad while editing keeps its save action", () => {
  const template = fs.readFileSync("miniprogram/pages/record-edit/index.wxml", "utf8");
  assert.match(template, /quick-entry="{{!isEditing}}"/);
  assert.match(template, /saving="{{saving}}" bind:submit="saveAndLeave"/);
  assert.match(template, /bind:submitcontinue="saveAndContinue"/);
  assert.match(template, /wx:if="{{isEditing}}"[\s\S]*保存记录/);
  assert.doesNotMatch(template, />保存并离开</);
  const formTemplate = fs.readFileSync("miniprogram/components/tl-record-form/index.wxml", "utf8");
  assert.match(formTemplate, /bindtap="submitContinue">再记一笔</);
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
    "cloudfunctions/ourNest/shared/helpers.js",
    {},
    {},
    { "wx-server-sdk": sdk }
  );
  const handler = load(
    "cloudfunctions/ourNest/handlers/record.handler.js",
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

function importFixture(html) {
  const state = {
    operations: {},
    records: [],
    categories: {},
    deletedFiles: [],
    fileAliases: {},
    ledger: { _id: "ledger", ownerOpenid: "owner" },
  };
  let queue = Promise.resolve();
  const db = {
    collection(name) {
      return {
        where: (query) => {
          let offset = 0;
          let limit = 100;
          const chain = {
            orderBy: () => chain,
            skip: (value) => {
              offset = value;
              return chain;
            },
            limit: (value) => {
              limit = value;
              return chain;
            },
            get: async () => ({
              data:
                name === "ledgerOperations"
                  ? Object.entries(state.operations)
                      .map(([id, item]) => ({ _id: id, ...item }))
                      .filter((item) =>
                        Object.entries(query).every(([key, value]) =>
                          value && value.op === "size"
                            ? Array.isArray(item[key]) && item[key].length === value.value
                            : item[key] === value
                        )
                      )
                      .slice(offset, offset + limit)
                  : state.records
                      .filter(
                        (row) =>
                          row.ledgerId === query.ledgerId &&
                          row.date >= query.date.start &&
                          row.date < query.date.end
                      )
                      .slice(offset, offset + limit),
            }),
          };
          return chain;
        },
        add: async ({ data }) => {
          if (name === "ledgerOperations") {
            const id = `batch-${Object.keys(state.operations).length}`;
            state.operations[id] = structuredClone(data);
            return { _id: id };
          }
          state.records.push(data);
          return { _id: String(state.records.length) };
        },
        doc(id) {
          return {
            get: async () => ({
              data:
                name === "ledgers"
                  ? state.ledger
                  : name === "categories"
                    ? state.categories[id]
                    : state.operations[id],
            }),
            set: async ({ data }) => {
              state.operations[id] = structuredClone(data);
            },
            update: async ({ data }) => {
              if (
                name === "ledgerOperations" &&
                data.status === "deleted" &&
                state.failMarkerUpdate
              ) {
                state.failMarkerUpdate = false;
                throw new Error("marker update unavailable");
              }
              if (name === "ledgerOperations") Object.assign(state.operations[id], data);
              else state.ledger.syncRevision = (state.ledger.syncRevision || 0) + 1;
            },
          };
        },
      };
    },
    runTransaction(fn) {
      const next = queue.then(() => {
        if (state.beforeTransaction) state.beforeTransaction();
        return fn(db);
      });
      queue = next.catch(() => {});
      return next;
    },
  };
  const handler = load(
    "cloudfunctions/ourNest/handlers/record.handler.js",
    {},
    {},
    {
      "wx-server-sdk": {
        downloadFile: async () => {
          if (state.fileUnavailable) throw new Error("file unavailable");
          return { fileContent: Buffer.from(html) };
        },
        deleteFile: async ({ fileList }) => {
          if (state.failDeletion) throw new Error("storage unavailable");
          return {
            fileList: fileList.map((fileID) => {
              const alias = state.fileAliases[fileID] || fileID;
              if (state.deletedFiles.includes(alias)) return { fileID, status: -503003 };
              state.deletedFiles.push(alias);
              return { fileID, status: 0 };
            }),
          };
        },
      },
      "../shared/helpers": {
        db,
        _: {
          inc: () => 1,
          in: (values) => ({ values }),
          size: (value) => ({ op: "size", value }),
          gte: (start) => ({ and: (end) => ({ start, end }) }),
          lt: (end) => end,
        },
        ok: (data) => data,
        now: () => new Date(0),
        getLedgerForUser: async () => state.ledger,
        getCategoryById: async (id) => state.categories[id],
        getLedgerRole: (openid, ledger) =>
          ledger && ledger.ownerOpenid === openid ? "owner" : "none",
        assertWritable: (role) => {
          if (role !== "owner") throw new Error("READONLY_LEDGER");
        },
        SCHEMA_VERSION: 1,
      },
    }
  );
  const rawPreview = handler.previewImport;
  const tickets = new Map();
  handler.previewImport = async (openid, data) => {
    const requested = String(data.fileId || "");
    if (
      data.ticketId ||
      !/^cloud:\/\/[^/]+\/imports\/owner\/[^/]+\.(xls|xlsx|csv)$/i.test(requested)
    )
      return rawPreview(openid, data);
    let ticket = tickets.get(requested);
    if (!ticket) {
      const extension = requested.split(".").pop();
      const issued = await handler.createImportUpload(openid, {
        ledgerId: data.ledgerId,
        extension,
      });
      ticket = { ticketId: issued.ticketId, fileId: `cloud://env/${issued.cloudPath}` };
      tickets.set(requested, ticket);
      state.fileAliases[ticket.fileId] = requested;
      Object.values(state.operations).forEach((operation) => {
        if (operation.type === "record-import" && operation.fileId === requested)
          operation.fileId = ticket.fileId;
      });
    }
    return rawPreview(openid, { ...data, fileId: ticket.fileId, ticketId: ticket.ticketId });
  };
  return { handler, state, rawPreview };
}

test("import preview requires a server-issued path bound to the caller and ledger", async () => {
  const { handler, rawPreview } = importFixture(
    `<table><tr><th>日期</th><th>收支类型</th><th>金额</th></tr><tr><td>2026-01-01</td><td>支出</td><td>1</td></tr></table>`
  );
  const ticket = await handler.createImportUpload("owner", {
    ledgerId: "ledger",
    extension: "xls",
  });
  await assert.rejects(
    handler.createImportUpload("intruder", { ledgerId: "ledger", extension: "xls" }),
    /READONLY_LEDGER/
  );
  assert.match(ticket.cloudPath, /^imports\/owner\/[0-9a-f]{48}\.xls$/);
  const fileId = `cloud://env/${ticket.cloudPath}`;
  await assert.rejects(
    rawPreview("owner", { ledgerId: "ledger", fileId }),
    /IMPORT_FILE_ACCESS_DENIED/
  );
  await assert.rejects(
    rawPreview("owner", {
      ledgerId: "ledger",
      fileId: "cloud://env/imports/owner/other.xls",
      ticketId: ticket.ticketId,
    }),
    /IMPORT_FILE_ACCESS_DENIED/
  );
  await assert.rejects(
    rawPreview("owner", { ledgerId: "other", fileId, ticketId: ticket.ticketId }),
    /IMPORT_FILE_ACCESS_DENIED/
  );
  await assert.rejects(
    rawPreview("intruder", { ledgerId: "ledger", fileId, ticketId: ticket.ticketId }),
    /IMPORT_FILE_ACCESS_DENIED/
  );
  const result = await rawPreview("owner", {
    ledgerId: "ledger",
    fileId,
    ticketId: ticket.ticketId,
  });
  assert.equal(result.rows.length, 1);
  await assert.rejects(
    rawPreview("owner", {
      ledgerId: "ledger",
      fileId: `cloud://another/${ticket.cloudPath}`,
      ticketId: ticket.ticketId,
    }),
    /IMPORT_FILE_ACCESS_DENIED/
  );
  await assert.rejects(
    handler.abandonImportUpload("owner", { ticketId: ticket.ticketId, fileId }),
    /IMPORT_UPLOAD_IN_USE/
  );
});

test("an unclaimed upload can be safely abandoned and cleanup retried", async () => {
  const { handler, state, rawPreview } = importFixture("");
  const ticket = await handler.createImportUpload("owner", {
    ledgerId: "ledger",
    extension: "csv",
  });
  const fileId = `cloud://env/${ticket.cloudPath}`;
  await assert.rejects(
    handler.abandonImportUpload("owner", {
      ticketId: ticket.ticketId,
      fileId: "cloud://env/imports/owner/another.csv",
    }),
    /IMPORT_FILE_ACCESS_DENIED/
  );
  state.failDeletion = true;
  const first = await handler.abandonImportUpload("owner", { ticketId: ticket.ticketId, fileId });
  assert.equal(first.cleanupStatus, "pending");
  await assert.rejects(
    rawPreview("owner", { ledgerId: "ledger", fileId, ticketId: ticket.ticketId }),
    /IMPORT_FILE_ACCESS_DENIED/
  );
  state.failDeletion = false;
  const repeated = await handler.abandonImportUpload("owner", {
    ticketId: ticket.ticketId,
    fileId,
  });
  assert.equal(repeated.cleanupStatus, "done");
  assert.deepEqual(state.deletedFiles, [fileId]);
});

test("preview and abandonment cannot both claim the same upload", async () => {
  const { handler, state, rawPreview } = importFixture(
    `<table><tr><th>日期</th><th>收支类型</th><th>金额</th></tr><tr><td>2026-01-01</td><td>支出</td><td>1</td></tr></table>`
  );
  const ticket = await handler.createImportUpload("owner", {
    ledgerId: "ledger",
    extension: "xls",
  });
  const fileId = `cloud://env/${ticket.cloudPath}`;
  const [preview, abandonment] = await Promise.allSettled([
    rawPreview("owner", { ledgerId: "ledger", ticketId: ticket.ticketId, fileId }),
    handler.abandonImportUpload("owner", { ticketId: ticket.ticketId, fileId }),
  ]);
  assert.notEqual(preview.status, abandonment.status);
  if (preview.status === "fulfilled") assert.equal(state.deletedFiles.length, 0);
  else assert.deepEqual(state.deletedFiles, [fileId]);
});

test("import preview validates rows and concurrent retries do not duplicate records", async () => {
  const html = `<table><tr><th>日期</th><th>收支类型</th><th>金额</th></tr>
    <tr><td>2024-02-29</td><td>支出</td><td>10.25</td></tr>
    <tr><td>2023-02-29</td><td>支出</td><td>10</td></tr>
    <tr><td>2024-04-31</td><td>收入</td><td>10</td></tr>
    <tr><td>2024-05-01</td><td>收入</td><td>0.001</td></tr>
    <tr><td>2024-05-01</td><td>收入</td><td>100000000</td></tr></table>`;
  const { handler, state } = importFixture(html);
  const preview = await handler.previewImport("owner", {
    ledgerId: "ledger",
    fileId: "cloud://env/imports/owner/bill.xls",
  });
  assert.equal(state.records.length, 0);
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.errors.length, 4);
  await assert.rejects(
    handler.importRecords("owner", { batchId: preview.batchId, selectedRows: [3] }),
    /IMPORT_ROWS_INVALID/
  );
  const payload = { batchId: preview.batchId, selectedRows: [2] };
  const results = await Promise.all([
    handler.importRecords("owner", payload),
    handler.importRecords("owner", payload),
  ]);
  assert.equal(results[0].imported, 1);
  assert.equal(results[1].imported, 1);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].date, "2024-02-29");
  assert.equal(state.ledger.syncRevision, 1);
  state.fileUnavailable = true;
  const repeated = await handler.importRecords("owner", payload);
  assert.equal(repeated.imported, 1);
  assert.equal(repeated.skipped, 4);
  await assert.rejects(
    handler.importRecords("owner", { ...payload, selectedRows: [3] }),
    /IMPORT_SELECTION_CHANGED/
  );
  await assert.rejects(handler.importRecords("intruder", payload), /IMPORT_BATCH_ACCESS_DENIED/);
});

test("shared import files remain until every active batch completes and failed cleanup can retry", async () => {
  const { handler, state } = importFixture(
    `<table><tr><th>日期</th><th>收支类型</th><th>金额</th></tr><tr><td>2026-01-01</td><td>支出</td><td>1</td></tr></table>`
  );
  const fileId = "cloud://env/imports/owner/shared.xls";
  const first = await handler.previewImport("owner", { ledgerId: "ledger", fileId });
  const second = await handler.previewImport("owner", { ledgerId: "ledger", fileId });
  const previews = await handler.listImportPreviews("owner", { ledgerId: "ledger" });
  assert.deepEqual(
    Array.from(previews.previews, (item) => item.batchId),
    [first.batchId, second.batchId]
  );
  await assert.rejects(
    handler.listImportPreviews("intruder", { ledgerId: "ledger" }),
    /READONLY_LEDGER/
  );
  await handler.importRecords("owner", { batchId: first.batchId, selectedRows: [2] });
  assert.equal(state.deletedFiles.length, 0);
  state.failDeletion = true;
  const completed = await handler.importRecords("owner", {
    batchId: second.batchId,
    selectedRows: [2],
  });
  assert.equal(completed.cleanupStatus, "pending");
  assert.equal(state.deletedFiles.length, 0);
  const pendingSweep = await handler.sweepImportFileCleanup("owner", { ledgerId: "ledger" });
  assert.equal(pendingSweep.pending, 1);
  await assert.rejects(
    handler.sweepImportFileCleanup("intruder", { ledgerId: "ledger" }),
    /READONLY_LEDGER/
  );
  state.failDeletion = false;
  await assert.rejects(
    handler.retryImportFileCleanup("intruder", { batchId: second.batchId }),
    /IMPORT_BATCH_ACCESS_DENIED/
  );
  const cleaned = await handler.retryImportFileCleanup("owner", { batchId: second.batchId });
  assert.equal(cleaned.cleanupStatus, "done");
  const repeated = await handler.importRecords("owner", {
    batchId: second.batchId,
    selectedRows: [2],
  });
  assert.equal(repeated.imported, 1);
  assert.deepEqual(state.deletedFiles, [fileId]);
  await assert.rejects(
    handler.previewImport("owner", { ledgerId: "ledger", fileId }),
    /IMPORT_FILE_UNAVAILABLE/
  );
});

test("cleanup recovers when file deletion succeeds but marker update fails", async () => {
  const { handler, state } = importFixture(
    `<table><tr><th>日期</th><th>收支类型</th><th>金额</th></tr><tr><td>2026-01-01</td><td>支出</td><td>1</td></tr></table>`
  );
  const fileId = "cloud://env/imports/owner/marker-retry.xls";
  const preview = await handler.previewImport("owner", { ledgerId: "ledger", fileId });
  state.failMarkerUpdate = true;
  const result = await handler.importRecords("owner", {
    batchId: preview.batchId,
    selectedRows: [2],
  });
  assert.equal(result.cleanupStatus, "pending");
  assert.deepEqual(state.deletedFiles, [fileId]);
  const retry = await handler.retryImportFileCleanup("owner", { batchId: preview.batchId });
  assert.equal(retry.cleanupStatus, "done");
  assert.deepEqual(state.deletedFiles, [fileId]);
});

test("legacy active batches prevent a new cleanup-managed reference from claiming their file", async () => {
  const { handler, state } = importFixture(
    `<table><tr><th>日期</th><th>收支类型</th><th>金额</th></tr><tr><td>2026-01-01</td><td>支出</td><td>1</td></tr></table>`
  );
  const fileId = "cloud://env/imports/owner/legacy.xls";
  state.operations.old = {
    type: "record-import",
    ledgerId: "ledger",
    ownerOpenid: "owner",
    fileId,
    status: "running",
  };
  await assert.rejects(
    handler.previewImport("owner", { ledgerId: "ledger", fileId }),
    /IMPORT_FILE_LEGACY_ACTIVE/
  );
  assert.equal(state.deletedFiles.length, 0);
});

test("cancelling a preview releases only its own file reference", async () => {
  const { handler, state } = importFixture(
    `<table><tr><th>日期</th><th>收支类型</th><th>金额</th></tr><tr><td>2026-01-01</td><td>支出</td><td>1</td></tr></table>`
  );
  const fileId = "cloud://env/imports/owner/shared-cancel.xls";
  const first = await handler.previewImport("owner", { ledgerId: "ledger", fileId });
  const second = await handler.previewImport("owner", { ledgerId: "ledger", fileId });
  await assert.rejects(
    handler.cancelImportPreview("intruder", { batchId: first.batchId }),
    /IMPORT_BATCH_ACCESS_DENIED/
  );
  await handler.cancelImportPreview("owner", { batchId: first.batchId });
  await handler.cancelImportPreview("owner", { batchId: first.batchId });
  const remaining = await handler.listImportPreviews("owner", { ledgerId: "ledger" });
  assert.deepEqual(
    Array.from(remaining.previews, (item) => item.batchId),
    [second.batchId]
  );
  assert.equal(state.deletedFiles.length, 0);
  await assert.rejects(
    handler.importRecords("owner", { batchId: first.batchId, selectedRows: [2] }),
    /IMPORT_BATCH_CANCELLED/
  );
  await handler.importRecords("owner", { batchId: second.batchId, selectedRows: [2] });
  assert.deepEqual(state.deletedFiles, [fileId]);
});

test("import resumes multiple batches without rewriting processed rows", async () => {
  const rows = Array.from(
    { length: 12 },
    (_, i) => `<tr><td>2026-01-${String(i + 1).padStart(2, "0")}</td><td>支出</td><td>1</td></tr>`
  ).join("");
  const { handler, state } = importFixture(
    `<table><tr><th>日期</th><th>收支类型</th><th>金额</th></tr>${rows}</table>`
  );
  const preview = await handler.previewImport("owner", {
    ledgerId: "ledger",
    fileId: "cloud://env/imports/owner/bill.xls",
  });
  const payload = {
    batchId: preview.batchId,
    selectedRows: Array.from({ length: 12 }, (_, i) => i + 2),
  };
  const first = await handler.importRecords("owner", payload);
  assert.equal(first.imported, 10);
  assert.equal(first.hasMore, true);
  const previews = await handler.listImportPreviews("owner", { ledgerId: "ledger" });
  assert.equal(previews.previews.length, 0);
  await assert.rejects(
    handler.cancelImportPreview("owner", { batchId: preview.batchId }),
    /IMPORT_BATCH_ALREADY_STARTED/
  );
  assert.equal(state.deletedFiles.length, 0);
  await assert.rejects(
    handler.importRecords("owner", { ...payload, selectedRows: [2] }),
    /IMPORT_SELECTION_CHANGED/
  );
  const second = await handler.importRecords("owner", payload);
  assert.equal(second.imported, 12);
  assert.equal(second.hasMore, false);
  await handler.importRecords("owner", payload);
  assert.equal(state.records.length, 12);
  assert.equal(state.ledger.syncRevision, 2);
});

test("import preview rejects another user's file before downloading", async () => {
  const { handler } = importFixture("");
  for (const fileId of [
    "cloud://env/imports/other/bill.xls",
    "cloud://env/imports/owner/%2e%2e",
    "cloud://env/imports/owner/a/bill.xls",
  ]) {
    await assert.rejects(
      handler.previewImport("owner", { ledgerId: "ledger", fileId }),
      /IMPORT_FILE_ACCESS_DENIED/
    );
  }
});

test("import preview reports original row numbers when a table has blank rows", async () => {
  const html = `<table><tr><th>说明</th></tr><tr><th>日期</th><th>收支类型</th><th>金额</th></tr>
    <tr></tr><tr><td>2024-02-29</td><td>支出</td><td>1</td></tr>
    <tr><td>2023-02-29</td><td>支出</td><td>2</td></tr></table>`;
  const { handler } = importFixture(html);
  const preview = await handler.previewImport("owner", {
    ledgerId: "ledger",
    fileId: "cloud://env/imports/owner/bill.xls",
  });
  assert.equal(preview.rows[0].rowNumber, 4);
  assert.match(preview.errors[0], /第 5 行/);
});

test("similar rows are flagged but remain selectable for legitimate repeated spending", async () => {
  const html = `<table><tr><th>日期</th><th>收支类型</th><th>金额</th></tr>
    <tr><td>2026-01-01</td><td>支出</td><td>10</td></tr>
    <tr><td>2026-01-01</td><td>支出</td><td>10</td></tr></table>`;
  const { handler, state } = importFixture(html);
  const preview = await handler.previewImport("owner", {
    ledgerId: "ledger",
    fileId: "cloud://env/imports/owner/bill.xls",
  });
  assert.ok(preview.rows[0].duplicateWarning);
  assert.ok(preview.rows[1].duplicateWarning);
  await handler.importRecords("owner", { batchId: preview.batchId, selectedRows: [2, 3] });
  assert.equal(state.records.length, 2);
});

test("category record filter preserves ledger scope and legacy identity fields", () => {
  const handler = load(
    "cloudfunctions/ourNest/handlers/record.handler.js",
    {},
    {},
    {
      "wx-server-sdk": {},
      "../shared/helpers": { _: { in: (values) => ({ values }) } },
    }
  );
  const query = { ledgerId: "ledger", type: "expense" };
  handler.applyCategoryFilter(query, { kind: "legacy", name: "其他", parent: "交通" });
  assert.equal(query.ledgerId, "ledger");
  assert.equal(query.type, "expense");
  assert.equal(query.categoryName, "其他");
  assert.equal(query.parentCategory, "交通");
  assert.deepEqual(Array.from(query.categoryId.values), ["", null]);
  assert.throws(
    () => handler.applyCategoryFilter({}, { kind: "id", id: "" }),
    /INVALID_CATEGORY_FILTER/
  );
});

test("category detail totals and pages use the same server filter", async () => {
  const queries = [];
  let aggregateExpression;
  const db = {
    collection: () => ({
      where: (query) => {
        queries.push(query);
        const chain = {
          count: async () => ({ total: 2 }),
          orderBy: () => chain,
          limit: () => chain,
          get: async () => ({ data: [] }),
        };
        return chain;
      },
      aggregate: () => ({
        match: (query) => {
          queries.push(query);
          return {
            group: (expression) => {
              aggregateExpression = expression.total;
              return { end: async () => ({ list: [{ _id: "expense", total: 2000 }] }) };
            },
          };
        },
      }),
    }),
  };
  const command = {
    gte: (value) => ({ and: (end) => ({ start: value, end }) }),
    lt: (value) => value,
    in: (values) => ({ values }),
  };
  const handler = load(
    "cloudfunctions/ourNest/handlers/record.handler.js",
    {},
    {},
    {
      "wx-server-sdk": {},
      "../shared/helpers": {
        db,
        _: command,
        $: {
          sum: (field) => field,
          floor: (value) => value,
          add: (value) => value,
          multiply: (value) => value,
        },
        ok: (data) => data,
        getLedgerForUser: async () => ({ _id: "ledger" }),
        getLedgerRole: () => "readonly",
        assertReadable: () => {},
        getRoleText: () => "访客",
        getUsersByOpenids: async () => ({}),
        resolveUsersAvatarUrls: async (users) => users,
      },
    }
  );
  const result = await handler.listRecords("visitor", {
    ledgerId: "ledger",
    type: "expense",
    start: "2026-01-01",
    end: "2026-02-01",
    categoryFilter: { kind: "id", id: "category" },
  });
  const filtered = queries.filter((query) => query.categoryId === "category");
  assert.equal(filtered.length, 3);
  assert.ok(filtered.every((query) => query.ledgerId === "ledger" && query.type === "expense"));
  assert.equal(result.rangeSummary.expense, 20);
  assert.equal(aggregateExpression[0][0], "$amount");
  assert.equal(aggregateExpression[0][1], 100);
  assert.equal(aggregateExpression[1], 0.5);
  assert.equal(result.readonly, true);
});

test("source bill parser separates successful spending from special and closed transactions", () => {
  const { parseSourceTable } = require("../cloudfunctions/ourNest/import-source");
  const table = [
    ["账单说明"],
    [
      "交易时间",
      "交易类型",
      "交易对方",
      "商品",
      "收/支",
      "金额(元)",
      "支付方式",
      "当前状态",
      "交易单号",
    ],
    [
      "2026-01-01 12:00:00",
      "商户消费",
      "餐厅",
      "午餐",
      "支出",
      "¥12.50",
      "零钱",
      "支付成功",
      "01234567890123456789",
    ],
    ["2026-01-02 12:00:00", "转账", "家人", "", "支出", "¥20.00", "零钱", "支付成功", "00002"],
    ["2026-01-03 12:00:00", "商户消费", "店", "", "支出", "¥5.00", "零钱", "交易关闭", "00003"],
  ];
  const parsed = parseSourceTable(table);
  assert.equal(parsed.source, "wechat");
  assert.equal(parsed.rows[0].rowNumber, 3);
  assert.equal(parsed.rows[0].transactionId, "01234567890123456789");
  assert.equal(parsed.rows[0].amount, 12.5);
  assert.equal(parsed.rows[0].needsReview, false);
  assert.equal(parsed.rows[1].needsReview, true);
  assert.equal(parsed.rows[2].excluded, true);
});

test("alipay parser preserves source IDs and never trusts numeric transaction IDs", () => {
  const { parseSourceTable } = require("../cloudfunctions/ourNest/import-source");
  const parsed = parseSourceTable([
    [
      "交易时间",
      "交易分类",
      "交易对方",
      "商品说明",
      "收/支",
      "金额",
      "收/付款方式",
      "交易状态",
      "交易订单号",
    ],
    [
      "2026-03-01 10:00:00",
      "餐饮",
      "餐厅",
      "午餐",
      "支出",
      "10.00",
      "余额",
      "交易成功",
      12345678901234568000,
    ],
    [
      "2026-03-02 10:00:00",
      "退款",
      "餐厅",
      "退款",
      "收入",
      "10.00",
      "余额",
      "交易成功",
      "00012345678901234567",
    ],
  ]);
  assert.equal(parsed.source, "alipay");
  assert.equal(parsed.rows[0].transactionId, "");
  assert.ok(parsed.rows[0].sourceIdWarning);
  assert.equal(parsed.rows[1].transactionId, "00012345678901234567");
  assert.equal(parsed.rows[1].needsReview, true);
});

test("CSV source preview requires review and deduplicates source IDs across imports", async () => {
  const csv = [
    "微信支付账单明细",
    "交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号",
    "2026-01-01 12:00:00,商户消费,餐厅,午餐,支出,12.50,零钱,支付成功,00000012345678901234",
    "2026-01-02 12:00:00,转账,家人,转账,支出,20.00,零钱,支付成功,00000012345678901235",
    "2026-01-03 12:00:00,商户消费,商家,订单,支出,10.00,零钱,交易关闭,00000012345678901236",
  ].join("\n");
  const { handler, state } = importFixture(csv);
  const payload = { ledgerId: "ledger", fileId: "cloud://env/imports/owner/bill.csv" };
  const first = await handler.previewImport("owner", payload);
  assert.equal(first.rows.length, 3);
  assert.equal(first.rows[1].needsReview, true);
  assert.equal(first.rows[2].excluded, true);
  await assert.rejects(
    handler.importRecords("owner", { batchId: first.batchId, selectedRows: [4] }),
    /IMPORT_ROW_REVIEW_REQUIRED/
  );
  await assert.rejects(
    handler.importRecords("owner", { batchId: first.batchId, selectedRows: [5] }),
    /IMPORT_ROW_EXCLUDED/
  );
  const result = await handler.importRecords("owner", {
    batchId: first.batchId,
    selectedRows: [3, 4],
    manualTypes: { 4: "expense" },
    categoryChoices: { 3: "", 4: "" },
  });
  assert.equal(result.imported, 2);
  assert.equal(state.records.length, 2);
  assert.equal(state.records[0].sourceTransactionId, "00000012345678901234");
  const again = await handler.previewImport("owner", {
    ...payload,
    fileId: "cloud://env/imports/owner/reuploaded.csv",
  });
  assert.equal(again.rows[0].confirmedDuplicate, true);
  const repeated = await handler.importRecords("owner", {
    batchId: again.batchId,
    selectedRows: [3],
    categoryChoices: { 3: "" },
  });
  assert.equal(repeated.imported, 0);
  assert.equal(repeated.duplicates, 1);
  assert.equal(state.records.length, 2);
});

test("GB18030 Alipay bill flags cross-source possible matches without removing them", async () => {
  const bytes = Buffer.from(
    "bdbbd2d7cab1bce42cbdbbd2d7b7d6c0e02cbdbbd2d7b6d4b7bd2cc9ccc6b7cbb5c3f72ccad52fd6a72cbdf0b6ee2ccad52fb8b6bfeeb7bdcabd2cbdbbd2d7d7b4ccac2cbdbbd2d7b6a9b5a5bac50a323032362d30312d30312031323a30303a30302cb2cdd2fb2cb2cdccfc2ccee7b2cd2cd6a7b3f62c31322e35302cd3e0b6ee2cbdbbd2d7b3c9b9a62c414c495041593030303132333435363738390a",
    "hex"
  );
  const { handler, state } = importFixture(bytes);
  state.records.push({
    ledgerId: "ledger",
    source: "wechat",
    sourceMerchant: "餐厅",
    date: "2026-01-01",
    amount: 12.5,
  });
  const preview = await handler.previewImport("owner", {
    ledgerId: "ledger",
    fileId: "cloud://env/imports/owner/bill.csv",
  });
  assert.equal(preview.rows[0].source, "alipay");
  assert.match(preview.rows[0].crossSourceWarning, /其他来源/);
  const result = await handler.importRecords("owner", {
    batchId: preview.batchId,
    selectedRows: [2],
    categoryChoices: { 2: "" },
  });
  assert.equal(result.imported, 1);
  assert.equal(state.records.length, 2);
});

test("Excel source timestamps retain the correct calendar day", () => {
  const { parseSourceRow } = require("../cloudfunctions/ourNest/import-source");
  const row = parseSourceRow("wechat", {
    交易时间: new Date("2026-01-01T11:59:59.999Z"),
    交易类型: "商户消费",
    "收/支": "支出",
    "金额(元)": "1.00",
    当前状态: "支付成功",
    交易单号: "123456789",
  });
  assert.equal(row.date, "2026-01-01");
  assert.equal(row.time, "12:00:00");
});

test("import stops when the caller loses write permission between batches", async () => {
  const rows = Array.from(
    { length: 11 },
    (_, i) => `<tr><td>2026-01-${String(i + 1).padStart(2, "0")}</td><td>支出</td><td>1</td></tr>`
  ).join("");
  const { handler, state } = importFixture(
    `<table><tr><th>日期</th><th>收支类型</th><th>金额</th></tr>${rows}</table>`
  );
  const preview = await handler.previewImport("owner", {
    ledgerId: "ledger",
    fileId: "cloud://env/imports/owner/bill.xls",
  });
  const payload = {
    batchId: preview.batchId,
    selectedRows: Array.from({ length: 11 }, (_, i) => i + 2),
  };
  const first = await handler.importRecords("owner", payload);
  assert.equal(first.hasMore, true);
  state.ledger.categoryDeletionId = "category";
  await assert.rejects(handler.importRecords("owner", payload), /分类迁移进行中/);
  assert.equal(state.records.length, 10);
  state.ledger.categoryDeletionId = "";
  state.ledger.ownerOpenid = "other";
  await assert.rejects(handler.importRecords("owner", payload), /READONLY_LEDGER/);
  assert.equal(state.records.length, 10);
});

test("synthetic XLSX source bill keeps date and leading-zero transaction ID", async () => {
  const xlsx = require("xlsx");
  const sheet = xlsx.utils.aoa_to_sheet(
    [
      ["说明"],
      [
        "交易时间",
        "交易类型",
        "交易对方",
        "商品",
        "收/支",
        "金额(元)",
        "支付方式",
        "当前状态",
        "交易单号",
      ],
      [
        new Date("2026-02-02T10:00:00Z"),
        "商户消费",
        "书店",
        "书",
        "支出",
        "18.00",
        "零钱",
        "支付成功",
        "00012345678901234567",
      ],
    ],
    { cellDates: true }
  );
  const buffer = xlsx.write(
    { SheetNames: ["账单"], Sheets: { 账单: sheet } },
    { type: "buffer", bookType: "xlsx" }
  );
  const { handler, state } = importFixture(buffer);
  const preview = await handler.previewImport("owner", {
    ledgerId: "ledger",
    fileId: "cloud://env/imports/owner/bill.xlsx",
  });
  assert.equal(preview.rows[0].date, "2026-02-02");
  assert.equal(preview.rows[0].rowNumber, 3);
  await handler.importRecords("owner", {
    batchId: preview.batchId,
    selectedRows: [3],
    categoryChoices: { 3: "" },
  });
  assert.equal(state.records[0].sourceTransactionId, "00012345678901234567");
  assert.equal(state.records[0].importBatchId, preview.batchId);
});

test("source identity deduplicates concurrent separate import batches", async () => {
  const csv = [
    "交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号",
    "2026-01-01 12:00:00,商户消费,餐厅,午餐,支出,12.50,零钱,支付成功,00000012345678901234",
  ].join("\n");
  const { handler, state } = importFixture(csv);
  const payload = { ledgerId: "ledger", fileId: "cloud://env/imports/owner/bill.csv" };
  const one = await handler.previewImport("owner", payload);
  const two = await handler.previewImport("owner", payload);
  const result = await Promise.all([
    handler.importRecords("owner", {
      batchId: one.batchId,
      selectedRows: [2],
      categoryChoices: { 2: "" },
    }),
    handler.importRecords("owner", {
      batchId: two.batchId,
      selectedRows: [2],
      categoryChoices: { 2: "" },
    }),
  ]);
  assert.equal(state.records.length, 1);
  assert.equal(result[0].imported + result[1].imported, 1);
  assert.equal(result[0].duplicates + result[1].duplicates, 1);
});

test("record creation validates category identity and uses server category metadata", async () => {
  const stored = [];
  let deletionBegins = false;
  let ledgerWrites = 0;
  let migrationActive = false;
  const categories = {
    child: {
      _id: "child",
      ledgerId: "ledger",
      type: "expense",
      level: "child",
      parentId: "parent",
      name: "午餐",
      icon: "food",
    },
    parent: {
      _id: "parent",
      ledgerId: "ledger",
      type: "expense",
      level: "parent",
      name: "餐饮",
      icon: "restaurant",
    },
    foreign: {
      _id: "foreign",
      ledgerId: "another",
      type: "expense",
      level: "child",
      parentId: "parent",
    },
  };
  const handler = load(
    "cloudfunctions/ourNest/handlers/record.handler.js",
    {},
    {},
    {
      "wx-server-sdk": {},
      "../shared/helpers": {
        db: {
          runTransaction: async (fn) =>
            fn({
              collection: (name) => ({
                doc: (id) => ({
                  get: async () => ({
                    data:
                      name === "ledgers"
                        ? { _id: "ledger", categoryDeletionId: migrationActive ? "child" : "" }
                        : deletionBegins && id === "parent"
                          ? { ...categories[id], deletionState: "deleting" }
                          : categories[id],
                  }),
                  update: async () => {
                    if (name === "ledgers") ledgerWrites += 1;
                  },
                }),
                add: async ({ data }) => {
                  stored.push(data);
                  return { _id: "record" };
                },
              }),
            }),
          collection: () => ({
            add: async ({ data }) => {
              stored.push(data);
              return { _id: "record" };
            },
          }),
        },
        _: { inc: () => 1 },
        ok: (data) => data,
        now: () => new Date(0),
        SCHEMA_VERSION: 1,
        bumpLedgerSyncRevision: async () => {},
        getLedgerForUser: async () => ({ _id: "ledger" }),
        getLedgerRole: () => "owner",
        assertWritable: () => {},
        getCategoryById: async (id) => categories[id],
      },
    }
  );
  const base = {
    ledgerId: "ledger",
    type: "expense",
    date: "2026-01-01",
    amount: 12,
    categoryName: "伪造",
  };
  await assert.rejects(
    handler.createRecord("owner", { ...base, categoryId: "foreign" }),
    /INVALID_RECORD_CATEGORY/
  );
  assert.equal(stored.length, 0);
  await handler.createRecord("owner", { ...base, categoryId: "child" });
  assert.equal(stored[0].categoryName, "午餐");
  assert.equal(stored[0].parentCategory, "餐饮");
  assert.equal(stored[0].categoryId, "child");
  assert.equal(ledgerWrites, 1);
  deletionBegins = true;
  await assert.rejects(
    handler.createRecord("owner", { ...base, categoryId: "child" }),
    /INVALID_RECORD_CATEGORY/
  );
  assert.equal(stored.length, 1);
  deletionBegins = false;
  migrationActive = true;
  await assert.rejects(
    handler.createRecord("owner", { ...base, categoryId: "" }),
    /分类迁移进行中/
  );
  assert.equal(stored.length, 1);
});

test("family and category drill-down use matching totals and cursor pages", async () => {
  const records = [
    {
      _id: "4",
      date: "2026-02-04",
      createdAt: 4,
      ledgerId: "ledger",
      type: "expense",
      amount: 10,
      ownerOpenid: "a",
      categoryId: "food",
      familyAttribution: { payerOpenid: "b", consumerKind: "personal", consumerOpenid: "a" },
    },
    {
      _id: "3",
      date: "2026-02-03",
      createdAt: 3,
      ledgerId: "ledger",
      type: "expense",
      amount: 20,
      ownerOpenid: "a",
      categoryId: "food",
      familyAttribution: { payerOpenid: "a", consumerKind: "public", consumerOpenid: "" },
    },
    {
      _id: "2",
      date: "2026-02-02",
      createdAt: 2,
      ledgerId: "ledger",
      type: "expense",
      amount: 30,
      ownerOpenid: "b",
      categoryId: "travel",
      familyAttribution: { payerOpenid: "b", consumerKind: "multiple", consumerOpenid: "" },
    },
    {
      _id: "1",
      date: "2026-02-01",
      createdAt: 1,
      ledgerId: "ledger",
      type: "expense",
      amount: 5,
      ownerOpenid: "a",
      categoryId: "food",
    },
    {
      _id: "0",
      date: "2026-02-01",
      createdAt: 0.5,
      ledgerId: "ledger",
      type: "expense",
      amount: 0.25,
      ownerOpenid: "b",
      categoryId: "food",
      familyAttribution: { payerOpenid: "b", consumerKind: "personal", consumerOpenid: "b" },
    },
  ];
  const command = {
    gte: (value) => ({ and: (end) => ({ op: "range", value, end }) }),
    lt: (value) => ({ op: "lt", value }),
    in: (values) => ({ op: "in", values }),
    nin: (values) => ({ op: "nin", values }),
    or: (items) => ({ op: "or", items }),
    and: (items) => ({ op: "and", items }),
  };
  const matches = (row, query) => {
    if (query.op === "and") return query.items.every((item) => matches(row, item));
    if (query.op === "or") return query.items.some((item) => matches(row, item));
    return Object.entries(query).every(([key, expected]) => {
      const actual = key.split(".").reduce((item, field) => item && item[field], row);
      if (expected && expected.op === "range")
        return actual >= expected.value && actual < expected.end.value;
      if (expected && expected.op === "lt") return actual < expected.value;
      if (expected && expected.op === "in")
        return expected.values.includes(actual == null ? null : actual);
      if (expected && expected.op === "nin") return !expected.values.includes(actual);
      return actual === expected;
    });
  };
  const db = {
    collection: () => ({
      where: (query) => {
        let size = 100;
        const chain = {
          count: async () => ({ total: records.filter((row) => matches(row, query)).length }),
          orderBy: () => chain,
          limit: (value) => {
            size = value;
            return chain;
          },
          get: async () => ({ data: records.filter((row) => matches(row, query)).slice(0, size) }),
        };
        return chain;
      },
      aggregate: () => ({
        match: (query) => ({
          group: () => ({
            end: async () => ({
              list: [
                {
                  _id: "expense",
                  total: records
                    .filter((row) => matches(row, query))
                    .reduce((sum, row) => sum + Math.round(row.amount * 100), 0),
                },
              ],
            }),
          }),
        }),
      }),
    }),
  };
  const handler = load(
    "cloudfunctions/ourNest/handlers/record.handler.js",
    {},
    {},
    {
      "wx-server-sdk": {},
      "../shared/helpers": {
        db,
        _: command,
        $: {
          sum: (field) => field,
          floor: (value) => value,
          add: (value) => value,
          multiply: (value) => value,
        },
        ok: (data) => data,
        getLedgerForUser: async () => ({ _id: "ledger", type: "shared" }),
        getLedgerRole: () => "readonly",
        assertReadable: () => {},
        getRoleText: () => "访客",
        getRecordById: async (id) => records.find((row) => row._id === id),
        getUsersByOpenids: async () => ({}),
        resolveUsersAvatarUrls: async (users) => users,
      },
    }
  );
  const query = {
    ledgerId: "ledger",
    start: "2026-02-01",
    end: "2026-03-01",
    type: "expense",
    pageSize: 1,
    familyFilter: { dimension: "consumer", openid: "a" },
    categoryFilter: { kind: "id", id: "food" },
  };
  const first = await handler.listRecords("visitor", query);
  assert.equal(first.rangeSummary.expense, 30);
  assert.equal(first.rangeRecordCount, 2);
  assert.equal(first.records[0]._id, "4");
  assert.equal(first.hasMore, true);
  const second = await handler.listRecords("visitor", { ...query, cursor: first.nextCursor });
  assert.equal(second.records[0]._id, "3");
  assert.equal(second.hasMore, false);
  assert.equal(second.rangeSummary.expense, 30);
  assert.equal(second.readonly, true);

  records.push(
    { ...records[0], _id: "another-ledger", ledgerId: "another", amount: 999 },
    { ...records[0], _id: "income", type: "income", amount: 999 },
    { ...records[0], _id: "before-start", date: "2026-01-31", amount: 999 },
    { ...records[0], _id: "at-end", date: "2026-03-01", amount: 999 }
  );
  const previewQuery = {
    ledgerId: "ledger",
    start: "2026-02-01",
    end: "2026-03-01",
    type: "expense",
    categoryFilter: { kind: "id", id: "food" },
    summaryFiltered: true,
    pageSize: 3,
    cursor: null,
  };
  const preview = await handler.listRecords("visitor", previewQuery);
  assert.equal(preview.records.length, 3);
  assert.equal(preview.hasMore, true);
  assert.equal(preview.rangeRecordCount, 4);
  assert.equal(preview.rangeSummary.expense, 35.25);
  assert.equal(
    preview.records.reduce((sum, row) => sum + row.amount, 0),
    35
  );
  const full = await handler.listRecords("visitor", { ...previewQuery, pageSize: 30 });
  assert.equal(full.records.length, 4);
  assert.equal(full.hasMore, false);
  assert.equal(full.rangeRecordCount, preview.rangeRecordCount);
  assert.equal(full.rangeSummary.expense, preview.rangeSummary.expense);
  assert.equal(preview.readonly, true);
  const empty = await handler.listRecords("visitor", {
    ...previewQuery,
    categoryFilter: { kind: "id", id: "missing" },
  });
  assert.equal(empty.records.length, 0);
  assert.equal(empty.rangeRecordCount, 0);
  assert.equal(empty.rangeSummary.expense, 0);
});

test("shared records validate family members and keep creator authority on server", async () => {
  const saved = [];
  const patches = [];
  let conflict = false;
  const ledger = {
    _id: "ledger",
    type: "shared",
    ownerOpenid: "a",
    memberOpenids: ["a", "b"],
    viewerOpenids: ["v"],
  };
  const original = {
    _id: "record",
    ledgerId: "ledger",
    ownerOpenid: "b",
    type: "expense",
    categoryId: "child",
    syncVersion: 1,
    familyAttribution: { payerOpenid: "b", consumerKind: "personal", consumerOpenid: "b" },
  };
  const handler = load(
    "cloudfunctions/ourNest/handlers/record.handler.js",
    {},
    {},
    {
      "wx-server-sdk": {},
      "../shared/helpers": {
        db: {
          runTransaction: async (fn) =>
            fn({
              collection: (name) => ({
                doc: (id) => ({
                  get: async () => ({
                    data:
                      name === "ledgers"
                        ? ledger
                        : name === "records"
                          ? { ...original, syncVersion: conflict ? 2 : 1 }
                          : id === "child"
                            ? {
                                _id: "child",
                                ledgerId: "ledger",
                                type: "expense",
                                level: "child",
                                parentId: "parent",
                                name: "午餐",
                              }
                            : {
                                _id: "parent",
                                ledgerId: "ledger",
                                type: "expense",
                                level: "parent",
                                name: "餐饮",
                              },
                  }),
                  update: async ({ data }) => {
                    if (name === "records") patches.push(data);
                  },
                }),
                add: async ({ data }) => {
                  saved.push(data);
                  return { _id: "new" };
                },
              }),
            }),
          collection: () => ({
            add: async ({ data }) => {
              saved.push(data);
              return { _id: "new" };
            },
            doc: () => ({
              update: async ({ data }) => {
                patches.push(data);
              },
            }),
            where: () => ({
              update: async ({ data }) => {
                if (conflict) return { stats: { updated: 0 } };
                patches.push(data);
                return { stats: { updated: 1 } };
              },
            }),
          }),
        },
        _: { inc: () => 1 },
        ok: (data) => data,
        now: () => new Date(0),
        SCHEMA_VERSION: 1,
        bumpLedgerSyncRevision: async () => {},
        getLedgerForUser: async () => ledger,
        getLedgerRole: (id) =>
          id === "a" ? "owner" : id === "b" ? "member" : id === "v" ? "readonly" : "none",
        assertWritable: (role) => {
          if (!["owner", "member"].includes(role)) throw new Error("READONLY_LEDGER");
        },
        getRecordById: async () => original,
        getCategoryById: async (id) =>
          id === "child"
            ? {
                _id: "child",
                ledgerId: "ledger",
                type: "expense",
                level: "child",
                parentId: "parent",
                name: "午餐",
              }
            : { _id: "parent", ledgerId: "ledger", type: "expense", level: "parent", name: "餐饮" },
      },
    }
  );
  const payload = {
    ledgerId: "ledger",
    date: "2026-01-01",
    type: "expense",
    amount: 8,
    ownerOpenid: "forged",
    syncVersion: 1,
  };
  await assert.rejects(
    handler.createRecord("b", {
      ...payload,
      familyAttribution: { payerOpenid: "v", consumerKind: "personal", consumerOpenid: "b" },
    }),
    /INVALID_FAMILY_MEMBER/
  );
  await handler.createRecord("b", {
    ...payload,
    familyAttribution: { payerOpenid: "a", consumerKind: "personal", consumerOpenid: "b" },
  });
  assert.equal(saved[0].ownerOpenid, "b");
  assert.equal(saved[0].familyAttribution.payerOpenid, "a");
  await assert.rejects(
    handler.updateRecord("v", { ...payload, recordId: "record" }),
    /READONLY_LEDGER/
  );
  await handler.updateRecord("a", {
    ...payload,
    recordId: "record",
    familyAttribution: { payerOpenid: "a", consumerKind: "public", consumerOpenid: "b" },
  });
  assert.equal(patches[0].familyAttribution.consumerKind, "public");
  assert.equal(patches[0].familyAttribution.consumerOpenid, "");
  assert.equal(patches[0].ownerOpenid, undefined);
  assert.equal(patches[0].categoryName, "午餐");
  await handler.updateRecord("a", {
    ...payload,
    recordId: "record",
    categoryId: "",
    categoryName: "其他",
  });
  assert.equal(patches[1].categoryId, "");
  conflict = true;
  await assert.rejects(
    handler.updateRecord("a", { ...payload, recordId: "record", categoryId: "" }),
    /记录已被其他成员修改/
  );
});

test("source import enforces category confirmation and server-side category ownership", async () => {
  const csv = [
    "交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号",
    "2026-01-01 12:00:00,商户消费,餐厅,午餐,支出,12.50,零钱,支付成功,00000012345678901234",
  ].join("\n");
  const { handler, state } = importFixture(csv);
  state.categories.child = {
    _id: "child",
    ledgerId: "ledger",
    type: "expense",
    level: "child",
    parentId: "parent",
    name: "午餐",
  };
  state.categories.parent = {
    _id: "parent",
    ledgerId: "ledger",
    type: "expense",
    level: "parent",
    name: "餐饮",
  };
  state.categories.foreign = {
    _id: "foreign",
    ledgerId: "other",
    type: "expense",
    level: "child",
    parentId: "parent",
  };
  const preview = await handler.previewImport("owner", {
    ledgerId: "ledger",
    fileId: "cloud://env/imports/owner/bill.csv",
  });
  const base = { batchId: preview.batchId, selectedRows: [2] };
  await assert.rejects(
    handler.importRecords("owner", base),
    /IMPORT_CATEGORY_CONFIRMATION_REQUIRED/
  );
  await assert.rejects(
    handler.importRecords("owner", { ...base, categoryChoices: { 2: "foreign" } }),
    /INVALID_RECORD_CATEGORY/
  );
  await assert.rejects(
    handler.importRecords("owner", {
      ...base,
      categoryChoices: { 2: "foreign" },
      recoverCategories: "true",
    }),
    /INVALID_RECORD_CATEGORY/
  );
  assert.equal(state.records.length, 0);
  await handler.importRecords("owner", { ...base, categoryChoices: { 2: "child" } });
  assert.equal(state.records[0].categoryId, "child");
  assert.equal(state.records[0].parentCategory, "餐饮");
});

test("import rechecks category state inside the write transaction", async () => {
  const csv = [
    "交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号",
    "2026-01-01 12:00:00,商户消费,餐厅,午餐,支出,12.50,零钱,支付成功,transaction123",
  ].join("\n");
  const { handler, state } = importFixture(csv);
  state.categories.parent = {
    _id: "parent",
    ledgerId: "ledger",
    type: "expense",
    level: "parent",
    name: "餐饮",
  };
  state.categories.child = {
    _id: "child",
    ledgerId: "ledger",
    type: "expense",
    level: "child",
    parentId: "parent",
    name: "午餐",
  };
  const preview = await handler.previewImport("owner", {
    ledgerId: "ledger",
    fileId: "cloud://env/imports/owner/bill.csv",
  });
  state.beforeTransaction = () => {
    state.categories.parent.deletionState = "deleting";
  };
  await assert.rejects(
    handler.importRecords("owner", {
      batchId: preview.batchId,
      selectedRows: [2],
      categoryChoices: { 2: "child" },
    }),
    /INVALID_RECORD_CATEGORY/
  );
  assert.equal(state.records.length, 0);
});

test("category recovery can begin safely before the first batch commits", async () => {
  const csv = [
    "交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号",
    "2026-01-01 12:00:00,商户消费,餐厅,午餐,支出,12.50,零钱,支付成功,transaction123",
  ].join("\n");
  const { handler, state } = importFixture(csv);
  const preview = await handler.previewImport("owner", {
    ledgerId: "ledger",
    fileId: "cloud://env/imports/owner/bill.csv",
  });
  const request = {
    batchId: preview.batchId,
    selectedRows: [2],
    categoryChoices: { 2: "deleted" },
  };
  const recovered = await handler.importRecords("owner", { ...request, recoverCategories: true });
  assert.equal(recovered.categoryChoices[2], "");
  const result = await handler.importRecords("owner", {
    ...request,
    categoryChoices: recovered.categoryChoices,
  });
  assert.equal(result.imported, 1);
  assert.equal(state.records[0].categoryId, "");
});

test("interrupted import can recover deleted categories without changing processed rows", async () => {
  const csv = [
    "交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号",
    ...Array.from(
      { length: 12 },
      (_, index) =>
        `2026-01-01 12:00:00,商户消费,餐厅,午餐,支出,12.50,零钱,支付成功,transaction${index}`
    ),
  ].join("\n");
  const { handler, state } = importFixture(csv);
  state.categories.parent = {
    _id: "parent",
    ledgerId: "ledger",
    type: "expense",
    level: "parent",
    name: "餐饮",
  };
  state.categories.child = {
    _id: "child",
    ledgerId: "ledger",
    type: "expense",
    level: "child",
    parentId: "parent",
    name: "午餐",
  };
  const preview = await handler.previewImport("owner", {
    ledgerId: "ledger",
    fileId: "cloud://env/imports/owner/bill.csv",
  });
  const selectedRows = Array.from({ length: 12 }, (_, index) => index + 2);
  const categoryChoices = Object.fromEntries(selectedRows.map((row) => [row, "child"]));
  const request = { batchId: preview.batchId, selectedRows, categoryChoices };
  const first = await handler.importRecords("owner", request);
  assert.equal(first.imported, 10);
  delete state.categories.child;
  await assert.rejects(handler.importRecords("owner", request), /INVALID_RECORD_CATEGORY/);
  const recovered = await handler.importRecords("owner", { ...request, recoverCategories: true });
  assert.equal(recovered.categoryChoices["2"], "child");
  assert.equal(recovered.categoryChoices["12"], "");
  const repeated = await handler.importRecords("owner", { ...request, recoverCategories: true });
  assert.equal(repeated.categoryChoices["12"], "");
  await assert.rejects(
    handler.importRecords("owner", request),
    /INVALID_RECORD_CATEGORY|IMPORT_SELECTION_CHANGED/
  );
  const finished = await handler.importRecords("owner", {
    ...request,
    categoryChoices: recovered.categoryChoices,
  });
  assert.equal(finished.imported, 12);
  assert.equal(state.records.length, 12);
  assert.equal(state.records[0].categoryId, "child");
  assert.equal(state.records[10].categoryId, "");
});

const entryCategories = [
  { _id: "food", type: "expense", level: "parent", name: "餐饮", icon: "restaurant-line" },
  {
    _id: "lunch",
    type: "expense",
    level: "child",
    parentId: "food",
    name: "午餐",
    icon: "restaurant-line",
  },
  { _id: "work", type: "income", level: "parent", name: "工作" },
  { _id: "salary", type: "income", level: "child", parentId: "work", name: "工资" },
];

function newEntryPage(listCategories = async () => entryCategories) {
  const calls = { writes: [], toasts: [], urls: [], unsubscribed: 0 };
  const page = load(
    "miniprogram/pages/record-edit/index.js",
    { globalData: { currentLedger: { _id: "owned", name: "个人账本", type: "personal" } } },
    { navigateTo: ({ url }) => calls.urls.push(url) },
    {
      "../../services/category.service": { listCategories },
      "../../services/category.store": {
        subscribeSync: (callback) => {
          calls.sync = callback;
          return () => calls.unsubscribed++;
        },
      },
      "../../services/record.service": {
        createRecord: async (payload) => calls.writes.push(payload),
      },
      "../../services/feedback-ui": { showToast: (value) => calls.toasts.push(value) },
    }
  );
  page.onLoad({ category: "伪造默认分类", categoryId: "lunch" });
  return { page, calls };
}

test("new entry requires an explicit inline category and type changes clear only category", async () => {
  const { page, calls } = newEntryPage();
  await page.onShow();
  assert.equal(page.data.categoryId, "");
  assert.equal(page.data.categoryName, "");
  page.setAmountExpression("36");
  page.setData({ note: "保留备注", tags: ["标签"], date: "2026-03-13", accountIndex: 1 });
  assert.equal(page.data.canSave, false);
  await page.saveAndContinue();
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.toasts[0].message, "请选择分类");
  page.chooseCategory({ detail: { categoryId: "lunch" } });
  assert.equal(calls.urls.length, 0);
  assert.equal(page.data.categoryName, "午餐");
  assert.equal(page.data.canSave, true);
  page.switchType({ currentTarget: { dataset: { type: "income" } } });
  assert.equal(page.data.categoryId, "");
  assert.equal(page.data.canSave, false);
  assert.equal(page.data.amount, "36");
  assert.equal(page.data.note, "保留备注");
  assert.equal(page.data.date, "2026-03-13");
  assert.equal(page.data.accountIndex, 1);
  page.chooseCategory({ detail: { categoryId: "lunch" } });
  assert.equal(page.data.categoryId, "");
  page.chooseCategory({ detail: { categoryId: "salary" } });
  await page.saveAndContinue();
  assert.equal(calls.writes[0].categoryId, "salary");
  assert.equal(calls.writes[0].type, "income");
  page.openCategoryManager();
  assert.match(calls.urls[0], /category-manage.*ledgerId=owned&type=income/);
  page.onHide();
  assert.equal(calls.unsubscribed, 1);
  await page.onShow();
  calls.sync({ ledgerId: "other", items: [] });
  assert.equal(page.data.categoryId, "salary");
  calls.sync({ ledgerId: "owned", items: entryCategories.filter((item) => item._id !== "salary") });
  assert.equal(page.data.categoryId, "");
  page.onUnload();
  assert.equal(calls.unsubscribed, 2);
});

test("inline categories distinguish loading, failure, retry and empty without enabling save", async () => {
  let reject = true;
  const { page, calls } = newEntryPage(async () => {
    if (reject) throw new Error("offline");
    return [];
  });
  assert.equal(page.data.categoryLoading, true);
  await page.onShow();
  assert.equal(page.data.categoryError, true);
  page.setAmountExpression("20");
  await page.saveAndContinue();
  assert.equal(calls.writes.length, 0);
  reject = false;
  await page.loadCategories();
  assert.equal(page.data.categoryError, false);
  assert.equal(page.data.categoryLoading, false);
  assert.equal(page.data.groups.length, 0);
  assert.equal(page.data.canSave, false);
});

for (const component of ["tl-tab-home", "tl-tab-records"]) {
  test(`${component} new entry keeps the viewed ledger and does not route through category`, () => {
    const urls = [];
    const view = load(
      `miniprogram/components/${component}/index.js`,
      { globalData: { currentLedger: { _id: "other" } } },
      { navigateTo: ({ url }) => urls.push(url) }
    );
    view.data.ledgerId = "viewed";
    view.data.readonly = false;
    view.goRecordEdit();
    assert.equal(urls[0], "/pages/record-edit/index?ledgerId=viewed");
  });
}
