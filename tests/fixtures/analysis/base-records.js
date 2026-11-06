const CENTS_PER_YUAN = 100;

function toCents(amount) {
  return Math.round(Number(amount) * CENTS_PER_YUAN);
}

function fromCents(cents) {
  return cents / CENTS_PER_YUAN;
}

function makeRecord(index, overrides = {}) {
  const day = String((index % 28) + 1).padStart(2, "0");
  const type = index % 3 === 0 ? "income" : "expense";
  return {
    _id: `fixture-${String(index + 1).padStart(5, "0")}`,
    ledgerId: "analysis-fixture-ledger",
    date: `2025-${String((index % 6) + 1).padStart(2, "0")}-${day}`,
    type,
    amount: fromCents(101 + index * 17),
    categoryId: type === "income" ? "salary" : `expense-${index % 7}`,
    categoryName: type === "income" ? "工资" : `支出分类${index % 7}`,
    categoryIcon: type === "income" ? "funds-line" : "shopping-bag-3-line",
    account: index % 4 === 0 ? "" : "微信",
    ownerOpenid: index % 2 === 0 ? "fixture-owner" : "fixture-member",
    familyAttribution: {
      payerOpenid: index % 2 === 0 ? "fixture-owner" : "fixture-member",
      consumerKind: index % 5 === 0 ? "public" : "personal",
      consumerOpenid: index % 5 === 0 ? "" : "fixture-owner",
    },
    note: `fixture note ${index + 1}`,
    ...overrides,
  };
}

function makeRecords(count, overrides = {}) {
  if (!Number.isInteger(count) || count < 0) throw new Error("FIXTURE_COUNT_INVALID");
  return Array.from({ length: count }, (_, index) => makeRecord(index, overrides));
}

function oracleSummary(records, type = "all", range = {}) {
  const totals = { income: 0, expense: 0, recordCount: 0 };
  const start = range.start || "";
  const end = range.end || "";
  for (const record of records) {
    if (start && record.date < start) continue;
    if (end && record.date >= end) continue;
    if (type !== "all" && record.type !== type) continue;
    totals[record.type] += toCents(record.amount);
    totals.recordCount += 1;
  }
  return {
    income: fromCents(totals.income),
    expense: fromCents(totals.expense),
    balance: fromCents(totals.income - totals.expense),
    recordCount: totals.recordCount,
  };
}

module.exports = { makeRecord, makeRecords, oracleSummary, toCents };
