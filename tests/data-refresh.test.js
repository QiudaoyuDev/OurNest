const test = require("node:test");
const assert = require("node:assert/strict");
const dataRefresh = require("../miniprogram/services/data-refresh.service");

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
