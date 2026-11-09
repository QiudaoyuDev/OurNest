const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Module = require("node:module");

const helpersPath = require.resolve("../cloudfunctions/ourNest/shared/helpers");
const ledgerHandlerPath = require.resolve("../cloudfunctions/ourNest/handlers/ledger.handler");

function makeDb({ ledger, transactionLedger = ledger, user = null, listedLedgers = [] } = {}) {
  let currentLedger = ledger;
  let txLedger = transactionLedger;
  let transactionCount = 0;
  let transactionUpdateCount = 0;
  let normalLedgerReads = 0;

  function collection(name) {
    return {
      doc(id) {
        return {
          async get() {
            if (name !== "ledgers") return { data: null };
            normalLedgerReads += 1;
            return { data: currentLedger && currentLedger._id === id ? currentLedger : null };
          },
          async update({ data }) {
            if (name === "ledgers" && currentLedger) {
              currentLedger = { ...currentLedger, ...data };
            }
          },
        };
      },
      where() {
        const query = {
          limit() {
            return query;
          },
          field() {
            return query;
          },
          async get() {
            if (name === "users") return { data: user ? [user] : [] };
            if (name === "ledgers") return { data: listedLedgers };
            return { data: [] };
          },
        };
        return query;
      },
    };
  }

  const db = {
    command: { aggregate: {}, or: (...values) => values },
    serverDate: () => new Date("2025-01-01T00:00:00.000Z"),
    collection,
    async runTransaction(callback) {
      transactionCount += 1;
      const transaction = {
        collection(name) {
          const base = collection(name);
          return {
            ...base,
            doc(id) {
              const ref = base.doc(id);
              return {
                ...ref,
                async get() {
                  return {
                    data: name === "ledgers" && txLedger && txLedger._id === id ? txLedger : null,
                  };
                },
                async update({ data }) {
                  transactionUpdateCount += 1;
                  if (name === "ledgers" && txLedger) txLedger = { ...txLedger, ...data };
                },
              };
            },
          };
        },
      };
      return callback(transaction);
    },
  };
  return {
    db,
    stats: {
      get transactionCount() {
        return transactionCount;
      },
      get transactionUpdateCount() {
        return transactionUpdateCount;
      },
      get normalLedgerReads() {
        return normalLedgerReads;
      },
      get currentLedger() {
        return currentLedger;
      },
    },
  };
}

