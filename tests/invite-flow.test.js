const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const inviteCode = require("../cloudfunctions/ourNest/invite-code");

function setup(mode = "member", type = "shared") {
  const rows = {
    ledgers: {
      ledger: {
        _id: "ledger",
        name: "家",
        type,
        ownerOpenid: "owner",
        memberOpenids: ["owner"],
        members: [],
        viewerOpenids: [],
        viewers: [],
        syncRevision: 1,
      },
    },
    ledgerInvites: {
      invite: {
        _id: "invite",
        token: "K7M92P4X",
        ledgerId: "ledger",
        mode,
        expiresAt: Date.now() + 60000,
        claimedOpenid: "",
      },
    },
    ledgerOperations: {},
  };
  const collection = (name) => ({
    async add({ data }) {
      rows[name].created = { ...data, _id: "created" };
    },
    doc(id) {
      return {
        async get() {
          return { data: rows[name][id] || null };
        },
        async set({ data }) {
          rows[name][id] = data;
        },
        async update({ data }) {
          const row = rows[name][id];
          for (const [key, value] of Object.entries(data))
            row[key] = value && value.inc ? (row[key] || 0) + value.inc : value;
        },
      };
    },
  });
  const db = { collection, runTransaction: async (fn) => fn({ collection }) };
  const helpers = {
    db,
    _: { inc: (inc) => ({ inc }) },
    ok: (data) => ({ success: true, data }),
    now: () => new Date(),
    getUser: async () => ({ nickName: "主人" }),
    getLedgerById: async (id) => rows.ledgers[id],
    getLedgerForUser: async () => rows.ledgers.ledger,
    getLedgerInviteByToken: async (token) =>
      Object.values(rows.ledgerInvites).find((row) => row.token === token),
    getLedgerRole: (openid, ledger) =>
      ledger.ownerOpenid === openid
        ? "owner"
        : ledger.memberOpenids.includes(openid)
          ? "member"
          : ledger.viewerOpenids.includes(openid)
            ? "readonly"
            : "none",
    assertReadable: (role) => {
      if (role === "none") throw new Error("NO_LEDGER_ACCESS");
    },
  };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync("cloudfunctions/ourNest/handlers/ledger.handler.js", "utf8"), {
    module: mod,
    exports: mod.exports,
    Date,
    console,
    require: (name) => {
      if (name.includes("shared/ledger-state"))
        return require("../cloudfunctions/ourNest/shared/ledger-state");
      if (name.includes("shared/helpers")) return helpers;
      if (name.includes("validators/schemas"))
        return { assertOpenid: () => {}, assertInviteInput: () => {} };
      if (name === "../invite-code") return inviteCode;
      if (name === "crypto") return require("node:crypto");
      return {};
    },
  });
  return { handler: mod.exports, rows };
}

test("只有拥有者能生成邀请，个人账本只能生成访客邀请", async () => {
  const { handler, rows } = setup("visitor", "personal");
  await assert.rejects(handler.createLedgerInviteToken("guest", { mode: "member" }), /ONLY_OWNER/);
  const result = await handler.createLedgerInviteToken("owner", { mode: "member" });
  assert.equal(result.data.mode, "visitor");
  assert.equal(rows.ledgerInvites.created.mode, "visitor");
  assert.ok(result.data.expiresAt > Date.now());
});

test("共享账本邀请码领取一次，同一用户重试不重复写入", async () => {
  const { handler, rows } = setup();
  const preview = await handler.previewLedgerInvite("new-user", { inviteCode: "k7m9-2p4x" });
  assert.equal(preview.data.ledgerName, "家");
  const first = await handler.joinLedgerByInviteToken("new-user", { inviteToken: "K7M92P4X" });
  assert.equal(first.data.role, "member");
  await handler.joinLedgerByInviteToken("new-user", { inviteToken: "K7M92P4X" });
  assert.equal(rows.ledgers.ledger.memberOpenids.filter((id) => id === "new-user").length, 1);
  await assert.rejects(
    handler.joinLedgerByInviteToken("other", { inviteToken: "K7M92P4X" }),
    /已被使用/
  );
});

