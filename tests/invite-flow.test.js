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
  };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync("cloudfunctions/ourNest/handlers/ledger.handler.js", "utf8"), {
    module: mod,
    exports: mod.exports,
    Date,
    console,
    require: (name) => {
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
