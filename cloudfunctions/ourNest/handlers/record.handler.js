// 记录域：收支记录 CRUD、游标分页、模板下载与批量导入。
const cloud = require("wx-server-sdk");
const crypto = require("crypto");
const { TextDecoder } = require("util");
const { parseSourceTable } = require("../import-source");
const { normalizeFamilyAttribution } = require("../family.helpers");
const {
  db,
  _,
  $,
  ok,
  fail,
  now,
  bumpLedgerSyncRevision,
  getLedgerForUser,
  getUsersByOpenids,
  resolveUsersAvatarUrls,
  getLedgerRole,
  getRoleText,
  assertReadable,
  assertWritable,
  defaultAvatarUrl,
  SCHEMA_VERSION,
  defaultPaymentAccounts,
  getRecordById,
  getCategoryById,
} = require("../shared/helpers");
const { assertRecordPayload } = require("../validators/schemas");

// --- 校验与展示辅助 ---

function attachRecordOwner(record = {}, ownerMap = {}, currentOpenid = "") {
  const owner = ownerMap[record.ownerOpenid] || {};
  return {
    ...record,
    id: record._id || record.id,
    memberName: owner.nickName || (record.ownerOpenid === currentOpenid ? "我" : "成员"),
    memberAvatar: owner.avatarUrl || defaultAvatarUrl,
  };
}

async function resolveRecordCategory(ledgerId, type, categoryId, readCategory = getCategoryById) {
  if (!categoryId) return null;
  const child = await readCategory(categoryId);
  if (
    !child ||
    child.ledgerId !== ledgerId ||
    child.type !== type ||
    child.deletionState === "deleting" ||
    child.level !== "child" ||
    !child.parentId
  )
    throw new Error("INVALID_RECORD_CATEGORY");
  const parent = await readCategory(child.parentId);
  if (
    !parent ||
    parent.ledgerId !== ledgerId ||
    parent.type !== type ||
    parent.level !== "parent" ||
    parent.deletionState === "deleting"
  )
    throw new Error("INVALID_RECORD_CATEGORY");
  return {
    categoryId: child._id,
    categoryName: child.name,
    categoryLabel: child.name,
    categoryIcon: child.icon || "price-tag-3-line",
    parentCategory: parent.name,
    parentIcon: parent.icon || "more-2-line",
  };
}

// --- 记录 CRUD ---

function assertNoCategoryMigration(ledger) {
  if (!ledger.categoryDeletionId) return;
  const error = new Error("分类迁移进行中，请稍后重试");
  error.code = "CATEGORY_DELETION_IN_PROGRESS";
  throw error;
}

async function createRecord(openid, data = {}) {
  assertRecordPayload(data);
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  const role = getLedgerRole(openid, ledger);
  assertWritable(role);
  const category = await resolveRecordCategory(ledger._id, data.type, data.categoryId);
  const familyAttribution = normalizeFamilyAttribution({
    ledger,
    openid,
    input: data.familyAttribution,
  });

  const record = {
    ledgerId: ledger._id,
    ownerOpenid: openid,
    familyAttribution,
    type: data.type,
    amount: Number(data.amount),
    categoryId: data.categoryId || "",
    categoryName: data.categoryName || "其他",
    categoryLabel: data.categoryLabel || data.categoryName || "其他",
    categoryIcon: data.categoryIcon || "price-tag-3-line",
    parentCategory: data.parentCategory || "",
    parentIcon: data.parentIcon || "",
    ...(category || {}),
    note: data.note || "",
    tags: Array.isArray(data.tags) ? data.tags.slice(0, 8) : [],
    account: data.account || "微信",
    date: data.date || new Date().toISOString().slice(0, 10),
    time: data.time || "",
    syncVersion: 1,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now(),
    updatedAt: now(),
  };
  const result = await db.runTransaction(async (transaction) => {
    const ledgerRef = transaction.collection("ledgers").doc(ledger._id);
    const currentLedger = (await ledgerRef.get()).data;
    assertWritable(getLedgerRole(openid, currentLedger));
    assertNoCategoryMigration(currentLedger);
    const currentCategory = await resolveRecordCategory(
      ledger._id,
      data.type,
      data.categoryId,
      async (id) => (await transaction.collection("categories").doc(id).get()).data
    );
    const currentRecord = {
      ...record,
      ...(currentCategory || {}),
      familyAttribution: normalizeFamilyAttribution({
        ledger: currentLedger,
        openid,
        input: data.familyAttribution,
      }),
    };
    const created = await transaction.collection("records").add({ data: currentRecord });
    await ledgerRef.update({ data: { syncRevision: _.inc(1), updatedAt: now() } });
    return { recordId: created._id, record: currentRecord };
  });
  return ok(result);
}

function applyCategoryFilter(query, filter) {
  if (!filter) return;
  if (
    filter.kind === "id" &&
    typeof filter.id === "string" &&
    filter.id.length > 0 &&
    filter.id.length <= 128
  ) {
    query.categoryId = filter.id;
    return;
  }
  if (
    filter.kind === "legacy" &&
    typeof filter.name === "string" &&
    typeof filter.parent === "string" &&
    filter.name.length <= 100 &&
    filter.parent.length <= 100
  ) {
    query.categoryId = _.in(["", null]);
    query.categoryName = filter.name || _.in(["", null]);
    query.parentCategory = filter.parent || _.in(["", null]);
    return;
  }
  throw new Error("INVALID_CATEGORY_FILTER");
}

function applyAccountFilter(query, filter) {
  if (!filter) return;
  if (filter.kind === "missing") {
    query.account = _.in(["", null]);
    return;
  }
  if (
    filter.kind === "name" &&
    typeof filter.name === "string" &&
    filter.name.length > 0 &&
    filter.name.length <= 100
  ) {
    query.account = filter.name;
    return;
  }
  throw new Error("INVALID_ACCOUNT_FILTER");
}

function makeFamilyFilter(filter, ledger) {
  if (!filter) return null;
  if (
    (ledger.type || "personal") !== "shared" ||
    !["payer", "consumer", "creator"].includes(filter.dimension) ||
    typeof filter.openid !== "string" ||
    filter.openid.length > 128
  )
    throw new Error("INVALID_FAMILY_FILTER");
  const id = filter.openid;
  if (filter.dimension === "creator") return { ownerOpenid: id || _.in(["", null]) };
  if (filter.dimension === "payer") {
    return { "familyAttribution.payerOpenid": id || _.in(["", null]) };
  }
  if (id) {
    return _.or([
      { "familyAttribution.consumerKind": "personal", "familyAttribution.consumerOpenid": id },
      { "familyAttribution.consumerKind": _.in(["public", "multiple"]), ownerOpenid: id },
    ]);
  }
  return _.or([
    { "familyAttribution.consumerKind": _.nin(["personal", "public", "multiple"]) },
    {
      "familyAttribution.consumerKind": "personal",
      "familyAttribution.consumerOpenid": _.in(["", null]),
    },
    {
      "familyAttribution.consumerKind": _.in(["public", "multiple"]),
      ownerOpenid: _.in(["", null]),
    },
  ]);
}

