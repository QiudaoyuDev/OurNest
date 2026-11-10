const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { PNG } = require("pngjs");
const { DEFAULT_AVATAR_URL } = require("../miniprogram/utils/avatar");
const { assertProfileInput } = require("../cloudfunctions/ourNest/validators/schemas");

const LOGO_URL = "/images/brand/our-nest-logo-256-transparent.png";

test("OurNest default avatar resolves to a bundled logo", () => {
  assert.equal(DEFAULT_AVATAR_URL, LOGO_URL);
  assert.ok(fs.existsSync(path.join("miniprogram", LOGO_URL)));
  const helpers = fs.readFileSync("cloudfunctions/ourNest/shared/helpers.js", "utf8");
  assert.ok(helpers.includes(`const defaultAvatarUrl = "${LOGO_URL}";`));
});

test("OurNest bundled logo matches the approved two-layer nest artwork", () => {
  const bundled = fs.readFileSync(path.join("miniprogram", LOGO_URL));
  assert.deepEqual(bundled, fs.readFileSync("outputs/brand/our-nest-logo-256-transparent.png"));
  const image = PNG.sync.read(bundled);
  assert.equal(image.width, 256);
  assert.equal(image.height, 256);
  const pixel = (x, y) =>
    Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
  assert.equal(pixel(0, 0)[3], 0);
  assert.equal(pixel(128, 95)[3], 0);
  assert.deepEqual(pixel(108, 87), [240, 68, 47, 255]);
  assert.deepEqual(pixel(128, 161), [240, 68, 47, 255]);
  assert.equal(pixel(128, 176)[3], 0);
  assert.deepEqual(pixel(128, 191), [240, 68, 47, 255]);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] === 0) continue;
    assert.deepEqual(Array.from(image.data.subarray(offset, offset + 3)), [240, 68, 47]);
  }
});

test("OurNest platform icon remains an opaque square with the same nest artwork", () => {
  const image = PNG.sync.read(fs.readFileSync("outputs/brand/our-nest-app-icon-1024.png"));
  assert.equal(image.width, 1024);
  assert.equal(image.height, 1024);
  assert.deepEqual(Array.from(image.data.subarray(0, 4)), [240, 68, 47, 255]);
  for (let offset = 3; offset < image.data.length; offset += 4) {
    assert.equal(image.data[offset], 255);
  }
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

test("OurNest entry copy welcomes individual and shared-ledger use without family-only wording", () => {
  const navbar = fs.readFileSync("miniprogram/components/tl-navbar/index.wxml", "utf8");
  const keypad = fs.readFileSync("miniprogram/components/tl-record-form/index.wxml", "utf8");
  const login = fs.readFileSync("miniprogram/pages/login/index.wxml", "utf8");
  const profile = fs.readFileSync("miniprogram/components/tl-tab-profile/index.wxml", "utf8");
  assert.match(navbar, /class="brand-name">OurNest<\/text>/);
  assert.match(keypad, /<text>记一笔<\/text>/);
  assert.match(login, /记好每一笔，生活更有数。/);
  assert.match(login, /顺手记一笔/);
  assert.match(profile, /class="function-tip">查看最近更新<\/view>/);
  assert.doesNotMatch(navbar + keypad, /咱家记一笔/);
  assert.doesNotMatch(login, /家庭与个人记账小程序/);
  assert.doesNotMatch(profile, /查看咱家小账最近变化/);
});

test("OurNest import template uses the application storage namespace", () => {
  const source = fs.readFileSync("cloudfunctions/ourNest/handlers/record.handler.js", "utf8");
  assert.ok(source.includes('cloudPath: "templates/our-nest-import-template.xlsx"'));
});

test("OurNest application version is defined as V0.0.1 and displayed below changelog", () => {
  const appSource = fs.readFileSync("miniprogram/app.js", "utf8");
  assert.match(appSource, /const\s+APP_VERSION\s*=\s*["']V0\.0\.1["']/);
  assert.match(appSource, /version:\s*APP_VERSION/);

  const profileWxml = fs.readFileSync("miniprogram/components/tl-tab-profile/index.wxml", "utf8");
  assert.match(profileWxml, /viewChangelog[\s\S]*?viewVersion/);
  assert.match(profileWxml, /class="function-title">版本号<\/view>/);
  assert.match(profileWxml, /class="function-value">\{\{version\}\}<\/view>/);

  const profileJs = fs.readFileSync("miniprogram/components/tl-tab-profile/index.js", "utf8");
  assert.match(profileJs, /const\s+APP_VERSION\s*=\s*["']V0\.0\.1["']/);
  assert.match(profileJs, /version:\s*APP_VERSION/);
  assert.match(profileJs, /viewVersion\(\)\s*\{/);
});
