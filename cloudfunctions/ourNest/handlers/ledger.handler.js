// 账本域：账本 CRUD、成员管理、同步、邀请加入、可恢复删除。
const {
  db,
  _,
  ok,
  fail,
  now,
  generateUniqueLedgerCode,
  getUser,
  getLedgerById,
  listLedgersForUser,
  getLedgerForUser,
  ensureLedgerSyncRevision,
  getUsersByOpenids,
  resolveUsersAvatarUrls,
  getOperation,
  saveOperation,
  getLedgerInviteByToken,
  getLedgerRole,
  assertReadable,
  assertLedgerId,
  defaultAvatarUrl,
  SCHEMA_VERSION,
  defaultQuickAmounts,
  defaultPaymentAccounts,
} = require("../shared/helpers");
const { createDefaultCategories } = require("./category-tree");
const { assertOpenid, assertLedgerInput, assertInviteInput } = require("../validators/schemas");
const crypto = require("crypto");
const { createInviteCode, normalizeInviteCode, getInviteStatus } = require("../invite-code");

// --- 账本 CRUD ---

async function createLedger(openid, data = {}) {
  assertOpenid(openid);

  const ledgerType = data.type === "shared" ? "shared" : "personal";
  const { name, remark, type } = assertLedgerInput({
    name: data.name,
    remark: data.remark,
    type: ledgerType,
  });
  void type; // assertLedgerInput 返回 type 但已在上方确定，保持结构不变

  const budgetEnabled = Boolean(data.budgetEnabled);
  const quickAmountsEnabled = Boolean(data.quickAmountsEnabled);
  const requestedBudget = Number(data.monthlyBudget);
  const monthlyBudget =
    budgetEnabled && Number.isFinite(requestedBudget)
      ? Math.min(999999, Math.max(1, Math.round(requestedBudget * 100) / 100))
      : 0;
  const ledgerNo = await generateUniqueLedgerCode("ledgerNo", { prefix: "L", min: 7, max: 11 });

  const ledger = {
    ledgerNo,
    name,
    remark,
    type,
    ownerOpenid: openid,
    members: [{ openid, role: "owner", joinedAt: new Date() }],
    memberOpenids: [openid],
    viewers: [],
    viewerOpenids: [],
    budgetEnabled,
    monthlyBudget,
    quickAmountsEnabled,
    quickAmounts: quickAmountsEnabled ? defaultQuickAmounts : [],
    accounts: defaultPaymentAccounts,
    accountsConfigured: true,
    syncRevision: 1,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now(),
    updatedAt: now(),
  };
  const res = await db.collection("ledgers").add({ data: ledger });
  await createDefaultCategories(res._id, openid);
  await db
    .collection("users")
    .where({ openid })
    .update({ data: { currentLedgerId: res._id, updatedAt: now() } });
  return ok({ ledgerId: res._id, ledger: { ...ledger, _id: res._id } });
}

async function updateLedger(openid, data = {}) {
  assertLedgerId(data.ledgerId);
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  const role = getLedgerRole(openid, ledger);
  if (role !== "owner") return fail("只有账本拥有者可以编辑账本", "ONLY_OWNER_CAN_UPDATE_LEDGER");

  const { name, remark } = assertLedgerInput({
    name: data.name,
    remark: data.remark,
  });

  if (name === String(ledger.name || "").trim() && remark === String(ledger.remark || "").trim())
    return ok({ changed: false, ledger });

  const syncRevision = Number(ledger.syncRevision || 0) + 1;
  await db
    .collection("ledgers")
    .doc(ledger._id)
    .update({
      data: {
        name,
        remark,
        syncRevision: _.inc(1),
        updatedAt: now(),
      },
    });
  return ok({ changed: true, ledger: { ...ledger, name, remark, syncRevision } });
}

async function listLedgers(openid) {
  const ledgers = await listLedgersForUser(openid);
  const initialized = await Promise.all(
    ledgers.map((ledger) => ensureLedgerSyncRevision(openid, ledger._id))
  );
  return ok({ ledgers: initialized.filter(Boolean) });
}

// --- 同步 ---

function getLedgerRevisionMap(ledgers = []) {
  return ledgers.reduce((result, ledger) => {
    result[ledger._id] = ledger.syncRevision;
    return result;
  }, {});
}

