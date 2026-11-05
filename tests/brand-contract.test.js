const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { DEFAULT_AVATAR_URL } = require("../miniprogram/utils/avatar");
const { assertProfileInput } = require("../cloudfunctions/ourNest/validators/schemas");

const LOGO_URL = "/images/brand/our-nest-logo-256-transparent.png";

test("OurNest default avatar resolves to a bundled logo", () => {
  assert.equal(DEFAULT_AVATAR_URL, LOGO_URL);
  assert.ok(fs.existsSync(path.join("miniprogram", LOGO_URL)));
  const helpers = fs.readFileSync("cloudfunctions/ourNest/shared/helpers.js", "utf8");
  assert.ok(helpers.includes(`const defaultAvatarUrl = "${LOGO_URL}";`));
});

test("OurNest user reads normalize bundled avatars without changing stored profiles", async () => {
  const stored = [
    {
      _id: "user-1",
      openid: "member-1",
      userNo: 1234,
      nickName: "微信用户",
      currentLedgerId: "ledger-1",
      avatarUrl: "/images/brand/unavailable-logo.png",
    },
    { openid: "member-2", avatarUrl: "cloud://test/custom-avatar.png" },
  ];
  const updates = [];
  const query = {
    limit: () => query,
    get: async () => ({ data: stored }),
    count: async () => ({ total: 0 }),
  };
  const db = {
    command: { aggregate: {}, in: (values) => values, or: (values) => values },
    serverDate: () => new Date(),
    collection: () => ({
      where: () => query,
      doc: () => ({ update: async ({ data }) => updates.push(data) }),
    }),
  };
  const cloud = { init() {}, database: () => db };
  const context = { module: { exports: {} }, require: () => cloud };
  vm.runInNewContext(fs.readFileSync("cloudfunctions/ourNest/shared/helpers.js", "utf8"), context);
  const helpers = context.module.exports;

  assert.equal((await helpers.getUser("member-1")).avatarUrl, LOGO_URL);
  const members = await helpers.getUsersByOpenids(["member-1", "member-2"]);
  assert.equal(members["member-1"].avatarUrl, LOGO_URL);
  assert.equal(members["member-2"].avatarUrl, stored[1].avatarUrl);
  assert.equal(stored[0].avatarUrl, "/images/brand/unavailable-logo.png");

  const authContext = {
    module: { exports: {} },
    require: (name) =>
      name === "../shared/helpers"
        ? { ...helpers, db, _: db.command, getLedgerById: async () => ({ _id: "ledger-1" }) }
        : { assertOpenid() {} },
  };
  vm.runInNewContext(
    fs.readFileSync("cloudfunctions/ourNest/handlers/auth.handler.js", "utf8"),
    authContext
  );
  const result = await authContext.module.exports.login("member-1");
  assert.equal(result.data.user.avatarUrl, LOGO_URL);
  assert.equal(result.data.user.nickName, "小家成员#1234");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].nickName, "小家成员#1234");
  assert.equal(Object.hasOwn(updates[0], "avatarUrl"), false);
  assert.equal(stored[0].avatarUrl, "/images/brand/unavailable-logo.png");
});

test("OurNest profiles preserve the system nickname ownership rule", () => {
  const systemNickName = "小家成员#1234";
  assert.equal(
    assertProfileInput({ nickName: systemNickName, systemNickName }).nickName,
    systemNickName
  );
  assert.throws(
    () => assertProfileInput({ nickName: "小家成员#5678", systemNickName }),
    (error) => error.code === "RESERVED_NICKNAME"
  );
  assert.equal(
    assertProfileInput({ nickName: "OurNest成员", systemNickName }).nickName,
    "OurNest成员"
  );
});

test("OurNest import template uses the application storage namespace", () => {
  const source = fs.readFileSync("cloudfunctions/ourNest/handlers/record.handler.js", "utf8");
  assert.ok(source.includes('cloudPath: "templates/our-nest-import-template.xlsx"'));
});
