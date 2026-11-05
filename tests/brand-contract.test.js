const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_AVATAR_URL } = require("../miniprogram/utils/avatar");
const { assertProfileInput } = require("../cloudfunctions/ourNest/validators/schemas");

const LOGO_URL = "/images/brand/our-nest-logo-256-transparent.png";

test("OurNest default avatar resolves to a bundled logo", () => {
  assert.equal(DEFAULT_AVATAR_URL, LOGO_URL);
  assert.ok(fs.existsSync(path.join("miniprogram", LOGO_URL)));
  const helpers = fs.readFileSync("cloudfunctions/ourNest/shared/helpers.js", "utf8");
  assert.ok(helpers.includes(`const defaultAvatarUrl = "${LOGO_URL}";`));
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