async function listRecords(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  const role = getLedgerRole(openid, ledger);
  assertReadable(role);
  const pageSize = Math.min(50, Math.max(1, Number(data.pageSize) || 30));
  const baseQuery = { ledgerId: ledger._id };
  if (data.type && data.type !== "all") baseQuery.type = data.type;
  if (data.start && data.end) baseQuery.date = _.gte(data.start).and(_.lt(data.end));
  if (data.categoryFilter && !["income", "expense"].includes(data.type))
    throw new Error("INVALID_CATEGORY_FILTER");
  applyCategoryFilter(baseQuery, data.categoryFilter);
  if (data.accountFilter && !["income", "expense"].includes(data.type))
    throw new Error("INVALID_ACCOUNT_FILTER");
  applyAccountFilter(baseQuery, data.accountFilter);
  if (data.familyFilter && data.type !== "expense") throw new Error("INVALID_FAMILY_FILTER");
  const familyClause = makeFamilyFilter(data.familyFilter, ledger);
  const cursor = data.cursor && data.cursor.date && data.cursor.id ? data.cursor : null;
  let query = familyClause ? _.and([baseQuery, familyClause]) : baseQuery;
  if (cursor) {
    const cursorRecord = await getRecordById(cursor.id);
    if (
      !cursorRecord ||
      cursorRecord.ledgerId !== ledger._id ||
      cursorRecord.date !== cursor.date ||
      !cursorRecord.createdAt
    )
      throw new Error("INVALID_RECORD_CURSOR");
    query = _.and([
      baseQuery,
      ...(familyClause ? [familyClause] : []),
      _.or([
        { date: _.lt(cursor.date) },
        { date: cursor.date, createdAt: _.lt(cursorRecord.createdAt) },
        {
          date: cursor.date,
          createdAt: cursorRecord.createdAt,
          _id: _.lt(cursor.id),
        },
      ]),
    ]);
  }
  const historyQuery = { ledgerId: ledger._id };
  let rangeQuery = { ledgerId: ledger._id };
  if (data.start && data.end) rangeQuery.date = _.gte(data.start).and(_.lt(data.end));
  if (
    (data.categoryFilter || data.familyFilter || data.accountFilter || data.summaryFiltered) &&
    ["income", "expense"].includes(data.type)
  ) {
    rangeQuery.type = data.type;
  }
  if (data.categoryFilter) applyCategoryFilter(rangeQuery, data.categoryFilter);
  if (data.accountFilter) applyAccountFilter(rangeQuery, data.accountFilter);
  if (familyClause) rangeQuery = _.and([rangeQuery, familyClause]);
  const [historyCountResult, rangeCountResult, rangeSummaryResult, latestRecordResult] =
    await Promise.all([
      db.collection("records").where(historyQuery).count(),
      db.collection("records").where(rangeQuery).count(),
      db
        .collection("records")
        .aggregate()
        .match(rangeQuery)
        .group({ _id: "$type", total: $.sum($.floor($.add([$.multiply(["$amount", 100]), 0.5]))) })
        .end(),
      db
        .collection("records")
        .where(historyQuery)
        .orderBy("date", "desc")
        .orderBy("createdAt", "desc")
        .orderBy("_id", "desc")
        .limit(1)
        .get(),
    ]);
  const rangeSummary = (rangeSummaryResult.list || []).reduce(
    (summary, item) => {
      if (item._id === "income") summary.income = Number(item.total || 0) / 100;
      if (item._id === "expense") summary.expense = Number(item.total || 0) / 100;
      return summary;
    },
    { income: 0, expense: 0 }
  );
  const result = await db
    .collection("records")
    .where(query)
    .orderBy("date", "desc")
    .orderBy("createdAt", "desc")
    .orderBy("_id", "desc")
    .limit(pageSize + 1)
    .get();
  const rows = result.data || [];
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const ownerMap = await resolveUsersAvatarUrls(
    await getUsersByOpenids(page.map((item) => item.ownerOpenid))
  );
  const last = page[page.length - 1];
  return ok({
    records: page.map((item) => attachRecordOwner(item, ownerMap, openid)),
    nextCursor: hasMore && last ? { date: last.date, id: last._id } : null,
    hasMore,
    historyRecordCount: historyCountResult.total || 0,
    rangeRecordCount: rangeCountResult.total || 0,
    rangeSummary,
    latestRecordDate: ((latestRecordResult.data || [])[0] || {}).date || "",
    ledger: {
      _id: ledger._id,
      name: ledger.name,
      type: ledger.type || "personal",
      budgetEnabled: Boolean(ledger.budgetEnabled),
      monthlyBudget: Number(ledger.monthlyBudget || 0),
    },
    role,
    roleText: getRoleText(role),
    readonly: role === "readonly",
  });
}

async function getRecord(openid, data = {}) {
  const recordId = data.recordId || data.id;
  if (!recordId) return fail("记录不存在", "RECORD_NOT_FOUND");
  const record = await getRecordById(recordId);
  if (!record) return fail("记录不存在", "RECORD_NOT_FOUND");
  const ledger = await getLedgerForUser(openid, record.ledgerId);
  const role = getLedgerRole(openid, ledger);
  assertReadable(role);
  const familyAttribution = normalizeFamilyAttribution({
    ledger,
    openid,
    existing: record.familyAttribution,
    isImport: true,
  });
  const ownerMap = await resolveUsersAvatarUrls(
    await getUsersByOpenids([
      record.ownerOpenid,
      familyAttribution.payerOpenid,
      familyAttribution.consumerOpenid,
    ])
  );
  const memberName = (id) =>
    id ? (ownerMap[id] || {}).nickName || (id === openid ? "我" : "历史成员") : "其他";
  const familyDisplay = {
    payerName: memberName(familyAttribution.payerOpenid),
    consumerName:
      familyAttribution.consumerKind === "personal"
        ? memberName(familyAttribution.consumerOpenid)
        : familyAttribution.consumerKind === "public"
          ? "公共（按记录人展示）"
          : familyAttribution.consumerKind === "multiple"
            ? "多人（按记录人展示）"
            : "其他",
  };
  const canEdit = (role === "owner" || record.ownerOpenid === openid) && role !== "readonly";
  return ok({
    record: { ...attachRecordOwner(record, ownerMap, openid), familyAttribution, familyDisplay },
    ledger: {
      _id: ledger._id,
      name: ledger.name,
      type: ledger.type || "personal",
      accounts: ledger.accounts || defaultPaymentAccounts,
      accountsConfigured: Boolean(ledger.accountsConfigured),
    },
    role,
    roleText: getRoleText(role),
    readonly: role === "readonly" || !canEdit,
    canEdit,
  });
}

