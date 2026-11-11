const { assertLedgerActive } = require("../shared/ledger-state");
// 分类域：分类树查询、新建/编辑、可恢复删除（迁移到"其他"）。
const {
  db,
  _,
  ok,
  now,
  getLedgerForUser,
  getLedgerRole,
  assertReadable,
  assertLedgerId,
  getOperation,
  saveOperation,
  getCategoryById,
} = require("../shared/helpers");
const { assertCategoryInput } = require("../validators/schemas");

async function listCategories(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  const role = getLedgerRole(openid, ledger);
  assertReadable(role);
  const result = await db
    .collection("categories")
    .where({ ledgerId: ledger._id })
    .orderBy("sort", "asc")
    .limit(200)
    .get();
  return ok({ categories: result.data || [], role });
}

async function saveCategory(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  const { name } = assertCategoryInput({ name: data.name });
  const type = data.type === "income" ? "income" : "expense";
  const category = data.categoryId ? await getCategoryById(data.categoryId) : null;
  if (data.categoryId && (!category || category.ledgerId !== ledger._id || category.type !== type))
    throw new Error("CATEGORY_NOT_FOUND");
  const duplicates = await db
    .collection("categories")
    .where({ ledgerId: ledger._id, type, name })
    .limit(2)
    .get();
  if ((duplicates.data || []).some((item) => item._id !== data.categoryId))
    throw new Error("CATEGORY_NAME_EXISTS");
  await db.runTransaction(async (transaction) => {
    const ledgerRef = transaction.collection("ledgers").doc(ledger._id);
    const currentLedger = (await ledgerRef.get()).data;
    assertLedgerActive(currentLedger);
    const role = getLedgerRole(openid, currentLedger);
    if (category ? role !== "owner" : !["owner", "member"].includes(role))
      throw new Error("NO_CATEGORY_PERMISSION");
    if (currentLedger.syncRevision !== ledger.syncRevision)
      throw new Error("CATEGORY_CHANGED_RETRY");
    if (currentLedger.categoryDeletionId || currentLedger.categoryRepairState)
      throw new Error("CATEGORY_DELETION_IN_PROGRESS");
    if (category) {
      const ref = transaction.collection("categories").doc(category._id);
      const current = (await ref.get()).data;
      if (
        !current ||
        current.ledgerId !== ledger._id ||
        current.type !== type ||
        current.deletionState
      )
        throw new Error("CATEGORY_NOT_FOUND");
      if (current.isOther) throw new Error("SYSTEM_CATEGORY_PROTECTED");
      await ref.update({ data: { name, icon: data.icon || current.icon, updatedAt: now() } });
    } else {
      await transaction.collection("categories").add({
        data: {
          ledgerId: ledger._id,
          type,
          name,
          icon: data.icon || "price-tag-3-line",
          sort: Date.now(),
          isOther: false,
          source: "custom",
          createdBy: openid,
          createdAt: now(),
          updatedAt: now(),
        },
      });
    }
    await ledgerRef.update({ data: { syncRevision: _.inc(1), updatedAt: now() } });
  });
  return ok({ ledgerId: ledger._id });
}

async function getOtherCategory(ledger, type) {
  const result = await db
    .collection("categories")
    .where({ ledgerId: ledger._id, type, isOther: true })
    .limit(1)
    .get();
  const category = (result.data || [])[0];
  if (!category) throw new Error("OTHER_CATEGORY_NOT_FOUND");
  return category;
}

async function migrateFlatRecords(ledger, category, target) {
  const query = { ledgerId: ledger._id, type: category.type, categoryId: category._id };
  for (let batch = 0; batch < 5; batch += 1) {
    const rows = (await db.collection("records").where(query).limit(50).get()).data || [];
    if (!rows.length) return true;
    await db
      .collection("records")
      .where(_.and([query, { _id: _.in(rows.map((row) => row._id)) }]))
      .update({
        data: {
          categoryId: target._id,
          categoryName: target.name,
          categoryLabel: target.name,
          categoryIcon: target.icon,
          parentCategory: "",
          parentIcon: "",
          syncVersion: _.inc(1),
          updatedAt: now(),
        },
      });
  }
  return false;
}

