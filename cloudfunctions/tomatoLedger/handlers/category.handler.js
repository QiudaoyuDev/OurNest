// 分类域：分类树查询、新建/编辑、可恢复删除（迁移到"其他"）。
const {
  db,
  _,
  ok,
  now,
  bumpLedgerSyncRevision,
  getLedgerForUser,
  getLedgerRole,
  assertReadable,
  assertLedgerId,
  getOperation,
  saveOperation,
  getCategoryById,
} = require("../shared/helpers");
const { ensureLedgerCategoryTree, addDefaultChild } = require("./category-tree");
const { assertCategoryInput } = require("../validators/schemas");

async function listCategories(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  const role = getLedgerRole(openid, ledger);
  assertReadable(role);
  const repaired = ledger.categoryDeletionId
    ? false
    : await ensureLedgerCategoryTree(ledger._id, ledger.ownerOpenid);
  if (repaired) await bumpLedgerSyncRevision(ledger._id);
  const result = await db
    .collection("categories")
    .where({ ledgerId: ledger._id })
    .orderBy("sort", "asc")
    .limit(200)
    .get();
  return ok({ categories: result.data || [], role });
}

async function isProtectedOtherCategory(category) {
  if (category.isOther && category.level === "parent") return true;
  if (category.level !== "child" || !category.isDefaultChild || !category.parentId) return false;
  const parent = await getCategoryById(category.parentId);
  return Boolean(parent && parent.isOther);
}

async function saveCategory(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  const role = getLedgerRole(openid, ledger);
  const editing = Boolean(data.categoryId);
  if (editing && role !== "owner") throw new Error("ONLY_OWNER_CAN_EDIT_CATEGORY");
  if (!editing && !["owner", "member"].includes(role)) throw new Error("NO_CATEGORY_PERMISSION");
  if (ledger.categoryDeletionId) throw new Error("CATEGORY_DELETION_IN_PROGRESS");
  const { name } = assertCategoryInput({ name: data.name });
  if (editing) {
    const category = await getCategoryById(data.categoryId);
    if (!category || category.ledgerId !== ledger._id) throw new Error("CATEGORY_NOT_FOUND");
    if (category.deletionState === "deleting") throw new Error("CATEGORY_DELETION_IN_PROGRESS");
    if (category.level === "child") {
      const parent = await getCategoryById(category.parentId);
      if (!parent || parent.deletionState === "deleting")
        throw new Error("CATEGORY_DELETION_IN_PROGRESS");
    }
    if (await isProtectedOtherCategory(category)) throw new Error("SYSTEM_CATEGORY_PROTECTED");
    await db.runTransaction(async (transaction) => {
      const ledgerRef = transaction.collection("ledgers").doc(ledger._id);
      const currentLedger = (await ledgerRef.get()).data;
      if (getLedgerRole(openid, currentLedger) !== "owner")
        throw new Error("ONLY_OWNER_CAN_EDIT_CATEGORY");
      if (currentLedger.categoryDeletionId) throw new Error("CATEGORY_DELETION_IN_PROGRESS");
      const categoryRef = transaction.collection("categories").doc(category._id);
      const currentCategory = (await categoryRef.get()).data;
      if (
        !currentCategory ||
        currentCategory.ledgerId !== ledger._id ||
        currentCategory.deletionState === "deleting"
      )
        throw new Error("CATEGORY_NOT_FOUND");
      if (currentCategory.level === "child") {
        const currentParent = (
          await transaction.collection("categories").doc(currentCategory.parentId).get()
        ).data;
        if (
          !currentParent ||
          currentParent.deletionState === "deleting" ||
          (currentCategory.isDefaultChild && currentParent.isOther)
        )
          throw new Error("CATEGORY_DELETION_IN_PROGRESS");
      }
      if (currentCategory.level === "parent" && currentCategory.isOther)
        throw new Error("SYSTEM_CATEGORY_PROTECTED");
      await categoryRef.update({
        data: { name, icon: data.icon || currentCategory.icon, updatedAt: now() },
      });
      await ledgerRef.update({ data: { syncRevision: _.inc(1), updatedAt: now() } });
    });
    if (category.level === "parent")
      await db
        .collection("categories")
        .where({ ledgerId: ledger._id, parentId: category._id })
        .update({ data: { parentName: name, updatedAt: now() } });
    return ok();
  }
  const level = data.level === "parent" ? "parent" : "child";
  if (level === "child" && !data.parentId) throw new Error("PARENT_REQUIRED");
  const parent = level === "child" ? await getCategoryById(data.parentId) : null;
  if (
    level === "child" &&
    (!parent ||
      parent.ledgerId !== ledger._id ||
      parent.level !== "parent" ||
      parent.deletionState === "deleting")
  )
    throw new Error("PARENT_NOT_FOUND");
  const type = data.type === "income" ? "income" : "expense";
  const icon = data.icon || "price-tag-3-line";
  if (parent && parent.type !== type) throw new Error("PARENT_NOT_FOUND");
  await db.runTransaction(async (transaction) => {
    const ledgerRef = transaction.collection("ledgers").doc(ledger._id);
    const currentLedger = (await ledgerRef.get()).data;
    if (!["owner", "member"].includes(getLedgerRole(openid, currentLedger)))
      throw new Error("NO_CATEGORY_PERMISSION");
    if (currentLedger.categoryDeletionId) throw new Error("CATEGORY_DELETION_IN_PROGRESS");
    let currentParent = null;
    if (parent) {
      currentParent = (await transaction.collection("categories").doc(parent._id).get()).data;
      if (
        !currentParent ||
        currentParent.ledgerId !== ledger._id ||
        currentParent.level !== "parent" ||
        currentParent.type !== type ||
        currentParent.deletionState === "deleting"
      )
        throw new Error("PARENT_NOT_FOUND");
    }
    const added = await transaction.collection("categories").add({
      data: {
        ledgerId: ledger._id,
        type,
        level,
        parentId: currentParent ? currentParent._id : "",
        parentName: currentParent ? currentParent.name : "",
        name,
        icon,
        sort: Date.now(),
        isOther: false,
        isDefaultChild: false,
        source: "custom",
        createdBy: openid,
        createdAt: now(),
        updatedAt: now(),
      },
    });
    if (level === "parent") {
      await transaction.collection("categories").add({
        data: {
          ledgerId: ledger._id,
          type,
          level: "child",
          parentId: added._id,
          parentName: name,
          name,
          icon,
          sort: -1,
          isDefaultChild: true,
          source: "system",
          createdBy: openid,
          createdAt: now(),
          updatedAt: now(),
        },
      });
    }
    await ledgerRef.update({ data: { syncRevision: _.inc(1), updatedAt: now() } });
  });
  return ok();
}