async function updateRecord(openid, data = {}) {
  assertRecordPayload(data);
  const record = await getRecordById(data.recordId);
  if (!record) {
    const error = new Error("记录已被删除");
    error.code = "RECORD_NOT_FOUND";
    throw error;
  }
  const ledger = await getLedgerForUser(openid, record.ledgerId);
  const role = getLedgerRole(openid, ledger);
  assertWritable(role);
  if (role !== "owner" && record.ownerOpenid !== openid)
    throw new Error("ONLY_OWNER_CAN_EDIT_OTHERS");

  const categoryId =
    typeof data.categoryId === "string" ? data.categoryId : record.categoryId || "";
  const category = await resolveRecordCategory(ledger._id, data.type, categoryId);
  const familyAttribution = normalizeFamilyAttribution({
    ledger,
    openid,
    input: data.familyAttribution,
    existing: record.familyAttribution,
    isImport: true,
  });

  // 乐观锁：客户端必须传入 syncVersion，服务端校验是否匹配
  const clientVersion = Number(data.syncVersion || 0);
  if (Number(record.syncVersion || 0) !== clientVersion) {
    const error = new Error("记录已被其他成员修改，请刷新后重试");
    error.code = "RECORD_CONFLICT";
    throw error;
  }

  const patch = {
    amount: Number(data.amount),
    type: data.type,
    familyAttribution,
    categoryId,
    categoryName: data.categoryName || record.categoryName,
    categoryLabel:
      data.categoryLabel || record.categoryLabel || data.categoryName || record.categoryName,
    categoryIcon: data.categoryIcon || record.categoryIcon || "price-tag-3-line",
    parentCategory: data.parentCategory || record.parentCategory || "",
    parentIcon: data.parentIcon || record.parentIcon || "",
    ...(category || {}),
    note: data.note || "",
    tags: Array.isArray(data.tags) ? data.tags.slice(0, 8) : record.tags || [],
    account: data.account || record.account,
    date: data.date || record.date,
    time: data.time || record.time || "",
    syncVersion: _.inc(1),
    updatedAt: now(),
  };
  await db.runTransaction(async (transaction) => {
    const ledgerRef = transaction.collection("ledgers").doc(ledger._id);
    const currentLedger = (await ledgerRef.get()).data;
    const currentRole = getLedgerRole(openid, currentLedger);
    assertWritable(currentRole);
    assertNoCategoryMigration(currentLedger);
    const recordRef = transaction.collection("records").doc(data.recordId);
    const currentRecord = (await recordRef.get()).data;
    if (
      !currentRecord ||
      currentRecord.ledgerId !== ledger._id ||
      (currentRole !== "owner" && currentRecord.ownerOpenid !== openid)
    )
      throw new Error("ONLY_OWNER_CAN_EDIT_OTHERS");
    if (Number(currentRecord.syncVersion || 0) !== clientVersion) {
      const error = new Error("记录已被其他成员修改，请刷新后重试");
      error.code = "RECORD_CONFLICT";
      throw error;
    }
    const currentCategory = await resolveRecordCategory(
      ledger._id,
      data.type,
      categoryId,
      async (id) => (await transaction.collection("categories").doc(id).get()).data
    );
    const currentFamily = normalizeFamilyAttribution({
      ledger: currentLedger,
      openid,
      input: data.familyAttribution,
      existing: currentRecord.familyAttribution,
      isImport: true,
    });
    await recordRef.update({
      data: { ...patch, ...(currentCategory || {}), familyAttribution: currentFamily },
    });
    await ledgerRef.update({ data: { syncRevision: _.inc(1), updatedAt: now() } });
  });
  return ok();
}

async function deleteRecord(openid, data = {}) {
  const record = await getRecordById(data.recordId);
  if (!record) {
    const error = new Error("记录已被删除");
    error.code = "RECORD_NOT_FOUND";
    throw error;
  }
  const ledger = await getLedgerForUser(openid, record.ledgerId);
  const role = getLedgerRole(openid, ledger);
  assertWritable(role);
  if (role !== "owner" && record.ownerOpenid !== openid)
    throw new Error("ONLY_OWNER_CAN_DELETE_OTHERS");

  const clientVersion = Number(data.syncVersion || 0);
  if (clientVersion && Number(record.syncVersion || 0) !== clientVersion) {
    const error = new Error("记录已被其他成员修改，请刷新后重试");
    error.code = "RECORD_CONFLICT";
    throw error;
  }

  await db.collection("records").doc(data.recordId).remove();
  await bumpLedgerSyncRevision(ledger._id);
  return ok();
}

// --- 导入 ---

function importCell(row, names) {
  for (const name of names)
    if (row[name] !== undefined && row[name] !== null && row[name] !== "") return row[name];
  return "";
}

function importDate(value, xlsx) {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);
  if (typeof value === "number" && xlsx && xlsx.SSF) {
    const parsed = xlsx.SSF.parse_date_code(value);
    if (parsed)
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const matched = String(value || "").match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  return matched
    ? `${matched[1]}-${String(matched[2]).padStart(2, "0")}-${String(matched[3]).padStart(2, "0")}`
    : "";
}

function isValidImportDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
  );
}

function parseHtmlImportRows(buffer) {
  const html = buffer.toString("utf8");
  const clean = (value) =>
    String(value || "")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .trim();
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const table of tables) {
    const rows = (table.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((row) =>
      (row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(clean)
    );
    const headerIndex = rows.findIndex(
      (row) => row.includes("日期") && row.some((cell) => cell.includes("收支类型"))
    );
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex];
    return rows
      .slice(headerIndex + 1)
      .map((row, index) => ({ row, rowNumber: headerIndex + index + 2 }))
      .filter((item) => item.row.length)
      .map(({ row, rowNumber }) => ({
        ...headers.reduce((item, header, index) => ({ ...item, [header]: row[index] || "" }), {}),
        __sourceRow: rowNumber,
      }));
  }
  return [];
}

async function getImportTemplate(openid) {
  if (!openid) throw new Error("LOGIN_REQUIRED");
  const xlsx = require("xlsx");
  const workbook = xlsx.utils.book_new();
  const sheet = xlsx.utils.aoa_to_sheet([
    ["日期*", "收支类型*", "金额*", "一级分类", "二级分类", "账户", "备注", "标签"],
    ["2026-06-01", "支出", 38.5, "餐饮", "午餐", "微信", "工作日午餐", "日常,餐饮"],
    ["2026-06-02", "收入", 5000, "工资", "工资", "银行卡", "六月工资", "固定收入"],
  ]);
  sheet["!cols"] = [14, 14, 12, 16, 16, 14, 28, 20].map((wch) => ({ wch }));
  xlsx.utils.book_append_sheet(workbook, sheet, "导入模板");
  const fileContent = xlsx.write(workbook, { bookType: "xlsx", type: "buffer" });
  const uploaded = await cloud.uploadFile({
    cloudPath: "templates/our-nest-import-template.xlsx",
    fileContent,
  });
  const temporary = await cloud.getTempFileURL({ fileList: [uploaded.fileID] });
  const file = (temporary.fileList || [])[0] || {};
  if (!file.tempFileURL) throw new Error("IMPORT_TEMPLATE_UNAVAILABLE");
  return ok({ fileId: uploaded.fileID, url: file.tempFileURL });
}

