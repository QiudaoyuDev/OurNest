const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeInviteCode, getInviteStatus } = require("../cloudfunctions/ourNest/invite-code");

test("邀请码统一大小写和分隔符，拒绝非法输入", () => {
  assert.equal(normalizeInviteCode("k7m9-2p4x"), "K7M92P4X");
  assert.equal(normalizeInviteCode("K7M9!2P4X"), "");
});

test("邀请码只能在有效期内由一人领取，同一人可以重试", () => {
  const invite = { expiresAt: 1000, claimedOpenid: "" };
  assert.equal(getInviteStatus(invite, "a", 999), "available");
  assert.equal(getInviteStatus(invite, "a", 1000), "expired");
  assert.equal(getInviteStatus({ ...invite, claimedOpenid: "a" }, "a", 2000), "claimed-by-self");
  assert.equal(getInviteStatus({ ...invite, claimedOpenid: "a" }, "b", 999), "claimed");
});
