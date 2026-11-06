const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

test("hidden analysis views mark dirty without issuing an analysis request", async () => {
  const filename = path.resolve("miniprogram/components/tl-tab-analysis/index.js");
  const requireFromComponent = createRequire(filename);
  let calls = 0;
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8").replace(/^import .*;\r?\n/, ""), {
    getApp: () => ({ globalData: {} }),
    require: (name) =>
      name.includes("ledger.service")
        ? { getAnalysis: async () => (calls += 1) }
        : requireFromComponent(name),
    Component: (value) => {
      definition = value;
    },
    console,
  });
  const instance = {
    ...definition.methods,
    data: { ...definition.data, active: false, foreground: true, ledgerId: "ledger" },
    isAttached: true,
    dirty: false,
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };

  await instance.loadAnalysis();
  assert.equal(calls, 0);
  assert.equal(instance.dirty, true);
});