function isImportFileForUser(fileId, openid) {
  if (!openid || !fileId.startsWith("cloud://")) return false;
  const pathStart = fileId.indexOf("/", "cloud://".length);
  if (pathStart <= "cloud://".length) return false;
  const parts = fileId.slice(pathStart + 1).split("/");
  return (
    parts.length === 3 &&
    parts[0] === "imports" &&
    parts[1] === openid &&
    Boolean(parts[2]) &&
    parts[2] !== "." &&
    parts[2] !== ".." &&
    !/[\\?#]/.test(parts[2]) &&
    !/%(?:2e|2f|5c)/i.test(parts[2])
  );
}

async function createImportUpload(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  assertWritable(getLedgerRole(openid, ledger));
  const extension = String(data.extension || "").toLowerCase();
  if (!["xls", "xlsx", "csv"].includes(extension)) throw new Error("IMPORT_FILE_TYPE_INVALID");
  const cloudPath = `imports/${openid}/${crypto.randomBytes(24).toString("hex")}.${extension}`;
  const ticket = await db.collection("ledgerOperations").add({
    data: {
      type: "import-upload-ticket",
      ownerOpenid: openid,
      ledgerId: ledger._id,
      cloudPath,
      status: "issued",
      createdAt: now(),
      updatedAt: now(),
    },
  });
  return ok({ ticketId: ticket._id, cloudPath });
}

function validateImportTicket(ticket, openid, ledgerId, fileId) {
  const pathStart = fileId.indexOf("/", "cloud://".length);
  if (
    !isImportFileForUser(fileId, openid) ||
    !ticket ||
    ticket.type !== "import-upload-ticket" ||
    ticket.ownerOpenid !== openid ||
    ticket.ledgerId !== ledgerId ||
    !["issued", "claimed"].includes(ticket.status) ||
    (ticket.status === "claimed" && ticket.fileId !== fileId) ||
    ticket.cloudPath !== fileId.slice(pathStart + 1)
  )
    throw new Error("IMPORT_FILE_ACCESS_DENIED");
}

async function abandonImportUpload(openid, data = {}) {
  const ticketId = String(data.ticketId || "");
  const fileId = String(data.fileId || "");
  if (!ticketId || !isImportFileForUser(fileId, openid))
    throw new Error("IMPORT_FILE_ACCESS_DENIED");
  const ticket = await getOptionalImportIdentity(db.collection("ledgerOperations"), ticketId);
  if (
    !ticket ||
    ticket.ownerOpenid !== openid ||
    ticket.type !== "import-upload-ticket" ||
    ticket.cloudPath !== fileId.slice(fileId.indexOf("/", "cloud://".length) + 1)
  )
    throw new Error("IMPORT_FILE_ACCESS_DENIED");
  const ledger = await getLedgerForUser(openid, ticket.ledgerId);
  assertWritable(getLedgerRole(openid, ledger));
  const fileMarkerId = importFileMarkerId(fileId);
  await db.runTransaction(async (transaction) => {
    const ledgerNow = (await transaction.collection("ledgers").doc(ticket.ledgerId).get()).data;
    assertWritable(getLedgerRole(openid, ledgerNow));
    const operations = transaction.collection("ledgerOperations");
    const ticketRef = operations.doc(ticketId);
    const current = (await ticketRef.get()).data;
    if (
      !current ||
      current.ownerOpenid !== openid ||
      current.ledgerId !== ticket.ledgerId ||
      current.cloudPath !== ticket.cloudPath
    )
      throw new Error("IMPORT_FILE_ACCESS_DENIED");
    if (current.status === "claimed") throw new Error("IMPORT_UPLOAD_IN_USE");
    if (current.status === "abandoned") {
      if (current.fileId !== fileId) throw new Error("IMPORT_FILE_ACCESS_DENIED");
      return;
    }
    if (current.status !== "issued") throw new Error("IMPORT_FILE_ACCESS_DENIED");
    const marker = await getOptionalImportIdentity(operations, fileMarkerId);
    if (marker) throw new Error("IMPORT_UPLOAD_IN_USE");
    await operations.doc(fileMarkerId).set({
      data: {
        type: "import-file-reference",
        fileId,
        ownerOpenid: openid,
        references: 0,
        status: "deleting",
        updatedAt: now(),
      },
    });
    await ticketRef.update({ data: { status: "abandoned", fileId, updatedAt: now() } });
  });
  return ok({
    cleanupStatus: await cleanupCompletedImportFile({ fileMarkerId, fileId, ownerOpenid: openid }),
  });
}

function decodeImportText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder("utf-16le").decode(buffer);
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder("utf-16be").decode(buffer);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (_error) {
    return new TextDecoder("gb18030", { fatal: true }).decode(buffer);
  }
}

function sourceImportRecords(sourceData, ledgerId, openid, defaultAccount) {
  const records = [];
  const rowNumbers = [];
  const rowInfo = [];
  const errors = [];
  sourceData.rows.forEach((row) => {
    try {
      if (!isValidImportDate(row.date)) throw new Error("INVALID_RECORD_DATE");
      assertRecordPayload({ date: row.date, type: row.type || "expense", amount: row.amount });
    } catch (_error) {
      errors.push(`第 ${row.rowNumber} 行：日期或金额无效`);
      return;
    }
    rowNumbers.push(row.rowNumber);
    rowInfo.push({
      excluded: row.excluded,
      needsReview: row.needsReview,
      reviewReason: row.reviewReason,
      sourceIdWarning: row.sourceIdWarning,
      source: row.source,
      sourceText: row.source === "wechat" ? "微信支付" : "支付宝",
      merchant: row.merchant,
      status: row.status,
      sourceCategory: row.transactionType,
      categoryChoiceRequired: true,
    });
    records.push({
      ledgerId,
      ownerOpenid: openid,
      familyAttribution: normalizeFamilyAttribution({
        ledger: { type: "shared" },
        openid,
        isImport: true,
      }),
      type: row.type || "expense",
      amount: row.amount,
      categoryId: "",
      categoryName: "其他",
      categoryLabel: "其他",
      categoryIcon: "price-tag-3-line",
      parentCategory: "其他",
      parentIcon: "more-2-line",
      note: String(row.note || row.product || row.merchant || "").slice(0, 100),
      tags: [],
      account: String(row.account || defaultAccount || "微信"),
      date: row.date,
      time: row.time,
      source: row.source,
      sourceTransactionId: row.transactionId,
      sourceMerchant: row.merchant,
      sourceCategory: row.transactionType,
      sourceStatus: row.status,
      sourceKind: row.sourceKind,
      schemaVersion: SCHEMA_VERSION,
      createdAt: now(),
      updatedAt: now(),
    });
  });
  return { records, rowNumbers, rowInfo, errors };
}

