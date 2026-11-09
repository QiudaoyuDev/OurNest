const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadApi(callFunction) {
  const context = {
    wx: { cloud: { callFunction } },
    module: { exports: {} },
    console: { error() {} },
  };
  vm.runInNewContext(fs.readFileSync("miniprogram/services/api.js", "utf8"), context);
  return context.module.exports.callApi;
}

test("API calls ourNest with the unchanged route protocol", async () => {
  let request;
  const payload = { ledgerId: "ledger-1" };
  const data = { records: [] };
  const callApi = loadApi(async (options) => {
    request = options;
    return { result: { ok: true, data } };
  });

  assert.equal(await callApi("record/list", payload), data);
  assert.equal(request.name, "ourNest");
  assert.equal(request.data.route, "record/list");
  assert.equal(request.data.payload, payload);
});

test("API preserves business errors from ourNest", async () => {
  const callApi = loadApi(async () => ({
    result: { ok: false, error: { code: "FORBIDDEN", message: "无权限" } },
  }));

  await assert.rejects(callApi("record/create"), (error) => {
    assert.equal(error.code, "FORBIDDEN");
    assert.equal(error.message, "无权限");
    assert.equal(error.route, "record/create");
    return true;
  });
});

test("API preserves RECORD_SNAPSHOT_CHANGED for pagination recovery", async () => {
  const callApi = loadApi(async () => ({
    result: {
      ok: false,
      error: { code: "RECORD_SNAPSHOT_CHANGED", message: "RECORD_SNAPSHOT_CHANGED" },
    },
  }));

  await assert.rejects(callApi("record/list", { cursor: { id: "stale" } }), (error) => {
    assert.equal(error.code, "RECORD_SNAPSHOT_CHANGED");
    assert.equal(error.message, "RECORD_SNAPSHOT_CHANGED");
    assert.equal(error.route, "record/list");
    return true;
  });
});

test("API does not retry writes on transport failure", async () => {
  const requests = [];
  const failure = new Error("transport failed");
  const callApi = loadApi(async (options) => {
    requests.push(options);
    throw failure;
  });

  await assert.rejects(callApi("record/create", { amount: 10 }), (error) => error === failure);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].name, "ourNest");
});