async function syncLedgers(openid, data = {}) {
  const ledgerRows =
    (
      await db
        .collection("ledgers")
        .where(
          _.or([{ ownerOpenid: openid }, { memberOpenids: openid }, { viewerOpenids: openid }])
        )
        .field({ _id: true })
        .get()
    ).data || [];
  // Recheck authorization and revision in one transaction per ledger. This
  // deliberately avoids a blind read-then-write migration race.
  const revisionRows = await Promise.all(
    ledgerRows.map((ledger) => ensureLedgerSyncRevision(openid, ledger._id))
  );
  const revisions = getLedgerRevisionMap(revisionRows.filter(Boolean));
  const clientRevisions =
    data.revisions && typeof data.revisions === "object" && !Array.isArray(data.revisions)
      ? data.revisions
      : {};
  const changedLedgerIds = Object.keys(revisions).filter(
    (ledgerId) =>
      !Object.prototype.hasOwnProperty.call(clientRevisions, ledgerId) ||
      Number(clientRevisions[ledgerId]) !== revisions[ledgerId]
  );
  const removedLedgerIds = Object.keys(clientRevisions).filter(
    (ledgerId) => !Object.prototype.hasOwnProperty.call(revisions, ledgerId)
  );
  const changed = Boolean(changedLedgerIds.length || removedLedgerIds.length);
  const ledgers = changed ? await listLedgersForUser(openid) : [];
  const user = await getUser(openid);
  const currentLedgerId =
    user && Object.prototype.hasOwnProperty.call(revisions, user.currentLedgerId)
      ? user.currentLedgerId
      : revisionRows[0]
        ? revisionRows[0]._id
        : "";
  const currentLedger = changed
    ? ledgers.find((ledger) => ledger._id === currentLedgerId) || null
    : null;
  if (user && user._id && user.currentLedgerId !== currentLedgerId) {
    await db
      .collection("users")
      .doc(user._id)
      .update({ data: { currentLedgerId, updatedAt: now() } });
  }
  return ok({
    changed,
    changedLedgerIds,
    removedLedgerIds,
    revisions,
    currentLedgerId,
    ...(changed ? { currentLedger, ledgers } : {}),
  });
}

// --- 成员管理 ---

function toUniqueOpenids(values = []) {
  return Array.from(new Set(values.map((value) => String(value || "")).filter(Boolean)));
}

async function getLedgerMembers(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  const role = getLedgerRole(openid, ledger);
  assertReadable(role);

  const memberOpenids = toUniqueOpenids([
    ledger.ownerOpenid,
    ...(ledger.memberOpenids || []),
    ...(ledger.members || []).map((item) => item.openid),
  ]);
  const viewerOpenids = toUniqueOpenids(ledger.viewerOpenids || []).filter(
    (item) => !memberOpenids.includes(item)
  );
  const users = await resolveUsersAvatarUrls(
    await getUsersByOpenids([...memberOpenids, ...viewerOpenids])
  );
  const memberRows = memberOpenids.map((memberOpenid) => {
    const user = users[memberOpenid] || {};
    const isOwner = memberOpenid === ledger.ownerOpenid;
    return {
      openid: memberOpenid,
      nickName: user.nickName || (isOwner ? "账本拥有者" : "账本成员"),
      avatarUrl: user.avatarUrl || defaultAvatarUrl,
      role: isOwner ? "owner" : "member",
    };
  });
  const visitorRows = viewerOpenids.map((viewerOpenid) => {
    const user = users[viewerOpenid] || {};
    return {
      openid: viewerOpenid,
      nickName: user.nickName || "账本访客",
      avatarUrl: user.avatarUrl || defaultAvatarUrl,
      role: "visitor",
    };
  });
  return ok({
    ledger: { id: ledger._id, name: ledger.name, type: ledger.type || "personal" },
    role,
    canManage: role === "owner",
    ownerTransfer:
      ledger.ownerTransfer && (role === "owner" || ledger.ownerTransfer.targetOpenid === openid)
        ? ledger.ownerTransfer
        : null,
    members: [...memberRows, ...visitorRows],
  });
}

async function removeLedgerMember(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  const targetOpenid = String(data.targetOpenid || "");
  await updateMembership(ledger._id, openid, targetOpenid, "remove");
  return ok();
}

