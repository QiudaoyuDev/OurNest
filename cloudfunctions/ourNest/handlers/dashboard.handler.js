// Dashboard 域：首页数据聚合——本月收支、预算、最近记录。
const {
  db,
  _,
  $,
  ok,
  getLedgerForUser,
  getLedgerRole,
  getRoleText,
  assertReadable,
  getUsersByOpenids,
  resolveUsersAvatarUrls,
  getCurrentMonthRange,
} = require("../shared/helpers");
const { attachRecordOwner } = require("./record.handler");
const { loadAllMonthRecords, summarizeDashboardRecords } = require("../dashboard.helpers");

async function getMonthRecords(query) {
  return loadAllMonthRecords(async (cursor, pageSize) => {
    const pageQuery = cursor
      ? _.and([
          query,
          _.or([
            { date: _.lt(cursor.date) },
            { date: cursor.date, createdAt: _.lt(cursor.createdAt) },
            {
              date: cursor.date,
              createdAt: cursor.createdAt,
              _id: _.lt(cursor._id),
            },
          ]),
        ])
      : query;
    const result = await db
      .collection("records")
      .where(pageQuery)
      .orderBy("date", "desc")
      .orderBy("createdAt", "desc")
      .orderBy("_id", "desc")
      .limit(pageSize)
      .get();
    return result.data || [];
  });
}

async function aggregateDashboard(query) {
  try {
    const summaryResult = await db
      .collection("records")
      .aggregate()
      .match(query)
      .group({
        _id: "$type",
        total: $.sum($.floor($.add([$.multiply(["$amount", 100]), 0.5]))),
        count: $.sum(1),
        maxAmount: $.max("$amount"),
      })
      .end();

    const summaryList = summaryResult.list || [];
    let income = 0;
    let expense = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    let largestExpense = 0;

    summaryList.forEach((item) => {
      if (item._id === "income") {
        income = Number(item.total || 0) / 100;
        incomeCount = Number(item.count || 0);
      }
      if (item._id === "expense") {
        expense = Number(item.total || 0) / 100;
        expenseCount = Number(item.count || 0);
        largestExpense = Number(item.maxAmount || 0);
      }
    });

    let topExpenseCategory = "其他";
    if (expenseCount > 0) {
      const topResult = await db
        .collection("records")
        .aggregate()
        .match({ ...query, type: "expense" })
        .group({
          _id: $.ifNull(["$parentCategory", $.ifNull(["$categoryName", "其他"])]),
          total: $.sum($.floor($.add([$.multiply(["$amount", 100]), 0.5]))),
        })
        .sort({ total: -1 })
        .limit(1)
        .end();

      const topItem = (topResult.list || [])[0];
      if (topItem && topItem._id) topExpenseCategory = String(topItem._id);
    }

    const recordCount = incomeCount + expenseCount;
    return {
      income,
      expense,
      balance: Number((income - expense).toFixed(2)),
      recordCount,
      topExpenseCategory,
      largestExpense,
      hasRecords: recordCount > 0,
    };
  } catch (error) {
    console.warn("dashboard aggregation fallback to memory scan", error);
    const monthRecords = await getMonthRecords(query);
    const monthSummary = summarizeDashboardRecords(monthRecords);
    return {
      ...monthSummary,
      hasRecords: monthRecords.length > 0,
    };
  }
}

async function getDashboard(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  if (!ledger) return ok({ noLedger: true, monthRange: getCurrentMonthRange() });
  const role = getLedgerRole(openid, ledger);
  assertReadable(role);

  const monthRange = getCurrentMonthRange();
  const query = { ledgerId: ledger._id, date: _.gte(monthRange.start).and(_.lt(monthRange.end)) };
  const [dashboardSummary, recentResult, totalRecordCountResult] = await Promise.all([
    aggregateDashboard(query),
    db
      .collection("records")
      .where({ ledgerId: ledger._id })
      .orderBy("date", "desc")
      .orderBy("createdAt", "desc")
      .orderBy("_id", "desc")
      .limit(10)
      .get(),
    db.collection("records").where({ ledgerId: ledger._id }).count(),
  ]);
  const latestRecords = recentResult.data || [];
  const ownerMap = await resolveUsersAvatarUrls(
    await getUsersByOpenids(latestRecords.map((item) => item.ownerOpenid))
  );
  const { income: monthIncome, expense: monthExpense } = dashboardSummary;
  const budgetEnabled = Boolean(ledger.budgetEnabled);
  const budget = budgetEnabled ? Number(ledger.monthlyBudget || 0) : 0;
  const budgetRate = budgetEnabled && budget ? (monthExpense / budget) * 100 : 0;

  return ok({
    ledgerId: ledger._id,
    ledgerName: ledger.name,
    ledgerType: ledger.type || "personal",
    role,
    roleText: getRoleText(role),
    readonly: role === "readonly",
    monthIncome,
    monthExpense,
    balance: dashboardSummary.balance,
    budget,
    budgetEnabled,
    quickAmountsEnabled: Boolean(ledger.quickAmountsEnabled),
    quickAmounts: Array.isArray(ledger.quickAmounts) ? ledger.quickAmounts : [],
    budgetLeft: budgetEnabled ? Number((budget - monthExpense).toFixed(2)) : 0,
    budgetRate,
    recordCount: dashboardSummary.recordCount,
    totalRecordCount: totalRecordCountResult.total || 0,
    topExpenseCategory: dashboardSummary.topExpenseCategory,
    largestExpenseAmount: dashboardSummary.largestExpense,
    familyMood: dashboardSummary.hasRecords ? "本月记录持续更新" : "本月还没有记录",
    monthRange,
    recentRecords: latestRecords.map((item) => attachRecordOwner(item, ownerMap, openid)),
  });
}

module.exports = {
  getDashboard,
};
