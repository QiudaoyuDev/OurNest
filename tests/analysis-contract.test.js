const test = require("node:test");
const assert = require("node:assert/strict");
const { validateAnalysisResponse } = require("../miniprogram/services/analysis-contract");

function analysisResponse(overrides = {}) {
  return {
    ledger: { _id: "ledger", name: "测试账本", type: "personal" },
    range: { start: "2025-01-01", end: "2025-02-01" },
    overview: { income: 0, expense: 12.34, balance: -12.34, recordCount: 2 },
    dashboard: {
      type: "expense",
      total: 12.34,
      recordCount: 2,
      daily: [{ date: "2025-01-01", expense: 12.34 }],
      categories: [{ amount: 12.34 }],
      accounts: [{ amount: 12.34 }],
      topRecords: [],
    },
    ...overrides,
  };
}

test("analysis response contract accepts a conserving analysis view response", () => {
  const result = analysisResponse();
  assert.equal(
    validateAnalysisResponse(result, {
      ledgerId: "ledger",
      analysisView: true,
      analysisType: "expense",
    }),
    result
  );
});

test("analysis response contract rejects missing fields instead of treating them as zero", () => {
  const result = analysisResponse();
  delete result.dashboard.daily;
  assert.throws(
    () => validateAnalysisResponse(result, { analysisView: true, analysisType: "expense" }),
    (error) => error.code === "ANALYSIS_CONTRACT_INVALID" && error.path === "dashboard.daily"
  );
});

test("analysis response contract rejects mismatched context and non-conserving totals", () => {
  assert.throws(
    () =>
      validateAnalysisResponse(analysisResponse(), {
        ledgerId: "other-ledger",
        analysisView: true,
        analysisType: "expense",
      }),
    /ledger\._id/
  );
  const result = analysisResponse();
  result.dashboard.accounts[0].amount = 12.33;
  assert.throws(
    () => validateAnalysisResponse(result, { analysisView: true, analysisType: "expense" }),
    /dashboard\.accounts/
  );
});

test("analysis response contract preserves non-analysis responses with valid overview fields", () => {
  const result = analysisResponse();
  delete result.dashboard;
  assert.equal(validateAnalysisResponse(result, { ledgerId: "ledger" }), result);
});

test("analysis response contract accepts all-time mode with empty start and end dates", () => {
  const result = analysisResponse({
    range: { start: "", end: "", label: "全部时间" },
  });
  delete result.dashboard;
  assert.equal(validateAnalysisResponse(result, { ledgerId: "ledger", mode: "all" }), result);
});