async function removeCategory(openid, data = {}) {
  assertLedgerId(data.ledgerId);
  if (!data.categoryId) throw new Error("CATEGORY_ID_REQUIRED");
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  if (getLedgerRole(openid, ledger) !== "owner") throw new Error("ONLY_OWNER_CAN_DELETE_CATEGORY");
  const key = "category-delete:" + data.categoryId;
  let operation = await getOperation("category-delete", key);
  if (operation && operation.ledgerId !== ledger._id) throw new Error("CATEGORY_NOT_FOUND");
  if (operation && operation.stage === "complete")
    return ok({ operationId: operation._id, hasMore: false });
  let category;
  if (operation && operation.stage === "cleanup") category = operation.categorySnapshot;
  else category = await getCategoryById(data.categoryId);
  if (!category || category.ledgerId !== ledger._id) throw new Error("CATEGORY_NOT_FOUND");
  if (!operation && category.isOther) throw new Error("SYSTEM_CATEGORY_PROTECTED");
  if (!operation) {
    operation = await saveOperation(null, {
      type: "category-delete",
      key,
      ledgerId: ledger._id,
      categoryId: category._id,
      categorySnapshot: category,
      stage: "migrate",
      status: "running",
    });
  }
  if (operation.stage === "migrate") {
    if (category.deletionState !== "deleting" || ledger.categoryDeletionId !== category._id) {
      await db.runTransaction(async (transaction) => {
        const ledgerRef = transaction.collection("ledgers").doc(ledger._id);
        const currentLedger = (await ledgerRef.get()).data;
        assertLedgerActive(currentLedger);
        if (getLedgerRole(openid, currentLedger) !== "owner")
          throw new Error("ONLY_OWNER_CAN_DELETE_CATEGORY");
        if (currentLedger.categoryDeletionId && currentLedger.categoryDeletionId !== category._id)
          throw new Error("CATEGORY_DELETION_IN_PROGRESS");
        const categoryRef = transaction.collection("categories").doc(category._id);
        const currentCategory = (await categoryRef.get()).data;
        if (!currentCategory || currentCategory.ledgerId !== ledger._id)
          throw new Error("CATEGORY_NOT_FOUND");
        if (currentCategory.isOther) throw new Error("SYSTEM_CATEGORY_PROTECTED");
        await categoryRef.update({ data: { deletionState: "deleting", updatedAt: now() } });
        await ledgerRef.update({
          data: { categoryDeletionId: category._id, syncRevision: _.inc(1), updatedAt: now() },
        });
      });
    }
    const target = await getOtherCategory(ledger, category.type);
    if (!(await migrateFlatRecords(ledger, category, target)))
      return ok({ ledgerId: ledger._id, operationId: operation._id, hasMore: true });
    operation = await saveOperation(operation, { stage: "cleanup", categorySnapshot: category });
  }
  if (operation.stage === "cleanup") {
    await db.runTransaction(async (transaction) => {
      const ledgerRef = transaction.collection("ledgers").doc(ledger._id);
      const currentLedger = (await ledgerRef.get()).data;
      assertLedgerActive(currentLedger);
      if (getLedgerRole(openid, currentLedger) !== "owner")
        throw new Error("ONLY_OWNER_CAN_DELETE_CATEGORY");
      if (currentLedger.categoryDeletionId && currentLedger.categoryDeletionId !== category._id)
        throw new Error("CATEGORY_DELETION_IN_PROGRESS");
      await transaction.collection("categories").doc(category._id).remove();
      await transaction
        .collection("ledgerOperations")
        .doc(operation._id)
        .update({
          data: { stage: "complete", status: "complete", completedAt: now(), updatedAt: now() },
        });
      await ledgerRef.update({
        data: { categoryDeletionId: "", syncRevision: _.inc(1), updatedAt: now() },
      });
    });
  }
  return ok({ ledgerId: ledger._id, operationId: operation._id, hasMore: false });
}

module.exports = {
  listCategories,
  saveCategory,
  removeCategory,
};
