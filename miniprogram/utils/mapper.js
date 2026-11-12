function getId(item = {}) {
  return item._id || item.id || "";
}

function getLedgerRole(openid, ledger = {}) {
  if (!ledger) return "member";
  if (ledger.role === "owner") return "owner";
  if (openid && ledger.ownerOpenid === openid) return "owner";
  if (
    openid &&
    Array.isArray(ledger.members) &&
    ledger.members.some((m) => m && m.openid === openid && m.role === "owner")
  ) {
    return "owner";
  }
  if (
    ledger.type === "personal" &&
    (!Array.isArray(ledger.memberOpenids) || ledger.memberOpenids.length === 0) &&
    (!Array.isArray(ledger.viewerOpenids) || ledger.viewerOpenids.length === 0)
  ) {
    if (ledger.role === "readonly" || ledger.readonly) return "readonly";
    return "owner";
  }
  if (
    ledger.role === "readonly" ||
    ledger.readonly ||
    (openid && (ledger.viewerOpenids || []).includes(openid)) ||
    (openid &&
      Array.isArray(ledger.members) &&
      ledger.members.some((m) => m && m.openid === openid && m.role === "readonly"))
  ) {
    return "readonly";
  }
  return "member";
}

function normalizeLedger(item = {}, openid = "") {
  const role = getLedgerRole(openid, item);
  return {
    ...item,
    id: getId(item),
    role,
    readonly: role === "readonly",
    memberCount: Array.isArray(item.memberOpenids) ? item.memberOpenids.length : 0,
    visitorCount: Array.isArray(item.viewerOpenids) ? item.viewerOpenids.length : 0,
  };
}

module.exports = { getId, getLedgerRole, normalizeLedger };