async function updateMembership(ledgerId, openid, targetOpenid, action) {
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection("ledgers").doc(ledgerId);
    const ledger = (await ref.get()).data;
    const callerRole = getLedgerRole(openid, ledger);
    if (action === "leave") {
      if (callerRole === "owner") throw new Error("OWNER_CANNOT_LEAVE");
      assertReadable(callerRole);
      targetOpenid = openid;
    } else if (callerRole !== "owner") throw new Error("ONLY_OWNER_CAN_MANAGE_MEMBERS");
    if (!targetOpenid || targetOpenid === ledger.ownerOpenid)
      throw new Error("OWNER_CANNOT_BE_REMOVED");
    const previousRole = getLedgerRole(targetOpenid, ledger);
    if (previousRole === "none") throw new Error("MEMBER_NOT_FOUND");
    if (action === "member" && ledger.type !== "shared") throw new Error("SHARED_LEDGER_REQUIRED");
    const members = (ledger.members || []).filter((item) => item.openid !== targetOpenid);
    const viewers = (ledger.viewers || []).filter((item) => item.openid !== targetOpenid);
    const memberOpenids = toUniqueOpenids(ledger.memberOpenids || []).filter(
      (id) => id !== targetOpenid
    );
    const viewerOpenids = toUniqueOpenids(ledger.viewerOpenids || []).filter(
      (id) => id !== targetOpenid
    );
    if (action === "member") {
      members.push({ openid: targetOpenid, role: "member", joinedAt: now() });
      memberOpenids.push(targetOpenid);
    } else if (action === "visitor") {
      viewers.push({ openid: targetOpenid, joinedAt: now() });
      viewerOpenids.push(targetOpenid);
    }
    const pending = ledger.ownerTransfer;
    await ref.update({
      data: {
        members,
        memberOpenids,
        viewers,
        viewerOpenids,
        ownerTransfer: pending && pending.targetOpenid === targetOpenid ? null : pending || null,
        syncRevision: _.inc(1),
        updatedAt: now(),
      },
    });
  });
}

async function leaveLedger(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  await updateMembership(ledger._id, openid, openid, "leave");
  return ok();
}

async function changeLedgerMemberRole(openid, data = {}) {
  if (!["member", "visitor"].includes(data.role)) throw new Error("INVALID_ROLE");
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  await updateMembership(ledger._id, openid, String(data.targetOpenid || ""), data.role);
  return ok();
}

async function requestOwnerTransfer(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection("ledgers").doc(ledger._id);
    const current = (await ref.get()).data;
    if (getLedgerRole(openid, current) !== "owner") throw new Error("ONLY_OWNER_CAN_TRANSFER");
    if (current.type !== "shared" || getLedgerRole(data.targetOpenid, current) !== "member")
      throw new Error("TRANSFER_TARGET_MUST_BE_MEMBER");
    await ref.update({
      data: {
        ownerTransfer: { fromOpenid: openid, targetOpenid: data.targetOpenid },
        syncRevision: _.inc(1),
        updatedAt: now(),
      },
    });
  });
  return ok();
}

async function acceptOwnerTransfer(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection("ledgers").doc(ledger._id);
    const current = (await ref.get()).data;
    const pending = current.ownerTransfer;
    if (
      !pending ||
      pending.targetOpenid !== openid ||
      pending.fromOpenid !== current.ownerOpenid ||
      getLedgerRole(openid, current) !== "member" ||
      current.type !== "shared"
    )
      throw new Error("TRANSFER_NOT_AVAILABLE");
    const members = (current.members || []).filter(
      (item) => item.openid !== openid && item.openid !== current.ownerOpenid
    );
    members.push(
      { openid: current.ownerOpenid, role: "member", joinedAt: now() },
      { openid, role: "owner", joinedAt: now() }
    );
    await ref.update({
      data: {
        ownerOpenid: openid,
        ownerEpoch: Number(current.ownerEpoch || 0) + 1,
        members,
        memberOpenids: toUniqueOpenids([
          ...(current.memberOpenids || []),
          current.ownerOpenid,
          openid,
        ]),
        ownerTransfer: null,
        syncRevision: _.inc(1),
        updatedAt: now(),
      },
    });
  });
  return ok();
}

