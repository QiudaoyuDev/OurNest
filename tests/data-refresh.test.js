const test = require("node:test");
const assert = require("node:assert/strict");
const dataRefresh = require("../miniprogram/services/data-refresh.service");
const fs = require("node:fs");
const vm = require("node:vm");

test("returning to the profile tab reads the updated user state", () => {
  let page;
  let refreshed = 0;
  const app = { globalData: { currentLedger: null } };
  vm.runInNewContext(fs.readFileSync("miniprogram/pages/index/index.js", "utf8"), {
    Page: (value) => {
      page = value;
    },
    getApp: () => app,
    require: (name) => (name.includes("ledger.store") ? { syncLedgers: async () => ({}) } : {}),
    console,
  });
  const context = {
    data: { activeTab: "profile", recordDisabledReason: "noLedger" },
    setData() {},
    syncRecordAccess() {},
    selectComponent: (id) =>
      id === "#tab-profile"
        ? {
            syncAuthState: () => {
              refreshed += 1;
            },
          }
        : null,
  };
  page.onShow.call(context);
  assert.equal(refreshed, 1);
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

test("data refresh coalesces invalidations for the same ledger", async () => {
  dataRefresh.clear();
  const events = [];
  const unsubscribe = dataRefresh.subscribe((event) => events.push(event));
  dataRefresh.invalidate({ ledgerId: "ledger", source: "record" });
  dataRefresh.invalidate({ ledgerId: "ledger", removedLedgerIds: ["removed"], source: "sync" });
  await flush();
  unsubscribe();
  assert.deepEqual(events, [
    {
      ledgerIds: ["ledger"],
      removedLedgerIds: ["removed"],
      source: "record,sync",
      mutationId: "",
      manual: false,
    },
  ]);
});

test("data refresh drops a later sync echo for an already delivered mutation", async () => {
  dataRefresh.clear();
  const events = [];
  const unsubscribe = dataRefresh.subscribe((event) => events.push(event));
  dataRefresh.invalidate({ ledgerId: "ledger", mutationId: "mutation", source: "record" });
  await flush();
  dataRefresh.invalidate({ ledgerId: "ledger", mutationId: "mutation", source: "ledger-sync" });
  await flush();
  unsubscribe();
  assert.equal(events.length, 1);
  assert.equal(events[0].source, "record");
});

test("manual sync invalidates all mounted views even without revision changes", async () => {
  dataRefresh.clear();
  const events = [];
  const unsubscribe = dataRefresh.subscribe((event) => events.push(event));
  dataRefresh.invalidate({ source: "manual-sync", manual: true });
  await flush();
  unsubscribe();
  assert.deepEqual(events[0].ledgerIds, []);
  assert.equal(events[0].manual, true);
});