async function prepareImport(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  const role = getLedgerRole(openid, ledger);
  assertWritable(role);
  const fileId = String(data.fileId || "");
  if (!isImportFileForUser(fileId, openid)) throw new Error("IMPORT_FILE_ACCESS_DENIED");
  const download = await cloud.downloadFile({ fileID: fileId });
  if (!download.fileContent || download.fileContent.length > 5 * 1024 * 1024) {
    throw new Error("IMPORT_FILE_SIZE_INVALID");
  }
  const fileHash = crypto.createHash("sha256").update(download.fileContent).digest("hex");
  let rows = parseHtmlImportRows(download.fileContent);
  let xlsx;
  let sourceData = null;
  if (!rows.length) {
    xlsx = require("xlsx");
    const isText = /\.csv$/i.test(fileId);
    const workbook = isText
      ? xlsx.read(decodeImportText(download.fileContent), { type: "string", raw: true })
      : xlsx.read(download.fileContent, { type: "buffer", cellDates: true, raw: true });
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const table = xlsx.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        raw: true,
        blankrows: true,
      });
      const firstRow = sheet["!ref"] ? xlsx.utils.decode_range(sheet["!ref"]).s.r + 1 : 1;
      sourceData = parseSourceTable(table, firstRow);
      if (sourceData && sourceData.rows.length) break;
      const parsed = xlsx.utils.sheet_to_json(sheet, { defval: "", raw: true });
      if (parsed.some((row) => importCell(row, ["日期", "日期*"]))) {
        rows = parsed;
        break;
      }
    }
  }
  if (sourceData && sourceData.rows.length) {
    if (sourceData.rows.length > 200) throw new Error("IMPORT_RECORD_LIMIT_EXCEEDED");
    return {
      ledger,
      fileHash,
      ...sourceImportRecords(sourceData, ledger._id, openid, data.defaultAccount),
    };
  }
  if (!rows.length) throw new Error("IMPORT_FORMAT_UNSUPPORTED");
  if (rows.length > 200) throw new Error("IMPORT_RECORD_LIMIT_EXCEEDED");
  const records = [];
  const rowNumbers = [];
  const errors = [];
  rows.forEach((row, index) => {
    const rowNumber = Number.isInteger(row.__sourceRow)
      ? row.__sourceRow
      : Number.isInteger(row.__rowNum__)
        ? row.__rowNum__ + 1
        : index + 2;
    const date = importDate(importCell(row, ["日期", "日期*"]), xlsx);
    const rawType = String(importCell(row, ["收支类型", "收支类型*"])).trim();
    const type = ["收入", "income"].includes(rawType.toLowerCase())
      ? "income"
      : ["支出", "expense"].includes(rawType.toLowerCase())
        ? "expense"
        : "";
    const amount = Number(importCell(row, ["金额", "金额*", "收入金额", "支出金额"]));
    try {
      if (!isValidImportDate(date)) throw new Error("INVALID_RECORD_DATE");
      assertRecordPayload({ date, type, amount });
    } catch (_error) {
      errors.push(`第 ${rowNumber} 行：日期、收支类型或金额无效`);
      return;
    }
    const parentCategory = String(importCell(row, ["类别", "一级分类"]) || "其他").trim();
    const categoryName = String(
      importCell(row, ["子类", "二级分类"]) || parentCategory || "其他"
    ).trim();
    const tags = String(importCell(row, ["标签"]) || "")
      .split(/[\s,，]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);
    rowNumbers.push(rowNumber);
    records.push({
      ledgerId: ledger._id,
      ownerOpenid: openid,
      familyAttribution: normalizeFamilyAttribution({ ledger, openid, isImport: true }),
      type,
      amount,
      categoryId: "",
      categoryName,
      categoryLabel: categoryName,
      categoryIcon: "price-tag-3-line",
      parentCategory,
      parentIcon: "more-2-line",
      note: String(importCell(row, ["备注"]) || "").slice(0, 100),
      tags,
      account: String(importCell(row, ["账户"]) || data.defaultAccount || "微信"),
      date,
      time: "",
      schemaVersion: SCHEMA_VERSION,
      createdAt: now(),
      updatedAt: now(),
    });
  });
  return { ledger, records, rowNumbers, errors, fileHash, rowInfo: records.map(() => ({})) };
}

function sourceIdentityId(ledgerId, record) {
  if (!record.source || !record.sourceTransactionId) return "";
  const digest = crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        ledgerId,
        record.source,
        record.sourceKind || "transaction",
        record.sourceTransactionId,
      ])
    )
    .digest("hex");
  return `import-source-${digest}`;
}

async function getOptionalImportIdentity(collection, id) {
  try {
    const result = await collection.doc(id).get();
    return result.data || null;
  } catch (error) {
    const message = String((error && (error.errMsg || error.message)) || error || "");
    if (message.includes(`document with _id ${id} does not exist`)) return null;
    throw error;
  }
}

function importFileMarkerId(fileId) {
  return `import-file-${crypto.createHash("sha256").update(fileId).digest("hex")}`;
}

async function cleanupCompletedImportFile(batch) {
  if (!batch.fileMarkerId) return "unmanaged";
  if (!isImportFileForUser(batch.fileId, batch.ownerOpenid)) return "pending";
  try {
    const ref = db.collection("ledgerOperations").doc(batch.fileMarkerId);
    const marker = (await ref.get()).data;
    if (
      !marker ||
      marker.type !== "import-file-reference" ||
      marker.ownerOpenid !== batch.ownerOpenid ||
      marker.fileId !== batch.fileId
    )
      return "pending";
    if (marker.status === "deleted") return "done";
    if (marker.status === "active" && marker.references > 0) return "shared";
    if (marker.status !== "deleting" || marker.references !== 0) return "pending";
    const result = await cloud.deleteFile({ fileList: [batch.fileId] });
    if (
      !(result.fileList || []).some(
        (item) => item.fileID === batch.fileId && [0, -503003].includes(item.status)
      )
    )
      return "pending";
    await ref.update({ data: { status: "deleted", updatedAt: now() } });
    return "done";
  } catch (_error) {
    // Completion remains retryable; the marker keeps the file unavailable to new batches.
    return "pending";
  }
}

async function findPossibleSourceDuplicates(ledgerId, records) {
  const sourceRows = records.filter((record) => record.source && record.sourceMerchant);
  if (!sourceRows.length) return { matches: new Set(), incomplete: false };
  const dates = sourceRows.map((record) => record.date).sort();
  const dayAfter = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  const query = { ledgerId, date: _.gte(dates[0]).and(_.lt(dayAfter.toISOString().slice(0, 10))) };
  const prior = [];
  for (let offset = 0; ; offset += 100) {
    const page =
      (
        await db
          .collection("records")
          .where(query)
          .orderBy("date", "asc")
          .orderBy("_id", "asc")
          .skip(offset)
          .limit(100)
          .get()
      ).data || [];
    prior.push(...page);
    if (prior.length > 2000) return { matches: new Set(), incomplete: true };
    if (page.length < 100) break;
  }
  const matches = new Set();
  sourceRows.forEach((record) => {
    if (
      prior.some(
        (item) =>
          item.source &&
          item.source !== record.source &&
          item.date === record.date &&
          Number(item.amount) === record.amount &&
          item.sourceMerchant === record.sourceMerchant
      )
    ) {
      matches.add(record);
    }
  });
  return { matches, incomplete: false };
}

