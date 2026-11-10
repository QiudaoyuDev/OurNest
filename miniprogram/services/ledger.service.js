const { callApi } = require("./api");

const createLedger = (data) => callApi("ledger/create", data);
const updateLedger = (data) => callApi("ledger/update", data);
const listLedgers = () => callApi("ledger/list");
const syncLedgers = (revisions) => callApi("ledger/sync", { revisions });
const setCurrentLedger = (ledgerId) => callApi("ledger/current/set", { ledgerId });
const deleteLedger = (ledgerId) => callApi("ledger/delete", { ledgerId });
const getLedgerMembers = (ledgerId) => callApi("ledger/members/get", { ledgerId });
const removeLedgerMember = (targetOpenid, ledgerId) =>
  callApi("ledger/members/remove", { targetOpenid, ledgerId });
const getDashboard = (ledgerId) => callApi("ledger/dashboard/get", { ledgerId });
const getAnalysis = (data) => callApi("ledger/analysis/get", data);
const updateBudget = (data) => callApi("ledger/budget/update", data);
const updateQuickAmounts = (data) => callApi("ledger/quick-amounts/update", data);
const updateAccounts = (data) => callApi("ledger/accounts/update", data);
const createLedgerInviteToken = (data) => callApi("invite/create", data);
const previewLedgerInvite = (inviteCode) => callApi("invite/preview", { inviteCode });
const joinLedgerByInviteToken = (inviteToken) => callApi("invite/join-token", { inviteToken });
const listLedgerInvites = (ledgerId) => callApi("invite/list", { ledgerId });
const revokeLedgerInvite = (ledgerId, inviteId) => callApi("invite/revoke", { ledgerId, inviteId });
const leaveLedger = (ledgerId) => callApi("ledger/members/leave", { ledgerId });
const changeLedgerMemberRole = (ledgerId, targetOpenid, role) =>
  callApi("ledger/members/role", { ledgerId, targetOpenid, role });
const requestOwnerTransfer = (ledgerId, targetOpenid) =>
  callApi("ledger/owner-transfer/request", { ledgerId, targetOpenid });
const acceptOwnerTransfer = (ledgerId) => callApi("ledger/owner-transfer/accept", { ledgerId });
const cancelOwnerTransfer = (ledgerId) => callApi("ledger/owner-transfer/cancel", { ledgerId });

module.exports = {
  createLedger,
  updateLedger,
  listLedgers,
  syncLedgers,
  setCurrentLedger,
  deleteLedger,
  getLedgerMembers,
  removeLedgerMember,
  getDashboard,
  getAnalysis,
  updateBudget,
  updateQuickAmounts,
  updateAccounts,
  createLedgerInviteToken,
  previewLedgerInvite,
  joinLedgerByInviteToken,
  listLedgerInvites,
  revokeLedgerInvite,
  leaveLedger,
  changeLedgerMemberRole,
  requestOwnerTransfer,
  acceptOwnerTransfer,
  cancelOwnerTransfer,
};