async function cancelOwnerTransfer(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection("ledgers").doc(ledger._id);
    const current = (await ref.get()).data;
    const pending = current.ownerTransfer;
    if (!pending || (current.ownerOpenid !== openid && pending.targetOpenid !== openid))
      throw new Error("TRANSFER_NOT_AVAILABLE");
    await ref.update({ data: { ownerTransfer: null, syncRevision: _.inc(1), updatedAt: now() } });
  });
  return ok();
}

async function setCurrentLedger(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  const role = getLedgerRole(openid, ledger);
  assertReadable(role);
  const user = await getUser(openid);
  if (user && user._id) {
    await db
      .collection("users")
      .doc(user._id)
      .update({ data: { currentLedgerId: ledger._id, updatedAt: now() } });
  }
  return ok({ ledger, role });
}

// --- 邀请与加入 ---

async function createLedgerInviteToken(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  const role = getLedgerRole(openid, ledger);
  if (role !== "owner") throw new Error("ONLY_OWNER_CAN_INVITE");
  const mode = ledger.type === "shared" && data.mode === "member" ? "member" : "visitor";
  const token = createInviteCode();
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  await db.runTransaction(async (transaction) => {
    const ledgerRef = transaction.collection("ledgers").doc(ledger._id);
    const currentLedger = (await ledgerRef.get()).data;
    if (getLedgerRole(openid, currentLedger) !== "owner") throw new Error("ONLY_OWNER_CAN_INVITE");
    await transaction.collection("ledgerInvites").add({
      data: {
        token,
        ledgerId: ledger._id,
        mode,
        ownerOpenid: openid,
        ownerEpoch: Number(currentLedger.ownerEpoch || 0),
        claimedOpenid: "",
        expiresAt,
        createdAt: now(),
        updatedAt: now(),
      },
    });
    await ledgerRef.update({ data: { syncRevision: _.inc(1), updatedAt: now() } });
  });
  return ok({ token, mode, expiresAt });
}

async function listLedgerInvites(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  if (getLedgerRole(openid, ledger) !== "owner") throw new Error("ONLY_OWNER_CAN_INVITE");
  const rows = [];
  let offset = 0;
  let page;
  do {
    const result = await db
      .collection("ledgerInvites")
      .where({ ledgerId: ledger._id, ownerOpenid: openid, expiresAt: _.gt(Date.now()) })
      .orderBy("_id", "asc")
      .skip(offset)
      .limit(100)
      .get();
    page = result.data || [];
    rows.push(...page);
    offset += page.length;
  } while (page.length === 100);
  return ok({
    invites: rows
      .filter(
        (item) =>
          !item.claimedOpenid &&
          !item.revokedAt &&
          Number(item.expiresAt) > Date.now() &&
          Number(item.ownerEpoch || 0) === Number(ledger.ownerEpoch || 0)
      )
      .map((item) => ({
        id: item._id,
        mode: item.mode,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt,
      })),
  });
}

async function revokeLedgerInvite(openid, data = {}) {
  const ledger = await getLedgerForUser(openid, data.ledgerId);
  await db.runTransaction(async (transaction) => {
    const current = (await transaction.collection("ledgers").doc(ledger._id).get()).data;
    if (getLedgerRole(openid, current) !== "owner") throw new Error("ONLY_OWNER_CAN_INVITE");
    const ref = transaction.collection("ledgerInvites").doc(String(data.inviteId || ""));
    const invite = (await ref.get()).data;
    if (!invite || invite.ledgerId !== ledger._id || invite.ownerOpenid !== openid)
      throw new Error("INVITE_NOT_FOUND");
    if (invite.claimedOpenid) throw new Error("INVITE_ALREADY_CLAIMED");
    if (!invite.revokedAt) await ref.update({ data: { revokedAt: now(), updatedAt: now() } });
  });
  return ok();
}

