const SPECIAL_TRANSACTION = /退款|转账|还款|充值|提现|理财|零钱通|基金|信用卡/;
const SUCCESS_STATUS = new Set([
  "支付成功",
  "交易成功",
  "交易完成",
  "收款成功",
  "已收钱",
  "已存入零钱",
]);
const CLOSED_STATUS = /关闭|失败|撤销|取消|已过期/;

function clean(value) {
  return String(value === undefined || value === null ? "" : value)
    .trim()
    .replace(/^`/, "")
    .trim();
}

function read(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== "") return clean(row[name]);
  }
  return "";
}

function detectSource(headers = []) {
  const names = headers.map(clean);
  if (
    names.includes("交易时间") &&
    names.includes("当前状态") &&
    names.includes("交易单号") &&
    names.includes("收/支")
  )
    return "wechat";
  if (
    names.includes("交易时间") &&
    names.includes("交易状态") &&
    names.includes("交易订单号") &&
    (names.includes("收/支") || names.includes("收/支出"))
  )
    return "alipay";
  return "";
}

function parseSourceRow(source, row = {}) {
  const rawDirection = read(row, ["收/支", "收/支出"]);
  const type = rawDirection === "收入" ? "income" : rawDirection === "支出" ? "expense" : "";
  const status = read(row, ["当前状态", "交易状态"]);
  const transactionType = read(row, ["交易类型", "交易分类"]);
  const product = read(row, ["商品", "商品说明"]);
  const merchant = read(row, ["交易对方"]);
  const rawDateTime = row["交易时间"];
  const dateTime =
    Object.prototype.toString.call(rawDateTime) === "[object Date]" &&
    Number.isFinite(rawDateTime.getTime())
      ? new Date(Math.round(rawDateTime.getTime() / 1000) * 1000)
          .toISOString()
          .replace("T", " ")
          .slice(0, 19)
      : read(row, ["交易时间"]);
  const rawAmount = read(row, ["金额(元)", "金额（元）", "金额"]);
  const amount = Number(rawAmount.replace(/[¥￥,\s]/g, ""));
  const transactionField = source === "wechat" ? "交易单号" : "交易订单号";
  const rawTransactionId = row[transactionField];
  const candidateId = typeof rawTransactionId === "string" ? clean(rawTransactionId) : "";
  const transactionId = /^[a-zA-Z0-9_-]{6,128}$/.test(candidateId) ? candidateId : "";
  const special = SPECIAL_TRANSACTION.test(`${transactionType} ${product}`);
  const closed = CLOSED_STATUS.test(status);
  let reviewReason = "";
  if (closed) reviewReason = "交易未成功，不计入收支";
  else if (special) reviewReason = "特殊交易，需确认是否计入收支";
  else if (!SUCCESS_STATUS.has(status)) reviewReason = "交易状态未确认，需人工核对";
  else if (!type) reviewReason = "收支方向未确认";
  return {
    source,
    transactionId,
    date: dateTime.slice(0, 10),
    time: dateTime.length > 10 ? dateTime.slice(11, 19) : "",
    type,
    amount,
    merchant,
    product,
    status,
    transactionType,
    sourceKind: /退款/.test(`${transactionType} ${product} ${status}`) ? "refund" : "transaction",
    account: read(row, ["支付方式", "收/付款方式"]),
    note: read(row, ["备注"]),
    excluded: closed,
    needsReview: Boolean(reviewReason) && !closed,
    reviewReason,
    sourceIdWarning: transactionId ? "" : "交易单号缺失或精度不可靠，无法用于确定去重",
  };
}

function parseSourceTable(table = [], firstRow = 1) {
  for (let index = 0; index < table.length; index += 1) {
    const headers = table[index] || [];
    const source = detectSource(headers);
    if (!source) continue;
    const names = headers.map(clean);
    const rows = [];
    for (let rowIndex = index + 1; rowIndex < table.length; rowIndex += 1) {
      const cells = table[rowIndex] || [];
      if (!cells.some((cell) => clean(cell))) continue;
      const row = names.reduce((item, name, position) => {
        if (name) item[name] = cells[position];
        return item;
      }, {});
      if (!read(row, ["交易时间"])) continue;
      rows.push({ rowNumber: firstRow + rowIndex, ...parseSourceRow(source, row) });
    }
    return { source, rows };
  }
  return null;
}

module.exports = { detectSource, parseSourceRow, parseSourceTable };
