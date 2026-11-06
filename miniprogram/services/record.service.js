const { callApi } = require("./api");
const ledgerStore = require("./ledger.store");
const dataRefresh = require("./data-refresh.service");
const { emit } = require("../utils/event-bus");

async function mutateRecord(route, payload) {
  const result = await callApi(route, payload);
  const mutationId = `record_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ledgerId = String(result.ledgerId || "");
  // The current cloud contract does not return an authoritative ledger ID for every mutation.
  // An empty scope deliberately invalidates all mounted views instead of trusting client payload.
  const invalidation = { ledgerId, mutationId, source: "record-mutation" };
  dataRefresh.invalidate(invalidation);
  emit("records:changed", invalidation);
  try {
    await ledgerStore.syncLedgers({ force: true, mutationId });
  } catch (error) {
    ledgerStore.markSyncRequired();
    console.warn("record mutation succeeded but synchronization failed", route, error);
  }
  return result;
}

const createRecord = (data) => mutateRecord("record/create", data);
const getRecord = (recordId) => callApi("record/get", { recordId });
const listRecords = (data) => callApi("record/list", data);
const updateRecord = (data) => mutateRecord("record/update", data);
const deleteRecord = (data) =>
  mutateRecord("record/delete", typeof data === "string" ? { recordId: data } : data);
const importRecords = (data) => mutateRecord("record/import", data);
const previewImport = (data) => callApi("record/import/preview", data);
const createImportUpload = (data) => callApi("record/import/upload-ticket", data);
const abandonImportUpload = (data) => callApi("record/import/upload-abandon", data);
const cancelImportPreview = (data) => callApi("record/import/cancel", data);
const retryImportFileCleanup = (data) => callApi("record/import/cleanup", data);
const sweepImportFileCleanup = (data) => callApi("record/import/cleanup/sweep", data);
const listImportPreviews = (data) => callApi("record/import/previews", data);
const getImportTemplate = () => callApi("record/import/template");

module.exports = {
  createRecord,
  getRecord,
  listRecords,
  updateRecord,
  deleteRecord,
  importRecords,
  previewImport,
  createImportUpload,
  abandonImportUpload,
  cancelImportPreview,
  retryImportFileCleanup,
  sweepImportFileCleanup,
  listImportPreviews,
  getImportTemplate,
};
