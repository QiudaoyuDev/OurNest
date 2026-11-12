const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function setup() {
  const ledger = {
    _id: "l",
    type: "shared",
    ownerOpenid: "owner",
    memberOpenids: ["member"],
    viewerOpenids: ["viewer"],
    syncRevision: 1,
  };
  const records = {};
  let transactionHook = () => {};
  const role = (id, l) =>
    !l
      ? "none"
      : l.ownerOpenid === id
        ? "owner"
        : l.memberOpenids.includes(id)
          ? "member"
          : l.viewerOpenids.includes(id)
            ? "readonly"
            : "none";
  const collection = (name) => ({
    doc: (id) => ({
      get: async () => ({ data: name === "ledgers" ? ledger : records[id] }),
      update: async ({ data }) => {
        Object.assign(name === "ledgers" ? ledger : records[id], data);
      },
    }),
    add: async ({ data }) => {
      records.r = { ...data, _id: "r" };
      return { _id: "r" };
    },
  });
  const db = {
    collection,
    runTransaction: async (fn) => {
      transactionHook();
      return fn({ collection });
    },
  };
  const helpers = {
    db,
    _: { inc: () => 2 },
    $: {},
    ok: (data) => ({ ok: true, data }),
    fail: (message, code) => ({ ok: false, message, code }),
    now: () => 1,
    getLedgerForUser: async (id) => {
      if (role(id, ledger) === "none") throw Error("NO_LEDGER_ACCESS");
      return ledger;
    },
    getLedgerRole: role,
    assertWritable: (r) => {
      if (!["owner", "member"].includes(r)) throw Error("READONLY_LEDGER");
    },
    assertReadable: (r) => {
      if (r === "none") throw Error("NO_LEDGER_ACCESS");
    },
    getRoleText: (r) => r,
    getRecordById: async (id) => records[id],
    getCategoryById: async () => null,
    getUsersByOpenids: async (ids) =>
      Object.fromEntries(
        ids.filter((id) => id === "member").map((id) => [id, { nickName: "成员名" }])
      ),
    resolveUsersAvatarUrls: async (users) => users,
    defaultAvatarUrl: "avatar",
    SCHEMA_VERSION: 1,
  };
  const path = require.resolve("../cloudfunctions/ourNest/handlers/record.handler.js");
  const realRequire = createRequire(path);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path, "utf8"), {
    module,
    require: (name) =>
      name === "wx-server-sdk" ? {} : name === "../shared/helpers" ? helpers : realRequire(name),
    Buffer,
    Date,
    console,
  });
  return {
    handler: module.exports,
    ledger,
    records,
    hook: (fn) => {
      transactionHook = fn;
    },
  };
}

const payload = { ledgerId: "l", type: "income", amount: 10 };

test("income owner is explicit, validated, and rechecked in transaction", async () => {
  const s = setup();
  let result = await s.handler.createRecord("owner", payload);
  assert.equal(result.data.record.incomeOwnerOpenid, "");
  result = await s.handler.createRecord("owner", { ...payload, incomeOwnerOpenid: "member" });
  assert.equal(result.data.record.incomeOwnerOpenid, "member");
  for (const id of ["viewer", "stranger", 123])
    await assert.rejects(
      s.handler.createRecord("owner", { ...payload, incomeOwnerOpenid: id }),
      /INVALID_INCOME_OWNER/
    );
  await assert.rejects(s.handler.createRecord("viewer", payload), /READONLY_LEDGER/);
  await assert.rejects(
    s.handler.createRecord("owner", { ...payload, type: "expense", incomeOwnerOpenid: "member" }),
    /INVALID_INCOME_OWNER/
  );
  s.hook(() => {
    s.ledger.memberOpenids = [];
  });
  await assert.rejects(
    s.handler.createRecord("owner", { ...payload, incomeOwnerOpenid: "member" }),
    /INVALID_INCOME_OWNER/
  );
});

test("updates preserve historical owner, clear on type change, and respect permissions", async () => {
  const s = setup();
  await s.handler.createRecord("owner", { ...payload, incomeOwnerOpenid: "member" });
  s.ledger.memberOpenids = [];
  await s.handler.updateRecord("owner", { ...payload, recordId: "r", syncVersion: 1 });
  assert.equal(s.records.r.incomeOwnerOpenid, "member");
  await s.handler.updateRecord("owner", {
    ...payload,
    recordId: "r",
    syncVersion: 2,
    incomeOwnerOpenid: "member",
  });
  assert.equal(s.records.r.incomeOwnerOpenid, "member");
  await assert.rejects(
    s.handler.updateRecord("owner", {
      ...payload,
      recordId: "r",
      syncVersion: 2,
      incomeOwnerOpenid: "other",
    }),
    /INVALID_INCOME_OWNER/
  );
  await s.handler.updateRecord("owner", {
    ...payload,
    type: "expense",
    recordId: "r",
    syncVersion: 2,
  });
  assert.equal(s.records.r.incomeOwnerOpenid, "");
});

test("update rechecks membership in transaction and personal ledgers reject attribution", async () => {
  const s = setup();
  await s.handler.createRecord("owner", payload);
  s.hook(() => {
    s.ledger.memberOpenids = [];
  });
  await assert.rejects(
    s.handler.updateRecord("owner", {
      ...payload,
      recordId: "r",
      syncVersion: 1,
      incomeOwnerOpenid: "member",
    }),
    /INVALID_INCOME_OWNER/
  );
  assert.equal(s.records.r.incomeOwnerOpenid, "");
  s.hook(() => {});
  s.ledger.type = "personal";
  await assert.rejects(
    s.handler.createRecord("owner", { ...payload, incomeOwnerOpenid: "owner" }),
    /INVALID_INCOME_OWNER/
  );
});

test("detail distinguishes unknown, historical and named members", async () => {
  const s = setup();
  await s.handler.createRecord("owner", payload);
  assert.equal(
    (await s.handler.getRecord("owner", { recordId: "r" })).data.record.incomeOwnerName,
    "未指定"
  );
  s.records.r.incomeOwnerOpenid = "member";
  assert.equal(
    (await s.handler.getRecord("owner", { recordId: "r" })).data.record.incomeOwnerName,
    "成员名"
  );
  s.records.r.incomeOwnerOpenid = "departed";
  assert.equal(
    (await s.handler.getRecord("owner", { recordId: "r" })).data.record.incomeOwnerName,
    "历史成员"
  );
  delete s.records.r.incomeOwnerOpenid;
  assert.equal(
    (await s.handler.getRecord("owner", { recordId: "r" })).data.record.incomeOwnerOpenid,
    ""
  );
});
