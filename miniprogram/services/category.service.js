const { callApi } = require("./api");
const ledgerStore = require("./ledger.store");
const categoryStore = require("./category.store");
const dataRefresh = require("./data-refresh.service");
const { emit } = require("../utils/event-bus");

// 有效缓存立即返回；冷启动、过期或失效时等待云端分类。
const listCategories = (ledgerId) => categoryStore.getCategories(ledgerId);
const getCategoryRole = (ledgerId) => categoryStore.getCategoryRole(ledgerId);

async function mutateCategory(route, payload) {
  const result = await callApi(route, payload);
  categoryStore.invalidate(payload.ledgerId);
  const mutationId = `category_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ledgerId = String(result.ledgerId || "");
  const invalidation = { ledgerId, mutationId, source: "category-mutation" };
  dataRefresh.invalidate(invalidation);
  emit("records:changed", invalidation);
  try {
    await ledgerStore.syncLedgers({ force: true, mutationId });
  } catch (error) {
    ledgerStore.markSyncRequired();
    console.warn("category mutation succeeded but synchronization failed", route, error);
  }
  categoryStore.refreshCategories(payload.ledgerId, { force: true }).catch(() => {});
  return result;
}

const saveCategory = (data) => mutateCategory("category/save", data);
async function removeCategory(categoryId, ledgerId) {
  let result;
  do {
    result = await mutateCategory("category/delete", { categoryId, ledgerId });
  } while (result.hasMore);
  return result;
}

module.exports = { listCategories, getCategoryRole, saveCategory, removeCategory };
