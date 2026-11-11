const { assertLedgerActive } = require("../shared/ledger-state");
// Budget 域：账本月度预算设置（Owner 专属）。
const { db, _, ok, now, getLedgerForUser, getLedgerRole } = require("../shared/helpers");
const { assertBudgetInput } = require("../validators/schemas");

async function updateBudget(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  const role = getLedgerRole(openid, ledger);
  if (role !== "owner") throw new Error("ONLY_OWNER_CAN_UPDATE_BUDGET");

  const { enabled: budgetEnabled, monthlyBudget } = assertBudgetInput({
    budgetEnabled: data.budgetEnabled,
    monthlyBudget: data.monthlyBudget,
  });

  const updatedLedger = await db.runTransaction(async (transaction) => {
    const ledgerRef = transaction.collection("ledgers").doc(ledger._id);
    const currentLedger = (await ledgerRef.get()).data;
    assertLedgerActive(currentLedger);
    if (getLedgerRole(openid, currentLedger) !== "owner")
      throw new Error("ONLY_OWNER_CAN_UPDATE_BUDGET");
    await ledgerRef.update({
      data: { budgetEnabled, monthlyBudget, syncRevision: _.inc(1), updatedAt: now() },
    });
    return {
      ...currentLedger,
      budgetEnabled,
      monthlyBudget,
      syncRevision: Number(currentLedger.syncRevision || 0) + 1,
    };
  });
  return ok({ ledger: updatedLedger });
}

module.exports = { updateBudget };