async function limitInviteAttempts(openid) {
  assertOpenid(openid);
  const id = `invite-rate-${crypto.createHash("sha256").update(openid).digest("hex")}`;
  const timestamp = Date.now();
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection("ledgerOperations").doc(id);
    let current = null;
    try {
      current = (await ref.get()).data;
    } catch (error) {
      const message = String(error.errMsg || error.message || "");
      if (!message.includes(`document with _id ${id} does not exist`)) throw error;
    }
    const active = current && timestamp - Number(current.windowStart) < 60000;
    if (active && current.count >= 10) throw new Error("邀请码尝试次数过多，请稍后再试");
    await ref.set({
      data: {
        type: "invite-rate-limit",
        windowStart: active ? current.windowStart : timestamp,
        count: active ? current.count + 1 : 1,
        updatedAt: now(),
      },
    });
  });
}

function assertInviteAvailable(invite, openid) {
  const status = getInviteStatus(invite, openid);
  if (status === "invalid") throw new Error("邀请码无效");
  if (status === "expired") throw new Error("邀请码已过期，请重新获取");
  if (status === "claimed") throw new Error("邀请码已被使用，请重新获取");
  if (status === "revoked") throw new Error("邀请码已撤销，请重新获取");
  return status;
}

async function previewLedgerInvite(openid, data = {}) {
  await limitInviteAttempts(openid);
  const token = normalizeInviteCode(data.inviteCode);
  if (!token) throw new Error("邀请码格式不正确");
  const invite = await getLedgerInviteByToken(token);
  const status = assertInviteAvailable(invite, openid);
  const ledger = await getLedgerById(invite.ledgerId);
  if (!ledger) throw new Error("账本不存在");
  if (
    (invite.ownerOpenid && invite.ownerOpenid !== ledger.ownerOpenid) ||
    Number(invite.ownerEpoch || 0) !== Number(ledger.ownerEpoch || 0)
  )
    throw new Error("邀请已失效，请重新获取");
  const owner = await getUser(ledger.ownerOpenid);
  const role = getLedgerRole(openid, ledger);
  return ok({
    ledgerName: ledger.name,
    ownerName: (owner && owner.nickName) || "账本拥有者",
    currentRole: role,
    mode:
      role === "readonly"
        ? "visitor"
        : role === "member" || role === "owner"
          ? "member"
          : ledger.type === "shared" && invite.mode === "member"
            ? "member"
            : "visitor",
    already: role !== "none",
    claimedBySelf: status === "claimed-by-self",
  });
}

async function joinLedgerByInviteToken(openid, data = {}) {
  await limitInviteAttempts(openid);
  const token = normalizeInviteCode(data.inviteToken);
  assertInviteInput({ token });
  const invite = await getLedgerInviteByToken(token);
  if (!invite) return fail("邀请链接无效", "INVALID_INVITE_TOKEN");

  const joined = await db.runTransaction(async (transaction) => {
    const currentInvite = (await transaction.collection("ledgerInvites").doc(invite._id).get())
      .data;
    if (!currentInvite) throw new Error("INVITE_NOT_FOUND");
    assertInviteAvailable(currentInvite, openid);
    const ledger = (await transaction.collection("ledgers").doc(currentInvite.ledgerId).get()).data;
    if (!ledger) throw new Error("LEDGER_NOT_FOUND");
    if (
      (currentInvite.ownerOpenid && currentInvite.ownerOpenid !== ledger.ownerOpenid) ||
      Number(currentInvite.ownerEpoch || 0) !== Number(ledger.ownerEpoch || 0)
    )
      throw new Error("邀请已失效，请重新获取");

    const currentRole = getLedgerRole(openid, ledger);
    if (currentInvite.claimedOpenid === openid && currentRole === "none")
      throw new Error("邀请已使用，请重新获取");
    if (currentRole === "none") {
      const nextRole =
        currentInvite.mode === "member" && ledger.type === "shared" ? "member" : "readonly";
      if (nextRole === "member") {
        await transaction
          .collection("ledgers")
          .doc(ledger._id)
          .update({
            data: {
              members: [...(ledger.members || []), { openid, role: "member", joinedAt: now() }],
              memberOpenids: toUniqueOpenids([...(ledger.memberOpenids || []), openid]),
              syncRevision: _.inc(1),
              updatedAt: now(),
            },
          });
      } else {
        await transaction
          .collection("ledgers")
          .doc(ledger._id)
          .update({
            data: {
              viewers: [...(ledger.viewers || []), { openid, joinedAt: now() }],
              viewerOpenids: toUniqueOpenids([...(ledger.viewerOpenids || []), openid]),
              syncRevision: _.inc(1),
              updatedAt: now(),
            },
          });
      }
    }
    if (!currentInvite.claimedOpenid && currentRole === "none") {
      await transaction
        .collection("ledgerInvites")
        .doc(currentInvite._id)
        .update({
          data: { claimedOpenid: openid, updatedAt: now() },
        });
    }
    return {
      ledger,
      already: currentRole !== "none",
      role:
        currentRole === "none"
          ? currentInvite.mode === "member" && ledger.type === "shared"
            ? "member"
            : "readonly"
          : currentRole,
    };
  });
  return ok({ ledgerId: joined.ledger._id, ...joined });
}

