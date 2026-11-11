const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const vm = require("node:vm");

test("quick amounts recheck write permission after membership changes", async () => {
  let writes = 0;
  const current = { ownerOpenid: "owner", memberOpenids: [] };
  const helpers = {
    db: {
      runTransaction: async (fn) =>
        fn({
          collection: () => ({
            doc: () => ({
              get: async () => ({ data: current }),
              update: async () => {
                writes += 1;
              },
            }),
          }),
        }),
    },
    _: { inc: () => 1 },
    ok: (data) => data,
    now: () => 0,
    getLedgerForUser: async () => ({
      _id: "ledger",
      ownerOpenid: "owner",
      memberOpenids: ["member"],
    }),
    getLedgerRole: (id, ledger) =>
      id === ledger.ownerOpenid ? "owner" : ledger.memberOpenids.includes(id) ? "member" : "none",
    assertWritable: (role) => {
      if (!["owner", "member"].includes(role)) throw new Error("READONLY_LEDGER");
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync("cloudfunctions/ourNest/handlers/settings.handler.js", "utf8"),
    {
      module,
      require: (name) =>
        name.includes("ledger-state")
          ? require("../cloudfunctions/ourNest/shared/ledger-state")
          : helpers,
    }
  );
  await assert.rejects(
    module.exports.updateQuickAmounts("member", { quickAmountsEnabled: true, quickAmounts: [10] }),
    /READONLY_LEDGER/
  );
  assert.equal(writes, 0);
});

test("record dates are natural calendar dates and budgets have one shared contract", () => {
  const {
    assertRecordPayload,
    assertBudgetInput,
  } = require("../cloudfunctions/ourNest/validators/schemas");
  const record = { type: "expense", amount: 1.23 };
  for (const date of ["2025-02-29", "2026-13-40", "2024-04-31"]) {
    assert.throws(() => assertRecordPayload({ ...record, date }), /INVALID_RECORD_DATE/);
  }
  assert.doesNotThrow(() => assertRecordPayload({ ...record, date: "2024-02-29" }));
  assert.throws(() => assertBudgetInput({ budgetEnabled: true, monthlyBudget: "bad" }));
  assert.throws(() => assertBudgetInput({ budgetEnabled: true, monthlyBudget: 1000000 }));
  assert.equal(
    assertBudgetInput({ budgetEnabled: true, monthlyBudget: 20.129 }).monthlyBudget,
    20.13
  );
});

test("cloud helpers keep database primitives available to login handlers", () => {
  const originalLoad = Module._load;
  const command = { aggregate: {} };
  const db = { command, collection: () => ({}) };
  let initCount = 0;
  Module._load = function load(request, parent, isMain) {
    if (request === "wx-server-sdk") {
      return {
        DYNAMIC_CURRENT_ENV: "test",
        init: () => {
          initCount += 1;
        },
        database: () => db,
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let helpers;
  try {
    helpers = require("../cloudfunctions/ourNest/shared/helpers");
  } finally {
    Module._load = originalLoad;
  }

  assert.equal(helpers.db, db);
  assert.equal(helpers._, command);
  assert.equal(helpers.$, command.aggregate);
  assert.equal(typeof helpers.getUser, "function");
  assert.equal(initCount, 1);
});
