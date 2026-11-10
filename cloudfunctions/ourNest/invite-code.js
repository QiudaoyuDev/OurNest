const crypto = require("crypto");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createInviteCode() {
  return Array.from(crypto.randomBytes(8), (value) => ALPHABET[value % ALPHABET.length]).join("");
}

function normalizeInviteCode(value) {
  const code = String(value || "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
  return /^[A-HJ-NP-Z2-9]{8}$/.test(code) ? code : "";
}

function getInviteStatus(invite, openid, currentTime = Date.now()) {
  if (!invite) return "invalid";
  if (invite.revokedAt) return "revoked";
  if (invite.claimedOpenid === openid && openid) return "claimed-by-self";
  if (invite.claimedOpenid) return "claimed";
  return Number(invite.expiresAt) > currentTime ? "available" : "expired";
}

module.exports = { createInviteCode, normalizeInviteCode, getInviteStatus };