test("个人账本邀请只产生访客，过期邀请码不可加入", async () => {
  const { handler, rows } = setup("visitor", "personal");
  const result = await handler.joinLedgerByInviteToken("guest", { inviteToken: "K7M92P4X" });
  assert.equal(result.data.role, "readonly");
  assert.equal(rows.ledgers.ledger.viewerOpenids.includes("guest"), true);
  const expired = setup();
  expired.rows.ledgerInvites.invite.expiresAt = Date.now() - 1;
  await assert.rejects(
    expired.handler.joinLedgerByInviteToken("guest", { inviteToken: "K7M92P4X" }),
    /已过期/
  );
});

test("邀请码请求按用户限频", async () => {
  const { handler } = setup();
  for (let i = 0; i < 10; i += 1) {
    await assert.rejects(handler.previewLedgerInvite("user", { inviteCode: "invalid" }));
  }
  await assert.rejects(
    handler.previewLedgerInvite("user", { inviteCode: "K7M92P4X" }),
    /尝试次数过多/
  );
});

test("撤销邀请后不能预览或领取，所有权转移后的旧邀请码不能恢复使用", async () => {
  const revoked = setup();
  revoked.rows.ledgerInvites.invite.ownerOpenid = "owner";
  await revoked.handler.revokeLedgerInvite("owner", { ledgerId: "ledger", inviteId: "invite" });
  await assert.rejects(
    revoked.handler.previewLedgerInvite("new-user", { inviteCode: "K7M92P4X" }),
    /已撤销/
  );
  await assert.rejects(
    revoked.handler.joinLedgerByInviteToken("new-user", { inviteToken: "K7M92P4X" }),
    /已撤销/
  );
  const transferred = setup();
  transferred.rows.ledgerInvites.invite.ownerOpenid = "owner";
  transferred.rows.ledgers.ledger.ownerEpoch = 2;
  await assert.rejects(
    transferred.handler.joinLedgerByInviteToken("new-user", { inviteToken: "K7M92P4X" }),
    /已失效/
  );
});

test("分享链接预览后必须确认才能加入", async () => {
  let page;
  let joined = 0;
  const app = { globalData: { loggedIn: true } };
  vm.runInNewContext(fs.readFileSync("miniprogram/pages/ledger-join-result/index.js", "utf8"), {
    Page: (value) => {
      page = value;
    },
    getApp: () => app,
    wx: {},
    console,
    require: (name) => {
      if (name.includes("shared/ledger-state"))
        return require("../cloudfunctions/ourNest/shared/ledger-state");
      if (name.includes("ledger.service"))
        return { previewLedgerInvite: async () => ({ ledgerName: "家", mode: "member" }) };
      if (name.includes("ledger.store"))
        return {
          joinLedgerByInviteToken: async () => {
            joined += 1;
            throw new Error("test");
          },
        };
      return {};
    },
  });
  const context = {
    ...page,
    data: { ...page.data, inviteToken: "K7M92P4X" },
    setData(value) {
      Object.assign(this.data, value);
    },
  };
  await context.previewInvite();
  assert.equal(context.data.status, "preview");
  assert.equal(joined, 0);
  await context.joinLedger();
  assert.equal(joined, 1);
});

test("成员退出、角色变更及所有权转移保留历史成员身份并验证权限", async () => {
  const { handler, rows } = setup();
  const ledger = rows.ledgers.ledger;
  ledger.memberOpenids.push("member");
  ledger.members.push({ openid: "owner", role: "owner" }, { openid: "member", role: "member" });
  ledger.viewerOpenids.push("guest");
  ledger.viewers.push({ openid: "guest" });
  await assert.rejects(
    handler.changeLedgerMemberRole("guest", {
      ledgerId: "ledger",
      targetOpenid: "member",
      role: "visitor",
    }),
    /OWNER/
  );
  await handler.changeLedgerMemberRole("owner", {
    ledgerId: "ledger",
    targetOpenid: "guest",
    role: "member",
  });
  assert.equal(ledger.memberOpenids.includes("guest"), true);
  await handler.changeLedgerMemberRole("owner", {
    ledgerId: "ledger",
    targetOpenid: "guest",
    role: "visitor",
  });
  assert.equal(ledger.viewerOpenids.includes("guest"), true);
  assert.equal(ledger.memberOpenids.includes("guest"), false);
  await assert.rejects(
    handler.requestOwnerTransfer("owner", { ledgerId: "ledger", targetOpenid: "guest" }),
    /TRANSFER/
  );
  await handler.requestOwnerTransfer("owner", { ledgerId: "ledger", targetOpenid: "member" });
  await assert.rejects(handler.acceptOwnerTransfer("guest", { ledgerId: "ledger" }), /TRANSFER/);
  await handler.acceptOwnerTransfer("member", { ledgerId: "ledger" });
  assert.equal(ledger.ownerOpenid, "member");
  assert.equal(ledger.members.find((row) => row.openid === "owner").role, "member");
  await handler.leaveLedger("owner", { ledgerId: "ledger" });
  assert.equal(ledger.memberOpenids.includes("owner"), false);
  await assert.rejects(handler.leaveLedger("member", { ledgerId: "ledger" }), /OWNER/);
});