async function getOtherDefaultChild(ledger, type, openid) {
  const other = (
    await db
      .collection("categories")
      .where({ ledgerId: ledger._id, type, level: "parent", isOther: true })
      .limit(1)
      .get()
  ).data[0];
  if (!other) throw new Error("OTHER_CATEGORY_NOT_FOUND");
  return { parent: other, child: await addDefaultChild(ledger._id, other, openid) };
}

async function migrateTo(ledger, parent, fromChild, target) {
  const ids = [];
  if (fromChild) ids.push(fromChild._id);
  else {
    for (let offset = 0; ; offset += 100) {
      const children =
        (
          await db
            .collection("categories")
            .where({ ledgerId: ledger._id, parentId: parent._id })
            .orderBy("_id", "asc")
            .skip(offset)
            .limit(100)
            .get()
        ).data || [];
      ids.push(...children.map((child) => child._id));
      if (children.length < 100) break;
    }
  }
  const legacy = { categoryId: _.in(["", null]), parentCategory: parent.name };
  if (fromChild) legacy.categoryName = fromChild.name;
  const identities = ids.length ? _.or([{ categoryId: _.in(ids) }, legacy]) : legacy;
  const query = _.and([{ ledgerId: ledger._id, type: parent.type }, identities]);
  const patch = {
    parentCategory: target.parent.name,
    parentIcon: target.parent.icon || "more-2-line",
    categoryId: target.child._id,
    categoryName: target.child.name,
    categoryLabel: target.child.name,
    categoryIcon: target.child.icon || target.parent.icon || "price-tag-3-line",
    syncVersion: _.inc(1),
    updatedAt: now(),
  };
  for (let batch = 0; batch < 5; batch += 1) {
    const rows = (await db.collection("records").where(query).limit(50).get()).data || [];
    if (!rows.length) return true;
    await db
      .collection("records")
      .where(_.and([query, { _id: _.in(rows.map((row) => row._id)) }]))
      .update({ data: patch });
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
  if (!operation && (await isProtectedOtherCategory(category)))
    throw new Error("SYSTEM_CATEGORY_PROTECTED");
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
        if (getLedgerRole(openid, currentLedger) !== "owner")
          throw new Error("ONLY_OWNER_CAN_DELETE_CATEGORY");
        if (currentLedger.categoryDeletionId && currentLedger.categoryDeletionId !== category._id)
          throw new Error("CATEGORY_DELETION_IN_PROGRESS");
        const categoryRef = transaction.collection("categories").doc(category._id);
        const currentCategory = (await categoryRef.get()).data;
        if (!currentCategory || currentCategory.ledgerId !== ledger._id)
          throw new Error("CATEGORY_NOT_FOUND");
        await categoryRef.update({ data: { deletionState: "deleting", updatedAt: now() } });
        await ledgerRef.update({
          data: { categoryDeletionId: category._id, syncRevision: _.inc(1), updatedAt: now() },
        });
      });
    }
    if (category.level === "parent") {
      const target = await getOtherDefaultChild(ledger, category.type, openid);
      if (!(await migrateTo(ledger, category, null, target)))
        return ok({ operationId: operation._id, hasMore: true });
    } else {
      const parent = await getCategoryById(category.parentId);
      if (!parent) throw new Error("PARENT_NOT_FOUND");
      const target = await getOtherDefaultChild(ledger, parent.type, openid);
      if (!(await migrateTo(ledger, parent, category, target)))
        return ok({ operationId: operation._id, hasMore: true });
    }
    operation = await saveOperation(operation, { stage: "cleanup", categorySnapshot: category });
  }
  if (operation.stage === "cleanup") {
    if (category.level === "parent") {
      for (let batch = 0; batch < 5; batch += 1) {
        const rows =
          (
            await db
              .collection("categories")
              .where({ ledgerId: ledger._id, parentId: category._id })
              .limit(50)
              .get()
          ).data || [];
        if (!rows.length) break;
        await db
          .collection("categories")
          .where({
            ledgerId: ledger._id,
            parentId: category._id,
            _id: _.in(rows.map((row) => row._id)),
          })
          .remove();
        if (batch === 4) return ok({ operationId: operation._id, hasMore: true });
      }
    }
    await db.runTransaction(async (transaction) => {
      const ledgerRef = transaction.collection("ledgers").doc(ledger._id);
      const currentLedger = (await ledgerRef.get()).data;
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
  return ok({ operationId: operation._id, hasMore: false });
}

module.exports = {
  listCategories,
  saveCategory,
  removeCategory,
};
