// Settings 域：快捷金额与支付账户配置。
const {
  db,
  _,
  ok,
  fail,
  now,
  getLedgerForUser,
  getLedgerRole,
  assertWritable,
} = require("../shared/helpers");

function normalizeQuickAmounts(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 5) return null;
  const normalized = values.map((value) => Math.round(Number(value) * 100) / 100);
  if (normalized.some((value) => !Number.isFinite(value) || value <= 0 || value > 999999))
    return null;
  return normalized;
}

async function updateQuickAmounts(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  const role = getLedgerRole(openid, ledger);
  if (role === "readonly") throw new Error("READONLY_LEDGER");
  const quickAmountsEnabled = Boolean(data.quickAmountsEnabled);
  const quickAmounts = quickAmountsEnabled ? normalizeQuickAmounts(data.quickAmounts) : [];
  if (quickAmountsEnabled && !quickAmounts)
    return fail("快捷金额需设置 1-5 个有效金额", "INVALID_QUICK_AMOUNTS");
  const updatedLedger = await db.runTransaction(async (transaction) => {
    const ledgerRef = transaction.collection("ledgers").doc(ledger._id);
    const currentLedger = (await ledgerRef.get()).data;
    if (getLedgerRole(openid, currentLedger) === "readonly") throw new Error("READONLY_LEDGER");
    await ledgerRef.update({
      data: {
        quickAmountsEnabled,
        quickAmounts,
        syncRevision: _.inc(1),
        updatedAt: now(),
      },
    });
    return {
      ...currentLedger,
      quickAmountsEnabled,
      quickAmounts,
      syncRevision: Number(currentLedger.syncRevision || 0) + 1,
    };
  });
  return ok({ ledger: updatedLedger });
}

function normalizePaymentAccounts(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 12) return null;
  const accounts = values.map((value) => String(value || "").trim());
  if (accounts.some((value) => !value || Array.from(value).length > 12)) return null;
  return Array.from(new Set(accounts));
}

async function updateAccounts(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  const role = getLedgerRole(openid, ledger);
  assertWritable(role);
  const accounts = normalizePaymentAccounts(data.accounts);
  if (!accounts) return fail("支付账户需设置 1-12 个有效名称", "INVALID_PAYMENT_ACCOUNTS");
  const updatedLedger = await db.runTransaction(async (transaction) => {
    const ledgerRef = transaction.collection("ledgers").doc(ledger._id);
    const currentLedger = (await ledgerRef.get()).data;
    assertWritable(getLedgerRole(openid, currentLedger));
    await ledgerRef.update({
      data: {
        accounts,
        accountsConfigured: true,
        syncRevision: _.inc(1),
        updatedAt: now(),
      },
    });
    return {
      ...currentLedger,
      accounts,
      accountsConfigured: true,
      syncRevision: Number(currentLedger.syncRevision || 0) + 1,
    };
  });
  return ok({ ledger: updatedLedger });
}

module.exports = {
  updateQuickAmounts,
  updateAccounts,
};