test("无账本用户加入后进入账本，已有账本用户自主选择切换", async () => {
  async function run(currentLedgerId) {
    let page;
    let opened = 0;
    const app = { globalData: { user: { currentLedgerId } }, persistAuthState() {} };
    const service = {
      setCurrentLedger: async () => {
        opened += 1;
        return { ledger: { _id: "ledger" }, role: "member" };
      },
    };
    const store = {
      joinLedgerByInviteToken: async () => ({ ledgerId: "ledger" }),
      refreshLedgers: async () => {},
    };
    vm.runInNewContext(fs.readFileSync("miniprogram/pages/ledger-invite-code/index.js", "utf8"), {
      getApp: () => app,
      Page: (definition) => {
        page = definition;
      },
      require: (name) =>
        name.includes("ledger.service")
          ? service
          : name.includes("ledger.store")
            ? store
            : { showToast() {} },
      wx: { reLaunch() {} },
    });
    page.data = { code: "K7M92P4X", busy: false };
    page.setData = (values) => Object.assign(page.data, values);
    await page.join();
    return { opened, page };
  }
  assert.equal((await run("")).opened, 1);
  const existing = await run("other-ledger");
  assert.equal(existing.opened, 0);
  assert.equal(existing.page.data.status, "success");
});

test("邀请码输入支持粘贴分隔符、错误提示及预览后返回修改", async () => {
  let page;
  let calls = 0;
  let submitted = "";
  const feedback = [];
  vm.runInNewContext(fs.readFileSync("miniprogram/pages/ledger-invite-code/index.js", "utf8"), {
    getApp: () => ({ globalData: {} }),
    Page: (definition) => {
      page = definition;
    },
    require: (name) =>
      name.includes("ledger.service")
        ? {
            previewLedgerInvite: async (code) => {
              calls += 1;
              submitted = code;
              return { ledgerName: "家" };
            },
          }
        : name.includes("ledger.store")
          ? {}
          : { showToast: (message) => feedback.push(message) },
    wx: { hideKeyboard() {} },
  });
  page.data = structuredClone(page.data);
  page.setData = (values) => Object.assign(page.data, values);
  page.onInput({ detail: { value: "" } });
  await page.previewInvite();
  assert.equal(calls, 0);
  assert.ok(feedback.length);
  page.onInput({ detail: { value: "k7m9 - 2p4x" } });
  await page.previewInvite();
  assert.equal(submitted, "K7M92P4X");
  assert.equal(page.data.status, "preview");
  page.editCode();
  assert.equal(page.data.status, "input");
  assert.equal(page.data.code, "K7M92P4X");
});

