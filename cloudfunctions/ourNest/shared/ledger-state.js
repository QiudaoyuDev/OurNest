function assertLedgerActive(ledger) {
  if (!ledger) throw new Error("LEDGER_NOT_FOUND");
  if (ledger.deletionState === "deleting") {
    const error = new Error("账本正在删除，请稍后重试");
    error.code = "LEDGER_DELETION_IN_PROGRESS";
    throw error;
  }
}

module.exports = { assertLedgerActive };
