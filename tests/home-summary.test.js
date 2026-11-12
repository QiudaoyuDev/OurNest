const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const money = require("../miniprogram/utils/money");

test("home shows expense placeholders for empty and income-only months", () => {
  const context = {
    getApp: () => ({}),
    require: (name) => (name.endsWith("/money") ? money : {}),
    Component() {},
  };
  vm.runInNewContext(
    fs.readFileSync("miniprogram/components/tl-tab-home/index.js", "utf8"),
    context
  );
  for (const recordCount of [0, 2]) {
    const data = context.normalizeDashboard({
      recordCount,
      monthExpense: 0,
      topExpenseCategory: "其他",
      largestExpenseAmount: 0,
    });
    assert.equal(data.hasMonthExpense, false);
    assert.equal(data.topExpenseCategory, "-");
    assert.equal(data.largestExpenseCompact, "-");
  }
  const data = context.normalizeDashboard({
    recordCount: 3,
    monthExpense: 50,
    topExpenseCategory: "餐饮",
    largestExpenseAmount: 39,
  });
  assert.equal(data.hasMonthExpense, true);
  assert.equal(data.topExpenseCategory, "餐饮");
  assert.equal(data.largestExpenseCompact, "39");
});

test("home dashboard calculates budget remaining and progress correctly", () => {
  let capturedComponentDef;
  const context = {
    getApp: () => ({ globalData: {} }),
    require: (name) => (name.endsWith("/money") ? money : {}),
    Component(def) {
      capturedComponentDef = def;
    },
  };
  vm.runInNewContext(
    fs.readFileSync("miniprogram/components/tl-tab-home/index.js", "utf8"),
    context
  );

  // 1. 预算未超支
  const normal = context.normalizeDashboard({
    budget: 3000,
    budgetEnabled: true,
    monthExpense: 1200,
    budgetLeft: 1800,
    budgetRate: 40,
  });
  assert.equal(normal.budget, "3000");
  assert.equal(normal.budgetLeft, "1800");
  assert.equal(normal.budgetLeftAbs, "1800");
  assert.equal(normal.isOverBudget, false);
  assert.equal(normal.budgetRate, 40);
  assert.equal(normal.budgetRateText, "40.0");

  // 2. 预算超支
  const over = context.normalizeDashboard({
    budget: 2000,
    budgetEnabled: true,
    monthExpense: 2500,
    budgetLeft: -500,
    budgetRate: 125,
  });
  assert.equal(over.budget, "2000");
  assert.equal(over.budgetLeft, "-500");
  assert.equal(over.budgetLeftAbs, "500");
  assert.equal(over.isOverBudget, true);
  assert.equal(over.budgetRate, 125);
  assert.equal(over.budgetRateText, "125.0");

  // 3. 测试 applyBudgetUpdate
  let updatedData = {};
  const mockComponent = {
    data: {
      monthExpense: "1200",
    },
    setData(patch) {
      updatedData = { ...updatedData, ...patch };
    },
  };
  capturedComponentDef.methods.applyBudgetUpdate.call(mockComponent, {
    budgetEnabled: true,
    monthlyBudget: 2000,
  });
  assert.equal(updatedData.budget, "2000");
  assert.equal(updatedData.budgetLeft, "800");
  assert.equal(updatedData.budgetLeftAbs, "800");
  assert.equal(updatedData.budgetRate, 60);
  assert.equal(updatedData.budgetRateText, "60.0");
  assert.equal(updatedData.isOverBudget, false);
});