// --- 可恢复删除 ---

async function deleteByQuery(collectionName, query) {
  let deleted = 0;
  while (true) {
    const result = await db.collection(collectionName).where(query).limit(100).get();
    const rows = result.data || [];
    if (!rows.length) break;
    const removals = await Promise.all(
      rows.map(async (item) => {
        try {
          await db.collection(collectionName).doc(item._id).remove();
          return true;
        } catch (error) {
          const message = String((error && (error.errMsg || error.message)) || "");
          if (message.includes("does not exist")) return false;
          throw error;
        }
      })
    );
    deleted += removals.filter(Boolean).length;
  }
  return deleted;
}

async function runLedgerDeletion(openid, ledgerId) {
  const key = "delete:" + ledgerId;
  let operation = await getOperation("ledger-delete", key);
  let ledger = await getLedgerById(ledgerId);
  if (!operation) {
    if (!ledger) throw new Error("LEDGER_NOT_FOUND");
    if (ledger.ownerOpenid !== openid) throw new Error("ONLY_OWNER_CAN_DELETE_LEDGER");
    operation = await saveOperation(null, {
      type: "ledger-delete",
      key,
      ledgerId,
      ownerOpenid: openid,
      stage: "records",
      status: "running",
    });
  } else if (operation.ownerOpenid !== openid) {
    throw new Error("ONLY_OWNER_CAN_DELETE_LEDGER");
  }
  if (operation.stage === "records")
    operation = await saveOperation(operation, {
      stage: "categories",
      deletedRecords: await deleteByQuery("records", { ledgerId }),
    });
  if (operation.stage === "categories")
    operation = await saveOperation(operation, {
      stage: "ledger",
      deletedCategories: await deleteByQuery("categories", { ledgerId }),
    });
  if (operation.stage === "ledger") {
    ledger = ledger || (await getLedgerById(ledgerId));
    if (ledger) await db.collection("ledgers").doc(ledgerId).remove();
    operation = await saveOperation(operation, {
      stage: "complete",
      status: "complete",
      completedAt: now(),
    });
  }
  const user = await getUser(openid);
  let currentLedger = null;
  let currentLedgerId = user && user.currentLedgerId !== ledgerId ? user.currentLedgerId || "" : "";
  if (user && user.currentLedgerId === ledgerId) {
    const rest = await listLedgersForUser(openid);
    currentLedger = rest[0] || null;
    currentLedgerId = currentLedger ? currentLedger._id : "";
    await db
      .collection("users")
      .doc(user._id)
      .update({ data: { currentLedgerId, updatedAt: now() } });
  } else if (currentLedgerId) currentLedger = await getLedgerById(currentLedgerId);
  return { currentLedgerId, currentLedger, operationId: operation._id };
}

async function deleteLedger(openid, data = {}) {
  assertLedgerId(data.ledgerId);
  if (!openid) return fail("LOGIN_REQUIRED", "OPENID_MISSING");
  return ok(await runLedgerDeletion(openid, data.ledgerId));
}

module.exports = {
  createLedger,
  updateLedger,
  listLedgers,
  syncLedgers,
  getLedgerMembers,
  removeLedgerMember,
  leaveLedger,
  changeLedgerMemberRole,
  requestOwnerTransfer,
  acceptOwnerTransfer,
  cancelOwnerTransfer,
  setCurrentLedger,
  createLedgerInviteToken,
  listLedgerInvites,
  revokeLedgerInvite,
  previewLedgerInvite,
  joinLedgerByInviteToken,
  deleteLedger,
};
