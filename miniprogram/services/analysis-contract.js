function contractError(path, message) {
  const error = new Error(`ANALYSIS_CONTRACT_INVALID:${path}:${message}`);
  error.code = "ANALYSIS_CONTRACT_INVALID";
  error.path = path;
  return error;
}

function assertObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw contractError(path, "object required");
  return value;
}

function assertArray(value, path) {
  if (!Array.isArray(value)) throw contractError(path, "array required");
  return value;
}

function assertFiniteNumber(value, path) {
  if (!Number.isFinite(value)) throw contractError(path, "finite number required");
  return value;
}

function assertNonNegativeInteger(value, path) {
  if (!Number.isInteger(value) || value < 0)
    throw contractError(path, "non-negative integer required");
  return value;
}

function assertDate(value, path) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw contractError(path, "YYYY-MM-DD required");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw contractError(path, "valid date required");
  return value;
}

function assertAmountRows(rows, path, type) {
  let cents = 0;
  for (const [index, row] of rows.entries()) {
    assertObject(row, `${path}[${index}]`);
    assertFiniteNumber(row.amount, `${path}[${index}].amount`);
    if (type && row.type && row.type !== type)
      throw contractError(`${path}[${index}].type`, "unexpected type");
    cents += Math.round(row.amount * 100);
  }
  return cents;
}

function validateAnalysisResponse(data, request = {}) {
  assertObject(data, "response");
  const ledger = assertObject(data.ledger, "ledger");
  if (request.ledgerId && ledger._id !== request.ledgerId)
    throw contractError("ledger._id", "does not match request");
  const range = assertObject(data.range, "range");
  const start = assertDate(range.start, "range.start");
  const end = assertDate(range.end, "range.end");
  if (start >= end) throw contractError("range", "end must be after start");

  const overview = assertObject(data.overview, "overview");
  for (const key of ["income", "expense", "balance"])
    assertFiniteNumber(overview[key], `overview.${key}`);
  assertNonNegativeInteger(overview.recordCount, "overview.recordCount");

  if (!request.analysisView) return data;

  const dashboard = assertObject(data.dashboard, "dashboard");
  const type = request.analysisType || "expense";
  if (dashboard.type !== type) throw contractError("dashboard.type", "does not match request");
  assertFiniteNumber(dashboard.total, "dashboard.total");
  assertNonNegativeInteger(dashboard.recordCount, "dashboard.recordCount");
  for (const key of ["daily", "categories", "accounts", "topRecords"])
    assertArray(dashboard[key], `dashboard.${key}`);

  const dailyCents = assertAmountRows(
    dashboard.daily.map((row, index) => {
      assertDate(row.date, `dashboard.daily[${index}].date`);
      return { amount: row[type] };
    }),
    "dashboard.daily",
    type
  );
  const categoryCents = assertAmountRows(dashboard.categories, "dashboard.categories", type);
  const accountCents = assertAmountRows(dashboard.accounts, "dashboard.accounts", type);
  const totalCents = Math.round(dashboard.total * 100);
  for (const [path, cents] of [
    ["dashboard.daily", dailyCents],
    ["dashboard.categories", categoryCents],
    ["dashboard.accounts", accountCents],
  ]) {
    if (cents !== totalCents) throw contractError(path, "does not conserve dashboard.total");
  }
  return data;
}

module.exports = { validateAnalysisResponse };