function loadHelpers(db) {
  const originalLoad = Module._load;
  delete require.cache[helpersPath];
  Module._load = function load(request, parent, isMain) {
    if (request === "wx-server-sdk") {
      return {
        DYNAMIC_CURRENT_ENV: "test",
        init() {},
        database: () => db,
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(helpersPath);
  } finally {
    Module._load = originalLoad;
  }
}

test("initialized ledger reads avoid transactions", async () => {
  const { db, stats } = makeDb({
    ledger: { _id: "ledger-1", ownerOpenid: "user-1", syncRevision: 4 },
  });
  const helpers = loadHelpers(db);

  const result = await helpers.getLedgerForUser("user-1", "ledger-1");
  assert.equal(result.syncRevision, 4);
  assert.equal(stats.normalLedgerReads, 1);
  assert.equal(stats.transactionCount, 0);
});

test("authorized legacy ledger initializes its revision once", async () => {
  const { db, stats } = makeDb({
    ledger: { _id: "legacy", ownerOpenid: "user-1" },
    transactionLedger: { _id: "legacy", ownerOpenid: "user-1" },
  });
  const helpers = loadHelpers(db);

  const result = await helpers.getLedgerForUser("user-1", "legacy");
  assert.equal(result.syncRevision, 1);
  assert.equal(stats.transactionCount, 1);
  assert.equal(stats.transactionUpdateCount, 1);
});

test("legacy initialization does not overwrite a concurrent revision", async () => {
  const { db, stats } = makeDb({
    ledger: { _id: "legacy", ownerOpenid: "user-1" },
    transactionLedger: { _id: "legacy", ownerOpenid: "user-1", syncRevision: 9 },
  });
  const helpers = loadHelpers(db);

  const result = await helpers.getLedgerForUser("user-1", "legacy");
  assert.equal(result.syncRevision, 9);
  assert.equal(stats.transactionCount, 1);
  assert.equal(stats.transactionUpdateCount, 0);
});

test("invalid revisions are rejected without a transaction", async () => {
  const { db, stats } = makeDb({
    ledger: { _id: "ledger-1", ownerOpenid: "user-1", syncRevision: 0 },
  });
  const helpers = loadHelpers(db);

  await assert.rejects(
    helpers.getLedgerForUser("user-1", "ledger-1"),
    (error) => error.code === "INVALID_LEDGER_REVISION"
  );
  assert.equal(stats.transactionCount, 0);
});

test("legacy initialization rechecks permission inside its transaction", async () => {
  const { db, stats } = makeDb({
    ledger: { _id: "legacy", ownerOpenid: "user-1" },
    transactionLedger: { _id: "legacy", ownerOpenid: "other-user" },
  });
  const helpers = loadHelpers(db);

  await assert.rejects(helpers.getLedgerForUser("user-1", "legacy"), /NO_LEDGER_ACCESS/);
  assert.equal(stats.transactionCount, 1);
  assert.equal(stats.transactionUpdateCount, 0);
});

test("ledger sync still checks revisions through the ledger handler", async () => {
  const { db, stats } = makeDb({
    listedLedgers: [{ _id: "ledger-1" }],
    transactionLedger: { _id: "ledger-1", ownerOpenid: "user-1", syncRevision: 2 },
    user: { _id: "user-doc", openid: "user-1", currentLedgerId: "ledger-1" },
  });
  const helpers = loadHelpers(db);
  delete require.cache[ledgerHandlerPath];
  const originalHelpers = require.cache[helpersPath];
  // ledger.handler destructures the already loaded helper module, so this also
  // verifies the production sync path rather than a duplicate test helper.
  assert.equal(originalHelpers.exports, helpers);
  const handler = require(ledgerHandlerPath);

  const result = await handler.syncLedgers("user-1", { revisions: { "ledger-1": 2 } });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.revisions, { "ledger-1": 2 });
  assert.equal(result.data.changed, false);
  assert.equal(stats.transactionCount, 1);
});

test("cloud wrapper preserves a ledger sync authorization failure", async () => {
  const source = fs.readFileSync("cloudfunctions/ourNest/index.js", "utf8");
  const failure = (code, message) => ({ ok: false, error: { code, message } });
  const modules = {
    "wx-server-sdk": {
      DYNAMIC_CURRENT_ENV: "test",
      init() {},
      database: () => ({ collection: () => ({ add: async () => ({}) }) }),
      getWXContext: () => ({ OPENID: "user-1" }),
    },
    "./shared/response": { success: (data) => ({ ok: true, data }), failure },
    "./shared/errors": { toFailure: (error) => ({ code: error.code, message: error.message }) },
    "./validators/schemas": { assertObject() {} },
    "./actions/feedback": {
      create: async () => ({ success: true }),
      list: async () => ({ success: true }),
    },
  };
  for (const name of ["auth", "record", "category", "dashboard", "analysis", "budget", "settings"])
    modules[`./handlers/${name}.handler`] = {};
  modules["./handlers/ledger.handler"] = {
    syncLedgers: async () => {
      throw Object.assign(new Error("NO_LEDGER_ACCESS"), { code: "NO_LEDGER_ACCESS" });
    },
  };
  const context = {
    require: (name) => modules[name],
    exports: {},
    console: { info() {}, warn() {}, error() {} },
    Date,
    Math,
  };
  vm.runInNewContext(source, context);

  const result = await context.exports.main({ route: "ledger/sync", payload: {} });
  assert.deepEqual(result, {
    ok: false,
    error: { code: "NO_LEDGER_ACCESS", message: "NO_LEDGER_ACCESS" },
  });
});
