const test = require("node:test");
const assert = require("node:assert/strict");
const {
  makeRecord,
  makeRecords,
  oracleSummary,
  toCents,
} = require("./fixtures/analysis/base-records");

test("analysis fixture covers the planned count boundaries with stable identities", () => {
  for (const count of [0, 1, 30, 50, 99, 100, 101, 500, 1000, 5000, 20000]) {
    const records = makeRecords(count);
    assert.equal(records.length, count);
    assert.equal(new Set(records.map((record) => record._id)).size, count);
    assert.ok(records.every((record) => record.ledgerId === "analysis-fixture-ledger"));
  }
});

test("analysis fixture oracle sums exact cents without production helpers", () => {
  const records = [
    makeRecord(0, { date: "2025-02-28", type: "expense", amount: 0.1 }),
    makeRecord(1, { date: "2025-02-29", type: "expense", amount: 0.2 }),
    makeRecord(2, { date: "2025-03-01", type: "income", amount: 25 }),
  ];
  assert.deepEqual(oracleSummary(records), {
    income: 25,
    expense: 0.3,
    balance: 24.7,
    recordCount: 3,
  });
  assert.deepEqual(oracleSummary(records, "expense", { start: "2025-02-01", end: "2025-03-01" }), {
    income: 0,
    expense: 0.3,
    balance: -0.3,
    recordCount: 2,
  });
  assert.equal(toCents(0.1) + toCents(0.2), 30);
});

test("analysis fixture rejects invalid generation counts", () => {
  assert.throws(() => makeRecords(-1), /FIXTURE_COUNT_INVALID/);
  assert.throws(() => makeRecords(1.5), /FIXTURE_COUNT_INVALID/);
});