function deletionFixture(failAt = "") {
  const state = {
    ledgers: { ledger: { _id: "ledger", ownerOpenid: "owner", syncRevision: 1 } },
    records: { r1: { _id: "r1", ledgerId: "ledger" }, r2: { _id: "r2", ledgerId: "ledger" } },
    categories: { c1: { _id: "c1", ledgerId: "ledger" } },
    ledgerInvites: { i1: { _id: "i1", ledgerId: "ledger" } },
    ledgerOperations: {},
    users: {},
  };
  let failed = false;
  let nextId = 0;
  const collection = (name) => ({
    where: (query) => ({
      limit: (limit) => ({
        get: async () => ({
          data: Object.values(state[name])
            .filter((row) => Object.entries(query).every(([key, value]) => row[key] === value))
            .slice(0, limit),
        }),
      }),
    }),
    add: async ({ data }) => {
      const id = `op-${++nextId}`;
      state[name][id] = { ...data, _id: id };
      return { _id: id };
    },
    doc: (id) => ({
      get: async () => ({ data: state[name][id] ? { ...state[name][id] } : null }),
      update: async ({ data }) => {
        if (!failed && name === "ledgerOperations" && data.stage === failAt) {
          failed = true;
          throw new Error("INJECTED_FAILURE");
        }
        const row = state[name][id];
        for (const [key, value] of Object.entries(data))
          row[key] = value && value.inc ? (row[key] || 0) + value.inc : value;
      },
      remove: async () => {
        if (!state[name][id]) throw new Error("does not exist");
        delete state[name][id];
      },
    }),
  });
  const helpers = {
    db: { collection, runTransaction: async (fn) => fn({ collection }) },
    _: { inc: (inc) => ({ inc }) },
    ok: (data) => ({ success: true, data }),
    now: () => 1,
    getLedgerById: async (id) => (state.ledgers[id] ? { ...state.ledgers[id] } : null),
    getOperation: async (type, key) =>
      Object.values(state.ledgerOperations).find((row) => row.type === type && row.key === key) ||
      null,
    getUser: async () => null,
    listLedgersForUser: async () => [],
    assertLedgerId: () => {},
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync("cloudfunctions/ourNest/handlers/ledger.handler.js", "utf8"), {
    module,
    console,
    Date,
    require: (name) => {
      if (name.includes("ledger-state"))
        return require("../cloudfunctions/ourNest/shared/ledger-state");
      if (name.includes("helpers")) return helpers;
      if (name === "crypto") return require("node:crypto");
      return {};
    },
  });
  return { state, handler: module.exports };
}

test("ledger deletion resumes after an interrupted stage and preserves unrelated assets", async () => {
  const { handler, state } = deletionFixture("categories");
  state.records.other = { _id: "other", ledgerId: "another" };
  state.ledgerOperations.file = { _id: "file", type: "import-file-reference", references: 1 };
  await assert.rejects(handler.deleteLedger("owner", { ledgerId: "ledger" }), /INJECTED_FAILURE/);
  assert.equal(state.ledgers.ledger.deletionState, "deleting");
  const operation = Object.values(state.ledgerOperations).find(
    (row) => row.type === "ledger-delete"
  );
  assert.equal(operation.stage, "records");
  const result = await handler.deleteLedger("owner", { ledgerId: "ledger" });
  assert.equal(result.success, true);
  assert.equal(state.ledgers.ledger, undefined);
  assert.equal(operation.stage, "complete");
  assert.deepEqual(Object.keys(state.records), ["other"]);
  assert.equal(Object.keys(state.categories).length, 0);
  assert.equal(Object.keys(state.ledgerInvites).length, 0);
  assert.equal(state.ledgerOperations.file.references, 1);
  const repeated = await handler.deleteLedger("owner", { ledgerId: "ledger" });
  assert.equal(repeated.data.operationId, operation._id);
});

test("ledger deletion rejects non-owner and active category migration", async () => {
  const first = deletionFixture();
  await assert.rejects(
    first.handler.deleteLedger("member", { ledgerId: "ledger" }),
    /ONLY_OWNER_CAN_DELETE_LEDGER/
  );
  assert.equal(Object.keys(first.state.ledgerOperations).length, 0);
  const second = deletionFixture();
  second.state.ledgers.ledger.categoryDeletionId = "category";
  await assert.rejects(
    second.handler.deleteLedger("owner", { ledgerId: "ledger" }),
    /CATEGORY_DELETION_IN_PROGRESS/
  );
  assert.equal(Object.keys(second.state.ledgerOperations).length, 0);
});

for (const stage of ["invites", "ledger"]) {
  test(`ledger deletion retries safely after failure advancing to ${stage}`, async () => {
    const { handler, state } = deletionFixture(stage);
    await assert.rejects(handler.deleteLedger("owner", { ledgerId: "ledger" }), /INJECTED_FAILURE/);
    assert.equal(state.ledgers.ledger.deletionState, "deleting");
    await handler.deleteLedger("owner", { ledgerId: "ledger" });
    assert.equal(state.ledgers.ledger, undefined);
    assert.equal(Object.keys(state.records).length, 0);
    assert.equal(Object.keys(state.categories).length, 0);
    assert.equal(Object.keys(state.ledgerInvites).length, 0);
  });
}
