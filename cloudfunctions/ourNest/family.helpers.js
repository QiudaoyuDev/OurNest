const { groupCategories, moneyCents } = require("./analysis.helpers");

const UNKNOWN_ATTRIBUTION = Object.freeze({
  payerOpenid: "",
  consumerKind: "unknown",
  consumerOpenid: "",
});

function normalizeFamilyAttribution({ ledger, openid, input, existing, isImport = false }) {
  if (input === undefined || input === null) {
    if (existing) return { ...UNKNOWN_ATTRIBUTION, ...existing };
    if (!isImport && (ledger.type || "personal") === "personal") {
      return { payerOpenid: openid, consumerKind: "personal", consumerOpenid: openid };
    }
    return { ...UNKNOWN_ATTRIBUTION };
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("INVALID_FAMILY_ATTRIBUTION");
  if ((ledger.type || "personal") !== "shared") throw new Error("FAMILY_ATTRIBUTION_SHARED_ONLY");
  const members = new Set([ledger.ownerOpenid, ...(ledger.memberOpenids || [])].filter(Boolean));
  const payerOpenid = String(input.payerOpenid || "");
  const consumerKind = String(input.consumerKind || "unknown");
  const consumerOpenid = consumerKind === "personal" ? String(input.consumerOpenid || "") : "";
  if (!["personal", "public", "multiple", "unknown"].includes(consumerKind))
    throw new Error("INVALID_FAMILY_ATTRIBUTION");
  const keepPrior = (field, value) => Boolean(existing && value && existing[field] === value);
  if (payerOpenid && !members.has(payerOpenid) && !keepPrior("payerOpenid", payerOpenid))
    throw new Error("INVALID_FAMILY_MEMBER");
  if (
    consumerKind === "personal" &&
    (!consumerOpenid ||
      (!members.has(consumerOpenid) && !keepPrior("consumerOpenid", consumerOpenid)))
  )
    throw new Error("INVALID_FAMILY_MEMBER");
  return { payerOpenid, consumerKind, consumerOpenid };
}

function familyExpenseGroups(records = []) {
  const payers = new Map();
  const consumers = new Map();
  let total = 0;
  const add = (map, id, amount, kind, record) => {
    const key = id || "";
    const item = map.get(key) || {
      openid: key,
      amount: 0,
      recordCount: 0,
      publicAmount: 0,
      multipleAmount: 0,
      categoryRecords: [],
    };
    item.amount += amount;
    item.recordCount += 1;
    item.categoryRecords.push(record);
    if (kind === "public") item.publicAmount += amount;
    if (kind === "multiple") item.multipleAmount += amount;
    map.set(key, item);
  };
  records
    .filter((record) => record.type === "expense")
    .forEach((record) => {
      const amount = moneyCents(record.amount);
      const attribution = { ...UNKNOWN_ATTRIBUTION, ...(record.familyAttribution || {}) };
      total += amount;
      add(payers, attribution.payerOpenid, amount, "", record);
      let consumer = "";
      if (attribution.consumerKind === "personal") consumer = attribution.consumerOpenid;
      if (["public", "multiple"].includes(attribution.consumerKind))
        consumer = record.ownerOpenid || "";
      add(consumers, consumer, amount, attribution.consumerKind, record);
    });
  const normalize = (map) =>
    Array.from(map.values())
      .map((item) => ({
        ...Object.fromEntries(Object.entries(item).filter(([key]) => key !== "categoryRecords")),
        categories: groupCategories(item.categoryRecords, "expense"),
        amount: item.amount / 100,
        publicAmount: item.publicAmount / 100,
        multipleAmount: item.multipleAmount / 100,
        rate: total ? Math.round((item.amount * 100) / total) : 0,
      }))
      .sort((left, right) => right.amount - left.amount);
  return {
    total: total / 100,
    payers: normalize(payers),
    consumers: normalize(consumers),
  };
}

function creatorExpenseGroups(records = []) {
  const groups = new Map();
  records
    .filter((record) => record.type === "expense")
    .forEach((record) => {
      const id = String(record.ownerOpenid || "");
      const item = groups.get(id) || { openid: id, amount: 0, recordCount: 0, records: [] };
      item.amount += moneyCents(record.amount);
      item.recordCount += 1;
      item.records.push(record);
      groups.set(id, item);
    });
  return Array.from(groups.values())
    .map((item) => ({
      openid: item.openid,
      amount: item.amount / 100,
      recordCount: item.recordCount,
      categories: groupCategories(item.records, "expense"),
    }))
    .sort((left, right) => right.amount - left.amount);
}

module.exports = {
  UNKNOWN_ATTRIBUTION,
  normalizeFamilyAttribution,
  familyExpenseGroups,
  creatorExpenseGroups,
};