async function previewImport(openid, data = {}) {
  const fileId = String(data.fileId || "");
  if (!isImportFileForUser(fileId, openid) || !data.ticketId)
    throw new Error("IMPORT_FILE_ACCESS_DENIED");
  const ticket = await getOptionalImportIdentity(
    db.collection("ledgerOperations"),
    String(data.ticketId)
  );
  validateImportTicket(ticket, openid, data.ledgerId, fileId);
  const { ledger, records, rowNumbers, errors, fileHash, rowInfo } = await prepareImport(
    openid,
    data
  );
  const identities = [];
  for (let offset = 0; offset < records.length; offset += 20) {
    const batchIdentities = await Promise.all(
      records.slice(offset, offset + 20).map(async (record) => {
        const id = sourceIdentityId(ledger._id, record);
        return id
          ? Boolean(await getOptionalImportIdentity(db.collection("ledgerOperations"), id))
          : false;
      })
    );
    identities.push(...batchIdentities);
  }
  const possibleDuplicates = await findPossibleSourceDuplicates(ledger._id, records);
  const sourceCounts = records.reduce((counts, record) => {
    const id = sourceIdentityId(ledger._id, record);
    if (id) counts[id] = (counts[id] || 0) + 1;
    return counts;
  }, {});
  const duplicateCounts = records.reduce((counts, record) => {
    const key = JSON.stringify([record.date, record.type, record.amount, record.account]);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  for (let offset = 0; ; offset += 100) {
    if (offset >= 1000) throw new Error("IMPORT_FILE_REFERENCE_SCAN_LIMIT");
    const existing =
      (
        await db
          .collection("ledgerOperations")
          .where({ type: "record-import", fileId })
          .orderBy("_id", "asc")
          .skip(offset)
          .limit(100)
          .get()
      ).data || [];
    if (existing.some((item) => !item.fileMarkerId && ["preview", "running"].includes(item.status)))
      throw new Error("IMPORT_FILE_LEGACY_ACTIVE");
    if (existing.length < 100) break;
  }
  const fileMarkerId = importFileMarkerId(fileId);
  const batch = await db.runTransaction(async (transaction) => {
    const currentLedger = (await transaction.collection("ledgers").doc(ledger._id).get()).data;
    assertWritable(getLedgerRole(openid, currentLedger));
    const operations = transaction.collection("ledgerOperations");
    const ticketRef = operations.doc(String(data.ticketId));
    const currentTicket = (await ticketRef.get()).data;
    validateImportTicket(currentTicket, openid, ledger._id, fileId);
    const marker = await getOptionalImportIdentity(operations, fileMarkerId);
    if (
      marker &&
      (marker.type !== "import-file-reference" ||
        marker.fileId !== fileId ||
        marker.ownerOpenid !== openid ||
        marker.status !== "active" ||
        !Number.isSafeInteger(marker.references) ||
        marker.references < 1 ||
        marker.references >= Number.MAX_SAFE_INTEGER)
    )
      throw new Error("IMPORT_FILE_UNAVAILABLE");
    const created = await operations.add({
      data: {
        type: "record-import",
        ledgerId: ledger._id,
        ownerOpenid: openid,
        fileId,
        fileHash,
        fileMarkerId,
        defaultAccount: String(data.defaultAccount || "微信"),
        selectedRows: [],
        processedRows: [],
        status: "preview",
        createdAt: now(),
        updatedAt: now(),
      },
    });
    await operations.doc(fileMarkerId).set({
      data: {
        type: "import-file-reference",
        fileId,
        ownerOpenid: openid,
        references: (marker ? marker.references : 0) + 1,
        status: "active",
        updatedAt: now(),
      },
    });
    await ticketRef.update({ data: { status: "claimed", fileId, updatedAt: now() } });
    return created;
  });
  return ok({
    batchId: batch._id,
    fileHash,
    duplicatesIncomplete: possibleDuplicates.incomplete,
    rows: records.map((record, index) => ({
      rowNumber: rowNumbers[index],
      ...rowInfo[index],
      confirmedDuplicate: identities[index],
      crossSourceWarning: possibleDuplicates.matches.has(record)
        ? "其他来源有相同日期、金额和交易对方的记录，请核对"
        : "",
      sourceDuplicateWarning:
        sourceCounts[sourceIdentityId(ledger._id, record)] > 1
          ? "同一来源交易号在文件中出现多次，仅会导入一次"
          : "",
      date: record.date,
      type: record.type,
      amount: record.amount,
      parentCategory: record.parentCategory,
      categoryName: record.categoryName,
      categoryWarning: "分类名称未关联账本分类，请核对",
      duplicateWarning:
        duplicateCounts[JSON.stringify([record.date, record.type, record.amount, record.account])] >
        1
          ? "文件内有相同日期、类型、金额和账户的记录，请核对"
          : "",
      account: record.account,
      note: record.note,
    })),
    errors,
  });
}

async function importRecords(openid, data = {}) {
  const batchId = String(data.batchId || "");
  if (!batchId) throw new Error("IMPORT_BATCH_REQUIRED");
  const batch = (await db.collection("ledgerOperations").doc(batchId).get()).data;
  if (!batch || batch.type !== "record-import" || batch.ownerOpenid !== openid)
    throw new Error("IMPORT_BATCH_ACCESS_DENIED");
  if (batch.status === "cancelled") throw new Error("IMPORT_BATCH_CANCELLED");
  if (batch.status === "complete" && batch.result) {
    const ledger = await getLedgerForUser(openid, batch.ledgerId);
    assertWritable(getLedgerRole(openid, ledger));
    const selectedRows = Array.isArray(data.selectedRows)
      ? [...data.selectedRows].sort((a, b) => a - b)
      : [];
    const manualTypes = data.manualTypes || {};
    const categoryChoices = data.categoryChoices || {};
    if (
      JSON.stringify(selectedRows) !== JSON.stringify(batch.selectedRows || []) ||
      (batch.manualChoices || []).some(
        (choice) => manualTypes[String(choice.row)] !== choice.type
      ) ||
      (batch.categoryChoices || []).some(
        (choice) => categoryChoices[String(choice.row)] !== choice.id
      )
    )
      throw new Error("IMPORT_SELECTION_CHANGED");
    const cleanupStatus = await cleanupCompletedImportFile(batch);
    return ok({ ...batch.result, cleanupStatus });
  }
  const prepared = await prepareImport(openid, {
    ledgerId: batch.ledgerId,
    fileId: batch.fileId,
    defaultAccount: batch.defaultAccount,
  });
  if (prepared.fileHash !== batch.fileHash) throw new Error("IMPORT_FILE_CHANGED");
  if (!Array.isArray(data.selectedRows) || !data.selectedRows.length)
    throw new Error("IMPORT_ROWS_REQUIRED");
  const selectedRows = [...data.selectedRows].sort((a, b) => a - b);
  const selected = new Set(selectedRows);
  if (
    selected.size !== selectedRows.length ||
    selectedRows.some((row) => !Number.isInteger(row) || !prepared.rowNumbers.includes(row))
  )
    throw new Error("IMPORT_ROWS_INVALID");
  const manualTypes =
    data.manualTypes && typeof data.manualTypes === "object" && !Array.isArray(data.manualTypes)
      ? data.manualTypes
      : {};
  const manualChoices = [];
  selectedRows.forEach((row) => {
    const index = prepared.rowNumbers.indexOf(row);
    const info = prepared.rowInfo[index] || {};
    if (info.excluded) throw new Error("IMPORT_ROW_EXCLUDED");
    if (info.needsReview) {
      const type = manualTypes[String(row)];
      if (!["income", "expense"].includes(type)) throw new Error("IMPORT_ROW_REVIEW_REQUIRED");
      manualChoices.push({ row, type });
    }
  });
  const choices =
    data.categoryChoices &&
    typeof data.categoryChoices === "object" &&
    !Array.isArray(data.categoryChoices)
      ? data.categoryChoices
      : {};
  const categoryChoices = [];
  const resolvedCategories = new Map();
  for (const row of selectedRows) {
    const index = prepared.rowNumbers.indexOf(row);
    const info = prepared.rowInfo[index] || {};
    if (!info.categoryChoiceRequired) continue;
    if (
      !Object.prototype.hasOwnProperty.call(choices, String(row)) ||
      typeof choices[String(row)] !== "string"
    )
      throw new Error("IMPORT_CATEGORY_CONFIRMATION_REQUIRED");
    const id = choices[String(row)];
    if (id.length > 128) throw new Error("INVALID_RECORD_CATEGORY");
    const manual = manualChoices.find((item) => item.row === row);
    const type = manual ? manual.type : prepared.records[index].type;
    const key = `${type}:${id}`;
    if (
      id &&
      data.recoverCategories !== true &&
      !(batch.processedRows || []).includes(row) &&
      !resolvedCategories.has(key)
    )
      resolvedCategories.set(key, await resolveRecordCategory(batch.ledgerId, type, id));
    categoryChoices.push({ row, id });
  }
  const selectedRecords = prepared.records.filter((_record, index) =>
    selected.has(prepared.rowNumbers[index])
  );
  const dates = selectedRecords.map((record) => record.date).sort();
  const result = await db.runTransaction(async (transaction) => {
    const operationRef = transaction.collection("ledgerOperations").doc(batchId);
    const operation = (await operationRef.get()).data;
    if (
      !operation ||
      operation.type !== "record-import" ||
      operation.ownerOpenid !== openid ||
      operation.ledgerId !== batch.ledgerId ||
      operation.fileHash !== batch.fileHash
    )
      throw new Error("IMPORT_BATCH_ACCESS_DENIED");
    if (operation.status === "cancelled") throw new Error("IMPORT_BATCH_CANCELLED");
    const ledgerRef = transaction.collection("ledgers").doc(batch.ledgerId);
    const ledger = (await ledgerRef.get()).data;
    assertWritable(getLedgerRole(openid, ledger));
    assertNoCategoryMigration(ledger);
    const original = operation.selectedRows || [];
    if (
      original.length &&
      (original.length !== selectedRows.length ||
        original.some((row, index) => row !== selectedRows[index]))
    )
      throw new Error("IMPORT_SELECTION_CHANGED");
    if (
      original.length &&
      JSON.stringify(operation.manualChoices || []) !== JSON.stringify(manualChoices)
    )
      throw new Error("IMPORT_SELECTION_CHANGED");
    const originalCategories = JSON.stringify(categoryChoices);
    const storedCategories = JSON.stringify(operation.categoryChoices || []);
    if (data.recoverCategories === true) {
      if (
        original.length &&
        storedCategories !== originalCategories &&
        operation.categoryRecoveryFrom !== originalCategories
      )
        throw new Error("IMPORT_SELECTION_CHANGED");
      const processed = operation.processedRows || [];
      const initialRecovery = !original.length || storedCategories === originalCategories;
      const recoveredChoices = initialRecovery
        ? categoryChoices.map((choice) =>
            processed.includes(choice.row) ? choice : { ...choice, id: "" }
          )
        : operation.categoryChoices || [];
      if (initialRecovery) {
        await operationRef.update({
          data: {
            selectedRows,
            manualChoices,
            categoryChoices: recoveredChoices,
            categoryRecoveryFrom: originalCategories,
            updatedAt: now(),
          },
        });
      }
      return {
        recovered: true,
        categoryChoices: Object.fromEntries(
          recoveredChoices.map((choice) => [String(choice.row), choice.id])
        ),
        hasMore: true,
      };
    }
    if (original.length && storedCategories !== originalCategories)
      throw new Error("IMPORT_SELECTION_CHANGED");
    if (operation.status === "complete" && operation.result) return operation.result;
    const processed = operation.processedRows || [];
    const pending = selectedRows.filter((row) => !processed.includes(row)).slice(0, 10);
    const willComplete = processed.length + pending.length === selectedRows.length;
    const fileRef = operation.fileMarkerId
      ? transaction.collection("ledgerOperations").doc(operation.fileMarkerId)
      : null;
    const fileMarker = willComplete && fileRef ? (await fileRef.get()).data : null;
    if (
      fileRef &&
      willComplete &&
      (!fileMarker ||
        fileMarker.type !== "import-file-reference" ||
        fileMarker.fileId !== operation.fileId ||
        fileMarker.ownerOpenid !== openid ||
        fileMarker.status !== "active" ||
        !Number.isInteger(fileMarker.references) ||
        fileMarker.references < 1)
    )
      throw new Error("IMPORT_FILE_REFERENCE_INVALID");
    const pendingCategories = new Map();
    for (const row of pending) {
      const categoryChoice = categoryChoices.find((item) => item.row === row);
      if (!categoryChoice || !categoryChoice.id) continue;
      const index = prepared.rowNumbers.indexOf(row);
      const manual = manualChoices.find((item) => item.row === row);
      const type = manual ? manual.type : prepared.records[index].type;
      const key = `${type}:${categoryChoice.id}`;
      if (!pendingCategories.has(key)) {
        pendingCategories.set(
          key,
          await resolveRecordCategory(
            batch.ledgerId,
            type,
            categoryChoice.id,
            async (id) => (await transaction.collection("categories").doc(id).get()).data
          )
        );
      }
    }
    const markers = new Map();
    for (const row of pending) {
      const record = prepared.records[prepared.rowNumbers.indexOf(row)];
      const id = sourceIdentityId(batch.ledgerId, record);
      if (id && !markers.has(id)) {
        markers.set(
          id,
          await getOptionalImportIdentity(transaction.collection("ledgerOperations"), id)
        );
      }
    }
    const duplicateRows = [...(operation.duplicateRows || [])];
    let written = 0;
    for (const row of pending) {
      const index = prepared.rowNumbers.indexOf(row);
      const choice = manualChoices.find((item) => item.row === row);
      const recordType = choice ? choice.type : prepared.records[index].type;
      const categoryChoice = categoryChoices.find((item) => item.row === row);
      const resolved =
        categoryChoice && categoryChoice.id
          ? pendingCategories.get(`${recordType}:${categoryChoice.id}`)
          : null;
      const record = {
        ...prepared.records[index],
        type: recordType,
        ...(resolved || {}),
        importBatchId: batchId,
      };
      const identityId = sourceIdentityId(batch.ledgerId, record);
      if (identityId && markers.get(identityId)) {
        duplicateRows.push(row);
        continue;
      }
      const created = await transaction.collection("records").add({ data: record });
      if (identityId) {
        const identity = {
          type: "import-source-identity",
          ledgerId: batch.ledgerId,
          source: record.source,
          sourceKind: record.sourceKind,
          sourceTransactionId: record.sourceTransactionId,
          recordId: created._id,
          createdAt: now(),
        };
        await transaction.collection("ledgerOperations").doc(identityId).set({ data: identity });
        markers.set(identityId, identity);
      }
      written += 1;
    }
    const processedRows = [...processed, ...pending];
    const complete = processedRows.length === selectedRows.length;
    const summary = {
      imported: processedRows.length - duplicateRows.length,
      duplicates: duplicateRows.length,
      hasMore: !complete,
      skipped: prepared.errors.length + duplicateRows.length,
      errors: prepared.errors.slice(0, 20),
      startDate: dates[0] || "",
      endDate: dates[dates.length - 1] || "",
    };
    await operationRef.update({
      data: {
        selectedRows,
        manualChoices,
        categoryChoices,
        processedRows,
        duplicateRows,
        status: complete ? "complete" : "running",
        ...(complete ? { result: summary } : {}),
        updatedAt: now(),
      },
    });
    if (complete && fileRef) {
      const references = fileMarker.references - 1;
      await fileRef.update({
        data: { references, status: references ? "active" : "deleting", updatedAt: now() },
      });
    }
    if (written) await ledgerRef.update({ data: { syncRevision: _.inc(1), updatedAt: now() } });
    return summary;
  });
  if (result.recovered) return ok(result);
  const cleanupStatus = result.hasMore ? "active" : await cleanupCompletedImportFile(batch);
  return ok({ ...result, cleanupStatus });
}

async function cancelImportPreview(openid, data = {}) {
  const batchId = String(data.batchId || "");
  if (!batchId) throw new Error("IMPORT_BATCH_REQUIRED");
  const batch = (await db.collection("ledgerOperations").doc(batchId).get()).data;
  if (!batch || batch.type !== "record-import" || batch.ownerOpenid !== openid)
    throw new Error("IMPORT_BATCH_ACCESS_DENIED");
  const ledger = await getLedgerForUser(openid, batch.ledgerId);
  assertWritable(getLedgerRole(openid, ledger));
  await db.runTransaction(async (transaction) => {
    const operationRef = transaction.collection("ledgerOperations").doc(batchId);
    const operation = (await operationRef.get()).data;
    const currentLedger = (await transaction.collection("ledgers").doc(batch.ledgerId).get()).data;
    assertWritable(getLedgerRole(openid, currentLedger));
    if (!operation || operation.ownerOpenid !== openid || operation.ledgerId !== batch.ledgerId)
      throw new Error("IMPORT_BATCH_ACCESS_DENIED");
    if (operation.status === "cancelled") return;
    if (
      operation.status !== "preview" ||
      (operation.selectedRows || []).length ||
      (operation.processedRows || []).length
    )
      throw new Error("IMPORT_BATCH_ALREADY_STARTED");
    if (operation.fileMarkerId) {
      const fileRef = transaction.collection("ledgerOperations").doc(operation.fileMarkerId);
      const marker = (await fileRef.get()).data;
      if (
        !marker ||
        marker.type !== "import-file-reference" ||
        marker.fileId !== operation.fileId ||
        marker.ownerOpenid !== openid ||
        marker.status !== "active" ||
        !Number.isInteger(marker.references) ||
        marker.references < 1
      )
        throw new Error("IMPORT_FILE_REFERENCE_INVALID");
      const references = marker.references - 1;
      await fileRef.update({
        data: { references, status: references ? "active" : "deleting", updatedAt: now() },
      });
    }
    await operationRef.update({ data: { status: "cancelled", updatedAt: now() } });
  });
  return ok({ cleanupStatus: await cleanupCompletedImportFile(batch) });
}

async function retryImportFileCleanup(openid, data = {}) {
  const batchId = String(data.batchId || "");
  if (!batchId) throw new Error("IMPORT_BATCH_REQUIRED");
  const batch = (await db.collection("ledgerOperations").doc(batchId).get()).data;
  if (!batch || batch.type !== "record-import" || batch.ownerOpenid !== openid)
    throw new Error("IMPORT_BATCH_ACCESS_DENIED");
  const ledger = await getLedgerForUser(openid, batch.ledgerId);
  assertWritable(getLedgerRole(openid, ledger));
  if (!["complete", "cancelled"].includes(batch.status))
    throw new Error("IMPORT_BATCH_NOT_COMPLETE");
  return ok({ cleanupStatus: await cleanupCompletedImportFile(batch) });
}

async function sweepImportFileCleanup(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  assertWritable(getLedgerRole(openid, ledger));
  const markers =
    (
      await db
        .collection("ledgerOperations")
        .where({
          type: "import-file-reference",
          ownerOpenid: openid,
          status: "deleting",
          references: 0,
        })
        .orderBy("updatedAt", "asc")
        .limit(5)
        .get()
    ).data || [];
  let pending = 0;
  for (const marker of markers) {
    const status = await cleanupCompletedImportFile({
      fileMarkerId: marker._id,
      fileId: marker.fileId,
      ownerOpenid: openid,
    });
    if (status === "pending") pending += 1;
  }
  return ok({ pending, hasMore: markers.length === 5 });
}

async function listImportPreviews(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  assertWritable(getLedgerRole(openid, ledger));
  const rows =
    (
      await db
        .collection("ledgerOperations")
        .where({
          type: "record-import",
          ledgerId: ledger._id,
          ownerOpenid: openid,
          status: "preview",
          selectedRows: _.size(0),
        })
        .orderBy("createdAt", "asc")
        .limit(50)
        .get()
    ).data || [];
  return ok({
    previews: rows
      .filter((row) => !(row.selectedRows || []).length && !(row.processedRows || []).length)
      .map((row) => ({ batchId: row._id, createdAt: row.createdAt })),
  });
}

module.exports = {
  attachRecordOwner,
  applyCategoryFilter,
  makeFamilyFilter,
  isValidImportDate,
  createRecord,
  listRecords,
  getRecord,
  updateRecord,
  deleteRecord,
  getImportTemplate,
  createImportUpload,
  abandonImportUpload,
  previewImport,
  importRecords,
  cancelImportPreview,
  retryImportFileCleanup,
  sweepImportFileCleanup,
  listImportPreviews,
};
